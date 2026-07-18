const DEFAULT_LOCATION = { lon: 121.405, lat: 31.123 };

export const WEATHER_CACHE_POLICIES = Object.freeze({
  snapshot: { fresh: 600, stale: 3600 },
  caiyun: { fresh: 600, stale: 3600 },
  now: { fresh: 600, stale: 3600 },
  warning: { fresh: 300, stale: 1800 },
  minutely: { fresh: 300, stale: 1200 },
  hourly: { fresh: 2700, stale: 10800 },
  daily: { fresh: 10800, stale: 43200 },
  indices: { fresh: 21600, stale: 86400 },
  airCurrent: { fresh: 1800, stale: 10800 },
  airHourly: { fresh: 3600, stale: 21600 },
  airDaily: { fresh: 28800, stale: 86400 }
});

const runtimeSingleFlight = new Map();
let jwtCache = null;

const toNumber = (value, fallback = null) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const asArray = value => Array.isArray(value) ? value : [];
const isoNow = () => new Date().toISOString();

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clampCoordinate(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : fallback;
}

export function normalizeWeatherLocation(lon, lat) {
  return {
    lon: clampCoordinate(lon, DEFAULT_LOCATION.lon),
    lat: clampCoordinate(lat, DEFAULT_LOCATION.lat)
  };
}

function cacheKey(resource, location, lang = 'zh') {
  return `weather:v2:${resource}:${location.lon.toFixed(2)},${location.lat.toFixed(2)}:${lang}`;
}

