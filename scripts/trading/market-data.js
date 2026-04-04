const { FINNHUB_KEY, STOOQ_SYMBOLS } = require('./config');

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPrice(symbol, config) {
  try {
    if (config.type === 'finnhub') {
      const d = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
      return { price: d.c, change: d.dp, high: d.h, low: d.l, prevClose: d.pc };
    }
    if (config.type === 'coingecko') {
      const d = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd&include_24hr_change=true`);
      return { price: d[symbol].usd, change: d[symbol].usd_24h_change };
    }
  } catch (error) {
    return { error: error.message };
  }
  return null;
}

async function getHistoricalPrices(symbol, days = 60) {
  const sources = [
    async () => {
      const stooqSymbol = STOOQ_SYMBOLS[symbol] || `${symbol.toLowerCase()}.us`;
      const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
      const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&d1=${startDate}&d2=${endDate}&i=d`;
      const res = await fetch(url);
      const text = await res.text();
      const lines = text.trim().split('\n').slice(1);
      if (lines.length < 10) throw new Error('No data');
      return lines.map(line => parseFloat(line.split(',')[4])).filter(price => !Number.isNaN(price));
    },
    async () => {
      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - days * 24 * 60 * 60;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
      const d = await fetchJson(url);
      const closes = d.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (!closes || closes.length < 10) throw new Error('No data');
      return closes.filter(close => close !== null);
    }
  ];

  for (const source of sources) {
    try {
      const result = await source();
      if (result && result.length >= 20) return result;
    } catch (_) {
      // Fall through to next source.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return null;
}

module.exports = {
  fetchJson,
  getPrice,
  getHistoricalPrices
};
