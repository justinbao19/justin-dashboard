import { getCache, waitUntil } from '@vercel/functions';
import { getWeatherSnapshot } from '../lib/weather-service.mjs';

const DEFAULT_LON = '121.405';
const DEFAULT_LAT = '31.123';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');

  const { lon = DEFAULT_LON, lat = DEFAULT_LAT, refresh = '' } = req.query;
  try {
    const payload = await getWeatherSnapshot({
      lon,
      lat,
      env: process.env,
      cache: getCache({ namespace: 'pulse-weather' }),
      refresh: refresh === '1',
      schedule: promise => waitUntil(promise)
    });
    res.status(200).json(payload);
  } catch (error) {
    console.error('Weather aggregation failed:', error?.message || error);
    res.status(503).json({
      schemaVersion: '2',
      status: 'error',
      error: { code: 'WEATHER_UNAVAILABLE', message: '天气数据暂时不可用' }
    });
  }
}