export function createMemoryWeatherCache() {
  const entries = new Map();
  return {
    async get(key) {
      const item = entries.get(key);
      if (!item || item.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return item.value;
    },
    async set(key, value, options = {}) {
      entries.set(key, { value, expiresAt: Date.now() + (Number(options.ttl) || 60) * 1000 });
    },
    async delete(key) { entries.delete(key); }
  };
}

async function loadCachedResource({ cache, key, policy, loader, force = false, schedule }) {
  const now = Date.now();
  const cached = cache ? await cache.get(key).catch(() => undefined) : undefined;
  if (!force && cached?.value && cached.freshUntil > now) {
    return { value: cached.value, cache: 'hit', updatedAt: cached.updatedAt, stale: false };
  }

  const refresh = async () => {
    if (runtimeSingleFlight.has(key)) return runtimeSingleFlight.get(key);
    const promise = (async () => {
      const value = await loader();
      const updatedAt = isoNow();
      if (cache) {
        await cache.set(key, {
          value,
          updatedAt,
          freshUntil: Date.now() + policy.fresh * 1000,
          staleUntil: Date.now() + policy.stale * 1000
        }, {
          ttl: policy.stale,
          tags: ['weather', `weather-${key.split(':')[2] || 'resource'}`],
          name: `weather-${key.split(':')[2] || 'resource'}`
        }).catch(() => {});
      }
      return { value, cache: cached?.value ? 'refresh' : 'miss', updatedAt, stale: false };
    })().finally(() => runtimeSingleFlight.delete(key));
    runtimeSingleFlight.set(key, promise);
    return promise;
  };

  if (!force && cached?.value && cached.staleUntil > now) {
    const work = refresh().catch(() => null);
    if (schedule) schedule(work);
    return { value: cached.value, cache: 'stale', updatedAt: cached.updatedAt, stale: true };
  }

  try {
    return await refresh();
  } catch (error) {
    if (cached?.value) return { value: cached.value, cache: 'expired', updatedAt: cached.updatedAt, stale: true, error };
    throw error;
  }
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBytes(pem) {
  const clean = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  if (!clean) throw new Error('QWeather private key is missing');
  const binary = atob(clean);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export async function createQWeatherJwt(config, nowMs = Date.now()) {
  const cached = jwtCache;
  if (cached && cached.configKey === `${config.projectId}:${config.credentialId}` && cached.expiresAt - 60000 > nowMs) return cached.token;
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const iat = Math.floor(nowMs / 1000) - 30;
  const exp = iat + 900;
  const header = base64Url(JSON.stringify({ alg: 'EdDSA', kid: config.credentialId }));
  const payload = base64Url(JSON.stringify({ sub: config.projectId, iat, exp }));
  const input = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(config.privateKey), { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input));
  const token = `${input}.${base64Url(signature)}`;
  jwtCache = { token, expiresAt: exp * 1000, configKey: `${config.projectId}:${config.credentialId}` };
  return token;
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Weather upstream ${response.status}`);
    const payload = await response.json();
    if (payload?.code && String(payload.code) !== '200') throw new Error(`Weather upstream code ${payload.code}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function qweatherConfig(env) {
  const host = String(env.QWEATHER_API_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const projectId = String(env.QWEATHER_PROJECT_ID || '').trim();
  const credentialId = String(env.QWEATHER_CREDENTIAL_ID || '').trim();
  const privateKey = String(env.QWEATHER_PRIVATE_KEY || '').trim();
  if (!host || !projectId || !credentialId || !privateKey) return null;
  return { host, projectId, credentialId, privateKey };
}

async function qweatherRequest(fetchImpl, config, path, params = {}) {
  const token = await createQWeatherJwt(config);
  const url = new URL(`https://${config.host}${path}`);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  return fetchJson(fetchImpl, url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'accept-encoding': 'gzip' } });
}

function skyCodeFromText(text, icon) {
  const value = String(text || '');
  const number = Number(icon);
  const night = number === 150 || (number >= 151 && number <= 159);
  if (/雷|thunder/i.test(value)) return 'STORM_RAIN';
  if (/暴雪|blizzard/i.test(value)) return 'STORM_SNOW';
  if (/大雪|heavy snow/i.test(value)) return 'HEAVY_SNOW';
  if (/中雪|moderate snow/i.test(value)) return 'MODERATE_SNOW';
  if (/雪|snow/i.test(value)) return 'LIGHT_SNOW';
  if (/暴雨|storm rain/i.test(value)) return 'STORM_RAIN';
  if (/大雨|heavy rain/i.test(value)) return 'HEAVY_RAIN';
  if (/中雨|moderate rain/i.test(value)) return 'MODERATE_RAIN';
  if (/雨|drizzle|shower/i.test(value)) return 'LIGHT_RAIN';
  if (/霾|haze/i.test(value)) return 'MODERATE_HAZE';
  if (/雾|fog/i.test(value)) return 'FOG';
  if (/沙|尘|sand|dust/i.test(value)) return 'DUST';
  if (/阴|overcast/i.test(value)) return 'CLOUDY';
  if (/云|cloud/i.test(value)) return night ? 'PARTLY_CLOUDY_NIGHT' : 'PARTLY_CLOUDY_DAY';
  return night ? 'CLEAR_NIGHT' : 'CLEAR_DAY';
}

export function normalizeQWeatherResources(resources) {
  const now = resources.now?.now || {};
  const current = resources.now ? {
    observedAt: safeDate(now.obsTime),
    temperature: toNumber(now.temp),
    feelsLike: toNumber(now.feelsLike),
    conditionCode: skyCodeFromText(now.text, now.icon),
    conditionText: now.text || '',
    humidity: toNumber(now.humidity),
    windSpeed: toNumber(now.windSpeed),
    windDirection: toNumber(now.wind360),
    windScale: now.windScale || '',
    visibility: toNumber(now.vis),
    pressure: toNumber(now.pressure),
    precipitation: toNumber(now.precip),
    cloudCover: toNumber(now.cloud),
    dewPoint: toNumber(now.dew),
    source: 'qweather'
  } : null;

  const hourly = asArray(resources.hourly?.hourly).map(item => ({
    time: safeDate(item.fxTime), temperature: toNumber(item.temp), feelsLike: null,
    conditionCode: skyCodeFromText(item.text, item.icon), conditionText: item.text || '',
    precipitation: toNumber(item.precip, 0), precipitationProbability: toNumber(item.pop, 0),
    humidity: toNumber(item.humidity), windSpeed: toNumber(item.windSpeed), windDirection: toNumber(item.wind360),
    pressure: toNumber(item.pressure), visibility: toNumber(item.vis), cloudCover: toNumber(item.cloud), dewPoint: toNumber(item.dew), source: 'qweather'
  }));

  const daily = asArray(resources.daily?.daily).map(item => ({
    date: item.fxDate || '', sunrise: item.sunrise || null, sunset: item.sunset || null,
    moonrise: item.moonrise || null, moonset: item.moonset || null, moonPhase: item.moonPhase || '', moonPhaseIcon: item.moonPhaseIcon || '',
    temperatureMin: toNumber(item.tempMin), temperatureMax: toNumber(item.tempMax),
    conditionDayCode: skyCodeFromText(item.textDay, item.iconDay), conditionNightCode: skyCodeFromText(item.textNight, item.iconNight),
    conditionDayText: item.textDay || '', conditionNightText: item.textNight || '',
    precipitation: toNumber(item.precip, 0), humidity: toNumber(item.humidity), pressure: toNumber(item.pressure),
    visibility: toNumber(item.vis), cloudCover: toNumber(item.cloud), uvIndex: toNumber(item.uvIndex),
    windSpeedDay: toNumber(item.windSpeedDay), windDirectionDay: toNumber(item.wind360Day), source: 'qweather'
  }));

  const precipitation = resources.minutely ? {
    summary: resources.minutely.summary || '',
    minutes: asArray(resources.minutely.minutely).map(item => ({ time: safeDate(item.fxTime), value: toNumber(item.precip, 0), type: item.type || 'rain' })),
    source: 'qweather', updatedAt: safeDate(resources.minutely.updateTime)
  } : null;

  const alerts = asArray(resources.warning?.warning).map(item => ({
    id: item.id || item.warningId || `${item.title}:${item.pubTime}`,
    title: item.title || '', sender: item.sender || '', publishedAt: safeDate(item.pubTime),
    startsAt: safeDate(item.startTime), endsAt: safeDate(item.endTime), status: item.status || '',
    level: item.level || item.severity || item.severityColor || '', type: item.typeName || item.type || '',
    description: item.text || '', sources: asArray(resources.warning?.refer?.sources), source: 'qweather'
  }));

  const indices = asArray(resources.indices?.daily).map(item => ({
    date: item.date || '', type: String(item.type || ''), name: item.name || '', level: String(item.level || ''),
    category: item.category || '', text: item.text || '', source: 'qweather'
  }));

  const airIndexes = asArray(resources.airCurrent?.indexes);
  const preferredIndex = airIndexes.find(item => item.code === 'cn-mee') || airIndexes.find(item => item.code === 'qaqi') || airIndexes[0] || {};
  const pollutants = Object.fromEntries(asArray(resources.airCurrent?.pollutants).map(item => [item.code, toNumber(item.concentration?.value)]));
  const airCurrent = resources.airCurrent ? {
    observedAt: safeDate(resources.airCurrent?.metadata?.updateTime || resources.airCurrent?.updateTime),
    aqi: toNumber(preferredIndex.aqi), display: preferredIndex.aqiDisplay || String(preferredIndex.aqi || ''),
    category: preferredIndex.category || '', level: preferredIndex.level || '', primaryPollutant: preferredIndex.primaryPollutant?.name || '',
    color: preferredIndex.color || null, healthEffect: preferredIndex.health?.effect || '',
    adviceGeneral: preferredIndex.health?.advice?.generalPopulation || '', adviceSensitive: preferredIndex.health?.advice?.sensitivePopulation || '',
    pollutants, stations: asArray(resources.airCurrent?.stations), source: 'qweather'
  } : null;
  const normalizeAirForecast = list => asArray(list).map(item => {
    const index = asArray(item.indexes).find(entry => entry.code === 'cn-mee') || asArray(item.indexes).find(entry => entry.code === 'qaqi') || asArray(item.indexes)[0] || {};
    return { time: safeDate(item.forecastTime), aqi: toNumber(index.aqi), display: index.aqiDisplay || '', category: index.category || '', level: index.level || '', primaryPollutant: index.primaryPollutant?.name || '' };
  });
  const airQuality = airCurrent || resources.airHourly || resources.airDaily ? {
    current: airCurrent,
    hourly: normalizeAirForecast(resources.airHourly?.hours),
    daily: normalizeAirForecast(resources.airDaily?.days),
    source: 'qweather'
  } : null;

  return {
    current, hourly, daily, precipitation, alerts, indices, airQuality,
    astronomy: { daily: daily.map(item => ({ date: item.date, sunrise: item.sunrise, sunset: item.sunset, moonrise: item.moonrise, moonset: item.moonset, moonPhase: item.moonPhase, moonPhaseIcon: item.moonPhaseIcon })) },
    narrative: '',
    source: 'qweather'
  };
}

function valueAt(items, index, key = 'value') {
  return toNumber(asArray(items)[index]?.[key]);
}

export function normalizeCaiyunPayload(payload) {
  const result = payload?.result || {};
  const realtime = result.realtime || {};
  const hourlyRoot = result.hourly || {};
  const hourlyTemp = asArray(hourlyRoot.temperature);
  const current = Object.keys(realtime).length ? {
    observedAt: safeDate(payload.server_time ? Number(payload.server_time) * 1000 : null),
    temperature: toNumber(realtime.temperature), feelsLike: toNumber(realtime.apparent_temperature),
    conditionCode: realtime.skycon || 'CLOUDY', conditionText: '', humidity: toNumber(realtime.humidity) === null ? null : toNumber(realtime.humidity) * 100,
    windSpeed: toNumber(realtime.wind?.speed), windDirection: toNumber(realtime.wind?.direction), windScale: '',
    visibility: toNumber(realtime.visibility), pressure: toNumber(realtime.pressure) === null ? null : toNumber(realtime.pressure) / 100,
    precipitation: toNumber(realtime.precipitation?.local?.intensity, 0), cloudCover: toNumber(realtime.cloudrate) === null ? null : toNumber(realtime.cloudrate) * 100,
    dewPoint: null, source: 'caiyun'
  } : null;
  const hourly = hourlyTemp.map((item, index) => ({
    time: safeDate(item.datetime), temperature: toNumber(item.value), feelsLike: valueAt(hourlyRoot.apparent_temperature, index),
    conditionCode: asArray(hourlyRoot.skycon)[index]?.value || 'CLOUDY', conditionText: '',
    precipitation: valueAt(hourlyRoot.precipitation, index) || 0, precipitationProbability: valueAt(hourlyRoot.precipitation, index, 'probability') || 0,
    humidity: valueAt(hourlyRoot.humidity, index) === null ? null : valueAt(hourlyRoot.humidity, index) * 100,
    windSpeed: toNumber(asArray(hourlyRoot.wind)[index]?.speed), windDirection: toNumber(asArray(hourlyRoot.wind)[index]?.direction),
    pressure: valueAt(hourlyRoot.pressure, index) === null ? null : valueAt(hourlyRoot.pressure, index) / 100,
    visibility: valueAt(hourlyRoot.visibility, index), cloudCover: valueAt(hourlyRoot.cloudrate, index) === null ? null : valueAt(hourlyRoot.cloudrate, index) * 100,
    dewPoint: null, source: 'caiyun'
  }));
  const dailyRoot = result.daily || {};
  const daily = asArray(dailyRoot.temperature).map((item, index) => {
    const astro = asArray(dailyRoot.astro)[index] || {};
    return {
      date: String(item.date || '').slice(0, 10), sunrise: astro.sunrise?.time || null, sunset: astro.sunset?.time || null, moonrise: null, moonset: null, moonPhase: '', moonPhaseIcon: '',
      temperatureMin: toNumber(item.min), temperatureMax: toNumber(item.max),
      conditionDayCode: asArray(dailyRoot.skycon_08h_20h)[index]?.value || asArray(dailyRoot.skycon)[index]?.value || 'CLOUDY',
      conditionNightCode: asArray(dailyRoot.skycon_20h_32h)[index]?.value || asArray(dailyRoot.skycon)[index]?.value || 'CLOUDY',
      conditionDayText: '', conditionNightText: '', precipitation: toNumber(asArray(dailyRoot.precipitation)[index]?.avg, 0),
      humidity: toNumber(asArray(dailyRoot.humidity)[index]?.avg) === null ? null : toNumber(asArray(dailyRoot.humidity)[index]?.avg) * 100,
      pressure: toNumber(asArray(dailyRoot.pressure)[index]?.avg) === null ? null : toNumber(asArray(dailyRoot.pressure)[index]?.avg) / 100,
      visibility: toNumber(asArray(dailyRoot.visibility)[index]?.avg), cloudCover: toNumber(asArray(dailyRoot.cloudrate)[index]?.avg) === null ? null : toNumber(asArray(dailyRoot.cloudrate)[index]?.avg) * 100,
      uvIndex: toNumber(asArray(dailyRoot.life_index?.ultraviolet)[index]?.index), windSpeedDay: toNumber(asArray(dailyRoot.wind_08h_20h)[index]?.avg?.speed),
      windDirectionDay: toNumber(asArray(dailyRoot.wind_08h_20h)[index]?.avg?.direction), source: 'caiyun'
    };
  });
  const minutely = result.minutely || {};
  const precipitation = {
    summary: minutely.description || result.forecast_keypoint || hourlyRoot.description || '',
    minutes: asArray(minutely.precipitation_2h).map((value, index) => ({ time: new Date(Date.now() + index * 60000).toISOString(), value: toNumber(value, 0), type: 'rain' })),
    source: 'caiyun', updatedAt: current?.observedAt
  };
  const aq = realtime.air_quality || {};
  const airQuality = Object.keys(aq).length ? {
    current: { observedAt: current?.observedAt, aqi: toNumber(aq.aqi?.chn), display: String(aq.aqi?.chn || ''), category: aq.description?.chn || '', level: '', primaryPollutant: '', color: null, healthEffect: '', adviceGeneral: '', adviceSensitive: '', pollutants: { pm2p5: toNumber(aq.pm25), pm10: toNumber(aq.pm10), o3: toNumber(aq.o3), so2: toNumber(aq.so2), no2: toNumber(aq.no2), co: toNumber(aq.co) }, stations: [], source: 'caiyun' },
    hourly: asArray(hourlyRoot.air_quality?.aqi).map(item => ({ time: safeDate(item.datetime), aqi: toNumber(item.value?.chn), display: String(item.value?.chn || ''), category: '', level: '', primaryPollutant: '' })),
    daily: [], source: 'caiyun'
  } : null;
  const life = dailyRoot.life_index || {};
  const indexNames = { ultraviolet: '紫外线', carWashing: '洗车', dressing: '穿衣', comfort: '舒适度', coldRisk: '感冒' };
  const indices = Object.entries(indexNames).flatMap(([type, name]) => asArray(life[type]).slice(0, 3).map(item => ({ date: item.date || '', type, name, level: String(item.index || ''), category: item.desc || '', text: '', source: 'caiyun' })));
  const alertContent = asArray(result.alert?.content || result.alert);
  const alerts = alertContent.map((item, index) => ({ id: item.alertId || `caiyun-${index}`, title: item.title || '', sender: item.source || '', publishedAt: safeDate(item.pubtimestamp ? Number(item.pubtimestamp) * 1000 : null), startsAt: null, endsAt: null, status: item.status || '', level: item.code || '', type: item.location || '', description: item.description || '', sources: item.source ? [item.source] : [], source: 'caiyun' }));
  return {
    current, hourly, daily, precipitation, alerts, indices, airQuality,
    astronomy: { daily: daily.map(item => ({ date: item.date, sunrise: item.sunrise, sunset: item.sunset, moonrise: null, moonset: null, moonPhase: '', moonPhaseIcon: '' })) },
    narrative: result.forecast_keypoint || hourlyRoot.description || '', source: 'caiyun', legacyResult: result
  };
}

function mergeWeather(caiyun, qweather, primaryProvider) {
  const primary = primaryProvider === 'qweather' && qweather ? qweather : (caiyun || qweather);
  const secondary = primary === caiyun ? qweather : caiyun;
  if (!primary) return null;
  const current = primary.current ? { ...primary.current } : secondary?.current ? { ...secondary.current } : null;
  if (current && secondary?.current) {
    for (const field of ['dewPoint', 'cloudCover', 'precipitation']) if (current[field] === null || current[field] === undefined) current[field] = secondary.current[field];
  }
  const preferLonger = (first, second) => asArray(second).length > asArray(first).length ? second : first;
  const hourly = preferLonger(primary.hourly, secondary?.hourly);
  const daily = preferLonger(primary.daily, secondary?.daily);
  const precipitation = primary.precipitation?.minutes?.length ? primary.precipitation : (secondary?.precipitation || primary.precipitation);
  const airQuality = qweather?.airQuality || primary.airQuality || secondary?.airQuality || null;
  const alerts = [...asArray(qweather?.alerts), ...asArray(caiyun?.alerts)].filter((item, index, list) => list.findIndex(candidate => candidate.title === item.title && candidate.publishedAt === item.publishedAt) === index);
  const indices = qweather?.indices?.length ? qweather.indices : (primary.indices || secondary?.indices || []);
  const astronomy = qweather?.astronomy?.daily?.length ? qweather.astronomy : (primary.astronomy || secondary?.astronomy || { daily: [] });
  return { current, hourly, daily, precipitation, airQuality, alerts, indices, astronomy, narrative: caiyun?.narrative || '', primaryProvider: primary.source };
}

function buildLegacyResult(snapshot) {
  const current = snapshot.current || {};
  return {
    realtime: {
      temperature: current.temperature, apparent_temperature: current.feelsLike, skycon: current.conditionCode,
      humidity: current.humidity === null ? null : current.humidity / 100, visibility: current.visibility,
      pressure: current.pressure === null ? null : current.pressure * 100,
      cloudrate: current.cloudCover === null ? null : current.cloudCover / 100,
      wind: { speed: current.windSpeed, direction: current.windDirection },
      precipitation: { local: { intensity: current.precipitation || 0 } },
      air_quality: snapshot.airQuality?.current ? {
        aqi: { chn: snapshot.airQuality.current.aqi }, description: { chn: snapshot.airQuality.current.category },
        pm25: snapshot.airQuality.current.pollutants?.pm2p5, pm10: snapshot.airQuality.current.pollutants?.pm10,
        o3: snapshot.airQuality.current.pollutants?.o3, so2: snapshot.airQuality.current.pollutants?.so2,
        no2: snapshot.airQuality.current.pollutants?.no2, co: snapshot.airQuality.current.pollutants?.co
      } : {}, life_index: {}
    },
    hourly: {
      description: snapshot.narrative || '',
      temperature: snapshot.hourly.map(item => ({ datetime: item.time, value: item.temperature })),
      apparent_temperature: snapshot.hourly.map(item => ({ datetime: item.time, value: item.feelsLike })),
      skycon: snapshot.hourly.map(item => ({ datetime: item.time, value: item.conditionCode })),
      precipitation: snapshot.hourly.map(item => ({ datetime: item.time, value: item.precipitation, probability: item.precipitationProbability })),
      wind: snapshot.hourly.map(item => ({ datetime: item.time, speed: item.windSpeed, direction: item.windDirection }))
    },
    daily: {
      temperature: snapshot.daily.map(item => ({ date: item.date, min: item.temperatureMin, max: item.temperatureMax })),
      skycon: snapshot.daily.map(item => ({ date: item.date, value: item.conditionDayCode })),
      astro: snapshot.daily.map(item => ({ date: item.date, sunrise: { time: item.sunrise }, sunset: { time: item.sunset } })),
      life_index: {}
    },
    alert: { content: snapshot.alerts }, forecast_keypoint: snapshot.narrative || ''
  };
}

async function loadQWeatherResources({ fetchImpl, config, cache, location, lang, force, schedule }) {
  const coordinate = `${location.lon.toFixed(2)},${location.lat.toFixed(2)}`;
  const definitions = {
    now: ['/v7/weather/now', { location: coordinate, lang }, 'now'],
    hourly: ['/v7/weather/168h', { location: coordinate, lang }, 'hourly'],
    daily: ['/v7/weather/30d', { location: coordinate, lang }, 'daily'],
    minutely: ['/v7/minutely/5m', { location: coordinate, lang }, 'minutely'],
    warning: ['/v7/warning/now', { location: coordinate, lang }, 'warning'],
    indices: ['/v7/indices/3d', { location: coordinate, type: 0, lang }, 'indices'],
    airCurrent: [`/airquality/v1/current/${location.lat.toFixed(2)}/${location.lon.toFixed(2)}`, { lang }, 'airCurrent'],
    airHourly: [`/airquality/v1/hourly/${location.lat.toFixed(2)}/${location.lon.toFixed(2)}`, { lang }, 'airHourly'],
    airDaily: [`/airquality/v1/daily/${location.lat.toFixed(2)}/${location.lon.toFixed(2)}`, { lang }, 'airDaily']
  };
  const settled = await Promise.allSettled(Object.entries(definitions).map(async ([name, [path, params, policyName]]) => {
    const result = await loadCachedResource({
      cache, key: cacheKey(name, location, lang), policy: WEATHER_CACHE_POLICIES[policyName],
      loader: () => qweatherRequest(fetchImpl, config, path, params),
      force: force && ['now', 'warning', 'minutely'].includes(name), schedule
    });
    return [name, result];
  }));
  const resources = {};
  const states = [];
  settled.forEach((item, index) => {
    const name = Object.keys(definitions)[index];
    if (item.status === 'fulfilled') {
      resources[name] = item.value[1].value;
      states.push({ id: `qweather:${name}`, status: item.value[1].stale ? 'stale' : 'ok', cache: item.value[1].cache, updatedAt: item.value[1].updatedAt });
    } else {
      states.push({ id: `qweather:${name}`, status: 'error', message: item.reason?.message || 'Unavailable', updatedAt: null });
    }
  });
  return { data: normalizeQWeatherResources(resources), states };
}

async function loadCaiyun({ fetchImpl, env, cache, location, force, schedule }) {
  const key = env.CAIYUN_API_TOKEN || env.CAIYUN_KEY || '';
  if (!key) return null;
  const result = await loadCachedResource({
    cache, key: cacheKey('caiyun', location, 'zh'), policy: WEATHER_CACHE_POLICIES.caiyun, force,
    loader: () => fetchJson(fetchImpl, `https://api.caiyunapp.com/v2.6/${encodeURIComponent(key)}/${location.lon},${location.lat}/weather?dailysteps=7&hourlysteps=24&alert=true`),
    schedule
  });
  return { data: normalizeCaiyunPayload(result.value), state: { id: 'caiyun', status: result.stale ? 'stale' : 'ok', cache: result.cache, updatedAt: result.updatedAt }, raw: result.value };
}

async function buildWeatherSnapshot({ lon, lat, env = {}, cache = null, refresh = false, schedule = null, fetchImpl = fetch } = {}) {
  const location = normalizeWeatherLocation(lon, lat);
  const primaryProvider = String(env.WEATHER_PRIMARY_PROVIDER || 'caiyun').toLowerCase() === 'qweather' ? 'qweather' : 'caiyun';
  const qConfig = qweatherConfig(env);
  const qEnabled = String(env.WEATHER_QWEATHER_ENABLED || (qConfig ? 'true' : 'false')).toLowerCase() !== 'false';
  const tasks = [loadCaiyun({ fetchImpl, env, cache, location, force: refresh && primaryProvider === 'caiyun', schedule })];
  if (qConfig && qEnabled) tasks.push(loadQWeatherResources({ fetchImpl, config: qConfig, cache, location, lang: 'zh', force: refresh, schedule }));
  const settled = await Promise.allSettled(tasks);
  const caiyunResult = settled[0]?.status === 'fulfilled' ? settled[0].value : null;
  const qweatherResult = settled[1]?.status === 'fulfilled' ? settled[1].value : null;
  let caiyun = caiyunResult?.data || null;
  let qweather = qweatherResult?.data || null;
  const fallbackEnabled = String(env.WEATHER_CAIYUN_FALLBACK_ENABLED || 'false').toLowerCase() === 'true';
  if (primaryProvider === 'qweather' && !qweather?.current && !fallbackEnabled) caiyun = null;
  const merged = mergeWeather(caiyun, qweather, primaryProvider);
  if (!merged?.current) throw new Error('Weather data is unavailable');
  const sources = [];
  if (caiyunResult?.state) sources.push({ ...caiyunResult.state, label: '彩云天气' });
  if (qweatherResult) sources.push(...qweatherResult.states.map(state => ({ ...state, label: 'QWeather' })));
  if (settled[0]?.status === 'rejected') sources.push({ id: 'caiyun', label: '彩云天气', status: 'error', message: settled[0].reason?.message || 'Unavailable' });
  const configuredQWeather = Boolean(qConfig && qEnabled);
  const errors = sources.filter(source => source.status === 'error').length;
  const stale = sources.some(source => source.status === 'stale');
  const status = errors && configuredQWeather ? 'partial' : stale ? 'stale' : 'ok';
  const generatedAt = isoNow();
  const snapshot = {
    schemaVersion: '2', status,
    location: { ...location, key: `${location.lon.toFixed(2)},${location.lat.toFixed(2)}` },
    snapshot: { generatedAt, effectiveAt: merged.current.observedAt || generatedAt, refreshAfter: new Date(Date.now() + 10 * 60 * 1000).toISOString() },
    current: merged.current, hourly: asArray(merged.hourly), daily: asArray(merged.daily), precipitation: merged.precipitation,
    airQuality: merged.airQuality, alerts: asArray(merged.alerts), indices: asArray(merged.indices), astronomy: merged.astronomy,
    narrative: merged.narrative, primaryProvider: merged.primaryProvider, sources,
    attribution: configuredQWeather ? [{ label: 'QWeather', url: 'https://www.qweather.com' }] : [],
    capabilities: { qweather: configuredQWeather, extendedHourly: asArray(merged.hourly).length > 24, extendedDaily: asArray(merged.daily).length > 7, airForecast: Boolean(merged.airQuality?.hourly?.length) },
  };
  snapshot.result = caiyunResult?.data?.legacyResult || buildLegacyResult(snapshot);
  return snapshot;
}

export async function getWeatherSnapshot({ lon, lat, env = {}, cache = null, refresh = false, schedule = null, fetchImpl = fetch } = {}) {
  const location = normalizeWeatherLocation(lon, lat);
  if (!cache) return buildWeatherSnapshot({ lon: location.lon, lat: location.lat, env, cache, refresh, schedule, fetchImpl });

  const primaryProvider = String(env.WEATHER_PRIMARY_PROVIDER || 'caiyun').toLowerCase() === 'qweather' ? 'qweather' : 'caiyun';
  const qConfig = qweatherConfig(env);
  const qEnabled = Boolean(qConfig) && String(env.WEATHER_QWEATHER_ENABLED || 'true').toLowerCase() !== 'false';
  const key = `${cacheKey('snapshot', location, 'zh')}:${primaryProvider}:${qEnabled ? 'q1' : 'q0'}`;
  const result = await loadCachedResource({
    cache,
    key,
    policy: WEATHER_CACHE_POLICIES.snapshot,
    force: refresh,
    schedule,
    loader: () => buildWeatherSnapshot({
      lon: location.lon,
      lat: location.lat,
      env,
      cache,
      refresh: true,
      schedule,
      fetchImpl
    })
  });
  return {
    ...result.value,
    snapshot: {
      ...result.value.snapshot,
      servedAt: isoNow(),
      delivery: result.cache
    }
  };
}
