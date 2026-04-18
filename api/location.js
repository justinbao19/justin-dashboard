const DEFAULT_LOCATION = {
  lon: '121.405',
  lat: '31.123',
  city: '上海',
  region: '闵行',
  country: '中国',
  displayName: '上海 · 闵行',
  source: 'default'
};

function readHeader(req, name) {
  const value = req.headers[name];
  if (!value) return '';
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value).trim();
}

function decodeHeaderValue(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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

function formatDisplayName(location) {
  const pieces = [location.city, location.region].filter(Boolean);
  const uniquePieces = pieces.filter((item, index) => pieces.indexOf(item) === index);
  return uniquePieces.join(' · ') || location.country || DEFAULT_LOCATION.displayName;
}

function getLocationFromVercelHeaders(req, ip) {
  const lat = readHeader(req, 'x-vercel-ip-latitude');
  const lon = readHeader(req, 'x-vercel-ip-longitude');
  if (!lat || !lon) return null;

  const city = decodeHeaderValue(readHeader(req, 'x-vercel-ip-city'));
  const region = decodeHeaderValue(readHeader(req, 'x-vercel-ip-country-region'));
  const country = decodeHeaderValue(readHeader(req, 'x-vercel-ip-country'));

  const location = {
    lon,
    lat,
    city,
    region,
    country,
    displayName: '',
    source: 'ip',
    ip: ip || null
  };

  location.displayName = formatDisplayName(location);
  return location;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  const ip = getClientIp(req);
  const headerLocation = getLocationFromVercelHeaders(req, ip);

  if (headerLocation) {
    res.status(200).json(headerLocation);
    return;
  }

  const error = isPrivateIp(ip)
    ? 'Local request has no public geo headers'
    : 'Geo headers unavailable on this request';

  res.status(200).json({ ...DEFAULT_LOCATION, ip: ip || null, error });
}
