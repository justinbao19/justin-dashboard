import { buildAmapProxyUrl } from '../typhoon-basemap.mjs';

const AMAP_PATH_PARAM = '__amap_path';

function readAmapRequest(req) {
  const requestUrl = new URL(req.url || '/', 'https://local.invalid');
  const path = requestUrl.searchParams.get(AMAP_PATH_PARAM) || '';
  requestUrl.searchParams.delete(AMAP_PATH_PARAM);
  return { path, query: requestUrl.searchParams };
}

function isValidAmapPath(path) {
  return /^\/?v[34]\//.test(String(path || '')) && !String(path).includes('..');
}

export default async function handler(req, res) {
  if (req.method && !['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { path, query } = readAmapRequest(req);
  if (!isValidAmapPath(path)) {
    res.status(400).json({ error: 'Invalid AMap path' });
    return;
  }

  const upstreamUrl = buildAmapProxyUrl(path, query, process.env.AMAP_SECURITY_CODE || '');
  try {
    const upstream = await fetch(upstreamUrl, { method: req.method || 'GET' });
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.status(upstream.status);
    if (req.method === 'HEAD') { res.end(); return; }
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error('AMap proxy request failed:', error?.message || error);
    res.status(502).json({ error: 'AMap service unavailable' });
  }
}
