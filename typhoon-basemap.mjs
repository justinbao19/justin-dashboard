import { simplifiedLand } from './typhoon-land.mjs';

export const BASEMAP_SOURCE_IDS = ['basemap-base', 'basemap-reference'];
export const BASEMAP_ATTRIBUTION = 'Esri, HERE, Garmin, © OpenStreetMap contributors';

export function basemapSources(theme = 'dark', mode = 'standard') {
  const canvas = `https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_${theme === 'light' ? 'Light' : 'Dark'}_Gray`;
  const satellite = mode === 'satellite';
  return {
    'basemap-base': {
      type: 'raster', tileSize: 256, maxzoom: satellite ? 19 : 16,
      tiles: [satellite
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : `${canvas}_Base/MapServer/tile/{z}/{y}/{x}`],
      attribution: satellite ? 'Esri World Imagery' : BASEMAP_ATTRIBUTION
    },
    'basemap-reference': {
      type: 'raster', tileSize: 256, maxzoom: satellite ? 10 : 16,
      tiles: [satellite
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
        : `${canvas}_Reference/MapServer/tile/{z}/{y}/{x}`],
      attribution: BASEMAP_ATTRIBUTION
    }
  };
}

export function createBasemapStyle(theme = 'dark', mode = 'standard') {
  const light = theme === 'light';
  return {
    version: 8,
    sources: {
      'basemap-land': { type: 'geojson', data: simplifiedLand },
      ...basemapSources(theme, mode)
    },
    layers: [
      { id: 'basemap-background', type: 'background', paint: { 'background-color': light ? '#dfe8ef' : '#07131d' } },
      // Always available beneath the raster tiles, including while offline/loading.
      { id: 'basemap-land', type: 'fill', source: 'basemap-land', paint: { 'fill-color': light ? '#c0ced5' : '#253947' } },
      { id: 'basemap-coast', type: 'line', source: 'basemap-land', paint: { 'line-color': light ? '#8ca3b0' : '#49616f', 'line-width': .8 } },
      { id: 'basemap-base', type: 'raster', source: 'basemap-base' },
      { id: 'basemap-reference', type: 'raster', source: 'basemap-reference', paint: { 'raster-opacity': .88 } }
    ]
  };
}

// One monitor per style; weather failures must never disable the basemap.
export function createBasemapFailureMonitor(threshold = 3) {
  let failures = 0;
  let failed = false;
  return event => {
    const sourceId = event?.sourceId || event?.source?.id;
    if (failed || !BASEMAP_SOURCE_IDS.includes(sourceId)) return false;
    failed = ++failures >= threshold;
    return failed;
  };
}
