// Vercel Serverless Function - 市场数据代理
// 行情主源：stock-sdk。避免 Finnhub key/额度，也避免手写新浪解析。
const path = require('node:path');
const { pathToFileURL } = require('node:url');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  try {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), 'scripts', 'market_snapshot.mjs')).href;
    const { buildMarketSnapshot, readExistingMarket } = await import(moduleUrl);
    const existing = await readExistingMarket(path.join(process.cwd(), 'data', 'market.json'));
    const data = await buildMarketSnapshot({ existing, preserveStatic: false });
    res.status(200).json(data);
  } catch (error) {
    console.error('[api/market] Failed to fetch market data:', error);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
};
