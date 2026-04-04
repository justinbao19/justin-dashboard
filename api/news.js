import { CATEGORY_CONFIG } from './news-config.js';

const NEWSNOW_BASE = 'https://newsnow.busiyi.world/api/s';
const NEWSNOW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://newsnow.busiyi.world/'
};

const CACHE_TTL_MS = 4 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 5000;
let memoryCache = { ts: 0, data: null };

function toDateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatStamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"'']/g, '')
    .trim()
    .toLowerCase();
}

async function fetchSource(sourceId, sourceLabel) {
  const response = await fetch(`${NEWSNOW_BASE}?id=${encodeURIComponent(sourceId)}&latest`, {
    headers: NEWSNOW_HEADERS,
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`${sourceId}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const updatedAt = new Date(Number(payload.updatedTime) || Date.now());

  return {
    sourceId,
    sourceLabel,
    updatedAt,
    items: items.map((item, index) => {
      const extra = item && typeof item.extra === 'object' ? item.extra : {};
      const icon = extra.icon && typeof extra.icon === 'object' ? extra.icon.url : extra.icon;
      return {
        id: `${sourceId}:${item.id ?? index}`,
        title: String(item.title || '').trim(),
        url: item.mobileUrl || item.url || '',
        desktopUrl: item.url || item.mobileUrl || '',
        mobileUrl: item.mobileUrl || '',
        sourceId,
        sourceLabel,
        rank: index + 1,
        info: extra.info || extra.hover || '',
        stamp: formatStamp(extra.date || item.pubDate),
        icon: typeof icon === 'string' ? icon : ''
      };
    }).filter(item => item.title && item.url)
  };
}

function buildCategory(key, results, config) {
  const seen = new Set();
  const items = [];

  results.forEach(result => {
    result.items.slice(0, 5).forEach(item => {
      const normalized = normalizeTitle(item.title);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      items.push(item);
    });
  });

  const trimmed = items.slice(0, key === 'macro' ? 14 : 12);
  const sourceGroups = results
    .filter(result => result.items.length)
    .map(result => ({
      id: result.sourceId,
      label: result.sourceLabel,
      items: result.items.slice(0, 3)
    }));

  const updatedAt = results.reduce((latest, result) => (
    !latest || result.updatedAt > latest ? result.updatedAt : latest
  ), null);

  return {
    key,
    title: config.title,
    deck: config.deck,
    updatedAtMs: updatedAt ? updatedAt.getTime() : 0,
    updatedLabel: updatedAt ? toDateLabel(updatedAt) : '',
    sources: sourceGroups.map(group => group.label),
    featured: trimmed[0] || null,
    items: trimmed.slice(1),
    sourceGroups
  };
}

async function buildNewsPayload() {
  const categoryEntries = Object.entries(CATEGORY_CONFIG);
  const categoryResults = await Promise.all(categoryEntries.map(async ([key, config]) => {
    const settled = await Promise.allSettled(
      config.sources.map(([sourceId, sourceLabel]) => fetchSource(sourceId, sourceLabel))
    );

    const fulfilled = settled
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    return [key, buildCategory(key, fulfilled, config)];
  }));

  const categories = Object.fromEntries(categoryResults);
  const latestTs = Object.values(categories).reduce((latest, category) => (
    Math.max(latest, category.updatedAtMs || 0)
  ), 0);
  const latestDate = latestTs ? new Date(latestTs) : new Date();

  return {
    date: `${latestDate.getFullYear()}年${latestDate.getMonth() + 1}月${latestDate.getDate()}日`,
    updatedAt: new Date().toISOString(),
    categories
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=240, stale-while-revalidate=900');

  try {
    if (memoryCache.data && Date.now() - memoryCache.ts < CACHE_TTL_MS) {
      return res.status(200).json(memoryCache.data);
    }

    const data = await buildNewsPayload();
    memoryCache = { ts: Date.now(), data };
    res.status(200).json(data);
  } catch (error) {
    if (memoryCache.data) {
      return res.status(200).json(memoryCache.data);
    }
    res.status(500).json({ error: 'Failed to fetch news streams' });
  }
}
