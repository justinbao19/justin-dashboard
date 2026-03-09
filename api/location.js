const DEFAULT_LOCATION = {
  lon: '121.405',
  lat: '31.123',
  city: '上海',
  region: '闵行',
  country: '中国',
  displayName: '上海 · 闵行',
  source: 'default'
};

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-store');

  const ip = getClientIp(req);

  if (isPrivateIp(ip)) {
    res.status(200).json({ ...DEFAULT_LOCATION, ip: ip || null });
    return;
  }

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!response.ok) {
      throw new Error(`Geo lookup failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.success || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      throw new Error('Geo lookup returned incomplete data');
    }

    const location = {
      lon: String(data.longitude),
      lat: String(data.latitude),
      city: data.city || '',
      region: data.region || '',
      country: data.country || '',
      displayName: '',
      source: 'ip',
      ip
    };

    location.displayName = formatDisplayName(location);

    res.status(200).json(location);
  } catch (error) {
    res.status(200).json({ ...DEFAULT_LOCATION, ip, error: 'Failed to locate IP' });
  }
}
