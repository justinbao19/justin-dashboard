const GDACS_BASE = 'https://www.gdacs.org/gdacsapi/api';
const CWA_ENDPOINT = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-005';
const ZHEJIANG_TYPHOON_BASE = 'https://typhoon.slt.zj.gov.cn/Api';
const CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=1800';
const REQUEST_TIMEOUT_MS = 8000;
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const GDACS_TIMELINE_URL = /^https:\/\/www\.gdacs\.org\/gdacsapi\/api\/export\/gettimeline\?id=\d+$/;
const CURRENT_ANALYSIS_CACHE_MS = 5 * 60 * 1000;
const currentAnalysisCache = new Map();

const TYPHOON_NAMES_ZH = {
  BAVI: '巴威'
};

const FORECAST_AGENCIES = {
  '中国': { id: 'cma', label: '中国', agency: '中央气象台', color: '#ff7a45' },
  '中国台湾': { id: 'cwa', label: '中国台湾', agency: '台湾气象部门', color: '#ffd43b' },
  '台湾': { id: 'cwa', label: '中国台湾', agency: '台湾气象部门', color: '#ffd43b' },
  '日本': { id: 'jma', label: '日本', agency: '日本气象厅', color: '#38bdf8' },
  '中国香港': { id: 'hko', label: '中国香港', agency: '香港天文台', color: '#a78bfa' },
  '香港': { id: 'hko', label: '中国香港', agency: '香港天文台', color: '#a78bfa' },
  '美国': { id: 'jtwc', label: '美国', agency: '联合台风警报中心', color: '#f472b6' }
};

export class TyphoonServiceError extends Error {
  constructor(message, { status = 502, code = 'UPSTREAM_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = 'TyphoonServiceError';
    this.status = status;
    this.code = code;
  }
}

const asArray = value => Array.isArray(value) ? value : (value ? [value] : []);
const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
const isoOrNull = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function safeText(value, max = 160) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
}

function inWesternPacific(position) {
  const lon = numberOrNull(position?.lon);
  const lat = numberOrNull(position?.lat);
  return lon !== null && lat !== null && lon >= 90 && lon <= 180 && lat >= 0 && lat <= 60;
}

function classificationFromWind(windKmh) {
  if (!Number.isFinite(windKmh)) return 'unknown';
  if (windKmh >= 183.6) return 'super_typhoon';
  if (windKmh >= 149.4) return 'severe_typhoon';
  if (windKmh >= 117.7) return 'typhoon';
  if (windKmh >= 88.2) return 'severe_tropical_storm';
  if (windKmh >= 61.9) return 'tropical_storm';
  if (windKmh >= 38.9) return 'tropical_depression';
  return 'tropical_disturbance';
}

function windForceScaleFromMs(windMs) {
  if (!Number.isFinite(windMs)) return null;
  const upperBounds = [0.2, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6, 36.9, 41.4, 46.1, 50.9, 56, 61.2];
  const scale = upperBounds.findIndex(bound => windMs <= bound);
  return scale === -1 ? '17+' : scale;
}

function parseChinaLocalTime(value) {
  const text = safeText(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) return isoOrNull(value);
  return isoOrNull(`${text.replace(' ', 'T')}+08:00`);
}

function normalizeMovementDirection(value) {
  const text = safeText(value, 20);
  return ({ 北西: '西北', 北东: '东北', 南西: '西南', 南东: '东南' })[text] || text || null;
}

function classificationFromChineseLabel(value, windMs) {
  const text = safeText(value, 40);
  if (text.includes('超强台风')) return 'super_typhoon';
  if (text.includes('强台风')) return 'severe_typhoon';
  if (text === '台风') return 'typhoon';
  if (text.includes('强热带风暴')) return 'severe_tropical_storm';
  if (text.includes('热带风暴')) return 'tropical_storm';
  if (text.includes('热带低压')) return 'tropical_depression';
  return classificationFromWind(Number.isFinite(windMs) ? windMs * 3.6 : null);
}

