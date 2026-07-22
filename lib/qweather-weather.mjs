import { createQWeatherJwt } from './weather-astronomy.mjs';
import { buildAirQualityStandards } from './air-quality-standards.mjs';

const REQUEST_TIMEOUT_MS = 7000;
const SOFT_DAILY_UPSTREAM_LIMIT = 800;
const endpointCache = new Map();
let quotaWindow = { day: '', used: 0 };

const ENDPOINT_TTL = {
  now: 15 * 60 * 1000,
  hourly: 60 * 60 * 1000,
  daily: 6 * 60 * 60 * 1000,
  minutely: 10 * 60 * 1000,
  alerts: 15 * 60 * 1000,
  air: 60 * 60 * 1000,
  indices: 6 * 60 * 60 * 1000
};

const INDEX_KEYS = {
  '1': 'sport',
  '2': 'carWashing',
  '3': 'dressing',
  '4': 'fishing',
  '5': 'ultraviolet',
  '6': 'travel',
  '7': 'allergy',
  '8': 'comfort',
  '9': 'coldRisk',
  '10': 'airPollution',
  '11': 'airConditioner',
  '12': 'sunglasses',
  '13': 'makeup',
  '14': 'drying',
  '15': 'traffic',
  '16': 'sunscreen'
};

function qweatherConfig(env = {}) {
  if (String(env.WEATHER_QWEATHER_ENABLED || '').toLowerCase() === 'false') return null;
  const host = String(env.QWEATHER_API_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const projectId = String(env.QWEATHER_PROJECT_ID || '').trim();
  const credentialId = String(env.QWEATHER_CREDENTIAL_ID || '').trim();
  const privateKey = String(env.QWEATHER_PRIVATE_KEY || '').trim();
  if (!host || !projectId || !credentialId || !privateKey) return null;
  return { host, projectId, credentialId, privateKey };
}

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function currentQuota(nowMs) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (quotaWindow.day !== day) quotaWindow = { day, used: 0 };
  return quotaWindow;
}

function inMainlandChina(lon, lat) {
  return lon >= 73.4 && lon <= 135.1 && lat >= 18.1 && lat <= 53.6;
}

function qweatherIconToSkycon(icon, atNight = false) {
  const code = Number(icon);
  if (code === 100) return atNight ? 'CLEAR_NIGHT' : 'CLEAR_DAY';
  if ([101, 102, 103].includes(code)) return atNight ? 'PARTLY_CLOUDY_NIGHT' : 'PARTLY_CLOUDY_DAY';
  if ([150].includes(code)) return 'CLEAR_NIGHT';
  if ([151, 152, 153].includes(code)) return 'PARTLY_CLOUDY_NIGHT';
  if (code === 104) return 'CLOUDY';
  if ([302, 303].includes(code)) return 'THUNDER_SHOWER';
  if (code === 304) return 'HAIL';
  if ([300, 305, 309, 314, 350, 399].includes(code)) return 'LIGHT_RAIN';
  if ([301, 306, 315, 351].includes(code)) return 'MODERATE_RAIN';
  if ([307, 308, 310, 311, 316, 317].includes(code)) return 'HEAVY_RAIN';
  if ([312, 318].includes(code)) return 'STORM_RAIN';
  if ([313, 404, 405, 406, 456].includes(code)) return 'SLEET';
  if ([400, 407, 408, 457, 499].includes(code)) return 'LIGHT_SNOW';
  if ([401, 409].includes(code)) return 'MODERATE_SNOW';
  if ([402, 410].includes(code)) return 'HEAVY_SNOW';
  if (code === 403) return 'STORM_SNOW';
  if ([500, 501, 509, 510, 514, 515].includes(code)) return 'FOG';
  if ([502, 511].includes(code)) return 'LIGHT_HAZE';
  if (code === 512) return 'MODERATE_HAZE';
  if (code === 513) return 'HEAVY_HAZE';
  if ([503, 504].includes(code)) return 'DUST';
  if ([507, 508].includes(code)) return 'SAND';
  return atNight ? 'PARTLY_CLOUDY_NIGHT' : 'PARTLY_CLOUDY_DAY';
}

