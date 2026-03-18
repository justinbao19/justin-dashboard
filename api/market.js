// Vercel Serverless Function - 市场数据代理
const FINNHUB_KEY = 'd6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY || '';
const SPARKLINE_POINTS = 12;
const SPARKLINE_TTL_MS = 6 * 60 * 60 * 1000; // 趋势线缓存 6 小时

// 函数实例内存缓存：复用 warm instance 避免重复打 Twelve Data
const _sparklineCache = {};
function cacheGet(key) {
  const e = _sparklineCache[key];
  if (!e) return undefined;
  if (Date.now() - e.ts > SPARKLINE_TTL_MS) { delete _sparklineCache[key]; return undefined; }
  return e.val;
}
function cacheSet(key, val) { _sparklineCache[key] = { val, ts: Date.now() }; }

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchFinnhub(symbol) {
  try {
    const d = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    return { price: d.c, change: d.dp };
  } catch { return null; }
}

async function fetchSina(symbol) {
  try {
    const r = await fetch(`https://hq.sinajs.cn/list=${symbol}`, {
      headers: { 'Referer': 'https://finance.sina.com.cn' }
    });
    const text = await r.text();
    const line = text.split('"')[1];
    if (!line) return null;
    const parts = line.split(',');
    
    let price, prevClose;
    if (symbol.startsWith('hk')) {
      price = parseFloat(parts[6]);
      prevClose = parseFloat(parts[3]);
    } else if (symbol.startsWith('sh') || symbol.startsWith('sz')) {
      price = parseFloat(parts[3]);
      prevClose = parseFloat(parts[2]);
    } else return null;
    
    const change = prevClose ? ((price - prevClose) / prevClose * 100) : 0;
    return { price, change: Math.round(change * 100) / 100 };
  } catch { return null; }
}

async function fetchCoinGecko(coinId) {
  try {
    const d = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
    const coin = d[coinId];
    return { price: coin.usd, change: Math.round(coin.usd_24h_change * 100) / 100 };
  } catch { return null; }
}

async function fetchForexSina(pair) {
  // 新浪外汇：fx_susdcny, fx_shkdcny, fx_seurcny, fx_sjpycny, fx_sgbpcny
  // 返回格式：时间,当前价,卖出价,买入价,...
  try {
    const r = await fetch(`https://hq.sinajs.cn/list=fx_s${pair}`, {
      headers: { 
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const text = await r.text();
    const line = text.split('"')[1];
    if (!line) return null;
    const parts = line.split(',');
    // parts[0]=时间, parts[1]=当前价, parts[5]=昨收
    const price = parseFloat(parts[1]);
    const prevClose = parseFloat(parts[5]);
    const change = prevClose ? ((price - prevClose) / prevClose * 100) : 0;
    return { price, change: Math.round(change * 100) / 100 };
  } catch { return null; }
}

// 备用汇率源：Exchange Rate API (免费)
async function fetchExchangeRateFallback() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/CNY');
    const d = await r.json();
    if (d.result !== 'success') return null;
    const rates = d.rates;
    return {
      usdcny: rates.USD ? { price: (1 / rates.USD).toFixed(4) } : null,
      hkdcny: rates.HKD ? { price: (1 / rates.HKD).toFixed(4) } : null,
      eurcny: rates.EUR ? { price: (1 / rates.EUR).toFixed(4) } : null,
      jpycny: rates.JPY ? { price: (1 / rates.JPY).toFixed(4) } : null,
      gbpcny: rates.GBP ? { price: (1 / rates.GBP).toFixed(4) } : null,
      thbcny: rates.THB ? { price: (1 / rates.THB).toFixed(4) } : null
    };
  } catch { return null; }
}

function normalizeSparkline(values, multiplier = 1, decimals = 2) {
  if (!Array.isArray(values)) return null;
  const clean = values
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));
  if (clean.length < 2) return null;

  const sampled = clean.length <= SPARKLINE_POINTS
    ? clean
    : Array.from({ length: SPARKLINE_POINTS }, (_, i) => {
        const idx = Math.round((i * (clean.length - 1)) / (SPARKLINE_POINTS - 1));
        return clean[idx];
      });

  return sampled.map(v => Number((v * multiplier).toFixed(decimals)));
}

async function fetchFinnhubCandles(symbol, multiplier = 1, decimals = 2) {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - 14 * 24 * 60 * 60;
    const d = await fetchJson(`https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`);
    if (d.s !== 'ok' || !Array.isArray(d.c)) return null;
    return normalizeSparkline(d.c, multiplier, decimals);
  } catch { return null; }
}

async function fetchTwelveDataSparkline(symbol, multiplier = 1, decimals = 2) {
  if (!TWELVE_DATA_KEY) return null;
  const cacheKey = `td:${symbol}:${multiplier}:${decimals}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const d = await fetchJson(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=14&order=ASC&apikey=${TWELVE_DATA_KEY}`);
    if (!Array.isArray(d.values)) return null;
    const result = normalizeSparkline(d.values.map(v => v.close), multiplier, decimals);
    if (result) cacheSet(cacheKey, result);
    return result;
  } catch { return null; }
}

async function fetchCoinGeckoSparklineWithCache(coinId) {
  const cacheKey = `cg:${coinId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const d = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=7&interval=daily`);
    const result = normalizeSparkline(d.prices?.map(p => p[1]), 1, 2);
    if (result) cacheSet(cacheKey, result);
    return result;
  } catch { return null; }
}

