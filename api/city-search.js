const SEARCH_LIMIT = 10;
const ALLOWED_FEATURE_CODES = new Set([
  'PPL',
  'PPLA',
  'PPLA2',
  'PPLA3',
  'PPLA4',
  'PPLC',
  'PPLG',
  'PPLL',
  'PPLS',
  'ADM1',
  'ADM2'
]);

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

function normalizeResult(item) {
  const latitude = Number(item?.latitude);
  const longitude = Number(item?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !item?.name) return null;
  if (item?.feature_code && !ALLOWED_FEATURE_CODES.has(item.feature_code)) return null;

  const region = item.admin2 || item.admin1 || item.admin3 || '';
  const city = {
    name: item.name,
    country: item.country || '',
    region,
    lat: latitude.toFixed(4),
    lon: longitude.toFixed(4),
    timezone: item.timezone || ''
  };

  return {
    id: buildCityId(city),
    ...city
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=600');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = String(req.query?.q || '').trim();
  if (!query) {
    return res.status(200).json({ results: [] });
  }

  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', String(SEARCH_LIMIT));
    url.searchParams.set('language', 'zh');
    url.searchParams.set('format', 'json');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'justin-dashboard/1.0 city-search'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to search cities' });
    }

    const data = await response.json();
    const dedupe = new Set();
    const results = (Array.isArray(data?.results) ? data.results : [])
      .sort((a, b) => Number(b?.population || 0) - Number(a?.population || 0))
      .map(normalizeResult)
      .filter(Boolean)
      .filter(item => {
        const key = `${item.name}|${item.region}|${item.country}|${item.lat}|${item.lon}`;
        if (dedupe.has(key)) return false;
        dedupe.add(key);
        return true;
      })
      .slice(0, SEARCH_LIMIT);

    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: 'City search failed' });
  }
}
