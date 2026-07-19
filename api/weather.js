// Vercel Serverless Function - QWeather 免费套餐聚合天气
const DEFAULT_LON = '121.405';
const DEFAULT_LAT = '31.123';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  
  const { lon = DEFAULT_LON, lat = DEFAULT_LAT } = req.query;
  try {
    const { fetchQWeatherWeather, getQWeatherQuotaState } = await import('../lib/qweather-weather.mjs');
    const data = await fetchQWeatherWeather({ env: process.env, lon, lat });
    res.setHeader('X-Weather-Source', 'qweather');
    res.setHeader('X-QWeather-Quota-Used', String(getQWeatherQuotaState().used));
    res.status(200).json(data);
  } catch (error) {
    console.error('[weather] Weather request failed:', error);
    res.status(503).json({ error: 'Failed to fetch QWeather data' });
  }
}
