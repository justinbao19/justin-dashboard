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

const newsCategories = {
  macro: { title: '市场风向', deck: '聚焦宏观叙事、交易快讯和风险资产情绪。', sources: [['wallstreetcn-quick','华尔街快讯'],['wallstreetcn-hot','华尔街最热'],['cls-telegraph','财联社电报'],['cls-hot','财联社热门'],['jin10','金十快讯'],['xueqiu-hotstock','雪球热门股']] },
  general: { title: '综合速览', deck: '主流媒体热点与国际动态。', sources: [['thepaper','澎湃热榜'],['tencent-hot','腾讯新闻'],['ifeng','凤凰热点'],['zaobao','联合早报'],['cankaoxiaoxi','参考消息']] },
  tech: { title: '科技情报', deck: '产品、开发者生态与全球科技趋势。', sources: [['ithome','IT之家'],['36kr-quick','36氪快讯'],['github-trending-today','GitHub Trending'],['hackernews','Hacker News'],['producthunt','Product Hunt'],['juejin','稀土掘金']] },
  social: { title: '社交热榜', deck: '平台热搜和大众关注点。', sources: [['weibo','微博热搜'],['zhihu','知乎热榜'],['baidu','百度热搜'],['toutiao','头条热榜'],['bilibili-hot-search','B站热搜'],['douyin','抖音热榜']] }
};

