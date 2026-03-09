// Vercel Serverless Function - 市场数据代理
const FINNHUB_KEY = 'd6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg';

async function fetchFinnhub(symbol) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
    const d = await r.json();
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
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
    const d = await r.json();
    const coin = d[coinId];
    return { price: coin.usd, change: Math.round(coin.usd_24h_change * 100) / 100 };
  } catch { return null; }
}

function fmt(price, prefix = '', decimals = 0) {
  if (decimals === 0) return `${prefix}${Math.round(price).toLocaleString()}`;
  return `${prefix}${price.toFixed(decimals)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60'); // 缓存1分钟
  
  try {
    // 并行获取所有数据
    const [qqq, spy, dia, hsi, hstec, sse, gld, uso, btc, eth] = await Promise.all([
      fetchFinnhub('QQQ'),
      fetchFinnhub('SPY'),
      fetchFinnhub('DIA'),
      fetchSina('hkHSI'),
      fetchSina('hkHSTECH'),
      fetchSina('sh000001'),
      fetchFinnhub('GLD'),
      fetchFinnhub('USO'),
      fetchCoinGecko('bitcoin'),
      fetchCoinGecko('ethereum')
    ]);
    
    const now = new Date();
    const data = {
      date: `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 实时`,
      updated_at: now.toISOString()
    };
    
    // ETF -> 指数换算
    if (qqq) data.ndx = { price: fmt(qqq.price * 41), change: qqq.change };
    if (spy) data.spx = { price: fmt(spy.price * 10), change: spy.change };
    if (dia) data.dji = { price: fmt(dia.price * 100), change: dia.change };
    if (hsi) data.hsi = { price: fmt(hsi.price), change: hsi.change };
    if (hstec) data.hstec = { price: fmt(hstec.price), change: hstec.change };
    if (sse) data.sse = { price: fmt(sse.price), change: sse.change };
    if (gld) data.gold = { price: fmt(gld.price * 5.85, '$'), change: gld.change };
    if (uso) data.oil = { price: fmt(uso.price * 0.62, '$', 2), change: uso.change };
    if (btc) data.btc = { price: fmt(btc.price, '$'), change: btc.change };
    if (eth) data.eth = { price: fmt(eth.price, '$'), change: eth.change };
    
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
}
