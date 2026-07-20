import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { StockSDK } from 'stock-sdk';

const sdk = new StockSDK({
  retry: { maxRetries: 2, baseDelay: 350 },
  providerPolicies: {
    tencent: { timeout: 12000, rateLimit: { requestsPerSecond: 4, maxBurst: 4 } },
    eastmoney: { timeout: 12000, rateLimit: { requestsPerSecond: 3, maxBurst: 3 } },
  },
});

const CORE_MARKETS = [
  { key: 'ndx', market: 'us', symbol: 'NDX', label: 'Nasdaq 100' },
  { key: 'spx', market: 'us', symbol: 'INX', label: 'S&P 500' },
  { key: 'dji', market: 'us', symbol: 'DJI', label: 'Dow Jones' },
  { key: 'hsi', market: 'hk', symbol: 'HSI', label: 'Hang Seng' },
  { key: 'hstec', market: 'hk', symbol: 'HSTECH', label: 'Hang Seng Tech' },
  { key: 'sse', market: 'cn', symbol: 'sh000001', label: 'SSE Composite' },
  { key: 'gold', market: 'us', symbol: 'GLD', label: 'Gold proxy', multiplier: 5.85, prefix: '$', decimals: 0 },
  { key: 'oil', market: 'us', symbol: 'USO', label: 'Oil proxy', multiplier: 0.62, prefix: '$', decimals: 2 },
];

const CRYPTO = [
  { key: 'btc', coinId: 'bitcoin', prefix: '$', decimals: 0 },
  { key: 'eth', coinId: 'ethereum', prefix: '$', decimals: 0 },
];

const SPARKLINE_POINTS = 120;
const SPARKLINE_SOURCES = [
  { key: 'spx', symbol: '^GSPC' },
  { key: 'ndx', symbol: '^NDX' },
  { key: 'dji', symbol: '^DJI' },
  { key: 'hsi', symbol: '^HSI' },
  // Yahoo does not expose HSTECH reliably. 3033.HK is Hang Seng TECH ETF;
  // sparkline only needs shape, while displayed price still comes from stock-sdk.
  { key: 'hstec', symbol: '3033.HK' },
  { key: 'sse', symbol: '000001.SS' },
  { key: 'gold', symbol: 'GLD', multiplier: 5.85, decimals: 2 },
  { key: 'oil', symbol: 'USO', multiplier: 0.62, decimals: 2 },
];

const FOREX_KEYS = {
  USD: 'usdcny',
  HKD: 'hkdcny',
  EUR: 'eurcny',
  JPY: 'jpycny',
  GBP: 'gbpcny',
  THB: 'thbcny',
};

export function formatPrice(price, prefix = '', decimals = 0) {
  if (!Number.isFinite(price)) return null;
  if (decimals === 0) return `${prefix}${Math.round(price).toLocaleString('en-US')}`;
  return `${prefix}${price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatDate(now = new Date()) {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 实时`;
}

