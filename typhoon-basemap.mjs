import { simplifiedLand } from './typhoon-land.mjs';

// Keep the renderer pinned; both CDN attempts use the same JS and CSS release.
export const MAPLIBRE_VERSION = '5.6.1';
export const MAPLIBRE_CDNS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com'];
export const BASEMAP_TIMEOUT_MS = 10000;
export const AMAP_TIMEOUT_MS = 8000;
export const AMAP_SCRIPT_URL = 'https://webapi.amap.com/maps?v=2.0';
export const OPENFREEMAP_STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron'
};
export const CHINESE_LABEL = ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name'], ['get', 'name:latin']];
export const BASEMAP_ATTRIBUTION = '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
export const ESRI_ATTRIBUTION = 'Esri, HERE, Garmin, © OpenStreetMap contributors';
export const BASEMAP_SOURCE_IDS = ['basemap-base', 'basemap-reference'];
export const BASEMAP_PALETTES = {
  dark: { water: '#07131d', land: '#182c3a', park: '#203b3e', urban: '#1d3342', border: '#536c7d', road: '#304957', label: '#c3d5df', mutedLabel: '#8da9b9', halo: '#10212e' },
  light: { water: '#dfe8ef', land: '#f1f5f7', park: '#e0ebe7', urban: '#e7edf0', border: '#9baeb9', road: '#d1dde4', label: '#3a5669', mutedLabel: '#698392', halo: '#f5f9fb' }
};

export function parseAmapConfig(payload) {
  const key = typeof payload?.key === 'string' && payload.key.trim() ? payload.key.trim() : null;
  const serviceHost = typeof payload?.serviceHost === 'string' && payload.serviceHost.trim()
    ? payload.serviceHost.trim().replace(/\/$/, '')
    : '/api/_AMapService';
  return { key, serviceHost };
}

export function amapStyleForTheme(theme = 'dark') {
  return theme === 'light' ? 'amap://styles/normal' : 'amap://styles/dark';
}

// Verified over Tokyo at z6. The lang=zh_cn variant and webst/wprd RoadNet
// tiles omit overseas text. Keep the labels baked into this raster on all devices.
export const AMAP_LABELED_TILE_URL = 'https://webrd02.is.autonavi.com/appmaptile?size=1&scale=1&style=8&x=[x]&y=[y]&z=[z]';
export const AMAP_SATELLITE_TILE_URL = 'https://webst02.is.autonavi.com/appmaptile?style=6&x=[x]&y=[y]&z=[z]';

// Regional reference labels supplement the raster's sparse z3–4 text. Country
// and province positions are interior label points; city positions are centers.
// At z5+ the raster supplies the more detailed place hierarchy.
export const AMAP_OVERVIEW_LABELS = [
  { name: '中国', position: [112, 35], kind: 'country' },
  { name: '日本', position: [137, 38], kind: 'country' },
  { name: '韩国', position: [128, 36.5], kind: 'country' },
  { name: '浙江', position: [119.8, 28.7], kind: 'province' },
  { name: '福建', position: [117.8, 26], kind: 'province' },
  { name: '广东', position: [113.5, 23.5], kind: 'province' },
  { name: '台湾', position: [121, 23.7], kind: 'province' },
  { name: '上海', position: [121.47, 31.23], kind: 'city' },
  { name: '东京', position: [139.69, 35.68], kind: 'city' }
];

// WebGL composites raster and storm layers into one canvas. Color only the
// basemap texture there; a CSS filter on that canvas would recolor the storms.
export function createAmapDarkTile(x, y, z, success, fail) {
  const tile = new Image();
  tile.crossOrigin = 'anonymous';
  tile.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = tile.naturalWidth;
      canvas.height = tile.naturalHeight;
      const context = canvas.getContext('2d');
      context.filter = 'invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.6)';
      context.drawImage(tile, 0, 0);
      success(canvas);
    } catch (error) { fail(error); }
  };
  tile.onerror = fail;
  tile.src = AMAP_LABELED_TILE_URL.replace('[x]', x).replace('[y]', y).replace('[z]', z);
}