function normalizeZhejiangPoint(point, { id, kind, sourceId, sourceLabel } = {}) {
  const lat = numberOrNull(point?.lat);
  const lon = numberOrNull(point?.lng ?? point?.lon);
  if (!inWesternPacific({ lat, lon })) return null;
  const windMs = numberOrNull(point?.speed);
  return {
    id,
    kind,
    sourceId,
    sourceLabel,
    validAt: parseChinaLocalTime(point?.time),
    position: { lat, lon },
    classification: classificationFromChineseLabel(point?.strong, windMs),
    intensity: {
      value: windMs,
      unit: windMs === null ? null : 'm/s',
      windForceScale: numberOrNull(point?.power),
      centralPressureHpa: numberOrNull(String(point?.pressure || '').trim())
    },
    movement: {
      directionText: normalizeMovementDirection(point?.movedirection),
      speedKmh: numberOrNull(point?.movespeed)
    }
  };
}

function normalizeZhejiangActiveEntry(entry) {
  const point = normalizeZhejiangPoint(entry, { id: `zj-current-${safeText(entry?.tfid, 24)}`, kind: 'current', sourceId: 'zhejiang', sourceLabel: '浙江省水利厅' });
  if (!point || !/^\d{6}$/.test(String(entry?.tfid || ''))) return null;
  return {
    tfid: String(entry.tfid),
    name: { zh: safeText(entry.name, 80) || null, en: safeText(entry.enname, 80) || null },
    point,
    updatedAt: point.validAt
  };
}

function matchZhejiangEntry(storm, entries) {
  return entries.find(entry => {
    const sameName = entry.name.en && storm.name.en && entry.name.en.toLowerCase() === storm.name.en.toLowerCase();
    const close = distanceKm(storm.position, entry.point.position) < 500;
    return sameName || close;
  }) || null;
}

function mergeZhejiangCurrent(storm, entry) {
  if (!entry) return storm;
  const point = entry.point;
  return {
    ...storm,
    providerIds: { ...storm.providerIds, zhejiang: entry.tfid },
    name: {
      display: entry.name.en || storm.name.display,
      en: entry.name.en || storm.name.en,
      zh: entry.name.zh || storm.name.zh
    },
    classification: point.classification,
    position: { ...point.position, validAt: point.validAt },
    intensity: { ...point.intensity, basis: 'current_analysis', windAveragePeriodMinutes: 10 },
    movement: point.movement,
    updatedAt: point.validAt || storm.updatedAt,
    stale: !point.validAt || Date.now() - new Date(point.validAt).getTime() > STALE_AFTER_MS,
    source: {
      provider: '浙江省水利厅',
      upstream: '多机构台风路径汇聚',
      url: 'https://typhoon.slt.zj.gov.cn/',
      attribution: '浙江省水利厅台风路径'
    }
  };
}

export function normalizeZhejiangTrack(payload) {
  const points = asArray(payload?.points);
  const observed = points.map((point, index) => normalizeZhejiangPoint(point, {
    id: `observed-${index}`,
    kind: index === points.length - 1 ? 'current' : 'observed',
    sourceId: 'observed',
    sourceLabel: '实况路径'
  })).filter(Boolean);
  const latest = points.at(-1) || {};
  const forecasts = asArray(latest.forecast).map(group => {
    const agency = FORECAST_AGENCIES[safeText(group?.tm, 40)];
    if (!agency) return null;
    const forecastPoints = asArray(group.forecastpoints).map((point, index) => normalizeZhejiangPoint(point, {
      id: `${agency.id}-${index}`,
      kind: index === 0 ? 'current' : 'forecast',
      sourceId: agency.id,
      sourceLabel: agency.label
    })).filter(Boolean);
    return forecastPoints.length > 1 ? { ...agency, points: forecastPoints } : null;
  }).filter(Boolean);
  return { observed, forecasts };
}

function buildForecastTrend(storm, tracks) {
  const preferred = tracks.forecasts.find(track => track.id === 'cma') || tracks.forecasts[0];
  const future = preferred?.points?.filter(point => point.kind === 'forecast') || [];
  const next = future[0] || null;
  const last = future.at(-1) || null;
  const currentWind = numberOrNull(storm.intensity?.value);
  const futureWind = numberOrNull(last?.intensity?.value);
  let strength = '强度趋势待确认';
  if (currentWind !== null && futureWind !== null) {
    const difference = futureWind - currentWind;
    strength = difference >= 3 ? '预计增强' : (difference <= -3 ? '预计减弱' : '强度变化不大');
  }
  return {
    sourceId: preferred?.id || null,
    sourceLabel: preferred?.agency || null,
    directionText: storm.movement?.directionText || null,
    speedKmh: storm.movement?.speedKmh ?? null,
    strength,
    nextPosition: next?.position || null,
    nextValidAt: next?.validAt || null,
    summary: [storm.movement?.directionText ? `向${storm.movement.directionText}移动` : null, hasFinite(storm.movement?.speedKmh) ? `约 ${Math.round(storm.movement.speedKmh)} km/h` : null, strength].filter(Boolean).join('，')
  };
}

