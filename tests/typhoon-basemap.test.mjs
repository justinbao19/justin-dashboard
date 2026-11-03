import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as basemap from '../typhoon-basemap.mjs';
import { createOutlineProjection } from '../typhoon-land.mjs';
const { ESRI_ATTRIBUTION, BASEMAP_PALETTES, CHINESE_LABEL, OPENFREEMAP_STYLES, basemapSources, createBasemapStyle, createFallbackStyle, createBasemapFailureMonitor, nextBasemapProvider, loadMapLibre } = basemap;

const vectorStyle = { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, unused: { type: 'raster', tiles: ['https://example.test/unused'] } }, layers: [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park' },
  { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary' },
  { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name:latin'] } },
  { id: 'shield', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': ['to-string', ['get', 'ref']] } }
] };
const flush = () => new Promise(resolve => setImmediate(resolve));

const js = await readFile(new URL('../typhoon.js', import.meta.url), 'utf8');

test('Esri fallback base and reference tiles stay keyless, ordered and bounded in both themes', async () => {
  for (const theme of ['dark', 'light']) {
    const sources = basemapSources(theme);
    for (const [id, suffix] of [['basemap-base', 'Base'], ['basemap-reference', 'Reference']]) {
      assert.deepEqual(sources[id].tiles, [`https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_${theme === 'light' ? 'Light' : 'Dark'}_Gray_${suffix}/MapServer/tile/{z}/{y}/{x}`]);
      assert.equal(sources[id].tileSize, 256);
      assert.equal(sources[id].maxzoom, 16);
      assert.equal(sources[id].attribution, ESRI_ATTRIBUTION);
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
    const style = createFallbackStyle(theme, 'esri', mode);
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
      if (!nodes.has(id)) nodes.set(id, {
        hidden: true, dataset: {}, style: {}, innerHTML: '',
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, setAttribute() {}, contains() { return false; },
        querySelector: () => ({ addEventListener() {}, setAttribute() {} }),
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 0, height: 0 })
      });
      return nodes.get(id);
    },
    createElement: tag => tag === 'canvas' ? { getContext: () => overrides.webgl === false ? null : {} } : {},
    querySelector: () => ({}),
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const contextDocument = overrides.document ? {
    ...document,
    ...overrides.document,
    createElement: overrides.document.createElement || document.createElement,
    addEventListener: overrides.document.addEventListener || document.addEventListener
  } : document;
  const instrumented = js.replace(/^import[\s\S]*?from '[^']+';\n/gm, '').replace('  init();', `
    ensureWindCircleLabelImages = () => {};
    renderMarkers = () => {};
    resolveAndLoadWeatherLayers = () => {};
    globalThis.api = { state, init, initializeMap, setBasemap, syncTheme, mapPadding, fitTracks, rebuildStormLayers, reloadMapStyle, showOutlineFallback, document };
  `);
  return runInNewContext(`${instrumented}\napi;`, {
    console, ...basemap, createOutlineProjection,
    loadMapLibre: async () => overrides.maplibregl || overrides.window?.maplibregl,
    fetch: async () => ({ ok: true, json: async () => structuredClone(vectorStyle) }),
    AbortController, queueMicrotask, setTimeout: () => 1, clearTimeout() {},
    addEventListener() {}, ...overrides, document: contextDocument
  });
}

class FakeMap {
  constructor({ style }) { this.events = []; this.touchZoomRotate = { disableRotation() {} }; this.reset(style); }
  reset(style) { this.style = structuredClone(style); this.sources = structuredClone(style.sources); }
  addControl() {}
  fitBounds() {}
  remove() { this.removed = true; }
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
  const maplibregl = { supported: () => true, Map: FakeMap, NavigationControl: class {}, LngLatBounds: class { extend() {} isEmpty() { return false; } } };
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
  await initializeMap();
  const map = state.map;
  const ready = async () => { map.fire('style.load'); await new Promise(resolve => setImmediate(resolve)); };
  const check = () => {
    const ids = map.style.layers.map(layer => layer.id);
    for (const id of ['track-observed-line', 'points-observed', 'track-cma', 'points-cma', 'forecast-cone-fill', 'playback-history-line', 'wind-circle-7-fill']) {
      assert.ok(ids.indexOf(id) > ids.indexOf('place'), id);
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
    await flush();
    await ready();
    check();
    assert.equal(map.events.length, listenerCount);
  }
  theme = 'light';
  syncTheme();
  await flush();
  await ready();
  check();
  assert.equal(map.getLayer('basemap-background').paint['background-color'], '#dfe8ef');
  state.activeSources.delete('observed');
  setBasemap('standard');
  setBasemap('satellite');
  await flush();
  await ready();
  check();
  assert.equal(map.getLayer('points-observed').layout.visibility, 'none');
  assert.equal(map.events.length, listenerCount, 'rapid switches preserve visibility and do not duplicate listeners');
  state.detail.tracks.forecasts = [{ id: 'jma', color: '#abcdef', points: [point, point] }];
  await rebuildStormLayers();
  assert.equal(map.getSource('track-cma'), undefined, 'old agency sources are removed when switching storms');
  assert.ok(map.getLayer('track-jma'));
});

test('vector tile failure falls back to Esri then bundled land, and switching retries vector tiles', async () => {
  const maplibregl = { supported: () => true, Map: FakeMap, NavigationControl: class {} };
  const { state, initializeMap, setBasemap, document } = harness({ window: { maplibregl }, maplibregl, console: { warn() {} } });
  state.needsTrackFit = false;
  await initializeMap();
  const map = state.map;
  assert.equal(state.basemapProvider, 'openfreemap');
  for (let i = 0; i < 3; i++) map.fire('error', { sourceId: 'openmaptiles' });
  await flush();
  assert.equal(state.basemapProvider, 'esri');
  map.fire('style.load');
  assert.equal(document.getElementById('basemapNotice').hidden, false);
  assert.ok(map.getLayer('basemap-base'));
  for (let i = 0; i < 3; i++) map.fire('error', { sourceId: 'basemap-base' });
  await flush();
  map.fire('style.load');
  assert.equal(state.basemapProvider, 'land');
  assert.ok(map.getSource('basemap-land').data.features.length);
  assert.equal(map.getLayer('basemap-base'), undefined);
  setBasemap('satellite');
  await flush();
  map.fire('style.load');
  assert.equal(document.getElementById('basemapNotice').hidden, true);
  assert.equal(state.basemapProvider, 'openfreemap');
  assert.ok(map.getLayer('basemap-satellite'));
  for (let i = 0; i < 5; i++) map.fire('error', { sourceId: 'weather-radar' });
  await flush();
  assert.equal(state.basemapProvider, 'openfreemap');
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

test('OpenFreeMap dark and positron are independently themed, with Chinese names and intact shields', () => {
  const original = structuredClone(vectorStyle);
  assert.equal(OPENFREEMAP_STYLES.dark, 'https://tiles.openfreemap.org/styles/dark');
  assert.equal(OPENFREEMAP_STYLES.light, 'https://tiles.openfreemap.org/styles/positron');
  for (const theme of ['dark', 'light']) {
    const style = createBasemapStyle(theme, 'standard', vectorStyle);
    const layer = id => style.layers.find(layer => layer.id === id);
    assert.equal(style.sources.openmaptiles.url, 'https://tiles.openfreemap.org/planet');
    assert.equal(style.sources.unused, undefined);
    assert.equal(layer('background'), undefined);
    assert.equal(layer('basemap-background').paint['background-color'], BASEMAP_PALETTES[theme].water);
    assert.equal(layer('water').paint['fill-color'], BASEMAP_PALETTES[theme].water);
    assert.equal(layer('park').paint['fill-color'], BASEMAP_PALETTES[theme].park);
    assert.equal(layer('boundary').paint['line-color'], BASEMAP_PALETTES[theme].border);
    assert.equal(layer('place').paint['text-color'], BASEMAP_PALETTES[theme].label);
    assert.deepEqual(layer('place').layout['text-field'], ['coalesce', ['get', 'name:zh-Hans'], ['get', 'name:zh'], ['get', 'name'], ['get', 'name:latin']]);
    assert.deepEqual(layer('shield').layout['text-field'], ['to-string', ['get', 'ref']]);
    assert.match(style.sources.openmaptiles.attribution, /OpenFreeMap.*OpenMapTiles.*openstreetmap.org\/copyright/);
    assert.ok(style.sources['basemap-land'].data.features.length);
  }
  assert.deepEqual(vectorStyle, original, 'theme building must not mutate cached upstream styles');
  assert.throws(() => createBasemapStyle('dark', 'standard', {}), /Invalid/);
});

test('satellite uses NASA raster beneath vector borders and Chinese labels, without opaque land fills', () => {
  const style = createBasemapStyle('light', 'satellite', vectorStyle);
  assert.equal(style.sources['basemap-satellite'].type, 'raster');
  assert.equal(style.sources['basemap-satellite'].maxzoom, 8);
  assert.match(style.sources['basemap-satellite'].tiles[0], /gibs\.earthdata\.nasa\.gov.*BlueMarble.*\{z\}\/\{y\}\/\{x\}\.jpeg$/);
  const ids = style.layers.map(layer => layer.id);
  assert.ok(ids.indexOf('basemap-satellite') > ids.indexOf('basemap-land'));
  assert.ok(ids.indexOf('boundary') > ids.indexOf('basemap-satellite'));
  assert.equal(ids.includes('background'), false);
  assert.equal(ids.includes('water'), false);
  assert.deepEqual(style.layers.find(layer => layer.id === 'place').layout['text-field'], CHINESE_LABEL);
});

test('fallback selection never requires a remote style or WebGL for the final outline', () => {
  assert.equal(nextBasemapProvider('openfreemap'), 'esri');
  assert.equal(nextBasemapProvider('esri'), 'land');
  assert.equal(nextBasemapProvider('openfreemap', false), 'outline');
  const style = createFallbackStyle('dark');
  assert.deepEqual(Object.keys(style.sources), ['basemap-land']);
  assert.equal(style.glyphs, undefined);
  assert.equal(style.sprite, undefined);
});

test('style request errors and invalid styles select Esri', async () => {
  const maplibregl = { supported: () => true, Map: FakeMap, NavigationControl: class {} };
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => ({ version: 8 }) })]) {
    const { state, initializeMap } = harness({ maplibregl, fetch, console: { warn() {} } });
    await initializeMap();
    assert.equal(state.basemapProvider, 'esri');
    assert.ok(state.map.getSource('basemap-land'));
  }
});

test('stalled style requests abort to Esri and tile deadlines survive storm rebuilds', async () => {
  const timers = new Map();
  let timerId = 0;
  const globals = { maplibregl: { supported: () => true, Map: FakeMap, NavigationControl: class {} }, console: { warn() {} },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const { state, initializeMap, reloadMapStyle } = harness({ ...globals,
    fetch: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  });
  const pending = initializeMap();
  await flush();
  const requestTimer = [...timers.values()].find(timer => timer.delay === 8000);
  requestTimer.callback();
  await pending;
  assert.equal(state.basemapProvider, 'esri');
  ++state.styleGeneration; // Rebuilding storm overlays must not cancel the basemap deadline.
  timers.get(state.basemapTimer).callback();
  assert.equal(state.basemapProvider, 'land');
  state.vectorStyles.set('dark', vectorStyle);
  await reloadMapStyle();
  timers.get(state.basemapTimer).callback();
  assert.equal(state.basemapProvider, 'esri', 'stalled vector tiles also time out');
});

test('successful visible tiles clear the deadline and subsequent pans arm it again', async () => {
  const cleared = [];
  const { state, initializeMap } = harness({ maplibregl: { supported: () => true, Map: FakeMap, NavigationControl: class {} }, clearTimeout: id => cleared.push(id) });
  await initializeMap();
  const map = state.map;
  map.fire('sourcedata', { sourceId: 'weather-radar', sourceDataType: 'content', tile: {}, isSourceLoaded: true });
  assert.notEqual(state.basemapTimer, null);
  map.fire('sourcedata', { sourceId: 'openmaptiles', sourceDataType: 'metadata', isSourceLoaded: true });
  assert.notEqual(state.basemapTimer, null, 'TileJSON alone is not a working basemap');
  map.fire('sourcedata', { sourceId: 'openmaptiles', tile: {}, isSourceLoaded: false });
  assert.equal(state.basemapTimer, null);
  assert.ok(cleared.length);
  map.fire('sourcedataloading', { sourceId: 'openmaptiles' });
  assert.notEqual(state.basemapTimer, null);
});

test('late style responses cannot override a newer theme or satellite choice', async () => {
  const requests = [];
  const { state, initializeMap, syncTheme, setBasemap } = harness({
    maplibregl: { supported: () => true, Map: FakeMap, NavigationControl: class {} },
    fetch: url => new Promise(resolve => requests.push({ url, resolve }))
  });
  const initial = initializeMap();
  await flush();
  syncTheme('light');
  setBasemap('satellite');
  assert.equal(requests.length, 3);
  requests[2].resolve({ ok: true, json: async () => vectorStyle });
  await flush();
  requests[1].resolve({ ok: true, json: async () => vectorStyle });
  requests[0].resolve({ ok: true, json: async () => vectorStyle });
  await initial;
  assert.equal(state.theme, 'light');
  assert.equal(state.basemap, 'satellite');
  assert.ok(state.map.getSource('basemap-satellite'));
  assert.equal(state.map.getLayer('basemap-background').paint['background-color'], BASEMAP_PALETTES.light.water);
});

test('CDN failure, unavailable WebGL, constructor failure and context loss leave a visible local map', async () => {
  for (const { renderer, webgl } of [
    { renderer: null },
    { renderer: { Map: FakeMap, NavigationControl: class {} }, webgl: false },
    { renderer: { Map: class { constructor() { throw new Error('WebGL'); } } } }
  ]) {
    const { state, initializeMap, document, syncTheme } = harness({ webgl, loadMapLibre: async () => { if (!renderer) throw new Error('CDN'); return renderer; }, console: { warn() {} } });
    state.detail = { storm: { position: { lon: 125, lat: 22 } }, tracks: { observed: [{ position: { lon: 125, lat: 22 }, classification: 'typhoon' }] } };
    await initializeMap();
    assert.equal(state.basemapProvider, 'outline');
    assert.equal(state.map, null);
    assert.equal(document.getElementById('mapFallback').hidden, false);
    assert.match(document.getElementById('mapFallback').innerHTML, /<svg.*<path.*data-point-key=/);
    assert.doesNotMatch(document.getElementById('mapFallback').innerHTML, /NaN|Infinity/);
    syncTheme('light');
    assert.match(document.getElementById('mapFallback').innerHTML, /#dfe8ef/);
  }
  const { state, initializeMap } = harness({ maplibregl: { supported: () => true, Map: FakeMap, NavigationControl: class {} } });
  await initializeMap();
  const map = state.map;
  map.fire('webglcontextlost');
  assert.equal(map.removed, true);
  assert.equal(state.basemapProvider, 'outline');
});

test('page startup initializes MapLibre before a slow detail request and keeps the vector basemap after detail failure', async () => {
  const maplibregl = { Map: FakeMap, NavigationControl: class {} };
  const response = (payload, ok = true) => ({ ok, json: async () => payload });
  const { state, init } = harness({
    maplibregl,
    location: { pathname: '/typhoon/gdacs-tc-1001343', search: '', href: 'http://localhost/typhoon/gdacs-tc-1001343' },
    URL, URLSearchParams,
    history: { replaceState() {} },
    navigator: { geolocation: null },
    localStorage: { getItem: () => 'dark' },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} },
    requestAnimationFrame: callback => callback(),
    cancelAnimationFrame() {},
    fetch: async url => {
      if (url === '/api/typhoons') return response({ storms: [{ id: 'gdacs-tc-1001343', active: true, position: { lat: 22, lon: 125 }, name: { display: 'Test' } }] });
      if (String(url).startsWith('/api/typhoon')) throw new Error('UPSTREAM_TIMEOUT');
      return response(vectorStyle);
    },
    console: { warn() {} }
  });
  const startup = init();
  assert.equal(state.rendererLoading, true, 'initializeMap should start before detail loading');
  await startup;
  await flush();
  assert.ok(state.map, 'detail failure must not remove the initialized map');
  assert.equal(state.basemapProvider, 'openfreemap');
  assert.ok(state.map.getSource('openmaptiles'));
});

test('MapLibre renderer without supported() uses the direct WebGL context check', async () => {
  const maplibregl = { Map: FakeMap, NavigationControl: class {} };
  const { state, initializeMap } = harness({ maplibregl });
  await initializeMap();
  assert.ok(state.map);
  assert.equal(state.basemapProvider, 'openfreemap');
});

test('MapLibre loads pinned CSS and JS from jsdelivr then unpkg, and rejects when both fail', async () => {
  for (const allFail of [false, true]) {
    const urls = [], window = {}, document = {
      createElement: () => ({ remove() {} }),
      head: { append(node) {
        const url = node.src || node.href;
        urls.push(url);
        queueMicrotask(() => {
          if (url.includes('cdn.jsdelivr.net') || allFail) node.onerror();
          else { if (node.src) window.maplibregl = { loaded: true }; node.onload(); }
        });
      } }
    };
    const promise = loadMapLibre({ window, document });
    if (allFail) await assert.rejects(promise, /MapLibre unavailable/);
    else assert.equal((await promise).loaded, true);
    assert.equal(urls.length, 4);
    assert.ok(urls.every(url => url.includes(`maplibre-gl@${basemap.MAPLIBRE_VERSION}/dist/`)));
    assert.ok(urls[0].endsWith('.css') && urls[1].endsWith('.js'));
    assert.match(urls[2], /unpkg\.com/);
  }
});

test('SVG fallback projection fits points into the unobscured mobile viewport', () => {
  const padding = { left: 38, right: 72, top: 150, bottom: 300 };
  const positions = [[130, 18], [126, 22], [122, 27]];
  const projection = createOutlineProjection({ width: 390, height: 844, padding, positions });
  for (const position of positions) {
    const [x, y] = projection.project(position);
    assert.ok(x >= padding.left && x <= 390 - padding.right);
    assert.ok(y >= padding.top && y <= 844 - padding.bottom);
  }
  assert.ok(projection.landPaths.length > 10);
  assert.ok(projection.landPaths.every(path => !/NaN|Infinity/.test(path)));
});
