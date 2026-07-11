const ISO_DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseDurationMs(value) {
  const match = String(value || '').match(ISO_DURATION_PATTERN);
  if (!match) return 0;
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match;
  return (((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

export function parseGibsDomainXml(xml) {
  const domains = [...String(xml || '').matchAll(/<Domain>([^<]+)<\/Domain>/gi)].flatMap(match => match[1].split(','));
  return domains.map(value => {
    const parts = value.trim().split('/');
    const start = Date.parse(parts[0]);
    const end = Date.parse(parts[1] || parts[0]);
    const stepMs = parseDurationMs(parts[2]) || Math.max(1, end - start || 1);
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end, stepMs } : null;
  }).filter(Boolean);
}

export function timeInIntervals(value, intervals, toleranceMs = 1000) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return intervals.some(interval => {
    if (time < interval.start - toleranceMs || time > interval.end + toleranceMs) return false;
    if (interval.start === interval.end) return Math.abs(time - interval.start) <= toleranceMs;
    const remainder = Math.abs((time - interval.start) % interval.stepMs);
    return remainder <= toleranceMs || Math.abs(interval.stepMs - remainder) <= toleranceMs;
  });
}

export function chooseSynchronizedFrame({ frames = [], domainXml = [], targetAt = null } = {}) {
  const domains = domainXml.map(parseGibsDomainXml);
  const candidates = frames.map(frame => ({ ...frame, timestamp: Number(frame.time) * 1000 }))
    .filter(frame => Number.isFinite(frame.timestamp) && domains.every(intervals => timeInIntervals(frame.timestamp, intervals)));
  if (!candidates.length) return null;
  const target = Date.parse(targetAt || '') || Math.max(...candidates.map(frame => frame.timestamp));
  const notAfter = candidates.filter(frame => frame.timestamp <= target).sort((a, b) => b.timestamp - a.timestamp);
  const selected = notAfter[0] || [...candidates].sort((a, b) => Math.abs(a.timestamp - target) - Math.abs(b.timestamp - target))[0];
  return { ...selected, observedAt: new Date(selected.timestamp).toISOString(), skewMinutes: Math.round((selected.timestamp - target) / 60000) };
}

export function chooseLatestAvailableTime(xml, notAfterAt = null) {
  const intervals = parseGibsDomainXml(xml);
  if (!intervals.length) return null;
  const target = Date.parse(notAfterAt || '') || Date.now();
  let selected = null;
  for (const interval of intervals) {
    if (target < interval.start) continue;
    const capped = Math.min(target, interval.end);
    const steps = Math.floor((capped - interval.start) / interval.stepMs);
    const candidate = interval.start + Math.max(0, steps) * interval.stepMs;
    if (candidate <= interval.end && (selected === null || candidate > selected)) selected = candidate;
  }
  if (selected === null) selected = Math.min(...intervals.map(interval => interval.start));
  return new Date(selected).toISOString();
}

export function buildGibsWmtsUrl({ layer, time, tileMatrixSet }) {
  const safeLayer = encodeURIComponent(layer);
  const safeTime = encodeURIComponent(time || 'default');
  const safeMatrix = encodeURIComponent(tileMatrixSet);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${safeLayer}/default/${safeTime}/${safeMatrix}/{z}/{y}/{x}.png`;
}

export function buildGibsDomainUrl({ layer, tileMatrixSet, start, end }) {
  const compact = value => new Date(value).toISOString().replace('.000Z', 'Z');
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/${encodeURIComponent(layer)}/default/${encodeURIComponent(tileMatrixSet)}/all/${compact(start)}--${compact(end)}.xml`;
}