// RoadNet has no overseas text even where the standard raster has Chinese
// names. Extract its dark lettering into a transparent reference texture so
// satellite mode uses exactly the same geographic labels, with a dark halo.
export function amapLabelPixels(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const brightest = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    const coverage = Math.max(0, Math.min(1, (205 - brightest) / 65));
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(pixels[i + 3] * coverage);
  }
  return pixels;
}

export function createAmapLabelTile(x, y, z, success, fail) {
  const tile = new Image();
  tile.crossOrigin = 'anonymous';
  tile.onload = () => {
    try {
      const mask = document.createElement('canvas');
      mask.width = tile.naturalWidth;
      mask.height = tile.naturalHeight;
      const context = mask.getContext('2d', { willReadFrequently: true });
      context.drawImage(tile, 0, 0);
      const pixels = context.getImageData(0, 0, mask.width, mask.height);
      amapLabelPixels(pixels.data);
      context.putImageData(pixels, 0, 0);
      const canvas = document.createElement('canvas');
      canvas.width = mask.width;
      canvas.height = mask.height;
      const output = canvas.getContext('2d');
      output.shadowColor = '#10212e';
      output.shadowBlur = 2;
      output.drawImage(mask, 0, 0);
      output.drawImage(mask, 0, 0);
      success(canvas);
    } catch (error) { fail(error); }
  };
  tile.onerror = fail;
  tile.src = AMAP_LABELED_TILE_URL.replace('[x]', x).replace('[y]', y).replace('[z]', z);
}

export function normalizeMapPadding(padding = 0) {
  return Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => {
    const value = Number(typeof padding === 'number' ? padding : padding?.[side] ?? 0);
    return [side, Number.isFinite(value) ? Math.max(0, value) : 0];
  }));
}

// Target displacement from the container center, in screen pixels.
export function amapPaddingOffset(padding) {
  const { top, bottom, left, right } = normalizeMapPadding(padding);
  return { dx: (left - right) / 2, dy: (top - bottom) / 2 };
}

export function nextBasemapProvider(provider, rendererAvailable = true) {
  if (!rendererAvailable) return 'outline';
  if (provider === 'amap') return 'openfreemap';
  return provider === 'openfreemap' ? 'esri' : 'land';
}

export function basemapProviderOrder() {
  return ['amap', 'openfreemap', 'esri', 'land'];
}

export function isAmapAuthError(value) {
  return /INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|INVALID_USER_DOMAIN|USERKEY_EXPIRED/i.test(String(value?.message || value || ''));
}

export function outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

export function wgs84ToGcj02(lonOrPosition, lat) {
  const lon = typeof lonOrPosition === 'object' ? Number(lonOrPosition.lon ?? lonOrPosition.lng ?? lonOrPosition[0]) : Number(lonOrPosition);
  const latitude = typeof lonOrPosition === 'object' ? Number(lonOrPosition.lat ?? lonOrPosition[1]) : Number(lat);
  if (![lon, latitude].every(Number.isFinite) || outOfChina(lon, latitude)) return [lon, latitude];
  const pi = Math.PI;
  const axis = 6378245;
  const eccentricity = 0.00669342162296594323;
  const transformLat = (x, y) => -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x))
    + (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3
    + (20 * Math.sin(y * pi) + 40 * Math.sin(y / 3 * pi)) * 2 / 3
    + (160 * Math.sin(y / 12 * pi) + 320 * Math.sin(y * pi / 30)) * 2 / 3;
  const transformLon = (x, y) => 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x))
    + (20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2 / 3
    + (20 * Math.sin(x * pi) + 40 * Math.sin(x / 3 * pi)) * 2 / 3
    + (150 * Math.sin(x / 12 * pi) + 300 * Math.sin(x / 30 * pi)) * 2 / 3;
  const dLat = transformLat(lon - 105, latitude - 35);
  const dLon = transformLon(lon - 105, latitude - 35);
  const radLat = latitude / 180 * pi;
  let magic = Math.sin(radLat);
  magic = 1 - eccentricity * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return [lon + dLon * 180 / (axis / magic * sqrtMagic * pi), latitude + dLat * 180 / (axis * (1 - eccentricity) / (magic * sqrtMagic) * pi)];
}