function isNightAt(dateValue, daily) {
  const date = new Date(dateValue);
  if (!Number.isFinite(date.getTime())) return false;
  const day = (daily || []).find(item => String(item.fxDate || '') === dateValue.slice(0, 10)) || daily?.[0];
  if (!day?.sunrise || !day?.sunset) return date.getHours() < 6 || date.getHours() >= 18;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const toMinutes = value => number(String(value).split(':')[0]) * 60 + number(String(value).split(':')[1]);
  return minutes < toMinutes(day.sunrise) || minutes >= toMinutes(day.sunset);
}

function buildLifeIndex(payload) {
  const rows = Array.isArray(payload?.daily) ? payload.daily : [];
  const life = {};
  for (const row of rows) {
    const key = INDEX_KEYS[String(row.type || '')];
    if (!key) continue;
    const item = {
      date: String(row.date || ''),
      type: String(row.type || ''),
      name: String(row.name || ''),
      index: number(row.level, null),
      category: String(row.category || '').trim() || null,
      desc: String(row.category || row.text || '').trim() || '暂无建议',
      text: String(row.text || '').trim() || null
    };
    if (!life[key]) life[key] = [];
    life[key].push(item);
  }
  return { life, rows: Object.values(life).flat() };
}

function normalizeAir(payload) {
  const pollutants = {};
  for (const item of Array.isArray(payload?.pollutants) ? payload.pollutants : []) {
    const key = item.code === 'pm2p5' ? 'pm25' : String(item.code || '').toLowerCase();
    if (key) pollutants[key] = number(item.concentration?.value, null);
  }
  const standards = buildAirQualityStandards(payload);
  const local = standards.local;
  return {
    ...pollutants,
    aqi: {
      local: local.aqi,
      chn: local.aqi,
      us: standards.us.aqi,
      european: standards.european.aqi
    },
    description: {
      local: local.category,
      chn: local.category,
      us: standards.us.category,
      european: standards.european.category
    },
    standards,
    defaultStandard: 'local',
    standard: local.name,
    primaryPollutant: local.primaryPollutant,
    healthEffect: payload?.indexes?.find(item => item.code !== 'qaqi')?.health?.effect || null,
    healthAdvice: local.healthAdvice,
    sensitiveAdvice: payload?.indexes?.find(item => item.code !== 'qaqi')?.health?.advice?.sensitivePopulation || null,
    updatedAt: iso(payload?.metadata?.tag ? Date.now() : null)
  };
}

function hourlyDescription(hourly, minutely) {
  if (minutely?.summary) return String(minutely.summary);
  const rows = hourly.slice(0, 12);
  const rain = rows.find(item => number(item.pop) >= 40 || number(item.precip) > 0.1);
  if (rain) {
    const time = new Date(rain.fxTime);
    const label = Number.isFinite(time.getTime()) ? `${String(time.getHours()).padStart(2, '0')}:00` : '稍后';
    return `${label} 前后降水概率升高，其余时段以${rows[0]?.text || '当前天气'}为主`;
  }
  const conditions = [...new Set(rows.map(item => item.text).filter(Boolean))];
  return conditions.length > 1 ? `未来数小时由${conditions[0]}转为${conditions[1]}` : `未来数小时${conditions[0] || '天气变化平稳'}`;
}

