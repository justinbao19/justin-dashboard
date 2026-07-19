const QWEATHER_PATH = '/v7/weather/7d';
const REQUEST_TIMEOUT_MS = 5000;
let jwtCache = null;

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
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function qweatherConfig(env = {}) {
  if (String(env.WEATHER_QWEATHER_ENABLED || '').toLowerCase() === 'false') return null;
  const host = String(env.QWEATHER_API_HOST || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const projectId = String(env.QWEATHER_PROJECT_ID || '').trim();
  const credentialId = String(env.QWEATHER_CREDENTIAL_ID || '').trim();
  const privateKey = String(env.QWEATHER_PRIVATE_KEY || '').trim();
  if (!host || !projectId || !credentialId || !privateKey) return null;
  return { host, projectId, credentialId, privateKey };
}

export async function createQWeatherJwt(config, nowMs = Date.now()) {
  const cacheKey = `${config.projectId}:${config.credentialId}`;
  if (jwtCache?.cacheKey === cacheKey && jwtCache.expiresAt - 60_000 > nowMs) return jwtCache.token;
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const iat = Math.floor(nowMs / 1000) - 30;
  const exp = iat + 900;
  const encodedHeader = base64Url(JSON.stringify({ alg: 'EdDSA', kid: config.credentialId }));
  const encodedPayload = base64Url(JSON.stringify({ sub: config.projectId, iat, exp }));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(config.privateKey), { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${base64Url(signature)}`;
  jwtCache = { cacheKey, expiresAt: exp * 1000, token };
  return token;
}

function cleanTime(value) {
  const text = String(value || '').trim();
  return /^\d{1,2}:\d{2}$/.test(text) ? text.padStart(5, '0') : null;
}

export function normalizeQWeatherAstronomy(payload) {
  if (!payload || String(payload.code) !== '200' || !Array.isArray(payload.daily)) return null;
  const daily = payload.daily.map(item => ({
    date: String(item.fxDate || '').slice(0, 10),
    moonrise: cleanTime(item.moonrise),
    moonset: cleanTime(item.moonset),
    moonPhase: String(item.moonPhase || '').trim() || null,
    moonPhaseIcon: String(item.moonPhaseIcon || '').trim() || null
  })).filter(item => item.date);
  if (!daily.length) return null;
  const parsedUpdateTime = payload.updateTime ? new Date(payload.updateTime) : null;
  return {
    source: 'qweather',
    providerLabel: 'QWeather 和风天气',
    updatedAt: parsedUpdateTime && Number.isFinite(parsedUpdateTime.getTime())
      ? parsedUpdateTime.toISOString()
      : new Date().toISOString(),
    daily
  };
}

export async function fetchQWeatherAstronomy({ env = {}, lon, lat, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const config = qweatherConfig(env);
  if (!config) return null;
  const longitude = Number(lon);
  const latitude = Number(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  const token = await createQWeatherJwt(config);
  const url = new URL(`https://${config.host}${QWEATHER_PATH}`);
  url.searchParams.set('location', `${longitude.toFixed(2)},${latitude.toFixed(2)}`);
  url.searchParams.set('lang', 'zh');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`QWeather HTTP ${response.status}`);
    const astronomy = normalizeQWeatherAstronomy(await response.json());
    if (!astronomy) throw new Error('QWeather astronomy response is invalid');
    return astronomy;
  } finally {
    clearTimeout(timer);
  }
}

export function attachAstronomy(weatherPayload, astronomy) {
  if (!weatherPayload || typeof weatherPayload !== 'object' || !astronomy) return weatherPayload;
  return { ...weatherPayload, astronomy };
}
