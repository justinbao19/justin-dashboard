const DEFAULT_LOCATION = {
  lon: '121.405',
  lat: '31.123',
  city: '上海',
  region: '闵行',
  country: '中国',
  displayName: '上海 · 闵行',
  source: 'default'
};

const REVERSE_GEOCODE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const REVERSE_GEOCODE_USER_AGENT = 'justin-dashboard/1.0 (weather location reverse geocoding)';

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function getClientIp(req) {
  const candidates = [
    req.headers['x-forwarded-for'],
    req.headers['x-real-ip'],
    req.headers['x-vercel-forwarded-for']
  ];

  for (const value of candidates) {
    if (!value) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    const ip = raw.split(',')[0].trim();
    if (ip) return ip;
  }

  return '';
}

function isPrivateIp(ip) {
  if (!ip) return true;

  const normalized = ip.toLowerCase();

  if (
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  ) {
    return true;
  }

  const ipv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  const parts = ipv4.split('.');
  if (parts.length === 4) {
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }
  }

  return false;
}

function formatDisplayName(location, fallbackDisplayName = DEFAULT_LOCATION.displayName) {
  const pieces = [location.city, location.region].filter(Boolean);
  const uniquePieces = pieces.filter((item, index) => pieces.indexOf(item) === index);
  return uniquePieces.join(' · ') || location.country || fallbackDisplayName;
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickFirstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function looksLikeDistrict(name) {
  return /(?:区|县|旗|市辖区)$/.test(name);
}

function normalizeMunicipalityName(name = '') {
  const normalized = String(name || '').trim();
  if (!normalized) return '';
  if (/(特别行政区|自治区|自治州|自治县)$/u.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/(市|区|县|旗)$/u, '').trim();
}

function getDisplayParts(data) {
  return typeof data?.display_name === 'string'
    ? data.display_name.split(',').map(part => part.trim()).filter(Boolean)
    : [];
}

function extractMunicipalityFromDisplay(displayParts, country) {
  return [...displayParts]
    .reverse()
    .find(part => /市$/u.test(part) && part !== country && !/^\d+$/u.test(part)) || '';
}

function pickReverseCity(address, municipalityFromDisplay) {
  const primaryAdmin = pickFirstNonEmpty([
    address.city,
    address.town,
    address.municipality,
    address.county,
    address.state_district,
    address.state
  ]);

  return looksLikeDistrict(primaryAdmin) && municipalityFromDisplay && municipalityFromDisplay !== primaryAdmin
    ? municipalityFromDisplay
    : primaryAdmin;
}

function pickReverseRegion(address, municipalityFromDisplay, primaryAdmin, { allowHyperLocal = false } = {}) {
  return pickFirstNonEmpty([
    looksLikeDistrict(primaryAdmin) && municipalityFromDisplay && municipalityFromDisplay !== primaryAdmin ? primaryAdmin : '',
    address.city_district,
    address.district,
    address.county,
    address.state_district,
    address.suburb,
    address.township,
    address.town,
    allowHyperLocal ? address.neighbourhood : '',
    allowHyperLocal ? address.quarter : '',
    allowHyperLocal ? address.village : '',
    address.borough
  ]);
}

function buildReverseLocation(detailData, broadData, lat, lon) {
  const detailAddress = detailData?.address || {};
  const broadAddress = broadData?.address || {};
  const detailDisplayParts = getDisplayParts(detailData);
  const broadDisplayParts = getDisplayParts(broadData);
  const country = pickFirstNonEmpty([detailAddress.country, broadAddress.country, DEFAULT_LOCATION.country]);
  const detailMunicipality = extractMunicipalityFromDisplay(detailDisplayParts, country);
  const broadMunicipality = extractMunicipalityFromDisplay(broadDisplayParts, country);

  const detailPrimaryAdmin = pickFirstNonEmpty([
    detailAddress.city,
    detailAddress.town,
    detailAddress.municipality,
    detailAddress.county,
    detailAddress.state_district,
    detailAddress.state
  ]);
  const broadPrimaryAdmin = pickFirstNonEmpty([
    broadAddress.city,
    broadAddress.town,
    broadAddress.municipality,
    broadAddress.county,
    broadAddress.state_district,
    broadAddress.state
  ]);

  const broadCity = pickReverseCity(broadAddress, broadMunicipality);
  const detailCity = pickReverseCity(detailAddress, detailMunicipality);
  const city = pickFirstNonEmpty([
    broadCity,
    detailCity,
    broadMunicipality,
    detailMunicipality,
    broadAddress.state,
    detailAddress.state
  ]);

  const region = pickFirstNonEmpty([
    pickReverseRegion(broadAddress, broadMunicipality, broadPrimaryAdmin),
    pickReverseRegion(detailAddress, detailMunicipality, detailPrimaryAdmin),
    pickReverseRegion(detailAddress, detailMunicipality, detailPrimaryAdmin, { allowHyperLocal: true })
  ]);

  const normalizedCity = normalizeMunicipalityName(city);
  const normalizedRegion = normalizeMunicipalityName(region);

  const location = {
    lon: String(lon),
    lat: String(lat),
    city: normalizedCity,
    region: normalizedRegion && normalizedRegion !== normalizedCity ? normalizedRegion : '',
    country,
    displayName: '',
    source: 'device'
  };

  const displayNameFallback = pickFirstNonEmpty([
    typeof broadData?.name === 'string' ? broadData.name : '',
    typeof detailData?.name === 'string' ? detailData.name : '',
    broadDisplayParts.slice(0, 2).join(' · '),
    detailDisplayParts.slice(0, 2).join(' · '),
    '当前位置'
  ]);
  location.displayName = formatDisplayName(location, displayNameFallback);
  return location;
}

async function reverseGeocodeLevel(lat, lon, zoom) {
  const url = new URL(REVERSE_GEOCODE_ENDPOINT);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', String(zoom));
  url.searchParams.set('accept-language', 'zh-CN');

  const response = await fetch(url, {
    headers: {
      'User-Agent': REVERSE_GEOCODE_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Reverse geocode failed with status ${response.status}`);
  }

  return response.json();
}

async function reverseGeocode(lat, lon) {
  const [detailData, broadData] = await Promise.all([
    reverseGeocodeLevel(lat, lon, 14),
    reverseGeocodeLevel(lat, lon, 10)
  ]);

  return buildReverseLocation(detailData, broadData, lat, lon);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  const requestedLat = parseCoordinate(req.query?.lat);
  const requestedLon = parseCoordinate(req.query?.lon);

  if (requestedLat !== null && requestedLon !== null) {
    try {
      const location = await reverseGeocode(requestedLat, requestedLon);
      res.status(200).json(location);
      return;
    } catch (error) {
      res.status(200).json({
        lon: String(requestedLon),
        lat: String(requestedLat),
        city: '',
        region: '',
        country: '',
        displayName: '当前位置',
        source: 'device',
        error: 'Failed to reverse geocode location'
      });
      return;
    }
  }

  const ip = getClientIp(req);
  const vercelCity = getHeaderValue(req, 'x-vercel-ip-city');
  const vercelRegion = getHeaderValue(req, 'x-vercel-ip-country-region');
  const vercelCountry = getHeaderValue(req, 'x-vercel-ip-country');
  const vercelLatitude = getHeaderValue(req, 'x-vercel-ip-latitude');
  const vercelLongitude = getHeaderValue(req, 'x-vercel-ip-longitude');

  if (isPrivateIp(ip)) {
    res.status(200).json({ ...DEFAULT_LOCATION, ip: ip || null });
    return;
  }

  if (vercelLatitude && vercelLongitude) {
    const location = {
      lon: vercelLongitude,
      lat: vercelLatitude,
      city: normalizeMunicipalityName(vercelCity),
      region: normalizeMunicipalityName(vercelRegion),
      country: vercelCountry || '',
      displayName: '',
      source: 'ip',
      ip
    };

    const fallbackDisplayName = [vercelCity, vercelRegion, vercelCountry]
      .filter(Boolean)
      .join(' · ') || DEFAULT_LOCATION.displayName;
    location.displayName = formatDisplayName(location, fallbackDisplayName);
    res.status(200).json(location);
    return;
  }

  res.status(200).json({
    ...DEFAULT_LOCATION,
    ip,
    error: 'Platform did not provide geo headers'
  });
}