async function fetchPreferredSparkline({ twelveSymbol, finnhubSymbol, multiplier = 1, decimals = 2 }) {
  const fromTwelve = await fetchTwelveDataSparkline(twelveSymbol, multiplier, decimals);
  if (fromTwelve) return fromTwelve;
  if (finnhubSymbol) return fetchFinnhubCandles(finnhubSymbol, multiplier, decimals);
  return null;
}

function fmt(price, prefix = '', decimals = 0) {
  if (decimals === 0) return `${prefix}${Math.round(price).toLocaleString()}`;
  return `${prefix}${price.toFixed(decimals)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  
  try {
    // 并行获取所有数据
    const [qqq, spy, dia, hsi, hstec, sse, gld, uso, btc, eth, usdcny, hkdcny, eurcny, jpycny, gbpcny, thbcny] = await Promise.all([
      fetchFinnhub('QQQ'),
      fetchFinnhub('SPY'),
      fetchFinnhub('DIA'),
      fetchSina('hkHSI'),
      fetchSina('hkHSTECH'),
      fetchSina('sh000001'),
      fetchFinnhub('GLD'),
      fetchFinnhub('USO'),
      fetchCoinGecko('bitcoin'),
      fetchCoinGecko('ethereum'),
      fetchForexSina('usdcny'),
      fetchForexSina('hkdcny'),
      fetchForexSina('eurcny'),
      fetchForexSina('jpycny'),
      fetchForexSina('gbpcny'),
      fetchForexSina('thbcny')
    ]);

    const [spxSparkline, ndxSparkline, djiSparkline, hsiSparkline, hstecSparkline, sseSparkline, goldSparkline, oilSparkline, btcSparkline, ethSparkline] = await Promise.all([
      fetchPreferredSparkline({ twelveSymbol: 'SPY', finnhubSymbol: 'SPY', multiplier: 10, decimals: 0 }),
      fetchPreferredSparkline({ twelveSymbol: 'QQQ', finnhubSymbol: 'QQQ', multiplier: 41, decimals: 0 }),
      fetchPreferredSparkline({ twelveSymbol: 'DIA', finnhubSymbol: 'DIA', multiplier: 100, decimals: 0 }),
      fetchPreferredSparkline({ twelveSymbol: 'EWH' }),      // iShares MSCI HK ETF 替代 HSI 趋势
      fetchPreferredSparkline({ twelveSymbol: 'MCHI' }),     // iShares MSCI China ETF 替代 HSTECH 趋势
      fetchPreferredSparkline({ twelveSymbol: 'ASHR' }),     // A-share ETF 替代 SSE 趋势
      fetchPreferredSparkline({ twelveSymbol: 'GLD', finnhubSymbol: 'GLD', multiplier: 5.85, decimals: 2 }),
      fetchPreferredSparkline({ twelveSymbol: 'USO', finnhubSymbol: 'USO', multiplier: 0.62, decimals: 2 }),
      fetchCoinGeckoSparklineWithCache('bitcoin'),
      fetchCoinGeckoSparklineWithCache('ethereum')
    ]);
    
    const now = new Date();
    const data = {
      date: `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 实时`,
      updated_at: now.toISOString()
    };
    
    // ETF -> 指数换算
    if (qqq) data.ndx = { price: fmt(qqq.price * 41), change: qqq.change, sparkline: ndxSparkline };
    if (spy) data.spx = { price: fmt(spy.price * 10), change: spy.change, sparkline: spxSparkline };
    if (dia) data.dji = { price: fmt(dia.price * 100), change: dia.change, sparkline: djiSparkline };
    if (hsi) data.hsi = { price: fmt(hsi.price), change: hsi.change, sparkline: hsiSparkline };
    if (hstec) data.hstec = { price: fmt(hstec.price), change: hstec.change, sparkline: hstecSparkline };
    if (sse) data.sse = { price: fmt(sse.price), change: sse.change, sparkline: sseSparkline };
    if (gld) data.gold = { price: fmt(gld.price * 5.85, '$'), change: gld.change, sparkline: goldSparkline };
    if (uso) data.oil = { price: fmt(uso.price * 0.62, '$', 2), change: uso.change, sparkline: oilSparkline };
    if (btc) data.btc = { price: fmt(btc.price, '$'), change: btc.change, sparkline: btcSparkline };
    if (eth) data.eth = { price: fmt(eth.price, '$'), change: eth.change, sparkline: ethSparkline };
    
    // 汇率（1外币=X人民币）- 优先新浪，失败则用备用源
    if (usdcny) data.usdcny = { price: usdcny.price.toFixed(4) };
    if (hkdcny) data.hkdcny = { price: hkdcny.price.toFixed(4) };
    if (eurcny) data.eurcny = { price: eurcny.price.toFixed(4) };
    if (jpycny) data.jpycny = { price: jpycny.price.toFixed(4) };
    if (gbpcny) data.gbpcny = { price: gbpcny.price.toFixed(4) };
    if (thbcny) data.thbcny = { price: thbcny.price.toFixed(4) };
    
    // 如果新浪汇率全部失败，尝试备用源
    if (!usdcny && !hkdcny && !eurcny) {
      const fallback = await fetchExchangeRateFallback();
      if (fallback) {
        if (fallback.usdcny) data.usdcny = fallback.usdcny;
        if (fallback.hkdcny) data.hkdcny = fallback.hkdcny;
        if (fallback.eurcny) data.eurcny = fallback.eurcny;
        if (fallback.jpycny) data.jpycny = fallback.jpycny;
        if (fallback.gbpcny) data.gbpcny = fallback.gbpcny;
        if (fallback.thbcny) data.thbcny = fallback.thbcny;
      }
    }
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
}
