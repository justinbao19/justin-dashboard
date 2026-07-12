const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const GRID_STEP = 2.5;
const GRID_LAT_RADIUS = 10;
const GRID_LON_RADIUS = 12.5;

const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const round = value => Math.round(Number(value) * 1000) / 1000;
const wrapLongitude = value => ((Number(value) + 540) % 360) - 180;

export function buildTyphoonFieldGrid(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -70 || lat > 70 || lon < -180 || lon > 180) {
    throw new Error('台风场中心坐标无效');
  }
  const points = [];
  for (let latOffset = -GRID_LAT_RADIUS; latOffset <= GRID_LAT_RADIUS; latOffset += GRID_STEP) {
    for (let lonOffset = -GRID_LON_RADIUS; lonOffset <= GRID_LON_RADIUS; lonOffset += GRID_STEP) {
      points.push({ lat: round(Math.max(-70, Math.min(70, lat + latOffset))), lon: round(wrapLongitude(lon + lonOffset)) });
    }
  }
  return points;
}

function requestUrl(base, points, parameters) {
  const query = new URLSearchParams({
    latitude: points.map(point => point.lat).join(','),
    longitude: points.map(point => point.lon).join(','),
    current: parameters,
    timezone: 'GMT'
  });
  if (base === FORECAST_URL) query.set('wind_speed_unit', 'ms');
  return `${base}?${query}`;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`模型场数据请求失败 (${response.status})`);
  return response.json();
}

function responseList(value) { return Array.isArray(value) ? value : [value]; }

function feature(point, properties) {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } };
}

export function normalizeTyphoonFields(points, windPayload, wavePayload) {
  const windRows = responseList(windPayload);
  const waveRows = responseList(wavePayload);
  const windFeatures = [];
  const waveFeatures = [];
  const windTimes = [];
  const waveTimes = [];

  points.forEach((point, index) => {
    const wind = windRows[index]?.current || {};
    if (finite(wind.wind_speed_10m)) {
      windFeatures.push(feature(point, {
        value: Number(wind.wind_speed_10m),
        direction: finite(wind.wind_direction_10m) ? Number(wind.wind_direction_10m) : null,
        gust: finite(wind.wind_gusts_10m) ? Number(wind.wind_gusts_10m) : null
      }));
      if (wind.time) windTimes.push(wind.time);
    }
    const wave = waveRows[index]?.current || {};
    if (finite(wave.wave_height)) {
      waveFeatures.push(feature(point, {
        value: Number(wave.wave_height),
        direction: finite(wave.wave_direction) ? Number(wave.wave_direction) : null,
        period: finite(wave.wave_period) ? Number(wave.wave_period) : null
      }));
      if (wave.time) waveTimes.push(wave.time);
    }
  });

  return {
    wind: { observedAt: windTimes.sort().at(-1) || null, geojson: { type: 'FeatureCollection', features: windFeatures } },
    waves: { observedAt: waveTimes.sort().at(-1) || null, geojson: { type: 'FeatureCollection', features: waveFeatures } }
  };
}

export async function getTyphoonFields(latitude, longitude, { fetchImpl = fetch } = {}) {
  const points = buildTyphoonFieldGrid(latitude, longitude);
  const [windPayload, wavePayload] = await Promise.all([
    fetchJson(requestUrl(FORECAST_URL, points, 'wind_speed_10m,wind_direction_10m,wind_gusts_10m'), fetchImpl),
    fetchJson(requestUrl(MARINE_URL, points, 'wave_height,wave_direction,wave_period'), fetchImpl)
  ]);
  const fields = normalizeTyphoonFields(points, windPayload, wavePayload);
  return {
    schemaVersion: '1',
    status: fields.wind.geojson.features.length && fields.waves.geojson.features.length ? 'ok' : 'degraded',
    generatedAt: new Date().toISOString(),
    grid: { spacingDegrees: GRID_STEP, pointCount: points.length },
    fields,
    attribution: 'Open-Meteo · 全球天气与海浪模式'
  };
}
