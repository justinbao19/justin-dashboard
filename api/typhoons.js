import { CACHE_CONTROL, TyphoonServiceError, getActiveTyphoons } from '../lib/typhoon-service.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    res.status(200).json(await getActiveTyphoons({ cwaApiKey: process.env.CWA_API_KEY || '' }));
  } catch (error) {
    const normalized = error instanceof TyphoonServiceError ? error : new TyphoonServiceError('台风数据暂时不可用');
    res.status(normalized.status).json({ schemaVersion: '1', status: 'degraded', active: null, generatedAt: new Date().toISOString(), sources: [{ id: 'gdacs', status: 'error', lastUpdatedAt: null, message: normalized.message }], storms: [], error: { code: normalized.code, message: normalized.message } });
  }
}
