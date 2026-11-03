import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { BASEMAP_ATTRIBUTION, basemapSources, createBasemapStyle, createBasemapFailureMonitor } from '../typhoon-basemap.mjs';

const js = await readFile(new URL('../typhoon.js', import.meta.url), 'utf8');

test('Canvas base and reference tiles are keyless, correctly ordered and bounded in both themes', async () => {
  for (const theme of ['dark', 'light']) {
    const sources = basemapSources(theme);
    for (const [id, suffix] of [['basemap-base', 'Base'], ['basemap-reference', 'Reference']]) {
      assert.deepEqual(sources[id].tiles, [`https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_${theme === 'light' ? 'Light' : 'Dark'}_Gray_${suffix}/MapServer/tile/{z}/{y}/{x}`]);
      assert.equal(sources[id].tileSize, 256);
      assert.equal(sources[id].maxzoom, 16);
      assert.equal(sources[id].attribution, BASEMAP_ATTRIBUTION);
    }
  }
  for (const file of ['typhoon.js', 'typhoon.html', 'typhoon-basemap.mjs']) {
    assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /cartocdn|carto\.com|API KEY REQUIRED/i);
  }
});

test('satellite keeps the Esri imagery and boundaries services', () => {
  const sources = basemapSources('light', 'satellite');
  assert.match(sources['basemap-base'].tiles[0], /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
  assert.match(sources['basemap-reference'].tiles[0], /Reference\/World_Boundaries_and_Places\/MapServer\/tile/);
});

test('every style starts with themed water and bundled land beneath the rasters', () => {
  for (const theme of ['dark', 'light']) for (const mode of ['standard', 'satellite']) {
    const style = createBasemapStyle(theme, mode);
    assert.equal(style.layers[0].type, 'background');
    assert.equal(style.layers[0].paint['background-color'], theme === 'light' ? '#dfe8ef' : '#07131d');
    const land = style.sources['basemap-land'].data;
    assert.equal(land.type, 'FeatureCollection');
    assert.ok(land.features.length > 10);
    for (const feature of land.features) {
      const ring = feature.geometry.coordinates[0];
      assert.deepEqual(ring[0], ring.at(-1));
      assert.ok(ring.every(([lon, lat]) => Math.abs(lon) <= 180 && Math.abs(lat) < 85));
    }
    assert.ok(style.layers.findIndex(layer => layer.id === 'basemap-land') < style.layers.findIndex(layer => layer.type === 'raster'));
    assert.doesNotMatch(JSON.stringify(style), /natural-earth|cartocdn|apikey|token=/i);
  }
});

test('only repeated basemap errors activate fallback, once per style', () => {
  const failed = createBasemapFailureMonitor();
  for (let i = 0; i < 10; i++) assert.equal(failed({ sourceId: 'weather-radar' }), false);
  assert.equal(failed({ error: new Error('Failed to fetch') }), false);
  assert.equal(failed({ sourceId: 'basemap-base' }), false);
  assert.equal(failed({ source: { id: 'basemap-reference' } }), false);
  assert.equal(failed({ sourceId: 'basemap-base' }), true);
  assert.equal(failed({ sourceId: 'basemap-base' }), false);
  assert.equal(createBasemapFailureMonitor()({ sourceId: 'basemap-base' }), false);
});

function harness(overrides = {}) {
  const nodes = new Map();
  const document = {
    documentElement: { dataset: {} },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, dataset: {}, style: {}, getBoundingClientRect: () => ({ width: 0, height: 0 }) });
      return nodes.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const instrumented = js.replace(/^import[\s\S]*?from '[^']+';\n/gm, '').replace('  init();', `
    ensureWindCircleLabelImages = () => {};
    renderMarkers = () => {};
    resolveAndLoadWeatherLayers = () => {};
    globalThis.api = { state, initializeMap, setBasemap, syncTheme, mapPadding, fitTracks, rebuildStormLayers, document };
  `);
  return runInNewContext(`${instrumented}\napi;`, {
    document, console, createBasemapStyle, createBasemapFailureMonitor,
    BASEMAP_SOURCE_IDS: ['basemap-base', 'basemap-reference'],
    addEventListener() {}, ...overrides
  });
}

class FakeMap {
  constructor({ style }) { this.events = []; this.reset(style); }
  reset(style) { this.style = structuredClone(style); this.sources = structuredClone(style.sources); }
  addControl() {}
  fitBounds() {}
  on(...args) { this.events.push(args); }
  fire(name, event = {}) { for (const [id, callback] of this.events) if (id === name && typeof callback === 'function') callback(event); }
  setStyle(style) { this.reset(style); this.fire('styledata'); }
  getStyle() { return { ...this.style, sources: this.sources }; }
  getSource(id) { return this.sources[id]; }
  getLayer(id) { return this.style.layers.find(layer => layer.id === id); }
  addSource(id, source) { assert.ok(!this.sources[id], `duplicate source ${id}`); this.sources[id] = { ...source, setData(data) { this.data = data; } }; }
  addLayer(layer, before) {
    assert.ok(!this.getLayer(layer.id), `duplicate layer ${layer.id}`);
    const index = this.style.layers.findIndex(item => item.id === before);
    this.style.layers.splice(index < 0 ? this.style.layers.length : index, 0, layer);
  }
  removeLayer(id) { this.style.layers = this.style.layers.filter(layer => layer.id !== id); }
  removeSource(id) { assert.ok(!this.style.layers.some(layer => layer.source === id)); delete this.sources[id]; }
  setLayoutProperty(id, property, value) { const layer = this.getLayer(id); layer.layout = { ...layer.layout, [property]: value }; }
}

test('style.load restores colored tracks, cones, playback and weather without duplicating interactions', async () => {
  let theme = 'dark';
  const maplibregl = { Map: FakeMap, NavigationControl: class {}, LngLatBounds: class { extend() {} isEmpty() { return false; } } };
  const { state, initializeMap, setBasemap, syncTheme, rebuildStormLayers } = harness({
    window: { maplibregl }, maplibregl,
    localStorage: { getItem: () => theme },
    document: {
      documentElement: { dataset: {} },
      getElementById: () => ({ dataset: {}, hidden: true, getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
      querySelector: () => ({}), querySelectorAll: () => []
    }
  });
  const point = { position: { lon: 125, lat: 22 }, classification: 'typhoon', kind: 'observed' };
  state.detail = {
    storm: point,
    tracks: { observed: [point, { ...point, classification: 'super_typhoon' }], forecasts: [{ id: 'cma', color: '#ff7a45', points: [point, point] }] },
    eventGeometry: { features: [{ type: 'Feature', properties: { featureType: 'forecast_cone' }, geometry: { type: 'Polygon', coordinates: [[[125,22],[126,23],[127,22],[125,22]]] } }] },
    mapConfig: { weatherLayers: [{ id: 'radar', type: 'raster' }] }
  };
  state.layerClock = { layers: { radar: { available: true, tiles: ['https://example.test/{z}/{x}/{y}'] } } };
  state.activeSources.add('cma');
  state.needsTrackFit = false;
  initializeMap();
  const map = state.map;
  const ready = async () => { map.fire('style.load'); await new Promise(resolve => setImmediate(resolve)); };
  const check = () => {
    const ids = map.style.layers.map(layer => layer.id);
    for (const id of ['track-observed-line', 'points-observed', 'track-cma', 'points-cma', 'forecast-cone-fill', 'playback-history-line', 'wind-circle-7-fill']) {
      assert.ok(ids.indexOf(id) > ids.indexOf('basemap-reference'), id);
      assert.ok(ids.indexOf(id) > ids.indexOf('weather-radar'), id);
    }
    assert.notEqual(map.getSource('points-observed').data.features[0].properties.color, map.getSource('points-observed').data.features[1].properties.color);
  };
  await ready();
  check();
  const listenerCount = map.events.length;
  for (const mode of ['satellite', 'standard', 'satellite']) {
    setBasemap(mode);
    assert.equal(map.getLayer('points-observed'), undefined, 'styledata must not hydrate an unfinished style');
    await ready();
    check();
    assert.equal(map.events.length, listenerCount);
  }
  theme = 'light';
  syncTheme();
  await ready();
  check();
  assert.equal(map.getLayer('basemap-background').paint['background-color'], '#dfe8ef');
  state.activeSources.delete('observed');
  setBasemap('standard');
  setBasemap('satellite');
  await ready();
  check();
  assert.equal(map.getLayer('points-observed').layout.visibility, 'none');
  assert.equal(map.events.length, listenerCount, 'rapid switches preserve visibility and do not duplicate listeners');
  state.detail.tracks.forecasts = [{ id: 'jma', color: '#abcdef', points: [point, point] }];
  await rebuildStormLayers();
  assert.equal(map.getSource('track-cma'), undefined, 'old agency sources are removed when switching storms');
  assert.ok(map.getLayer('track-jma'));
});

test('tile failure before style.load reveals the bundled map and notice, and switching retries tiles', () => {
  const maplibregl = { Map: FakeMap, NavigationControl: class {} };
  const { state, initializeMap, setBasemap, document } = harness({ window: { maplibregl }, maplibregl, console: { warn() {} } });
  state.needsTrackFit = false;
  initializeMap();
  const map = state.map;
  for (let i = 0; i < 3; i++) map.fire('error', { sourceId: 'basemap-base' });
  assert.equal(state.basemapFailed, true);
  map.fire('style.load');
  assert.equal(document.getElementById('basemapNotice').hidden, false);
  for (const id of ['basemap-base', 'basemap-reference']) assert.equal(map.getLayer(id).layout.visibility, 'none');
  assert.ok(map.getSource('basemap-land').data.features.length);
  assert.equal(map.getLayer('basemap-land').layout?.visibility, undefined);
  setBasemap('satellite');
  map.fire('style.load');
  assert.equal(document.getElementById('basemapNotice').hidden, true);
  assert.equal(state.basemapFailed, false);
  assert.equal(map.getLayer('basemap-base').layout?.visibility, undefined);
  for (let i = 0; i < 5; i++) map.fire('error', { sourceId: 'weather-radar' });
  assert.equal(state.basemapFailed, false);
});

test('camera fit includes a current position without history and excludes other storms', () => {
  const fitted = [];
  const { state, fitTracks } = harness({ maplibregl: { LngLatBounds: class {
    extend(point) { fitted.push(point); }
    isEmpty() { return fitted.length === 0; }
  } } });
  let options;
  state.map = { fitBounds: (bounds, value) => { options = value; } };
  state.detail = { storm: { position: { lon: 125, lat: 22 } }, tracks: { forecasts: [] } };
  state.otherStormTracks = [{ lines: [{ points: [{ position: { lon: -50, lat: -30 } }] }] }];
  fitTracks();
  assert.equal(JSON.stringify(fitted), '[[125,22]]');
  assert.equal(options.retainPadding, false);
  assert.equal(options.maxZoom, 7);
});

test('fitting reserves the desktop panel and the 390px mobile sheet and toolbar', () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  for (const mobile of [false, true]) {
    const mapRect = mobile ? rect(0, 0, 390, 844) : rect(0, 0, 1440, 900);
    const rectangles = {
      typhoonMap: mapRect,
      insightPanel: mobile ? rect(8, 625, 374, 211) : rect(1046, 76, 380, 810),
      trackPlayback: mobile ? rect(8, 549, 374, 64) : rect(14, 800, 520, 76)
    };
    const { mapPadding } = harness({ document: {
      getElementById: id => ({ getBoundingClientRect: () => rectangles[id] || rect(0, 0, 0, 0) }),
      querySelector: selector => ({ getBoundingClientRect: () => selector === '.topbar'
        ? rect(8, 8, mapRect.width - 16, 50)
        : mobile ? rect(330, 68, 52, 300) : rect(610, 76, 410, 48) })
    } });
    const padding = mapPadding();
    if (mobile) {
      assert.ok(padding.bottom >= mapRect.bottom - rectangles.trackPlayback.top + 12);
      assert.ok(padding.right >= 72);
    } else {
      assert.ok(padding.right >= 408);
    }
    assert.ok(mapRect.width - padding.left - padding.right >= 140);
    assert.ok(mapRect.height - padding.top - padding.bottom >= 140);
  }
});