export function normalizeQWeatherBundle(bundle, location = {}) {
  const now = bundle.now?.now || {};
  const hourlyRows = Array.isArray(bundle.hourly?.hourly) ? bundle.hourly.hourly : [];
  const dailyRows = Array.isArray(bundle.daily?.daily) ? bundle.daily.daily : [];
  const { life, rows: lifeRows } = buildLifeIndex(bundle.indices);
  const air = normalizeAir(bundle.air);
  const minutelyRows = Array.isArray(bundle.minutely?.minutely) ? bundle.minutely.minutely : [];
  const alerts = Array.isArray(bundle.alerts?.alerts) ? bundle.alerts.alerts : [];
  const today = dailyRows[0] || {};
  const currentNight = isNightAt(now.obsTime || new Date().toISOString(), dailyRows);
  const currentSkycon = qweatherIconToSkycon(now.icon, currentNight);
  const realtime = {
    status: 'ok',
    temperature: number(now.temp),
    apparent_temperature: number(now.feelsLike, number(now.temp)),
    pressure: number(now.pressure) * 100,
    humidity: number(now.humidity) / 100,
    wind: { direction: number(now.wind360), speed: number(now.windSpeed), scale: now.windScale || null, text: now.windDir || null },
    precipitation: { local: { intensity: number(now.precip) }, intensity: number(now.precip) },
    cloudrate: number(now.cloud) / 100,
    visibility: number(now.vis),
    skycon: currentSkycon,
    skyconText: now.text || null,
    dewPoint: number(now.dew, null),
    air_quality: air,
    life_index: {
      comfort: life.comfort?.[0] || { index: null, desc: null },
      ultraviolet: life.ultraviolet?.[0] || { index: number(today.uvIndex), desc: number(today.uvIndex) >= 7 ? '较强' : '温和' }
    },
    obsTime: iso(now.obsTime),
    updatedAt: iso(bundle.now?.updateTime)
  };
  const hourly = {
    status: 'ok',
    description: hourlyDescription(hourlyRows, bundle.minutely),
    temperature: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.temp) })),
    apparent_temperature: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.temp) })),
    skycon: hourlyRows.map(item => ({ datetime: item.fxTime, value: qweatherIconToSkycon(item.icon, isNightAt(item.fxTime, dailyRows)), text: item.text || null })),
    precipitation: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.precip), probability: number(item.pop) })),
    wind: hourlyRows.map(item => ({ datetime: item.fxTime, direction: number(item.wind360), speed: number(item.windSpeed) })),
    humidity: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.humidity) / 100 })),
    pressure: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.pressure) * 100 })),
    cloudrate: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.cloud) / 100 })),
    visibility: hourlyRows.map(item => ({ datetime: item.fxTime, value: number(item.vis) }))
  };
  const daily = {
    status: 'ok',
    temperature: dailyRows.map(item => ({ date: item.fxDate, max: number(item.tempMax), min: number(item.tempMin) })),
    skycon: dailyRows.map(item => ({ date: item.fxDate, value: qweatherIconToSkycon(item.iconDay), text: item.textDay || null, nightValue: qweatherIconToSkycon(item.iconNight, true), nightText: item.textNight || null })),
    astro: dailyRows.map(item => ({ date: item.fxDate, sunrise: { time: item.sunrise || null }, sunset: { time: item.sunset || null } })),
    precipitation: dailyRows.map(item => ({ date: item.fxDate, avg: number(item.precip), probability: null })),
    humidity: dailyRows.map(item => ({ date: item.fxDate, avg: number(item.humidity) / 100 })),
    wind: dailyRows.map(item => ({ date: item.fxDate, speed: number(item.windSpeedDay), direction: number(item.wind360Day), text: item.windDirDay || null })),
    life_index: life
  };
  const astronomy = {
    source: 'qweather',
    providerLabel: 'QWeather 和风天气',
    updatedAt: iso(bundle.daily?.updateTime) || new Date().toISOString(),
    daily: dailyRows.map(item => ({
      date: String(item.fxDate || ''),
      moonrise: item.moonrise || null,
      moonset: item.moonset || null,
      moonPhase: item.moonPhase || null,
      moonPhaseIcon: item.moonPhaseIcon || null
    }))
  };
  return {
    status: 'ok',
    api_version: 'qweather-v7',
    source: 'qweather',
    server_time: Math.floor(Date.now() / 1000),
    location: [number(location.lat), number(location.lon)],
    result: {
      realtime,
      hourly,
      daily,
      minutely: {
        supported: Boolean(bundle.minutely),
        summary: bundle.minutely?.summary || null,
        precipitation: minutelyRows.map(item => ({ datetime: item.fxTime, value: number(item.precip), type: item.type || 'rain' })),
        updatedAt: iso(bundle.minutely?.updateTime)
      },
      alerts: {
        available: Boolean(bundle.alerts),
        items: alerts,
        count: alerts.length
      },
      forecast_keypoint: hourly.description,
      indices: lifeRows,
      astronomy,
      dataStatus: bundle.dataStatus || {},
      attribution: 'QWeather 和风天气'
    }
  };
}

