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
import { fetchQWeatherWeather, getQWeatherQuotaState } from './qweather-weather.mjs';

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

const f1Flags = { Australia:'🇦🇺', China:'🇨🇳', Japan:'🇯🇵', Bahrain:'🇧🇭', 'Saudi Arabia':'🇸🇦', 'United States':'🇺🇸', USA:'🇺🇸', Canada:'🇨🇦', Monaco:'🇲🇨', Spain:'🇪🇸', Austria:'🇦🇹', 'United Kingdom':'🇬🇧', UK:'🇬🇧', Belgium:'🇧🇪', Hungary:'🇭🇺', Netherlands:'🇳🇱', Italy:'🇮🇹', Azerbaijan:'🇦🇿', Singapore:'🇸🇬', Mexico:'🇲🇽', Brazil:'🇧🇷', Qatar:'🇶🇦', 'United Arab Emirates':'🇦🇪', UAE:'🇦🇪', Malaysia:'🇲🇾' };
const f1HeadshotOverrides = { 34:'https://media.formula1.com/image/upload/c_lfill,w_256/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000000/common/f1/2026/astonmartin/jakcra01/2026astonmartinjakcra01right.webp', 41:'https://media.formula1.com/image/upload/c_lfill,w_256/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000000/common/f1/2026/racingbulls/arvlin01/2026racingbullsarvlin01right.webp' };
const jolpicaBase = 'https://api.jolpi.ca/ergast/f1';
const sessionDurations = { 'Practice 1':60,'Practice 2':60,'Practice 3':60,'Sprint Qualifying':45,'Sprint':45,'Qualifying':60,'Race':130 };
function gpName(country, location, raceName='') { const loc=location||''; if (country === 'United States' || country === 'USA') return loc.includes('Miami') ? 'Miami GP' : loc.includes('Las Vegas') ? 'Las Vegas GP' : 'United States GP'; if (country === 'Spain' && loc.includes('Madrid')) return 'Madrid GP'; if (raceName) { const cleaned = raceName.replace(/Grand Prix.*/i,'GP').replace(/\s+/g,' ').trim(); if (cleaned && cleaned !== 'GP') return cleaned.includes('GP') ? cleaned : cleaned + ' GP'; } const names = { China:'Chinese GP', Japan:'Japanese GP', Australia:'Australian GP', Bahrain:'Bahrain GP', 'Saudi Arabia':'Saudi Arabian GP', Canada:'Canadian GP', Monaco:'Monaco GP', Spain:'Spanish GP', Austria:'Austrian GP', 'United Kingdom':'British GP', UK:'British GP', Belgium:'Belgian GP', Hungary:'Hungarian GP', Netherlands:'Dutch GP', Italy:'Italian GP', Azerbaijan:'Azerbaijan GP', Singapore:'Singapore GP', Mexico:'Mexico City GP', Brazil:'São Paulo GP', Qatar:'Qatar GP', 'United Arab Emirates':'Abu Dhabi GP', UAE:'Abu Dhabi GP', Malaysia:'Bahrain GP' }; return names[country] || country + ' GP'; }
function toIso(date, time) { if (!date) return null; return new Date(date + 'T' + (time || '12:00:00Z').replace(/Z?$/, 'Z')).toISOString(); }
function addMinutes(iso, minutes) { return new Date(new Date(iso).getTime() + minutes * 60000).toISOString(); }
function parseClock(value) { if (value == null || value === '') return null; if (typeof value === 'number' && Number.isFinite(value)) return value; const text = String(value).trim(); if (!text || text.startsWith('+') || /lap/i.test(text)) return null; const parts = text.split(':').map(Number); if (parts.some(Number.isNaN)) return null; if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2]; if (parts.length === 2) return parts[0]*60 + parts[1]; return parts[0]; }
function encodeJSession(year, round, key) { return 'j' + year + 'r' + round + '_' + key; }
function parseJSession(session) { const m = String(session).match(/^j(\d{4})r(\d+)_(fp1|fp2|fp3|sq|sprint|q|race)$/); return m ? { year:m[1], round:m[2], kind:m[3] } : null; }
function jolpicaSessionDefs(race) {
  const defs = [];
  const push = (key, name, type, block) => { if (!block?.date) return; const date_start = toIso(block.date, block.time); if (!date_start) return; defs.push({ key, name, type, date_start, date_end: addMinutes(date_start, sessionDurations[name] || 60) }); };
  push('fp1','Practice 1','Practice', race.FirstPractice);
  if (race.Sprint) { push('sq','Sprint Qualifying','Qualifying', race.SprintQualifying || race.SprintShootout); push('sprint','Sprint','Race', race.Sprint); push('q','Qualifying','Qualifying', race.Qualifying); }
  else { push('fp2','Practice 2','Practice', race.SecondPractice); push('fp3','Practice 3','Practice', race.ThirdPractice); push('q','Qualifying','Qualifying', race.Qualifying); }
  push('race','Race','Race', { date: race.date, time: race.time });
  return defs.sort((a,b)=>new Date(a.date_start)-new Date(b.date_start));
}
function mapJolpicaRace(race, year) {
  const location = race.Circuit?.Location || {}; const locality = location.locality || ''; const country = location.country || '';
  const sessions = jolpicaSessionDefs(race).map(s => ({ session_key: encodeJSession(year, race.round, s.key), type:s.type, name:s.name, date_start:s.date_start, date_end:s.date_end }));
  const date_start = sessions[0]?.date_start || toIso(race.date, race.time); const date_end = sessions[sessions.length-1]?.date_end || date_start;
  return { meeting_key:Number(race.round), round:Number(race.round), circuit:locality || race.Circuit?.circuitName || '', circuit_full:race.Circuit?.circuitName || locality, country, country_flag:f1Flags[country]||'', location:locality, gp_name:gpName(country, locality, race.raceName), date_start, date_end, has_sprint:Boolean(race.Sprint), source:'jolpica', sessions };
}
function mapJResult(row, duration=null, gap=null) {
  const status = String(row.status||''); const positionText = String(row.positionText || row.position || '');
  const number = Number(row.number || row.Driver?.permanentNumber || 0);
  return { position:Number(row.position||0)||null, driver_number:number, driver_name:((row.Driver?.givenName||'') + ' ' + (row.Driver?.familyName||'')).trim() || ('#'+number), driver_code:row.Driver?.code||'', team_name:row.Constructor?.name||'', team_colour:'', headshot_url:f1HeadshotOverrides[number]||'', laps:row.laps!=null?Number(row.laps):null, duration, gap_to_leader:gap, dnf:/Retired|Accident|Collision|Engine|Gearbox|Electrical|Brakes|Suspension|Overheating|Oil|Water|Throttle|Transmission|Clutch|Hydraulics|Wheel|Puncture|Spun off|Excluded|Withdrew|Power/i.test(status)||positionText==='R', dns:positionText==='W'||/Did not start|Not classified/i.test(status), dsq:positionText==='D'||/Disqualified/i.test(status) };
}
async function fetchOpenF1Sessions(year) {
  try { const response = await fetch('https://api.openf1.org/v1/sessions?year=' + encodeURIComponent(year)); if (!response.ok) return null; return await response.json(); }
  catch { return null; }
}
async function getF1FromJolpica(year, meeting, session) {
  if (session) {
    const parsed = parseJSession(session); if (!parsed) return null;
    const raceRes = await fetch(jolpicaBase + '/' + parsed.year + '/' + parsed.round + '.json'); if (!raceRes.ok) return null;
    const race = (await raceRes.json())?.MRData?.RaceTable?.Races?.[0]; if (!race) return null;
    const def = jolpicaSessionDefs(race).find(item => item.key === parsed.kind); if (!def) return null;
    const payload = { session_key: session, meeting_key:Number(parsed.round), name:def.name, type:def.type, date_start:def.date_start, date_end:def.date_end, status:'pending', results:[], source:'jolpica' };
    if (parsed.kind === 'fp1' || parsed.kind === 'fp2' || parsed.kind === 'fp3' || parsed.kind === 'sq') return payload;
    if (parsed.kind === 'q') {
      const qRes = await fetch(jolpicaBase + '/' + parsed.year + '/' + parsed.round + '/qualifying.json');
      const rows = qRes.ok ? ((await qRes.json())?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults || []) : [];
      payload.results = rows.map(row => mapJResult(row, parseClock(row.Q3 || row.Q2 || row.Q1), Number(row.position)===1?0:null));
      payload.status = payload.results.length ? 'complete' : 'pending'; return payload;
    }
    const path = parsed.kind === 'sprint' ? '/sprint.json' : '/results.json';
    const rRes = await fetch(jolpicaBase + '/' + parsed.year + '/' + parsed.round + path);
    const raceData = rRes.ok ? (await rRes.json())?.MRData?.RaceTable?.Races?.[0] : null;
    const rows = parsed.kind === 'sprint' ? (raceData?.SprintResults || []) : (raceData?.Results || []);
    let leader = null;
    payload.results = rows.map(row => {
      const millis = row.Time?.millis != null ? Number(row.Time.millis)/1000 : parseClock(row.Time?.time);
      if (Number(row.position)===1 && millis!=null) leader = millis;
      let gap = null; if (Number(row.position)===1) gap=0; else if (millis!=null && leader!=null) gap=Number((millis-leader).toFixed(3));
      return mapJResult(row, millis, gap);
    });
    payload.status = payload.results.length ? 'complete' : 'pending'; return payload;
  }
  if (meeting) {
    const raceRes = await fetch(jolpicaBase + '/' + year + '/' + meeting + '.json'); if (!raceRes.ok) return null;
    const race = (await raceRes.json())?.MRData?.RaceTable?.Races?.[0]; return race ? mapJolpicaRace(race, year) : null;
  }
  const seasonRes = await fetch(jolpicaBase + '/' + year + '.json?limit=100'); if (!seasonRes.ok) throw new Error('Jolpica ' + seasonRes.status);
  const races = (await seasonRes.json())?.MRData?.RaceTable?.Races || [];
  const calendar = races.map(race => { const m = mapJolpicaRace(race, year); return { meeting_key:m.meeting_key, round:m.round, circuit:m.circuit, country:m.country, country_flag:m.country_flag, location:m.location, gp_name:m.gp_name, date_start:m.date_start, date_end:m.date_end, has_sprint:m.has_sprint, source:'jolpica' }; });
  return { year:Number(year), total_races:calendar.length, calendar, source:'jolpica' };
}
async function getF1(url) {
  const year = url.searchParams.get('year') || '2026'; const meeting = url.searchParams.get('meeting'); const session = url.searchParams.get('session');
  // Calendar/meeting prefer Jolpica; OpenF1 remains available for numeric live session keys.
  if (!session || parseJSession(session)) {
    try {
      const jolpica = await getF1FromJolpica(year, meeting, session);
      if (jolpica && (!jolpica.total_races || jolpica.total_races > 0) && (session || meeting || jolpica.calendar)) return jolpica;
    } catch {}
  }
  const sessions = await fetchOpenF1Sessions(year);
  if (sessions && sessions.length) {
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
      return { session_key:Number(session), meeting_key:meta.meeting_key, name:meta.session_name, type:meta.session_type, date_start:meta.date_start, date_end:meta.date_end, status:results.length?'complete':'pending', source:'openf1', results:results.map(result => { const driver=driversByNumber.get(result.driver_number)||{}; return {position:result.position,driver_number:result.driver_number,driver_name:driver.full_name||driver.broadcast_name||('#'+result.driver_number),driver_code:driver.name_acronym||'',team_name:driver.team_name||'',team_colour:driver.team_colour||'',headshot_url:f1HeadshotOverrides[result.driver_number]||driver.headshot_url||'',laps:result.number_of_laps,duration:result.duration,gap_to_leader:result.gap_to_leader,dnf:result.dnf,dns:result.dns,dsq:result.dsq}; }) };
    }
    if (meeting) { const list = sessions.filter(s => String(s.meeting_key) === String(meeting)).sort((a,b) => new Date(a.date_start)-new Date(b.date_start)); if (!list.length) return null; const first=list[0]; return { meeting_key:first.meeting_key, circuit:first.circuit_short_name, circuit_full:first.circuit_short_name, country:first.country_name, country_flag:f1Flags[first.country_name]||'', location:first.location, gp_name:gpName(first.country_name,first.location), gmt_offset:first.gmt_offset, source:'openf1', sessions:list.map(s=>({session_key:s.session_key,type:s.session_type,name:s.session_name,date_start:s.date_start,date_end:s.date_end})) }; }
    const meetings = new Map();
    for (const s of sessions) { if (s.session_name?.includes('Day')) continue; if (!meetings.has(s.meeting_key)) meetings.set(s.meeting_key,{meeting_key:s.meeting_key,circuit:s.circuit_short_name,country:s.country_name,country_flag:f1Flags[s.country_name]||'',location:s.location,gp_name:gpName(s.country_name,s.location),date_start:s.date_start,date_end:s.date_end||s.date_start,has_sprint:false,source:'openf1'}); const m=meetings.get(s.meeting_key); if(new Date(s.date_start)<new Date(m.date_start))m.date_start=s.date_start;if(new Date(s.date_end||s.date_start)>new Date(m.date_end))m.date_end=s.date_end||s.date_start;if(s.session_name==='Sprint')m.has_sprint=true; }
    const calendar=[...meetings.values()].sort((a,b)=>new Date(a.date_start)-new Date(b.date_start)).map((m,i)=>({...m,round:i+1})); return {year:Number(year),total_races:calendar.length,calendar,source:'openf1'};
  }
  return getF1FromJolpica(year, meeting, session);
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/weather' || pathname === '/typhoon' || pathname === '/market' || pathname === '/news' || pathname === '/f1') {
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
      const lon = url.searchParams.get('lon') || '121.405';
      const lat = url.searchParams.get('lat') || '31.123';
      try {
        const weather = await fetchQWeatherWeather({ env, lon, lat });
        weather.quota = getQWeatherQuotaState();
        return json(weather, 200, 'public, max-age=1800, stale-while-revalidate=3600');
      } catch (error) {
        console.error('[weather] Weather request failed:', error);
        return json({ error: 'Failed to fetch QWeather data' }, 503);
      }
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
await writeFile(path.join(dist, 'server', 'weather-astronomy.mjs'), await readFile(path.join(root, 'lib', 'weather-astronomy.mjs')));
await writeFile(path.join(dist, 'server', 'air-quality-standards.mjs'), await readFile(path.join(root, 'lib', 'air-quality-standards.mjs')));
await writeFile(path.join(dist, 'server', 'qweather-weather.mjs'), await readFile(path.join(root, 'lib', 'qweather-weather.mjs')));
await writeFile(path.join(dist, '.openai', 'hosting.json'), await readFile(path.join(root, '.openai', 'hosting.json')));
console.log('Sites bundle created in dist/');
