import fs from 'node:fs/promises';

const CONFIG_URL = new URL('../data/weather-cities.json', import.meta.url);
const REQUIRED_SECRET_ENV = 'WEATHER_CONFIG_WRITE_SECRET';

const DEFAULT_CONFIG = {
  activeCityId: null,
  manualCities: [],
  updatedAt: null
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Weather-Config-Secret');
  res.setHeader('Cache-Control', 'no-store');
}

function buildCityId(city) {
  const slug = [city.name, city.region, city.country]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const lat = String(city.lat).replace('.', '');
  const lon = String(city.lon).replace('.', '');
  return `${slug || 'city'}-${lon}-${lat}`;
}

function normalizeManualCity(city) {
  if (!city || typeof city !== 'object') return null;
  const latitude = Number(city.lat);
  const longitude = Number(city.lon);
  if (!city.name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const normalized = {
    id: String(city.id || buildCityId(city)),
    name: String(city.name).trim(),
    country: String(city.country || '').trim(),
    region: String(city.region || '').trim(),
    lat: latitude.toFixed(4),
    lon: longitude.toFixed(4),
    timezone: city.timezone ? String(city.timezone).trim() : ''
  };

  if (!normalized.name) return null;
  return normalized;
}

function normalizeConfig(input) {
  const cities = Array.isArray(input?.manualCities) ? input.manualCities : [];
  const dedupe = new Set();
  const manualCities = cities
    .map(normalizeManualCity)
    .filter(Boolean)
    .filter(city => {
      const key = `${city.name}|${city.lat}|${city.lon}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });

  const activeCityId = manualCities.some(city => city.id === input?.activeCityId)
    ? input.activeCityId
    : (manualCities[0]?.id || null);

  return {
    activeCityId,
    manualCities,
    updatedAt: new Date().toISOString()
  };
}

async function readConfigFromDisk() {
  try {
    const raw = await fs.readFile(CONFIG_URL, 'utf8');
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    return { ...DEFAULT_CONFIG };
  }
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function getGitHubFileMeta({ owner, repo, path, token }) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'justin-dashboard-weather-config'
    }
  });

  if (response.status === 404) return { sha: null };
  if (!response.ok) throw new Error('Failed to read GitHub config file');
  const data = await response.json();
  return { sha: data.sha || null };
}

async function writeGitHubFile({ owner, repo, path, token, config, sha }) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'justin-dashboard-weather-config'
    },
    body: JSON.stringify({
      message: `Update weather cities config (${config.updatedAt})`,
      content: Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8').toString('base64'),
      sha,
      branch: 'main'
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Failed to write GitHub config file: ${payload}`);
  }

  const data = await response.json();
  return data.commit?.sha || null;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    const config = await readConfigFromDisk();
    return res.status(200).json({ config });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const configuredSecret = process.env[REQUIRED_SECRET_ENV];
  const providedSecret = req.headers['x-weather-config-secret'];
  if (!configuredSecret) {
    return res.status(503).json({ error: `Missing server configuration: ${REQUIRED_SECRET_ENV}` });
  }
  if (!providedSecret || providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Invalid weather config secret' });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!token || !owner || !repo) {
    return res.status(503).json({ error: 'Missing GitHub environment variables for weather config write-back' });
  }

  try {
    const body = await parseJsonBody(req);
    const config = normalizeConfig(body?.config || body);
    const path = 'data/weather-cities.json';
    const { sha } = await getGitHubFileMeta({ owner, repo, path, token });
    const commitSha = await writeGitHubFile({ owner, repo, path, token, config, sha });
    return res.status(200).json({ config, commitSha });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to save weather cities config' });
  }
}
