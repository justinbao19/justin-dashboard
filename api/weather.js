// Vercel Serverless Function - 彩云天气 + 可选 QWeather 天文增强
const CAIYUN_KEY = process.env.CAIYUN_API_TOKEN || process.env.CAIYUN_KEY || '';
const DEFAULT_LON = '121.405';
const DEFAULT_LAT = '31.123';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
  
  const { lon = DEFAULT_LON, lat = DEFAULT_LAT } = req.query;
  if (!CAIYUN_KEY) {
    res.status(503).json({ error: 'Weather API is not configured' });
    return;
  }
  const url = `https://api.caiyunapp.com/v2.6/${CAIYUN_KEY}/${lon},${lat}/weather?dailysteps=7&hourlysteps=24`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json(data);
      return;
    }
    const { attachAstronomy, fetchQWeatherAstronomy } = await import('../lib/weather-astronomy.mjs');
    const astronomy = await fetchQWeatherAstronomy({ env: process.env, lon, lat }).catch(error => {
      console.warn('[weather] QWeather astronomy unavailable:', error.message);
      return null;
    });
    res.status(200).json(attachAstronomy(data, astronomy));
  } catch (error) {
    console.error('[weather] Weather request failed:', error);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
}