function hasFinite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function normalizeName(properties = {}) {
  const raw = safeText(properties.eventname || properties.name || '未命名热带系统', 80);
  const display = raw
    .replace(/^Tropical Cyclone\s+/i, '')
    .replace(/-\d{2}$/i, '')
    .trim() || '未命名热带系统';
  return { display, en: display, zh: TYPHOON_NAMES_ZH[display.toUpperCase()] || null };
}

export function normalizeGdacsFeature(feature, now = new Date()) {
  const properties = feature?.properties || {};
  const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
  const position = {
    lat: numberOrNull(coordinates?.[1]),
    lon: numberOrNull(coordinates?.[0]),
    validAt: isoOrNull(properties.todate || properties.datemodified)
  };
  const eventId = safeText(properties.eventid, 24);
  if (!/^\d+$/.test(eventId) || !inWesternPacific(position)) return null;

  const windKmh = numberOrNull(properties.severitydata?.severity);
  const updatedAt = isoOrNull(properties.datemodified || properties.todate);
  const updatedMs = updatedAt ? new Date(updatedAt).getTime() : 0;
  const stale = !updatedMs || now.getTime() - updatedMs > STALE_AFTER_MS;
  const affectedRegions = asArray(properties.affectedcountries)
    .map(item => safeText(item?.countryname, 80))
    .filter(Boolean);
  if (!affectedRegions.length && properties.country) {
    affectedRegions.push(...safeText(properties.country, 300).split(',').map(value => value.trim()).filter(Boolean));
  }

  return {
    id: `gdacs-tc-${eventId}`,
    providerIds: { gdacs: eventId, cwa: null, zhejiang: null },
    name: normalizeName(properties),
    basin: 'WP',
    active: String(properties.iscurrent).toLowerCase() === 'true',
    classification: 'unknown',
    alertLevel: null,
    impactLevel: ['green', 'orange', 'red'].includes(String(properties.alertlevel).toLowerCase())
      ? String(properties.alertlevel).toLowerCase()
      : null,
    position,
    intensity: {
      value: null,
      unit: null,
      basis: 'unknown',
      windForceScale: null,
      windAveragePeriodMinutes: null,
      centralPressureHpa: null
    },
    historicalMaximum: {
      value: windKmh,
      unit: windKmh === null ? null : 'km/h',
      basis: windKmh === null ? 'unknown' : 'event_max'
    },
    movement: { directionText: null, speedKmh: null },
    affectedRegions: [...new Set(affectedRegions)].slice(0, 12),
    startedAt: isoOrNull(properties.fromdate),
    updatedAt,
    stale,
    source: {
      provider: 'GDACS',
      upstream: safeText(properties.source, 40) || null,
      url: properties.url?.report && /^https:\/\/www\.gdacs\.org\//.test(properties.url.report) ? properties.url.report : null,
      attribution: 'Global Disaster Awareness and Coordination System (GDACS)'
    },
    detailUrl: `/typhoon/gdacs-tc-${eventId}`
  };
}

function parseGdacsAdvisoryTime(value) {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})$/.exec(safeText(value, 40));
  if (!match) return null;
  const month = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }[match[2]];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]))).toISOString();
}

export function normalizeGdacsCurrentAnalysis(payload, now = new Date()) {
  const items = asArray(payload?.channel?.item);
  const actual = items.filter(item => String(item?.actual).toLowerCase() === 'true');
  const current = actual.find(item => String(item?.current).toLowerCase() === 'true') || actual.at(-1);
  if (!current) return null;
  const windMs = numberOrNull(current.wind_speed);
  const lat = numberOrNull(current.latitude);
  const lon = numberOrNull(current.longitude);
  const validAt = parseGdacsAdvisoryTime(current.advisory_datetime);
  if (windMs === null || !inWesternPacific({ lat, lon })) return null;
  return {
    classification: classificationFromWind(windMs * 3.6),
    position: { lat, lon, validAt },
    intensity: {
      value: windMs,
      unit: 'm/s',
      basis: 'current_analysis',
      windForceScale: windForceScaleFromMs(windMs),
      windAveragePeriodMinutes: 1,
      centralPressureHpa: numberOrNull(current.pressure) || null
    },
    updatedAt: validAt,
    stale: !validAt || now.getTime() - new Date(validAt).getTime() > STALE_AFTER_MS
  };
}

