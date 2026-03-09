// Vercel Serverless Function - 彩云天气代理
const CAIYUN_KEY = 'Du0t79IRJh5j9mUe';
const DEFAULT_LON = '121.405';
const DEFAULT_LAT = '31.123';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300'); // 缓存5分钟
  
  const { lon = DEFAULT_LON, lat = DEFAULT_LAT } = req.query;
  const url = `https://api.caiyunapp.com/v2.6/${CAIYUN_KEY}/${lon},${lat}/weather?dailysteps=7&hourlysteps=24`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
}