async function settleMap(tasks) {
  const entries = await Promise.all(Object.entries(tasks).map(async ([key, task]) => {
    try {
      return [key, await task()];
    } catch (error) {
      console.warn(`[market] ${key} failed: ${error?.message || error}`);
      return [key, null];
    }
  }));
  return Object.fromEntries(entries);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSparkline(values, multiplier = 1, decimals = 2) {
  if (!Array.isArray(values)) return null;
  const clean = values.map(Number).filter(value => Number.isFinite(value) && value > 0);
  if (clean.length < 2) return null;
  // Keep the latest raw closes. Evenly resampling a longer series erases small
  // intraday moves and makes the mini-chart look artificially smooth.
  const sampled = clean.slice(-SPARKLINE_POINTS);
  return sampled.map(v => Number((v * multiplier).toFixed(decimals)));
}

function toQuoteItem(quote, spec) {
  if (!quote || !Number.isFinite(Number(quote.price))) return null;
  const multiplier = spec.multiplier || 1;
  const price = Number(quote.price) * multiplier;
  return {
    price: formatPrice(price, spec.prefix || '', spec.decimals ?? 0),
    change: Number.isFinite(Number(quote.changePercent)) ? Number(Number(quote.changePercent).toFixed(2)) : 0,
    source: 'stock-sdk',
  };
}

async function fetchStockQuotes() {
  const usSymbols = CORE_MARKETS.filter(s => s.market === 'us').map(s => s.symbol);
  const hkSymbols = CORE_MARKETS.filter(s => s.market === 'hk').map(s => s.symbol);
  const cnSymbols = CORE_MARKETS.filter(s => s.market === 'cn').map(s => s.symbol);

  const [us, hk, cn] = await Promise.all([
    usSymbols.length ? sdk.quotes.us(usSymbols) : [],
    hkSymbols.length ? sdk.quotes.hk(hkSymbols) : [],
    cnSymbols.length ? sdk.quotes.cnSimple(cnSymbols) : [],
  ]);

  const byMarketSymbol = new Map();
  for (const q of us) {
    const code = q.code || '';
    byMarketSymbol.set(`us:${code.replace(/^\./, '').split('.')[0]}`, q);
  }
  for (const q of hk) byMarketSymbol.set(`hk:${q.code}`, q);
  for (const q of cn) byMarketSymbol.set(`cn:${q.marketId === '1' ? 'sh' : ''}${q.code}`, q);

  const data = {};
  for (const spec of CORE_MARKETS) {
    const candidates = [
      `${spec.market}:${spec.symbol}`,
      `${spec.market}:${spec.symbol.replace(/^sh/, '')}`,
      `${spec.market}:${spec.symbol.replace(/^hk/, '')}`,
    ];
    const quote = candidates.map(k => byMarketSymbol.get(k)).find(Boolean);
    const item = toQuoteItem(quote, spec);
    if (item) data[spec.key] = item;
  }
  return data;
}

async function fetchCryptoQuotes() {
  const ids = CRYPTO.map(c => c.coinId).join(',');
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
  const json = await r.json();
  const data = {};
  for (const spec of CRYPTO) {
    const coin = json[spec.coinId];
    if (!coin || !Number.isFinite(Number(coin.usd))) continue;
    data[spec.key] = {
      price: formatPrice(Number(coin.usd), spec.prefix, spec.decimals),
      change: Number.isFinite(Number(coin.usd_24h_change)) ? Number(Number(coin.usd_24h_change).toFixed(2)) : 0,
      source: 'coingecko',
    };
  }
  return data;
}

async function fetchYahooSparkline({ symbol, multiplier = 1, decimals = 2 }) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=15m&includePrePost=false`;
  const json = await fetchJsonWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const closes = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
  return normalizeSparkline(closes, multiplier, decimals);
}

async function fetchCryptoSparkline(coinId) {
  const symbol = coinId === 'bitcoin' ? 'BTCUSDT' : coinId === 'ethereum' ? 'ETHUSDT' : null;
  if (!symbol) return null;
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=${SPARKLINE_POINTS}`;
    const json = await fetchJsonWithTimeout(url);
    return normalizeSparkline(json.map(row => row?.[4]), 1, 2);
  } catch (error) {
    // Binance blocks Vercel's US egress (HTTP 451). CoinGecko's one-day chart
    // returns dense intraday prices and keeps production from falling back to
    // the old sparse snapshot.
    console.warn(`[market] Binance ${symbol} sparkline failed, using CoinGecko: ${error?.message || error}`);
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=1`;
    const json = await fetchJsonWithTimeout(url);
    return normalizeSparkline((json.prices || []).map(row => row?.[1]), 1, 2);
  }
}

async function fetchSparklines() {
  const tasks = [
    ...SPARKLINE_SOURCES.map(async spec => [spec.key, await fetchYahooSparkline(spec)]),
    ...CRYPTO.map(async spec => [spec.key, await fetchCryptoSparkline(spec.coinId)]),
  ];

  const entries = await Promise.all(tasks.map(async task => {
    try {
      return await task;
    } catch (error) {
      console.warn(`[market] sparkline failed: ${error?.message || error}`);
      return null;
    }
  }));

  return Object.fromEntries(entries.filter(entry => Array.isArray(entry) && Array.isArray(entry[1])));
}

async function fetchForexQuotes() {
  const r = await fetch('https://open.er-api.com/v6/latest/CNY');
  if (!r.ok) throw new Error(`FX HTTP ${r.status}`);
  const json = await r.json();
  if (json.result !== 'success') throw new Error(`FX result ${json.result || 'unknown'}`);

  const data = {};
  for (const [currency, key] of Object.entries(FOREX_KEYS)) {
    const rate = Number(json.rates?.[currency]);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    data[key] = { price: (1 / rate).toFixed(4), source: 'open-er-api' };
  }
  return data;
}

export async function readExistingMarket(path = new URL('../data/market.json', import.meta.url)) {
  const filePath = path instanceof URL ? path : new URL(path, `file://${process.cwd()}/`);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function preserveNestedFields(next, existing, fields = ['sparkline']) {
  for (const key of Object.keys(next)) {
    if (!next[key] || typeof next[key] !== 'object') continue;
    for (const field of fields) {
      if (next[key][field] === undefined && existing?.[key]?.[field] !== undefined) {
        next[key][field] = existing[key][field];
      }
    }
  }
  return next;
}

export async function buildMarketSnapshot({ existing = {}, preserveStatic = false } = {}) {
  const results = await settleMap({
    stock: fetchStockQuotes,
    crypto: fetchCryptoQuotes,
    forex: fetchForexQuotes,
    sparklines: fetchSparklines,
  });

  const now = new Date();
  const live = {
    date: formatDate(now),
    updated_at: now.toISOString(),
    data_source: 'stock-sdk primary (Tencent/Eastmoney) + Yahoo Finance/Binance dense intraday sparklines + CoinGecko crypto + open.er-api FX',
    ...(results.stock || {}),
    ...(results.crypto || {}),
    ...(results.forex || {}),
  };

  for (const [key, sparkline] of Object.entries(results.sparklines || {})) {
    if (live[key] && sparkline?.length > 1) {
      live[key].sparkline = sparkline;
    }
  }

  preserveNestedFields(live, existing);
  return preserveStatic ? { ...existing, ...live } : live;
}