export function buildAmapScriptUrl(key) {
  const url = new URL(AMAP_SCRIPT_URL);
  url.searchParams.set('key', key);
  return url.toString();
}

export function buildAmapProxyUrl(path = '', query = '', securityCode = '') {
  const normalizedPath = `/${String(path || '').replace(/^\/+/, '')}`;
  const upstreamBase = normalizedPath.startsWith('/v4/map/styles')
    ? 'https://webapi.amap.com'
    : normalizedPath.startsWith('/v3/vectormap')
      ? 'https://fmap01.amap.com'
      : 'https://restapi.amap.com';
  const upstream = new URL(normalizedPath, upstreamBase);
  const search = query instanceof URLSearchParams ? query : new URLSearchParams(String(query || '').replace(/^\?/, ''));
  search.forEach((value, name) => upstream.searchParams.append(name, value));
  if (securityCode) upstream.searchParams.set('jscode', securityCode);
  return upstream.toString();
}

// Original keyless Esri path remains available independently of OpenFreeMap.
export function basemapSources(theme = 'dark', mode = 'standard') {
  const canvas = `https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_${theme === 'light' ? 'Light' : 'Dark'}_Gray`;
  const satellite = mode === 'satellite';
  return {
    'basemap-base': {
      type: 'raster', tileSize: 256, maxzoom: satellite ? 19 : 16,
      tiles: [satellite
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : `${canvas}_Base/MapServer/tile/{z}/{y}/{x}`],
      attribution: satellite ? 'Esri World Imagery' : ESRI_ATTRIBUTION
    },
    'basemap-reference': {
      type: 'raster', tileSize: 256, maxzoom: satellite ? 10 : 16,
      tiles: [satellite
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
        : `${canvas}_Reference/MapServer/tile/{z}/{y}/{x}`],
      attribution: ESRI_ATTRIBUTION
    }
  };
}

export function createFallbackStyle(theme = 'dark', provider = 'land', mode = 'standard') {
  const palette = BASEMAP_PALETTES[theme] || BASEMAP_PALETTES.dark;
  return {
    version: 8,
    sources: {
      'basemap-land': { type: 'geojson', data: simplifiedLand },
      ...(provider === 'esri' ? basemapSources(theme, mode) : {})
    },
    layers: [
      { id: 'basemap-background', type: 'background', paint: { 'background-color': palette.water } },
      { id: 'basemap-land', type: 'fill', source: 'basemap-land', paint: { 'fill-color': palette.land } },
      { id: 'basemap-coast', type: 'line', source: 'basemap-land', paint: { 'line-color': palette.border, 'line-width': .8 } },
      ...(provider === 'esri' ? [
        { id: 'basemap-base', type: 'raster', source: 'basemap-base' },
        { id: 'basemap-reference', type: 'raster', source: 'basemap-reference', paint: { 'raster-opacity': .88 } }
      ] : [])
    ]
  };
}