function findTimelineUrl(detail) {
  for (const impact of asArray(detail?.properties?.impacts)) {
    const url = impact?.resource?.timeline;
    if (GDACS_TIMELINE_URL.test(String(url || ''))) return url;
  }
  return null;
}

async function applyGdacsCurrentAnalysis(storm, detail, { fetchImpl = fetch, now = new Date() } = {}) {
  const timelineUrl = findTimelineUrl(detail);
  if (!timelineUrl) return storm;
  let timeline;
  try {
    timeline = await fetchJson(timelineUrl, { fetchImpl });
  } catch {
    timeline = await fetchJson(timelineUrl, { fetchImpl, timeoutMs: 12000 });
  }
  const current = normalizeGdacsCurrentAnalysis(timeline, now);
  if (!current) return storm;
  return { ...storm, ...current, intensity: current.intensity, position: current.position };
}

async function enrichWithGdacsCurrentAnalysis(storm, { fetchImpl = fetch, now = new Date() } = {}) {
  const eventId = storm?.providerIds?.gdacs;
  if (!eventId) return storm;
  const useCache = fetchImpl === fetch;
  const cached = useCache ? currentAnalysisCache.get(eventId) : null;
  const applyCached = value => ({
    ...storm,
    classification: value.classification,
    position: value.position,
    intensity: value.intensity,
    updatedAt: value.updatedAt,
    stale: value.stale
  });
  if (cached && now.getTime() - cached.cachedAt < CURRENT_ANALYSIS_CACHE_MS) return applyCached(cached);
  try {
    const detailUrl = `${GDACS_BASE}/events/geteventdata?eventtype=TC&eventid=${eventId}`;
    let detail;
    try {
      detail = await fetchJson(detailUrl, { fetchImpl });
    } catch {
      detail = await fetchJson(detailUrl, { fetchImpl, timeoutMs: 12000 });
    }
    const enriched = await applyGdacsCurrentAnalysis(storm, detail, { fetchImpl, now });
    if (enriched.intensity?.basis === 'current_analysis') {
      if (useCache) currentAnalysisCache.set(eventId, {
        classification: enriched.classification,
        position: enriched.position,
        intensity: enriched.intensity,
        updatedAt: enriched.updatedAt,
        stale: enriched.stale,
        cachedAt: now.getTime()
      });
    }
    return enriched;
  } catch {
    return cached ? applyCached(cached) : storm;
  }
}

function normalizeGeometry(geometry, eventId) {
  const features = asArray(geometry?.features).filter(feature => {
    const type = feature?.geometry?.type;
    return ['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(type);
  }).slice(0, 600).map(feature => {
    const properties = feature.properties || {};
    return {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        dataRole: properties.Class === 'Point_Centroid' ? 'current_center' : 'event_geometry',
        featureType: safeText(properties.featuretype || properties.Class, 80) || 'event_geometry',
        label: safeText(properties.polygonlabel, 80) || null,
        validAt: isoOrNull(properties.polygondate),
        source: safeText(properties.source, 40) || 'GDACS'
      }
    };
  });
  return { type: 'FeatureCollection', name: `gdacs-tc-${eventId}`, features };
}

function buildTimeline(geojson, storm) {
  const seen = new Set();
  const entries = [];
  for (const feature of geojson.features) {
    const label = feature.properties?.label;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    entries.push({ label, validAt: feature.properties?.validAt || null });
  }
  if (!entries.length && storm.position.validAt) {
    entries.push({ label: '当前时次', validAt: storm.position.validAt });
  }
  return entries.slice(0, 120);
}

