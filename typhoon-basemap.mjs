import { simplifiedLand } from './typhoon-land.mjs';

// Keep the renderer pinned; both CDN attempts use the same JS and CSS release.
export const MAPLIBRE_VERSION = '5.6.1';
export const MAPLIBRE_CDNS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com'];
export const BASEMAP_TIMEOUT_MS = 10000;
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

export function nextBasemapProvider(provider, rendererAvailable = true) {
  if (!rendererAvailable) return 'outline';
  return provider === 'openfreemap' ? 'esri' : 'land';
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
