import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'server'), { recursive: true });
await mkdir(path.join(dist, '.openai'), { recursive: true });

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const typhoonHtml = await readFile(path.join(root, 'typhoon.html'), 'utf8');
const typhoonCss = await readFile(path.join(root, 'typhoon.css'), 'utf8');
const typhoonJs = await readFile(path.join(root, 'typhoon.js'), 'utf8');
const typhoonLayerClock = await readFile(path.join(root, 'typhoon-layer-clock.mjs'), 'utf8');
const typhoonFieldRenderer = await readFile(path.join(root, 'typhoon-field-renderer.mjs'), 'utf8');
const data = {};
for (const name of await readdir(path.join(root, 'data'))) {
  if (name.endsWith('.json') || name.endsWith('.geojson')) data[`/data/${name}`] = await readFile(path.join(root, 'data', name), 'utf8');
}

const tracks = {};
for (const name of await readdir(path.join(root, 'tracks'))) {
  if (name.endsWith('.svg')) tracks[`/tracks/${name}`] = await readFile(path.join(root, 'tracks', name), 'utf8');
}

const worker = `
import { CACHE_CONTROL, getActiveTyphoons, getTyphoonDetail, TyphoonServiceError } from './typhoon-service.mjs';
import { createMemoryWeatherCache, getWeatherSnapshot } from './weather-service.mjs';

const weatherCache = createMemoryWeatherCache();

const html = ${JSON.stringify(html)};
const typhoonHtml = ${JSON.stringify(typhoonHtml)};
const typhoonCss = ${JSON.stringify(typhoonCss)};
const typhoonJs = ${JSON.stringify(typhoonJs)};
const typhoonLayerClock = ${JSON.stringify(typhoonLayerClock)};
const typhoonFieldRenderer = ${JSON.stringify(typhoonFieldRenderer)};
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

function getStaticNews() {
  const stored = JSON.parse(data['/data/news.json'] || '{"items":[]}');
  const normalized = (stored.items || []).map((item, index) => ({ id: 'stored:' + index, title: String(item.title || '').trim(), url: item.url || '', desktopUrl: item.url || '', mobileUrl: '', sourceId: 'stored', sourceLabel: item.source || '新闻', rank: index + 1, info: item.summary || '', stamp: '', icon: item.image || '' })).filter(item => item.title && item.url);
  const techWords = /科技|AI|人工智能|芯片|手机|互联网|机器人|软件|汽车|特斯拉|苹果|华为|小米|字节|腾讯|阿里/i;
  const socialWords = /热搜|网友|社会|教育|儿童|生活|文化|娱乐|电影|体育|健康/i;
  const selections = { macro: normalized.slice(0, 14), general: normalized.slice(0, 14), tech: normalized.filter(item => techWords.test(item.title + item.info)), social: normalized.filter(item => socialWords.test(item.title + item.info)) };
  if (selections.tech.length < 4) selections.tech = normalized.slice(0, 10);
  if (selections.social.length < 4) selections.social = normalized.slice(0, 10);
  const categories = {};
  for (const [key, config] of Object.entries(newsCategories)) { const items = selections[key] || normalized; const groups = [...new Set(items.map(item => item.sourceLabel))].slice(0, 3).map((label, i) => ({ id: 'stored-' + i, label, items: items.filter(item => item.sourceLabel === label).slice(0, 3) })); categories[key] = { key, title: config.title, deck: config.deck, updatedAtMs: Date.now(), updatedLabel: stored.date || '', sources: groups.map(g => g.label), featured: items[0] || null, items: items.slice(1, 12), sourceGroups: groups }; }
  return { date: stored.date || '', updatedAt: stored.updated_at || new Date().toISOString(), categories };
}

async function getSentiment(env) {
  const finnhub = env.FINNHUB_KEY || ''; const fred = env.FRED_KEY || '';
  const safeJson = async url => { try { const r=await fetch(url); return r.ok ? await r.json() : {}; } catch { return {}; } };
  const [vix, fear, y10, y2, spread, dxy, events] = await Promise.all([
    finnhub ? safeJson('https://finnhub.io/api/v1/quote?symbol=VIXY&token=' + encodeURIComponent(finnhub)) : {},
    safeJson('https://api.alternative.me/fng/?limit=1'),
    fred ? safeJson('https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=' + encodeURIComponent(fred) + '&file_type=json&limit=5&sort_order=desc') : {},
    fred ? safeJson('https://api.stlouisfed.org/fred/series/observations?series_id=DGS2&api_key=' + encodeURIComponent(fred) + '&file_type=json&limit=5&sort_order=desc') : {},
    fred ? safeJson('https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=' + encodeURIComponent(fred) + '&file_type=json&limit=14&sort_order=desc') : {},
    finnhub ? safeJson('https://finnhub.io/api/v1/quote?symbol=UUP&token=' + encodeURIComponent(finnhub)) : {},
    safeJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json')
  ]);
  const fg = fear.data?.[0] || {}; const vixValue=Number(vix.c)||0; const spreadRows=spread.observations||[]; const spreadValue=Number(spreadRows[0]?.value)||0;
  return { updated_at:new Date().toISOString(), vix:{value:vixValue,change:Number(vix.dp)||0,level:vixValue>30?'extreme':vixValue>20?'elevated':'normal',label:vixValue>30?'恐慌':vixValue>20?'警惕':'平稳'}, fear_greed:{value:Number(fg.value)||50,label:fg.value_classification||'Neutral',timestamp:fg.timestamp}, treasury:{y10:Number(y10.observations?.[0]?.value)||0,y2:Number(y2.observations?.[0]?.value)||0,spread:spreadValue,inverted:spreadValue<0,spread_history:spreadRows.map(row=>Number(row.value)||0).reverse()}, dxy:{value:Number(dxy.c)||0,change:Number(dxy.dp)||0,label:'UUP ETF'}, events:(Array.isArray(events)?events:[]).filter(e=>e.impact==='High'||e.impact==='Medium').slice(0,8).map(e=>({date:e.date?.split('T')[0]||'',time:e.date?.split('T')[1]?.slice(0,5)||'',event:e.title,event_cn:e.title,country:e.country==='USD'?'US':e.country,impact:e.impact==='High'?3:2,forecast:e.forecast,previous:e.previous})) };
}

const f1Flags = { Australia:'🇦🇺', China:'🇨🇳', Japan:'🇯🇵', Bahrain:'🇧🇭', 'Saudi Arabia':'🇸🇦', 'United States':'🇺🇸', Canada:'🇨🇦', Monaco:'🇲🇨', Spain:'🇪🇸', Austria:'🇦🇹', 'United Kingdom':'🇬🇧', Belgium:'🇧🇪', Hungary:'🇭🇺', Netherlands:'🇳🇱', Italy:'🇮🇹', Azerbaijan:'🇦🇿', Singapore:'🇸🇬', Mexico:'🇲🇽', Brazil:'🇧🇷', Qatar:'🇶🇦', 'United Arab Emirates':'🇦🇪' };
function gpName(country, location) { if (country === 'United States') return location.includes('Miami') ? 'Miami GP' : location.includes('Las Vegas') ? 'Las Vegas GP' : 'United States GP'; if (country === 'Spain' && location.includes('Madrid')) return 'Madrid GP'; const names = { China:'Chinese GP', Japan:'Japanese GP', Australia:'Australian GP', Bahrain:'Bahrain GP', 'Saudi Arabia':'Saudi Arabian GP', Canada:'Canadian GP', Monaco:'Monaco GP', Spain:'Spanish GP', Austria:'Austrian GP', 'United Kingdom':'British GP', Belgium:'Belgian GP', Hungary:'Hungarian GP', Netherlands:'Dutch GP', Italy:'Italian GP', Azerbaijan:'Azerbaijan GP', Singapore:'Singapore GP', Mexico:'Mexico City GP', Brazil:'São Paulo GP', Qatar:'Qatar GP', 'United Arab Emirates':'Abu Dhabi GP' }; return names[country] || country + ' GP'; }
async function getF1(url) {
  const year = url.searchParams.get('year') || '2026'; const meeting = url.searchParams.get('meeting'); const session = url.searchParams.get('session');
  const response = await fetch('https://api.openf1.org/v1/sessions?year=' + encodeURIComponent(year));
  if (!response.ok) throw new Error('OpenF1 ' + response.status);
  const sessions = await response.json();
  if (session) {
    const meta = sessions.find(item => String(item.session_key) === String(session));
    if (!meta) return null;
    const [resultsResponse, driversResponse] = await Promise.all([
      fetch('https://api.openf1.org/v1/session_result?session_key=' + encodeURIComponent(session)),
      fetch('https://api.openf1.org/v1/drivers?session_key=' + encodeURIComponent(session))
    ]);
    if (!resultsResponse.ok || !driversResponse.ok) throw new Error('OpenF1 result data unavailable');
    const [results, drivers] = await Promise.all([resultsResponse.json(), driversResponse.json()]);
    const driversByNumber = new Map(drivers.map(driver => [driver.driver_number, driver]));
    return { session_key:Number(session), meeting_key:meta.meeting_key, name:meta.session_name, type:meta.session_type, date_start:meta.date_start, date_end:meta.date_end, status:results.length?'complete':'pending', results:results.map(result => { const driver=driversByNumber.get(result.driver_number)||{}; return {position:result.position,driver_number:result.driver_number,driver_name:driver.full_name||driver.broadcast_name||('#'+result.driver_number),driver_code:driver.name_acronym||'',team_name:driver.team_name||'',team_colour:driver.team_colour||'',headshot_url:driver.headshot_url||'',laps:result.number_of_laps,duration:result.duration,gap_to_leader:result.gap_to_leader,dnf:result.dnf,dns:result.dns,dsq:result.dsq}; }) };
  }
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
  const response = await fetch(target, { headers: { accept: 'application/json', 'user-agent': 'JustinPulse/1.0' } });
  return new Response(response.body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8', 'cache-control': cache } });
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/weather' || pathname === '/market' || pathname === '/news' || pathname === '/f1') {
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (/^\/typhoon\/gdacs-tc-\d+\/?$/.test(pathname)) {
      return new Response(typhoonHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (pathname === '/typhoon.css') return new Response(typhoonCss, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (pathname === '/typhoon.js') return new Response(typhoonJs, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (pathname === '/typhoon-layer-clock.mjs') return new Response(typhoonLayerClock, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (pathname === '/typhoon-field-renderer.mjs') return new Response(typhoonFieldRenderer, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (data[pathname]) return json(data[pathname]);
    if (tracks[pathname]) return new Response(tracks[pathname], { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });

    if (pathname === '/api/location') {
      const lon = request.cf?.longitude || '121.405';
      const lat = request.cf?.latitude || '31.123';
      const city = request.cf?.city || '上海';
      const region = request.cf?.region || '闵行';
      return json({ lon: String(lon), lat: String(lat), city, region, country: request.cf?.country || '中国', displayName: [city, region].filter(Boolean).join(' · '), source: request.cf ? 'ip' : 'default' }, 200, 'private, max-age=300');
    }
    if (pathname === '/api/weather') {
      const lon = url.searchParams.get('lon') || '121.405';
      const lat = url.searchParams.get('lat') || '31.123';
      try {
        const payload = await getWeatherSnapshot({ lon, lat, env, cache: weatherCache, refresh: url.searchParams.get('refresh') === '1', schedule: promise => context?.waitUntil?.(promise) });
        return json(payload, 200, 'public, max-age=60, s-maxage=300, stale-while-revalidate=900');
      } catch {
        return json({ schemaVersion:'2', status:'error', error:{ code:'WEATHER_UNAVAILABLE', message:'天气数据暂时不可用' } }, 503);
      }
    }
    if (pathname === '/api/typhoons') {
      try { return json(await getActiveTyphoons({ cwaApiKey: env.CWA_API_KEY || '' }), 200, CACHE_CONTROL); }
      catch (error) { const e=error instanceof TyphoonServiceError?error:new TyphoonServiceError('台风数据暂时不可用'); return json({schemaVersion:'1',status:'degraded',active:null,generatedAt:new Date().toISOString(),sources:[{id:'gdacs',status:'error',lastUpdatedAt:null,message:e.message}],storms:[],error:{code:e.code,message:e.message}},e.status,'public, s-maxage=60'); }
    }
    if (pathname === '/api/typhoon') {
      try { return json(await getTyphoonDetail(url.searchParams.get('id'), { zhejiangId: url.searchParams.get('zj') || '' }), 200, CACHE_CONTROL); }
      catch (error) { const e=error instanceof TyphoonServiceError?error:new TyphoonServiceError('台风详情暂时不可用'); return json({schemaVersion:'1',status:'degraded',generatedAt:new Date().toISOString(),error:{code:e.code,message:e.message}},e.status,'public, s-maxage=60'); }
    }
    if (pathname === '/api/reverse-geocode') {
      const lat = url.searchParams.get('lat');
      const lon = url.searchParams.get('lon');
      if (!lat || !lon) return json({ error: 'Missing lat or lon' }, 400);
      return proxy(request, 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) + '&accept-language=zh-CN', 'public, max-age=86400');
    }
    if (pathname === '/api/market') return json(data['/data/market.json'], 200, 'public, max-age=60');
    if (pathname === '/api/news') { try { const live=await getNews(); const count=Object.values(live.categories).reduce((sum,category)=>sum+(category.items?.length||0)+(category.featured?1:0),0); return json(count ? live : getStaticNews(), 200, 'public, max-age=240'); } catch { return json(getStaticNews(), 200, 'public, max-age=240'); } }
    if (pathname === '/api/sentiment') return json(await getSentiment(env), 200, 'public, max-age=300');
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
await writeFile(path.join(dist, 'server', 'typhoon-service.mjs'), await readFile(path.join(root, 'lib', 'typhoon-service.mjs')));
await writeFile(path.join(dist, 'server', 'weather-service.mjs'), await readFile(path.join(root, 'lib', 'weather-service.mjs')));
await writeFile(path.join(dist, '.openai', 'hosting.json'), await readFile(path.join(root, '.openai', 'hosting.json')));
console.log('Sites bundle created in dist/');
