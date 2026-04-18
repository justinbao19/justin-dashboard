const USER_AGENT = 'justin-dashboard/1.0 (weather reverse geocode)';

function pickFirst(...values) {
  for (const value of values) {
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function normalizePlaceName(value) {
  return String(value || '')
    .replace(/^(中华人民共和国|中国)\s*/, '')
    .replace(/市$/u, '')
    .trim();
}

function formatDisplayName(address = {}) {
  const city = normalizePlaceName(
    pickFirst(
      address.city,
      address.town,
      address.municipality,
      address.county,
      address.state_district,
      address.state,
      address.country
    )
  );

  const area = normalizePlaceName(
    pickFirst(
      address.city_district,
      address.district,
      address.suburb,
      address.borough,
      address.township,
      address.neighbourhood,
      address.quarter,
      address.road
    )
  );

  const pieces = [city, area].filter(Boolean);
  const uniquePieces = pieces.filter((item, index) => pieces.indexOf(item) === index);
  return uniquePieces.join(' · ') || normalizePlaceName(address.country) || '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=86400');

  const lat = String(req.query?.lat || '').trim();
  const lon = String(req.query?.lon || '').trim();

  if (!lat || !lon) {
    res.status(400).json({ error: 'Missing lat or lon' });
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&accept-language=zh-CN`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Reverse geocode failed with status ${response.status}`);
    }

    const data = await response.json();
    const address = data?.address || {};
    const displayName = formatDisplayName(address);

    res.status(200).json({
      displayName: displayName || '当前位置',
      city: normalizePlaceName(
        pickFirst(
          address.city,
          address.town,
          address.municipality,
          address.county,
          address.state_district,
          address.state,
          address.country
        )
      ),
      area: normalizePlaceName(
        pickFirst(
          address.city_district,
          address.district,
          address.suburb,
          address.borough,
          address.township,
          address.neighbourhood,
          address.quarter,
          address.road
        )
      )
    });
  } catch (error) {
    res.status(200).json({ displayName: '当前位置', error: 'Reverse geocode unavailable' });
  }
}