async function fetchJson({ config, token, name, path, fetchImpl, timeoutMs, nowMs }) {
  const cacheKey = `${config.host}:${path}`;
  const cached = endpointCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return { payload: cached.payload, source: 'cache' };
  const quota = currentQuota(nowMs);
  if (quota.used >= SOFT_DAILY_UPSTREAM_LIMIT) {
    if (cached?.payload) return { payload: cached.payload, source: 'stale-cache' };
    throw new Error('QWeather free-tier safety limit reached');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    quota.used += 1;
    const response = await fetchImpl(`https://${config.host}${path}`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.code && String(payload.code) !== '200') throw new Error(`${name} QWeather ${payload.code}`);
    endpointCache.set(cacheKey, { payload, expiresAt: nowMs + ENDPOINT_TTL[name], storedAt: nowMs });
    return { payload, source: 'network' };
  } catch (error) {
    if (cached?.payload) return { payload: cached.payload, source: 'stale-cache', error: error.message };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchQWeatherWeather({ env = {}, lon, lat, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, nowMs = Date.now() } = {}) {
  const config = qweatherConfig(env);
  if (!config) throw new Error('QWeather is not configured');
  const longitude = Number(lon);
  const latitude = Number(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('Invalid weather coordinates');
  const normalizedLon = longitude.toFixed(2);
  const normalizedLat = latitude.toFixed(2);
  const location = encodeURIComponent(`${normalizedLon},${normalizedLat}`);
  const token = await createQWeatherJwt(config, nowMs);
  const specs = [
    ['now', `/v7/weather/now?location=${location}&lang=zh`],
    ['hourly', `/v7/weather/24h?location=${location}&lang=zh`],
    ['daily', `/v7/weather/7d?location=${location}&lang=zh`],
    ['air', `/airquality/v1/current/${normalizedLat}/${normalizedLon}?lang=zh`],
    ['indices', `/v7/indices/1d?type=0&location=${location}&lang=zh`],
    ['alerts', `/weatheralert/v1/current/${normalizedLat}/${normalizedLon}?localTime=true&lang=zh`]
  ];
  if (inMainlandChina(longitude, latitude)) specs.push(['minutely', `/v7/minutely/5m?location=${location}&lang=zh`]);
  const settled = await Promise.allSettled(specs.map(async ([name, path]) => {
    const response = await fetchJson({ config, token, name, path, fetchImpl, timeoutMs, nowMs });
    return [name, response];
  }));
  const bundle = { dataStatus: {} };
  settled.forEach((item, index) => {
    const name = specs[index][0];
    if (item.status === 'fulfilled') {
      bundle[name] = item.value[1].payload;
      bundle.dataStatus[name] = { status: item.value[1].source, error: item.value[1].error || null };
    } else {
      bundle.dataStatus[name] = { status: 'error', error: item.reason?.message || 'Unavailable' };
    }
  });
  if (!bundle.now || !bundle.hourly || !bundle.daily) throw new Error('Required QWeather data is unavailable');
  return normalizeQWeatherBundle(bundle, { lon: normalizedLon, lat: normalizedLat });
}

export function getQWeatherQuotaState(nowMs = Date.now()) {
  const quota = currentQuota(nowMs);
  return { ...quota, softLimit: SOFT_DAILY_UPSTREAM_LIMIT };
}
