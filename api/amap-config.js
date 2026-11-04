export default function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.status(200).json({
    key: process.env.AMAP_JS_KEY || null,
    serviceHost: '/api/_AMapService'
  });
}