export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'JustinPulse/1.0' }
    });
    if (!response.ok) throw new TyphoonServiceError(`上游服务返回 ${response.status}`, { status: 502 });
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType && !contentType.includes('json') && !contentType.includes('geo')) {
      throw new TyphoonServiceError('上游服务未返回 JSON', { status: 502, code: 'INVALID_RESPONSE' });
    }
    return await response.json();
  } catch (error) {
    if (error instanceof TyphoonServiceError) throw error;
    if (error?.name === 'AbortError') {
      throw new TyphoonServiceError('台风数据源请求超时', { status: 504, code: 'UPSTREAM_TIMEOUT', cause: error });
    }
    throw new TyphoonServiceError('暂时无法连接台风数据源', { status: 502, cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function gdacsSearchUrl(now = new Date()) {
  const from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return `${GDACS_BASE}/events/geteventlist/SEARCH?eventlist=TC&fromdate=${from}&todate=${to}&alertlevel=green;orange;red`;
}

function findObjectsByKey(value, key, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Object.prototype.hasOwnProperty.call(value, key)) found.push(value);
  for (const child of Object.values(value)) findObjectsByKey(child, key, found);
  return found;
}

function normalizeCwa(payload) {
  const candidates = findObjectsByKey(payload, 'typhoonName');
  return candidates.map((item, index) => {
    const analysis = asArray(item.analysisData?.fix || item.analysisData || item.fix).at(-1) || {};
    const lat = numberOrNull(analysis.coordinate?.coordinateLatitude || analysis.latitude || analysis.lat);
    const lon = numberOrNull(analysis.coordinate?.coordinateLongitude || analysis.longitude || analysis.lon);
    if (!inWesternPacific({ lat, lon })) return null;
    const name = safeText(item.typhoonName || item.cwaTyphoonName, 80) || `CWA-${index + 1}`;
    const windMs = numberOrNull(analysis.maxWindSpeed || analysis.maximumWindSpeed);
    const validAt = isoOrNull(analysis.fixTime || analysis.analysisTime || item.dataTime);
    return {
      id: `cwa-tc-${safeText(item.typhoonNumber || name, 40).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
      providerIds: { gdacs: null, cwa: safeText(item.typhoonNumber || name, 40), zhejiang: null },
      name: { display: name, en: name, zh: safeText(item.cwaTyphoonName, 80) || null },
      basin: 'WP', active: true,
      classification: classificationFromWind(windMs === null ? null : windMs * 3.6),
      alertLevel: null,
      impactLevel: null,
      position: { lat, lon, validAt },
      intensity: {
        value: windMs, unit: windMs === null ? null : 'm/s', basis: 'current_analysis',
        windForceScale: windForceScaleFromMs(windMs),
        windAveragePeriodMinutes: 10,
        centralPressureHpa: numberOrNull(analysis.centralPressure || analysis.pressure)
      },
      movement: {
        directionText: safeText(analysis.movingDirection || analysis.movementDirection, 40) || null,
        speedKmh: numberOrNull(analysis.movingSpeed || analysis.movementSpeed)
      },
      affectedRegions: [], startedAt: null, updatedAt: validAt,
      stale: !validAt || Date.now() - new Date(validAt).getTime() > STALE_AFTER_MS,
      source: { provider: 'CWA', upstream: null, url: 'https://opendata.cwa.gov.tw/dataset/warning/W-C0034-005', attribution: '交通部中央气象署' },
      detailUrl: null
    };
  }).filter(Boolean);
}

function distanceKm(a, b) {
  const rad = degree => degree * Math.PI / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function mergeStorms(gdacsStorms, cwaStorms) {
  const merged = gdacsStorms.map(storm => ({ ...storm }));
  for (const cwa of cwaStorms) {
    const match = merged.find(storm => {
      const sameName = storm.name.display.toLowerCase() === cwa.name.display.toLowerCase();
      const close = distanceKm(storm.position, cwa.position) < 350;
      const nearTime = storm.position.validAt && cwa.position.validAt
        ? Math.abs(new Date(storm.position.validAt) - new Date(cwa.position.validAt)) < 24 * 60 * 60 * 1000
        : true;
      return (sameName || close) && nearTime;
    });
    // The MVP detail route is keyed by a validated GDACS event id. Keep CWA as
    // an official-analysis enrichment until a stable CWA-only detail identity
    // and track contract is available.
    if (!match) continue;
    match.providerIds.cwa = cwa.providerIds.cwa;
    match.name.zh = cwa.name.zh;
    match.position = cwa.position;
    match.intensity = cwa.intensity;
    match.movement = cwa.movement;
    match.updatedAt = cwa.updatedAt || match.updatedAt;
    match.stale = cwa.stale;
    match.source = { ...cwa.source, upstream: match.source.upstream, gdacsAttribution: match.source.attribution };
  }
  return merged;
}

export async function getActiveTyphoons({ fetchImpl = fetch, cwaApiKey = '', now = new Date(), zhejiangEnabled = fetchImpl === fetch } = {}) {
  let gdacs;
  try {
    gdacs = await fetchJson(gdacsSearchUrl(now), { fetchImpl });
  } catch (error) {
    throw error instanceof TyphoonServiceError ? error : new TyphoonServiceError('GDACS 数据不可用', { cause: error });
  }
  if (!Array.isArray(gdacs?.features)) {
    throw new TyphoonServiceError('GDACS 数据结构异常', { code: 'INVALID_RESPONSE' });
  }
  const discoveredStorms = gdacs.features
    .map(feature => normalizeGdacsFeature(feature, now))
    .filter(storm => storm?.active);

  const sources = [{
    id: 'gdacs', status: discoveredStorms.some(storm => storm.stale) ? 'stale' : 'ok',
    lastUpdatedAt: discoveredStorms.map(storm => storm.updatedAt).filter(Boolean).sort().at(-1) || now.toISOString(), message: null
  }];

  let zhejiangEntries = [];
  if (zhejiangEnabled) {
    try {
      const payload = await fetchJson(`${ZHEJIANG_TYPHOON_BASE}/TyhoonActivity`, { fetchImpl });
      if (!Array.isArray(payload)) throw new TyphoonServiceError('浙江台风路径数据结构异常', { code: 'INVALID_RESPONSE' });
      zhejiangEntries = payload.map(normalizeZhejiangActiveEntry).filter(Boolean);
      sources.push({ id: 'zhejiang', status: 'ok', lastUpdatedAt: zhejiangEntries.map(entry => entry.updatedAt).filter(Boolean).sort().at(-1) || now.toISOString(), message: null });
    } catch (error) {
      sources.push({ id: 'zhejiang', status: 'error', lastUpdatedAt: null, message: error.message });
    }
  } else {
    sources.push({ id: 'zhejiang', status: 'disabled', lastUpdatedAt: null, message: '未启用浙江台风路径数据' });
  }

  const zhejiangMergedStorms = discoveredStorms.map(storm => mergeZhejiangCurrent(storm, matchZhejiangEntry(storm, zhejiangEntries)));
  const gdacsStorms = await Promise.all(zhejiangMergedStorms.map(storm => storm.intensity?.basis === 'current_analysis'
    ? storm
    : enrichWithGdacsCurrentAnalysis(storm, { fetchImpl, now })));
  sources[0] = {
    id: 'gdacs', status: gdacsStorms.some(storm => storm.stale) ? 'stale' : 'ok',
    lastUpdatedAt: gdacsStorms.map(storm => storm.updatedAt).filter(Boolean).sort().at(-1) || now.toISOString(), message: null
  };

  let cwaStorms = [];
  if (cwaApiKey) {
    try {
      const cwa = await fetchJson(`${CWA_ENDPOINT}?Authorization=${encodeURIComponent(cwaApiKey)}&format=JSON`, { fetchImpl });
      cwaStorms = normalizeCwa(cwa);
      sources.push({ id: 'cwa', status: 'ok', lastUpdatedAt: cwaStorms.map(storm => storm.updatedAt).filter(Boolean).sort().at(-1) || now.toISOString(), message: null });
    } catch (error) {
      sources.push({ id: 'cwa', status: 'error', lastUpdatedAt: null, message: error.message });
    }
  } else {
    sources.push({ id: 'cwa', status: 'disabled', lastUpdatedAt: null, message: '未配置 CWA_API_KEY' });
  }

  const storms = mergeStorms(gdacsStorms, cwaStorms)
    .sort((a, b) => ({ red: 3, orange: 2, green: 1 }[b.impactLevel] || 0) - ({ red: 3, orange: 2, green: 1 }[a.impactLevel] || 0));
  return {
    schemaVersion: '1',
    status: sources.some(source => source.status === 'error') ? 'degraded' : 'ok',
    active: storms.length > 0,
    generatedAt: now.toISOString(),
    sources,
    storms
  };
}

export function parseTyphoonId(id) {
  const match = /^gdacs-tc-(\d{1,12})$/.exec(String(id || ''));
  if (!match) throw new TyphoonServiceError('台风 ID 格式无效', { status: 400, code: 'INVALID_ID' });
  return match[1];
}

async function getZhejiangDetailForStorm(storm, { fetchImpl = fetch } = {}) {
  const activePayload = await fetchJson(`${ZHEJIANG_TYPHOON_BASE}/TyhoonActivity`, { fetchImpl });
  if (!Array.isArray(activePayload)) throw new TyphoonServiceError('浙江台风路径数据结构异常', { code: 'INVALID_RESPONSE' });
  const entries = activePayload.map(normalizeZhejiangActiveEntry).filter(Boolean);
  const entry = matchZhejiangEntry(storm, entries);
  if (!entry) throw new TyphoonServiceError('未匹配到浙江台风路径', { status: 404, code: 'NOT_FOUND' });
  const payload = await fetchJson(`${ZHEJIANG_TYPHOON_BASE}/TyphoonInfo/${entry.tfid}`, { fetchImpl, timeoutMs: 12000 });
  const tracks = normalizeZhejiangTrack(payload);
  if (!tracks.observed.length) throw new TyphoonServiceError('浙江台风路径缺少实况节点', { code: 'INVALID_RESPONSE' });
  const latest = tracks.observed.at(-1);
  const detailedEntry = {
    ...entry,
    name: { zh: safeText(payload?.name, 80) || entry.name.zh, en: safeText(payload?.enname, 80) || entry.name.en },
    point: latest,
    updatedAt: latest.validAt
  };
  return { storm: mergeZhejiangCurrent(storm, detailedEntry), tracks, tfid: entry.tfid };
}

async function getZhejiangDetailById(eventId, zhejiangId, { fetchImpl = fetch } = {}) {
  if (!/^\d{6}$/.test(String(zhejiangId || ''))) throw new TyphoonServiceError('浙江台风编号无效', { status: 400, code: 'INVALID_ID' });
  const payload = await fetchJson(`${ZHEJIANG_TYPHOON_BASE}/TyphoonInfo/${zhejiangId}`, { fetchImpl, timeoutMs: 12000 });
  const tracks = normalizeZhejiangTrack(payload);
  const latest = tracks.observed.at(-1);
  if (!latest) throw new TyphoonServiceError('浙江台风路径缺少实况节点', { code: 'INVALID_RESPONSE' });
  const nameEn = safeText(payload?.enname, 80) || '未命名热带系统';
  const baseStorm = {
    id: `gdacs-tc-${eventId}`,
    providerIds: { gdacs: eventId, cwa: null, zhejiang: String(zhejiangId) },
    name: { display: nameEn, en: nameEn, zh: safeText(payload?.name, 80) || TYPHOON_NAMES_ZH[nameEn.toUpperCase()] || null },
    basin: 'WP', active: true, classification: latest.classification,
    alertLevel: null, impactLevel: null,
    position: { ...latest.position, validAt: latest.validAt },
    intensity: { ...latest.intensity, basis: 'current_analysis', windAveragePeriodMinutes: 10 },
    historicalMaximum: { value: null, unit: null, basis: 'unknown' },
    movement: latest.movement,
    affectedRegions: [],
    startedAt: parseChinaLocalTime(payload?.starttime),
    updatedAt: latest.validAt,
    stale: false,
    source: { provider: '浙江省水利厅', upstream: '多机构台风路径汇聚', url: 'https://typhoon.slt.zj.gov.cn/', attribution: '浙江省水利厅台风路径' },
    detailUrl: `/typhoon/gdacs-tc-${eventId}?zj=${encodeURIComponent(zhejiangId)}`
  };
  return { storm: baseStorm, tracks };
}

function buildDetailResponse({ eventId, storm, tracks, now, gdacsStatus = 'ok', zhejiangStatus = 'ok' }) {
  const eventGeometry = { type: 'FeatureCollection', name: `gdacs-tc-${eventId}`, features: [] };
  return {
    schemaVersion: '3', status: tracks.observed.length ? 'ok' : 'degraded', generatedAt: now.toISOString(),
    storm,
    analyses: { type: 'FeatureCollection', features: [] },
    eventGeometry,
    tracks,
    trend: buildForecastTrend(storm, tracks),
    forecasts: tracks.forecasts,
    timeline: tracks.observed.length ? tracks.observed.map(point => ({ label: point.sourceLabel, validAt: point.validAt })) : [],
    mapConfig: {
      basemaps: [
        { id: 'standard', label: '标准地图', provider: 'CARTO / OpenStreetMap' },
        { id: 'satellite', label: '卫星地图', provider: 'Esri World Imagery' }
      ],
      weatherLayers: [
        { id: 'radar', label: '天气雷达', provider: 'RainViewer', type: 'rainviewer', timeGroup: 'synced-observation', cadenceMinutes: 10, maxNativeZoom: 7, baseOpacity: 0.72, icon: 'radar', defaultVisible: true },
        { id: 'himawari-ir', label: '红外云图', provider: 'NASA GIBS', type: 'gibs-wmts', layer: 'Himawari_AHI_Band13_Clean_Infrared', timeGroup: 'synced-observation', cadenceMinutes: 10, tileMatrixSet: 'GoogleMapsCompatible_Level6', maxNativeZoom: 6, baseOpacity: 0.44, icon: 'cloud', defaultVisible: false },
        { id: 'himawari-visible', label: '可见光云图', provider: 'NASA GIBS', type: 'gibs-wmts', layer: 'Himawari_AHI_Band3_Red_Visible_1km', timeGroup: 'synced-observation', cadenceMinutes: 10, tileMatrixSet: 'GoogleMapsCompatible_Level7', maxNativeZoom: 7, baseOpacity: 0.36, icon: 'sun-horizon', defaultVisible: false },
        { id: 'precipitation', label: '降水估算', provider: 'NASA GIBS', type: 'gibs-wmts', layer: 'IMERG_Precipitation_Rate_30min', timeGroup: 'latest-available', cadenceMinutes: 30, tileMatrixSet: 'GoogleMapsCompatible_Level6', maxNativeZoom: 6, baseOpacity: 0.66, icon: 'drop-half-bottom', defaultVisible: false }
      ]
    },
    sourceHealth: [
      { id: 'gdacs-detail', status: gdacsStatus, lastUpdatedAt: storm.updatedAt },
      { id: 'zhejiang-multisource-track', status: zhejiangStatus, lastUpdatedAt: storm.updatedAt }
    ],
    disclaimer: '实况与多机构预报路径来自浙江省水利厅台风路径汇聚服务；不同机构的预报存在差异，应以当地气象部门最新预警为准。',
    attribution: ['浙江省水利厅', 'GDACS', 'CARTO', 'OpenStreetMap', 'Esri', 'RainViewer', 'NASA GIBS']
  };
}

export async function getTyphoonDetail(id, { fetchImpl = fetch, now = new Date(), zhejiangId = '' } = {}) {
  const eventId = parseTyphoonId(id);
  if (zhejiangId) {
    const zhejiang = await getZhejiangDetailById(eventId, zhejiangId, { fetchImpl });
    return buildDetailResponse({ eventId, storm: zhejiang.storm, tracks: zhejiang.tracks, now, gdacsStatus: 'linked', zhejiangStatus: 'ok' });
  }
  const detailUrl = `${GDACS_BASE}/events/geteventdata?eventtype=TC&eventid=${eventId}`;
  const detail = await fetchJson(detailUrl, { fetchImpl });
  if (!detail?.properties || String(detail.properties.eventid) !== eventId) {
    throw new TyphoonServiceError('未找到对应台风', { status: 404, code: 'NOT_FOUND' });
  }
  const discoveredStorm = normalizeGdacsFeature(detail, now);
  if (!discoveredStorm) throw new TyphoonServiceError('台风位置不在支持范围内', { status: 404, code: 'OUT_OF_BASIN' });
  const zhejiangResult = await Promise.allSettled([getZhejiangDetailForStorm(discoveredStorm, { fetchImpl })]).then(results => results[0]);
  let fallbackStorm = discoveredStorm;
  if (zhejiangResult.status !== 'fulfilled') {
    try { fallbackStorm = await applyGdacsCurrentAnalysis(discoveredStorm, detail, { fetchImpl, now }); }
    catch { fallbackStorm = discoveredStorm; }
  }
  const storm = zhejiangResult.status === 'fulfilled' ? zhejiangResult.value.storm : fallbackStorm;
  const tracks = zhejiangResult.status === 'fulfilled' ? zhejiangResult.value.tracks : { observed: [], forecasts: [] };
  return buildDetailResponse({ eventId, storm, tracks, now, gdacsStatus: 'ok', zhejiangStatus: zhejiangResult.status === 'fulfilled' ? 'ok' : 'error' });
}

export { CACHE_CONTROL, REQUEST_TIMEOUT_MS };