export function createBasemapStyle(theme = 'dark', mode = 'standard', upstream) {
  if (upstream?.version !== 8 || !Array.isArray(upstream.layers) || !Object.values(upstream.sources || {}).some(source => source.type === 'vector')) {
    throw new Error('Invalid OpenFreeMap style');
  }
  const style = JSON.parse(JSON.stringify(upstream));
  const palette = BASEMAP_PALETTES[theme] || BASEMAP_PALETTES.dark;
  const satellite = mode === 'satellite';
  // The optional Natural Earth raster is unused in these styles. Only keep vector data.
  style.sources = Object.fromEntries(Object.entries(style.sources).filter(([, source]) => source.type === 'vector'));
  for (const source of Object.values(style.sources)) source.attribution = BASEMAP_ATTRIBUTION;
  style.layers = style.layers.filter(layer => layer.type !== 'background' && (!layer.source || style.sources[layer.source]) &&
    (!satellite || layer.type === 'symbol' || layer['source-layer'] === 'boundary'));
  for (const layer of style.layers) {
    const sourceLayer = layer['source-layer'];
    const paint = layer.paint ||= {};
    if (layer.type === 'fill') {
      delete paint['fill-pattern'];
      paint['fill-color'] = sourceLayer === 'water' ? palette.water
        : /park|landcover/.test(sourceLayer) ? palette.park
        : /building|landuse/.test(sourceLayer) ? palette.urban : palette.land;
      if ('fill-outline-color' in paint) paint['fill-outline-color'] = palette.road;
    }
    if (layer.type === 'line') {
      paint['line-color'] = sourceLayer === 'boundary' ? palette.border : sourceLayer === 'waterway' ? palette.water : palette.road;
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      // Preserve road shield references (e.g. G15); localize geographic names.
      if (/name/.test(JSON.stringify(layer.layout['text-field']))) layer.layout['text-field'] = JSON.parse(JSON.stringify(CHINESE_LABEL));
      paint['text-color'] = satellite ? '#f2f7fa' : /water|transportation/.test(sourceLayer) ? palette.mutedLabel : palette.label;
      paint['text-halo-color'] = satellite ? '#10212e' : palette.halo;
      paint['text-halo-width'] = 1.3;
      paint['text-halo-blur'] = .5;
    }
  }
  const fallback = createFallbackStyle(theme);
  style.sources = { ...fallback.sources, ...style.sources };
  if (satellite) {
    style.sources['basemap-satellite'] = {
      type: 'raster', tileSize: 256, maxzoom: 8, attribution: 'NASA GIBS Blue Marble',
      tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg']
    };
    style.layers.unshift({ id: 'basemap-satellite', type: 'raster', source: 'basemap-satellite' });
  }
  style.layers.unshift(...fallback.layers);
  return style;
}

// One monitor per style; unrelated weather failures never disable the basemap.
export function createBasemapFailureMonitor(sourceIds = BASEMAP_SOURCE_IDS, threshold = 3) {
  let failures = 0;
  let failed = false;
  return event => {
    const sourceId = event?.sourceId || event?.source?.id;
    if (failed || !sourceIds.includes(sourceId)) return false;
    failed = ++failures >= threshold;
    return failed;
  };
}

// A failed or stalled CDN must not prevent the local page module from starting.
export async function loadMapLibre({ document = globalThis.document, window = globalThis.window, timeoutMs = 6000 } = {}) {
  if (window.maplibregl) return window.maplibregl;
  const load = (url, css) => new Promise((resolve, reject) => {
    const node = document.createElement(css ? 'link' : 'script');
    const timer = setTimeout(() => finish(new Error('Map renderer download timed out')), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      node.onload = node.onerror = null;
      if (error) { node.remove(); reject(error); } else resolve();
    }
    if (css) { node.rel = 'stylesheet'; node.href = url; }
    else { node.src = url; node.async = true; }
    node.onload = () => finish();
    node.onerror = () => finish(new Error('Map renderer download failed'));
    document.head.append(node);
  });
  for (const cdn of MAPLIBRE_CDNS) {
    const base = `${cdn}/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl`;
    const result = await Promise.allSettled([load(`${base}.css`, true), load(`${base}.js`, false)]);
    if (result.every(item => item.status === 'fulfilled') && window.maplibregl) return window.maplibregl;
  }
  throw new Error('MapLibre unavailable');
}

export async function loadAmapScript({ document = globalThis.document, window = globalThis.window, key, timeoutMs = AMAP_TIMEOUT_MS } = {}) {
  if (window?.AMap) return window.AMap;
  if (!key) throw new Error('AMap key unavailable');
  // AMap 2.0's WebGL renderer fetches its vector style even with explicit
  // raster layers and features: []. Its bootstrap flag (SDK spelling) selects
  // the 2D DOM renderer before initialization, including on iOS. This affects
  // AMap only; weather canvases and the MapLibre fallback can still use WebGL.
  window.forbidenWebGL = true;
  return new Promise((resolve, reject) => {
    const node = document.createElement('script');
    let finished = false;
    const timer = setTimeout(() => finish(new Error('AMap script timed out')), timeoutMs);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      node.onload = node.onerror = null;
      if (error) { node.remove?.(); reject(error); }
      else if (window.AMap) resolve(window.AMap);
      else reject(new Error('AMap unavailable'));
    }
    node.src = buildAmapScriptUrl(key);
    node.async = true;
    node.onload = () => finish();
    node.onerror = () => finish(new Error('AMap script failed'));
    document.head.append(node);
  });
}
