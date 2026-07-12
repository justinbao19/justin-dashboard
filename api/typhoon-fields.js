import { getTyphoonFields } from '../lib/typhoon-field-service.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const payload = await getTyphoonFields(req.query?.lat, req.query?.lon);
    res.status(200).json(payload);
  } catch (error) {
    console.error('Typhoon field aggregation failed:', error?.message || error);
    res.status(503).json({ schemaVersion: '1', status: 'error', error: { code: 'FIELD_UNAVAILABLE', message: '风场与浪高数据暂时不可用' } });
  }
}