async function getNews() {
  const categories = {};
  for (const [key, config] of Object.entries(newsCategories)) {
    const settled = await Promise.allSettled(config.sources.map(async ([sourceId, sourceLabel]) => {
      const response = await fetch('https://newsnow.busiyi.world/api/s?id=' + encodeURIComponent(sourceId) + '&latest', { headers: { accept: 'application/json', referer: 'https://newsnow.busiyi.world/' } });
      if (!response.ok) throw new Error('news source ' + response.status);
      const payload = await response.json();
      return { id: sourceId, label: sourceLabel, updatedTime: Number(payload.updatedTime) || Date.now(), items: (payload.items || []).map((item, index) => { const extra = item.extra || {}; const icon = typeof extra.icon === 'object' ? extra.icon?.url : extra.icon; return { id: sourceId + ':' + (item.id ?? index), title: String(item.title || '').trim(), url: item.mobileUrl || item.url || '', desktopUrl: item.url || item.mobileUrl || '', mobileUrl: item.mobileUrl || '', sourceId, sourceLabel, rank: index + 1, info: extra.info || extra.hover || '', stamp: '', icon: typeof icon === 'string' ? icon : '' }; }).filter(item => item.title && item.url) };
    }));
    const groups = settled.filter(item => item.status === 'fulfilled').map(item => item.value);
    const seen = new Set(); const merged = [];
    for (const group of groups) for (const item of group.items.slice(0, 5)) { const normalized = item.title.replace(/\s+/g, ' ').toLowerCase(); if (!seen.has(normalized)) { seen.add(normalized); merged.push(item); } }
    const trimmed = merged.slice(0, key === 'macro' ? 14 : 12);
    categories[key] = { key, title: config.title, deck: config.deck, updatedAtMs: Math.max(0, ...groups.map(g => g.updatedTime)), updatedLabel: '', sources: groups.map(g => g.label), featured: trimmed[0] || null, items: trimmed.slice(1), sourceGroups: groups.map(g => ({ id: g.id, label: g.label, items: g.items.slice(0, 3) })) };
  }
  const now = new Date();
  return { date: now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日', updatedAt: now.toISOString(), categories };
}

const f1Flags = { Australia:'🇦🇺', China:'🇨🇳', Japan:'🇯🇵', Bahrain:'🇧🇭', 'Saudi Arabia':'🇸🇦', 'United States':'🇺🇸', Canada:'🇨🇦', Monaco:'🇲🇨', Spain:'🇪🇸', Austria:'🇦🇹', 'United Kingdom':'🇬🇧', Belgium:'🇧🇪', Hungary:'🇭🇺', Netherlands:'🇳🇱', Italy:'🇮🇹', Azerbaijan:'🇦🇿', Singapore:'🇸🇬', Mexico:'🇲🇽', Brazil:'🇧🇷', Qatar:'🇶🇦', 'United Arab Emirates':'🇦🇪' };
function gpName(country, location) { if (country === 'United States') return location.includes('Miami') ? 'Miami GP' : location.includes('Las Vegas') ? 'Las Vegas GP' : 'United States GP'; if (country === 'Spain' && location.includes('Madrid')) return 'Madrid GP'; const names = { China:'Chinese GP', Japan:'Japanese GP', Australia:'Australian GP', Bahrain:'Bahrain GP', 'Saudi Arabia':'Saudi Arabian GP', Canada:'Canadian GP', Monaco:'Monaco GP', Spain:'Spanish GP', Austria:'Austrian GP', 'United Kingdom':'British GP', Belgium:'Belgian GP', Hungary:'Hungarian GP', Netherlands:'Dutch GP', Italy:'Italian GP', Azerbaijan:'Azerbaijan GP', Singapore:'Singapore GP', Mexico:'Mexico City GP', Brazil:'São Paulo GP', Qatar:'Qatar GP', 'United Arab Emirates':'Abu Dhabi GP' }; return names[country] || country + ' GP'; }
async function getF1(url) {
  const year = url.searchParams.get('year') || '2026'; const meeting = url.searchParams.get('meeting');
  const response = await fetch('https://api.openf1.org/v1/sessions?year=' + encodeURIComponent(year));
  if (!response.ok) throw new Error('OpenF1 ' + response.status);
  const sessions = await response.json();
  if (meeting) { const list = sessions.filter(s => String(s.meeting_key) === String(meeting)).sort((a,b) => new Date(a.date_start)-new Date(b.date_start)); if (!list.length) return null; const first=list[0]; return { meeting_key:first.meeting_key, circuit:first.circuit_short_name, circuit_full:first.circuit_short_name, country:first.country_name, country_flag:f1Flags[first.country_name]||'', location:first.location, gp_name:gpName(first.country_name,first.location), gmt_offset:first.gmt_offset, sessions:list.map(s=>({session_key:s.session_key,type:s.session_type,name:s.session_name,date_start:s.date_start,date_end:s.date_end})) }; }
  const meetings = new Map();
  for (const s of sessions) { if (s.session_name?.includes('Day')) continue; if (!meetings.has(s.meeting_key)) meetings.set(s.meeting_key,{meeting_key:s.meeting_key,circuit:s.circuit_short_name,country:s.country_name,country_flag:f1Flags[s.country_name]||'',location:s.location,gp_name:gpName(s.country_name,s.location),date_start:s.date_start,date_end:s.date_end||s.date_start,has_sprint:false}); const m=meetings.get(s.meeting_key); if(new Date(s.date_start)<new Date(m.date_start))m.date_start=s.date_start;if(new Date(s.date_end||s.date_start)>new Date(m.date_end))m.date_end=s.date_end||s.date_start;if(s.session_name==='Sprint')m.has_sprint=true; }
  const calendar=[...meetings.values()].sort((a,b)=>new Date(a.date_start)-new Date(b.date_start)).map((m,i)=>({...m,round:i+1})); return {year:Number(year),total_races:calendar.length,calendar};
}

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
    if (pathname === '/api/news') { try { return json(await getNews(), 200, 'public, max-age=240'); } catch { return json(data['/data/news.json'], 200, 'public, max-age=240'); } }
    if (pathname === '/api/metar') {
      const stations = url.searchParams.get('stations') || 'ZSSS,ZSPD';
      return proxy(request, 'https://aviationweather.gov/api/data/metar?ids=' + encodeURIComponent(stations) + '&format=json');
    }
    if (pathname === '/api/f1') { try { const result=await getF1(url); return result ? json(result,200,'public, max-age=3600') : json({error:'Meeting not found'},404); } catch { return json({error:'Failed to fetch F1 data'},502); } }
    return json({ error: 'Not found' }, 404);
  }
};
`;

await writeFile(path.join(dist, 'server', 'index.js'), worker);
await writeFile(path.join(dist, '.openai', 'hosting.json'), await readFile(path.join(root, '.openai', 'hosting.json')));
console.log('Sites bundle created in dist/');
