export default async function handler(req, res) {
  const { CACHE_CONTROL, TyphoonServiceError, getTyphoonDetail } = await import('../lib/typhoon-service.mjs');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    res.status(200).json(await getTyphoonDetail(req.query?.id, { zhejiangId: req.query?.zj || '' }));
  } catch (error) {
    const normalized = error instanceof TyphoonServiceError ? error : new TyphoonServiceError('台风详情暂时不可用');
    res.status(normalized.status).json({ schemaVersion: '1', status: 'degraded', generatedAt: new Date().toISOString(), error: { code: normalized.code, message: normalized.message } });
  }
}
