import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const data = {};
for (const name of await readdir(path.join(root, 'data'))) {
  if (name.endsWith('.json')) data[`/data/${name}`] = await readFile(path.join(root, 'data', name), 'utf8');
}

const tracks = {};
for (const name of await readdir(path.join(root, 'tracks'))) {
  if (name.endsWith('.svg')) tracks[`/tracks/${name}`] = await readFile(path.join(root, 'tracks', name), 'utf8');
}

const worker = `
const html = ${JSON.stringify(html)};
const data = ${JSON.stringify(data)};
const tracks = ${JSON.stringify(tracks)};

const json = (value, status = 200, cache = 'no-store') => new Response(
  typeof value === 'string' ? value : JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache } }
);

async function proxy(request, target, cache = 'public, max-age=300') {
  const response = await fetch(target, { headers: { accept: 'application/json', 'user-agent': 'JustinDashboard/1.0' } });
  return new Response(response.body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': cache } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/weather' || pathname === '/market' || pathname === '/news' || pathname === '/f1') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (data[pathname]) return json(data[pathname]);
    if (tracks[pathname]) return new Response(tracks[pathname], { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });

    if (pathname === '/api/location') {
      const lon = request.cf?.longitude || '121.405';
      const lat = request.cf?.latitude || '31.123';
      const city = request.cf?.city || '上海';
      const region = request.cf?.region || '闵行';
      return json({ lon: String(lon), lat: String(lat), city, region, country: request.cf?.country || '中国', displayName: [city, region].filter(Boolean).join(' · '), source: request.cf ? 'ip' : 'default' });
    }
    if (pathname === '/api/weather') {
      const key = env.CAIYUN_API_TOKEN || env.CAIYUN_KEY;
      if (!key) return json({ error: 'Weather API is not configured' }, 503);
      const lon = url.searchParams.get('lon') || '121.405';
      const lat = url.searchParams.get('lat') || '31.123';
      return proxy(request, 'https://api.caiyunapp.com/v2.6/' + key + '/' + lon + ',' + lat + '/weather?dailysteps=7&hourlysteps=24');
    }
    if (pathname === '/api/reverse-geocode') {
      const lat = url.searchParams.get('lat');
      const lon = url.searchParams.get('lon');
      if (!lat || !lon) return json({ error: 'Missing lat or lon' }, 400);
      return proxy(request, 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&accept-language=zh-CN', 'public, max-age=86400');
    }
    if (pathname === '/api/market') return json(data['/data/market.json'], 200, 'public, max-age=60');
    if (pathname === '/api/news') return json(data['/data/news.json'], 200, 'public, max-age=240');
    if (pathname === '/api/metar') {
      const stations = url.searchParams.get('stations') || 'ZSSS,ZSPD';
      return proxy(request, 'https://aviationweather.gov/api/data/metar?ids=' + encodeURIComponent(stations) + '&format=json');
    }
    if (pathname === '/api/f1') {
      const year = url.searchParams.get('year') || '2026';
      return proxy(request, 'https://api.openf1.org/v1/sessions?year=' + encodeURIComponent(year), 'public, max-age=3600');
    }
    return json({ error: 'Not found' }, 404);
  }
};
`;

await writeFile(path.join(dist, 'server', 'index.js'), worker);
await writeFile(path.join(dist, '.openai', 'hosting.json'), await readFile(path.join(root, '.openai', 'hosting.json')));
console.log('Sites bundle created in dist/');
