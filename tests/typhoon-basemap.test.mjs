import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as basemap from '../typhoon-basemap.mjs';
import { createOutlineProjection } from '../typhoon-land.mjs';
const { AMAP_TIMEOUT_MS, ESRI_ATTRIBUTION, BASEMAP_PALETTES, CHINESE_LABEL, OPENFREEMAP_STYLES, amapStyleForTheme, basemapProviderOrder, basemapSources, buildAmapProxyUrl, amapPaddingOffset, normalizeMapPadding, createBasemapStyle, createFallbackStyle, createBasemapFailureMonitor, isAmapAuthError, nextBasemapProvider, loadMapLibre, parseAmapConfig, wgs84ToGcj02 } = basemap;

const vectorStyle = { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }, unused: { type: 'raster', tiles: ['https://example.test/unused'] } }, layers: [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
  { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park' },
  { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary' },
  { id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name:latin'] } },
  { id: 'shield', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': ['to-string', ['get', 'ref']] } }
] };
const flush = () => new Promise(resolve => setImmediate(resolve));

class FakeAmapPlaceMarker {
  constructor(options) { Object.assign(this, options); }
  setMap(map) { this.map = map; }
}

class FakeAmapTileLayer {
  constructor(options) { Object.assign(this, options); this.visible = true; }
  on(name, callback) { (this.events ||= new Map()).set(name, callback); }
  fire(name, event) { this.events?.get(name)?.(event); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  static Satellite = class extends FakeAmapTileLayer {};
  static RoadNet = class extends FakeAmapTileLayer {};
  static Flexible = class extends FakeAmapTileLayer {};
}

test('AMap config, theme and fallback helpers keep the primary chain explicit', () => {
  assert.deepEqual(parseAmapConfig({ key: ' public-key ', serviceHost: '/api/_AMapService/' }), { key: 'public-key', serviceHost: '/api/_AMapService' });
  assert.deepEqual(parseAmapConfig({ key: '' }), { key: null, serviceHost: '/api/_AMapService' });
  assert.equal(amapStyleForTheme('light'), 'amap://styles/normal');
  assert.equal(amapStyleForTheme('dark'), 'amap://styles/dark');
  assert.equal(AMAP_TIMEOUT_MS, 8000);
  assert.deepEqual(basemapProviderOrder(), ['amap', 'openfreemap', 'esri', 'land']);
  assert.equal(nextBasemapProvider('amap'), 'openfreemap');
  assert.equal(isAmapAuthError('INVALID_USER_KEY'), true);
  assert.equal(isAmapAuthError('network timeout'), false);
});

test('AMap raster URL uses the Chinese labeled variant and SDK tile placeholders', () => {
  const url = new URL(basemap.AMAP_LABELED_TILE_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'webrd02.is.autonavi.com');
  assert.equal(url.pathname, '/appmaptile');
  assert.deepEqual(Object.fromEntries(url.searchParams), { size: '1', scale: '1', style: '8', x: '[x]', y: '[y]', z: '[z]' });
  assert.equal(url.searchParams.has('lang'), false, 'lang=zh_cn removes overseas labels on the raster service');
});

test('AMap selects its raster renderer before the SDK can bootstrap a vector style on any device', async () => {
  for (const userAgent of ['desktop', 'iPhone', 'Android']) {
    const window = { navigator: { userAgent } };
    const sdk = {};
    const document = {
      createElement: () => ({}),
      head: { append(script) {
        assert.equal(window.forbidenWebGL, true, 'renderer choice must precede script execution');
        window.AMap = sdk;
        script.onload();
      } }
    };
    assert.equal(await basemap.loadAmapScript({ document, window, key: 'test-key' }), sdk);
  }
});

test('AMap dark WebGL tiles color the raster before upload and propagate image failures', () => {
  let image, result, failure;
  const draws = [];
  const context = { drawImage(...args) { draws.push({ args, filter: this.filter }); } };
  const canvas = { getContext: () => context };
  const createTile = runInNewContext(`(${basemap.createAmapDarkTile.toString()})`, {
    AMAP_LABELED_TILE_URL: basemap.AMAP_LABELED_TILE_URL,
    Image: class { constructor() { image = this; this.naturalWidth = 256; this.naturalHeight = 256; } },
    document: { createElement: () => canvas }
  });
  createTile(28, 12, 5, tile => { result = tile; }, error => { failure = error; });
  assert.equal(image.crossOrigin, 'anonymous', 'the resulting canvas must be usable as a WebGL texture');
  assert.match(image.src, /style=8&x=28&y=12&z=5$/);
  image.onload();
  assert.equal(result, canvas);
  assert.equal(canvas.width, 256);
  assert.equal(canvas.height, 256);
  assert.deepEqual(draws[0].args, [image, 0, 0]);
  assert.match(draws[0].filter, /^invert\(1\) hue-rotate\(180deg\)/);
  const error = new Error('tile unavailable');
  image.onerror(error);
  assert.equal(failure, error);
});

test('satellite references retain text and boundaries while removing opaque land, water and roads', () => {
  const pixels = new Uint8ClampedArray([
    16, 16, 16, 255, // city text
    130, 110, 70, 255, // region text
    170, 170, 170, 255, // antialiasing / boundary
    255, 251, 240, 255, // land
    180, 214, 230, 255, // sea
    255, 153, 0, 255, // road
    16, 16, 16, 0 // transparent input
  ]);
  basemap.amapLabelPixels(pixels);
  const alpha = [...pixels].filter((_, i) => i % 4 === 3);
  assert.deepEqual(alpha.slice(0, 2), [255, 255]);
  assert.ok(alpha[2] > 0 && alpha[2] < 255, 'keep antialiased edges');
  assert.deepEqual(alpha.slice(3), [0, 0, 0, 0]);
  assert.ok([...pixels].every((value, i) => i % 4 === 3 || value === 255), 'white text remains readable over imagery');
  const seaLabel = new Uint8ClampedArray([44, 88, 175, 255]);
  basemap.amapLabelPixels(seaLabel);
  assert.ok(seaLabel[3] > 0, 'blue sea names must survive alongside gray city names');
});

test('AMap padding offsets use screen coordinates for desktop, mobile and symmetric insets', () => {
  assert.deepEqual(amapPaddingOffset({ left: 70, right: 408, top: 142, bottom: 76 }), { dx: -169, dy: 33 });
  assert.deepEqual(amapPaddingOffset({ left: 38, right: 72, top: 150, bottom: 320 }), { dx: -17, dy: -85 });
  assert.deepEqual(amapPaddingOffset({ left: 100, top: 60 }), { dx: 50, dy: 30 });
  for (const padding of [undefined, null, 0, 40]) assert.deepEqual(amapPaddingOffset(padding), { dx: 0, dy: 0 });
  assert.deepEqual(normalizeMapPadding(24), { top: 24, bottom: 24, left: 24, right: 24 });
  assert.deepEqual(normalizeMapPadding({ top: -10, right: Infinity, bottom: NaN }), { top: 0, bottom: 0, left: 0, right: 0 });
});

test('WGS-84 coordinates convert to GCJ-02 only inside mainland China bounds', () => {
  const outside = wgs84ToGcj02(10, 20);
  assert.deepEqual(outside, [10, 20]);
  const beijing = wgs84ToGcj02(116.397, 39.908);
  assert.ok(beijing[0] > 116.4 && beijing[0] < 116.41);
  assert.ok(beijing[1] > 39.909 && beijing[1] < 39.916);
});

test('AMap proxy URLs select the official upstream and append jscode server-side', () => {
  const weather = new URL(buildAmapProxyUrl('/v3/weather/weatherInfo', 'city=310000&extensions=all', 'server-secret'));
  assert.equal(weather.hostname, 'restapi.amap.com');
  assert.equal(weather.searchParams.get('city'), '310000');
  assert.equal(weather.searchParams.get('jscode'), 'server-secret');
  const style = new URL(buildAmapProxyUrl('v4/map/styles', '', 'server-secret'));
  assert.equal(style.hostname, 'webapi.amap.com');
  assert.equal(style.pathname, '/v4/map/styles');
  const vector = new URL(buildAmapProxyUrl('/v3/vectormap/tiles', '?z=3', 'server-secret'));
  assert.equal(vector.hostname, 'fmap01.amap.com');
  assert.equal(vector.searchParams.get('jscode'), 'server-secret');
});

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
        querySelector: selector => selector === 'canvas.amap-layer' ? null : ({ addEventListener() {}, setAttribute() {} }),
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
    const nativeWindCircleLabelImages = ensureWindCircleLabelImages;
    ensureWindCircleLabelImages = map => { if (map.isAmap) nativeWindCircleLabelImages(map); };
    renderMarkers = () => {};
    resolveAndLoadWeatherLayers = () => {};
    globalThis.api = { state, init, initializeMap, initializeAmapMap, setBasemap, syncTheme, mapPadding, fitTracks, hydrateMapStyle, refreshMapForStorm, rebuildStormLayers, reloadMapStyle, showOutlineFallback, AmapMapAdapter, AmapMarker, addTrackLayers, document };
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
  flyTo(options) { (this.flights ||= []).push(options); }
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

test('camera fit includes the supplied forecast cone geometry', () => {
  const fitted = [];
  const { state, fitTracks } = harness({ maplibregl: { LngLatBounds: class {
    extend(point) { fitted.push(point); }
    isEmpty() { return fitted.length === 0; }
  } } });
  state.map = { fitBounds() {} };
  state.detail = {
    storm: { position: { lon: 125, lat: 22 } },
    tracks: { observed: [], forecasts: [] },
    eventGeometry: { features: [{
      properties: { featureType: 'forecast_cone' },
      geometry: { type: 'Polygon', coordinates: [[[130, 20], [138, 25], [130, 30], [130, 20]]] }
    }] }
  };
  fitTracks();
  assert.ok(fitted.some(([lon, lat]) => lon === 138 && lat === 25));
});

test('AMap adapter fits with padding, converts overlays and preserves labeled base layers across themes and modes', () => {
  const overlays = [];
  class FakeOverlay {
    constructor(options) { Object.assign(this, options); overlays.push(this); }
    setMap(map) { this.map = map; }
    setPosition(position) { this.position = position; }
    setOptions(options) { Object.assign(this, options); }
    show() { this.hidden = false; }
    hide() { this.hidden = true; }
    on() {}
  }
  class FakeTileLayer extends FakeOverlay {}
  class FakeDefaultLayer extends FakeOverlay {}
  class FakeSatellite extends FakeTileLayer {}
  class FakeRoadNet extends FakeTileLayer {}
  class FakeNativeMap {
    constructor(container, options) { this.container = container; this.options = options; this.defaultLayer = new FakeDefaultLayer(); this.layers = [...options.layers]; this.layers.forEach(layer => layer.setMap(this)); this.zoom = options.zoom; }
    on() {}
    setBounds(...args) { this.boundsArgs = args; this.zoom = 9; }
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = zoom; }
    setLayers() { assert.fail('mode switches must preserve explicit rasters'); }
    setMapStyle(style) { this.mapStyle = style; }
    add(items) { for (const item of Array.isArray(items) ? items : [items]) { item.setMap(this); if (!this.layers.includes(item)) this.layers.push(item); } }
    remove(items) { for (const item of items) { item.setMap(null); this.layers = this.layers.filter(layer => layer !== item); } }
  }
  class FakeBounds {
    constructor(southWest, northEast) { this.southWest = southWest; this.northEast = northEast; }
  }
  FakeTileLayer.Satellite = FakeSatellite;
  FakeTileLayer.RoadNet = FakeRoadNet;
  FakeTileLayer.Flexible = class extends FakeTileLayer {};
  const AMap = {
    Map: FakeNativeMap,
    Bounds: FakeBounds,
    TileLayer: FakeTileLayer,
    createDefaultLayer: () => assert.fail('must never create a default vector layer'),
    Polyline: FakeOverlay,
    Polygon: FakeOverlay,
    CircleMarker: FakeOverlay,
    Text: FakeOverlay,
    Marker: FakeOverlay
  };
  const classes = new Set();
  const container = { append() {}, dataset: {}, classList: {
    toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
    contains(name) { return classes.has(name); }
  } };
  const { AmapMapAdapter, AmapMarker, addTrackLayers, state } = harness({ document: { getElementById: () => container } });
  const adapter = new AmapMapAdapter(AMap, { container: 'typhoonMap', center: [116.397, 39.908], zoom: 5, mapStyle: amapStyleForTheme('dark') });
  assert.deepEqual(adapter.native.options.center, wgs84ToGcj02(116.397, 39.908));
  assert.equal(adapter.native.options.lang, 'zh_cn');
  assert.equal(adapter.native.options.showLabel, false);
  assert.equal(JSON.stringify(adapter.native.options.features), '[]');
  assert.equal(adapter.native.options.mapStyle, undefined, 'raster themes must not request vector styles');
  assert.equal(adapter.native.options.layers.length, 1);
  assert.equal(adapter.native.options.layers[0], adapter.standardLayer, 'explicit raster replaces the default vector layer');
  const labels = [...adapter.placeLabels];
  for (const name of ['中国', '日本', '上海', '浙江', '台湾']) {
    const index = basemap.AMAP_OVERVIEW_LABELS.findIndex(label => label.name === name);
    assert.ok(index >= 0);
    assert.match(labels[index].content, new RegExp(`>${name}</span>`));
    assert.deepEqual(labels[index].position, wgs84ToGcj02(basemap.AMAP_OVERVIEW_LABELS[index].position));
    assert.equal(labels[index].map, adapter.native);
    assert.equal(JSON.stringify(labels[index].zooms), '[3,4]', 'detailed zooms use raster labels without duplicates');
    assert.equal(labels[index].clickable, false, 'reference text must not intercept storm interactions');
  }
  assert.equal(adapter.standardLayer.tileUrl, basemap.AMAP_LABELED_TILE_URL);
  assert.equal(adapter.standardLayer.zIndex, 1);
  assert.equal(adapter.standardLayer.map, adapter.native, 'raster is available before vector loading completes');
  const bounds = { isEmpty: () => false, getSouthWest: () => [116.397, 39.908], getNorthEast: () => [116.5, 40] };
  adapter.fitBounds(bounds, { padding: { top: 92, right: 408, bottom: 76, left: 70 }, maxZoom: 7 });
  assert.equal(adapter.native.boundsArgs[1], true);
  assert.equal(JSON.stringify(adapter.native.boundsArgs[2]), JSON.stringify([92, 76, 70, 408]));
  assert.equal(adapter.native.getZoom(), 7);
  assert.notDeepEqual(adapter.native.boundsArgs[0].southWest, [116.397, 39.908]);

  adapter.addSource('track', { type: 'geojson', data: { type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[116.397, 39.908], [116.5, 40]] }
  }] } });
  adapter.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#fff' } });
  assert.deepEqual(overlays.at(-1).path[0], wgs84ToGcj02(116.397, 39.908));
  assert.equal(overlays.at(-1).map, adapter.native);
  assert.deepEqual(adapter.toAmap([138.5, 24.8]), [138.5, 24.8]);
  assert.deepEqual(adapter.toAmap({ lng: 138.5, lat: 24.8 }), [138.5, 24.8]);
  assert.throws(() => adapter.toAmap([[138.5, 24.8], [139, 25]]), /Invalid map coordinate/);

  const ring = [[138.5, 24.8], [139, 25], [140, 24], [138.5, 24.8]];
  const hole = [[138.8, 24.7], [139, 24.8], [139.1, 24.6], [138.8, 24.7]];
  const polygon = { type: 'Feature', properties: { level: 7 }, geometry: { type: 'Polygon', coordinates: [ring, hole] } };
  const multi = { ...polygon, geometry: { type: 'MultiPolygon', coordinates: [[ring, hole], [ring]] } };
  adapter.addSource('cone', { type: 'geojson', data: polygon });
  adapter.addLayer({ id: 'cone-fill', type: 'fill', source: 'cone', paint: { 'fill-color': '#5bb6df', 'fill-opacity': .16 } }, 'track');
  adapter.addLayer({ id: 'cone-line', type: 'line', source: 'cone' });
  assert.equal(adapter.layers[0].id, 'cone-fill');
  assert.equal(JSON.stringify(adapter.getLayer('cone-fill').overlays[0].path), JSON.stringify([ring, hole]));
  assert.equal(adapter.getLayer('cone-fill').overlays[0].fillOpacity, .16);
  assert.equal(adapter.getLayer('cone-line').overlays.length, 2, 'each polygon ring becomes a line');
  assert.equal(JSON.stringify(adapter.getLayer('cone-line').overlays[0].path), JSON.stringify(ring));
  const oldLines = [...adapter.getLayer('cone-line').overlays];
  adapter.setLayoutProperty('cone-line', 'visibility', 'none');
  adapter.getSource('cone').setData(multi);
  assert.ok(oldLines.every(overlay => overlay.map === null), 'source updates detach old overlays');
  assert.equal(adapter.getLayer('cone-line').overlays.length, 3);
  assert.ok(adapter.getLayer('cone-line').overlays.every(overlay => !overlay.map), 'setData preserves hidden layers');
  adapter.setPaintProperty('cone-line', 'line-color', '#ff0000');
  assert.ok(adapter.getLayer('cone-line').overlays.every(overlay => !overlay.map));
  adapter.setLayoutProperty('cone-line', 'visibility', 'visible');
  assert.ok(adapter.getLayer('cone-line').overlays.every(overlay => overlay.map === adapter.native));
  adapter.getSource('cone').setData({ type: 'FeatureCollection', features: [] });
  assert.equal(adapter.getLayer('cone-line').overlays.length, 0);

  adapter.addSource('dots', { type: 'geojson', data: { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { color: '#f472b6', kind: 'current' }, geometry: { type: 'Point', coordinates: ring[0] } },
    { type: 'Feature', properties: { color: '#fb923c' }, geometry: { type: 'MultiPoint', coordinates: ring.slice(1, 3) } }
  ] } });
  adapter.addLayer({ id: 'dots', type: 'circle', source: 'dots', layout: { visibility: 'none' }, paint: {
    'circle-color': ['get', 'color'], 'circle-radius': 4,
    'circle-opacity': ['case', ['==', ['get', 'kind'], 'current'], 0, .9],
    'circle-stroke-width': 1.2, 'circle-stroke-color': '#fff'
  } });
  const dots = adapter.getLayer('dots').overlays;
  assert.equal(dots.length, 3);
  assert.equal(dots[0].fillOpacity, 0);
  assert.equal(dots[1].fillColor, '#fb923c');
  assert.equal(dots[1].radius, 4);
  assert.equal(dots[1].strokeWeight, 1.2);
  assert.ok(dots.every(overlay => !overlay.map), 'initial visibility is respected');

  const element = { style: { position: 'absolute' } };
  const marker = new AmapMarker({ element }).setLngLat(ring[0]).addTo(adapter);
  assert.equal(marker.native.map, adapter.native);
  assert.equal(marker.native.content, element);
  assert.equal(element.style.position, 'relative');
  assert.deepEqual(marker.native.position, ring[0]);
  marker.setLngLat(ring[1]);
  assert.deepEqual(marker.native.position, ring[1]);
  const removedMarker = marker.native;
  marker.remove();
  assert.equal(removedMarker.map, null);

  // Exercise real storm hydration, including the native label path (no MapLibre sprites).
  state.map = adapter;
  state.detail = { tracks: { observed: [{ position: { lon: 138.5, lat: 24.8 }, kind: 'current' }], forecasts: [] },
    eventGeometry: { features: [{ ...polygon, properties: { featureType: 'forecast_cone' } }] } };
  state.windCirclePoint = { position: { lon: 138.5, lat: 24.8 }, windCircles: [{ level: 7, minRadiusKm: 220, maxRadiusKm: 360,
    quadrants: { northeast: 360, southeast: 220, southwest: 220, northwest: 360 } }] };
  addTrackLayers();
  assert.equal(adapter.getLayer('forecast-cone-fill').overlays.length, 1);
  assert.equal(adapter.getLayer('forecast-cone-line').overlays.length, 2);
  assert.equal(adapter.getLayer('wind-circle-7-fill').overlays.length, 1);
  assert.equal(adapter.getLayer('wind-circle-10-fill').overlays.length, 0, 'wind filters select their level');
  assert.ok(adapter.getLayer('wind-circle-7-line').overlays[0].path.every(([lon, lat]) => lon > 130 && lon < 145 && lat > 20 && lat < 30));
  assert.equal(adapter.getLayer('wind-circle-label-symbols').overlays[0].map, adapter.native);
  assert.equal(adapter.getLayer('points-observed').overlays[0].fillOpacity, 0);

  adapter.syncBasemap('dark', 'standard');
  assert.equal(container.classList.contains('amap-theme-dark'), true);
  adapter.syncBasemap('light', 'standard');
  assert.equal(container.classList.contains('amap-theme-dark'), false);
  assert.equal(container.classList.contains('amap-reference-light'), true);
  adapter.syncBasemap('dark', 'standard');
  assert.equal(container.classList.contains('amap-theme-dark'), true);
  adapter.setSatellite(true);
  assert.equal(container.classList.contains('amap-theme-dark'), false);
  assert.equal(adapter.standardLayer.hidden, true);
  assert.equal(adapter.satelliteLayer.tileUrl, basemap.AMAP_SATELLITE_TILE_URL);
  assert.equal(adapter.roadLayer.createTile, basemap.createAmapLabelTile);
  assert.equal(adapter.satelliteLayer.map, adapter.native);
  assert.equal(adapter.roadLayer.map, adapter.native);
  assert.ok(adapter.roadLayer.zIndex > adapter.satelliteLayer.zIndex);
  assert.equal(adapter.native.layers.includes(adapter.native.defaultLayer), false);
  adapter.setSatellite(false);
  assert.equal(container.classList.contains('amap-theme-dark'), true);
  assert.equal(adapter.standardLayer.hidden, false);
  assert.equal(adapter.satelliteLayer.map, null);
  assert.equal(adapter.roadLayer.map, null);
  assert.ok(adapter.native.layers.includes(adapter.standardLayer));
  assert.equal(adapter.native.layers.includes(adapter.native.defaultLayer), false);
  assert.equal(adapter.getLayer('track').overlays[0].map, adapter.native, 'mode switches preserve storm overlays');
  adapter.syncBasemap('light', 'satellite');
  assert.equal(container.classList.contains('amap-reference-light'), false, 'satellite labels retain a dark halo in either theme');
  assert.deepEqual(adapter.placeLabels, labels, 'theme and basemap switches reuse reference markers');
  adapter.remove();
  assert.ok(labels.every(label => label.map === null), 'removing a map detaches its reference labels');
});

test('AMap dark raster filter composites the base layer and overlaps tile edges without filtering overlays', async () => {
  const css = await readFile(new URL('../typhoon.css', import.meta.url), 'utf8');
  assert.match(css, /#typhoonMap\.amap-theme-dark \.amap-layer:has\(img\[src\*="webrd"\]\[src\*="style=8"\]\)\s*\{\s*filter:/);
  assert.doesNotMatch(css, /img\[src\*="appmaptile"\]\[src\*="style=8"\]\s*\{[^}]*filter:/);
  assert.match(css, /img\[src\*="webrd"\]\[src\*="style=8"\]\s*\{[^}]*scale: 1\.004;/);
  assert.match(css, /filter:\s*invert\(1\) hue-rotate\(180deg\) brightness\(\.85\) contrast\(\.9\) saturate\(\.6\)/);
  assert.doesNotMatch(css, /#typhoonMap\.amap-theme-dark[^{}]*\.amap-(?:markers|overlays|canvas)/);
  assert.doesNotMatch(css, /[^{}]*\.amap-(?:labels|markers|overlays|canvas)[^{}]*\{[^}]*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0(?:\s|;))/);
  for (const selector of ['.amap-overlay-canvas-container', '.amap-overlay-canvas-container canvas']) {
    const rule = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    assert.match(rule, /background:\s*transparent/);
    assert.match(rule, /pointer-events:\s*none/);
  }
});

test('AMap WebGL uses dark raster textures only in standard dark mode and reuses them across switches', () => {
  class NativeMap {
    constructor(container, options) { this.layers = new Set(options.layers); }
    on() {}
    add(items) { for (const item of Array.isArray(items) ? items : [items]) this.layers.add(item); }
    remove(items) { for (const item of items) this.layers.delete(item); }
    setMapStyle() {}
    setLayers() { assert.fail('explicit rasters must survive'); }
  }
  const { AmapMapAdapter } = harness({ document: { getElementById: () => ({ querySelector: selector => selector === 'canvas.amap-layer' ? {} : null }) } });
  const adapter = new AmapMapAdapter({ Map: NativeMap, Marker: FakeAmapPlaceMarker, TileLayer: FakeAmapTileLayer }, { container: 'map', center: [134, 33], zoom: 5 });
  adapter.syncBasemap('light', 'standard');
  assert.equal(adapter.darkStandardLayer, undefined);
  adapter.syncBasemap('dark', 'standard');
  const darkLayer = adapter.darkStandardLayer;
  assert.equal(darkLayer.createTile, basemap.createAmapDarkTile);
  assert.equal(darkLayer.visible, true);
  assert.equal(adapter.standardLayer.visible, false);
  adapter.syncBasemap('dark', 'satellite');
  assert.equal(darkLayer.visible, false);
  assert.equal(adapter.standardLayer.visible, false);
  assert.ok(adapter.native.layers.has(adapter.roadLayer));
  adapter.syncBasemap('light', 'standard');
  assert.equal(darkLayer.visible, false);
  assert.equal(adapter.standardLayer.visible, true);
  assert.equal(adapter.native.layers.has(adapter.roadLayer), false);
  adapter.syncBasemap('dark', 'standard');
  assert.equal(adapter.darkStandardLayer, darkLayer);
  assert.equal(darkLayer.visible, true);
  assert.equal(adapter.native.layers.size, 2, 'only light and dark rasters are retained without duplication');
  assert.ok(adapter.native.layers.has(adapter.standardLayer));
});

test('AMap raster completion starts overlays despite unrelated SDK failures, while auth errors still reject', async () => {
  class NativeMap {
    constructor() { this.events = new Map(); }
    on(name, callback) { this.events.set(name, callback); }
    fire(name, event) { this.events.get(name)?.(event); }
  }
  const { AmapMapAdapter } = harness();
  const AMap = { Map: NativeMap, Marker: FakeAmapPlaceMarker, TileLayer: FakeAmapTileLayer };
  const options = { container: 'typhoonMap', center: [138, 25], zoom: 5 };
  const adapter = new AmapMapAdapter(AMap, options);
  let loads = 0;
  adapter.on('load', () => loads++);
  adapter.native.fire('error', new Error('unused vector style CORS failure'));
  adapter.standardLayer.fire('complete');
  await adapter.ready;
  adapter.native.fire('complete');
  assert.equal(loads, 1, 'native and raster completion must hydrate overlays only once');
  assert.equal(adapter.complete, true);
  const denied = new AmapMapAdapter(AMap, options);
  denied.native.fire('error', new Error('INVALID_USER_DOMAIN'));
  await assert.rejects(denied.ready, /INVALID_USER_DOMAIN/);
});

test('AMap adapter observes container size, debounces resize in RAF and keeps native state idempotent', () => {
  let observeCallback;
  let observedContainer;
  let resizeCalls = 0;
  let styleCalls = 0;
  let layerCalls = 0;
  const frames = [];
  class FakeResizeObserver {
    constructor(callback) { observeCallback = callback; }
    observe(container) { observedContainer = container; }
    disconnect() {}
  }
  class FakeNativeMap {
    constructor(container, options) { this.container = container; this.options = options; this.layers = new Set(options.layers); }
    on() {}
    resize() { resizeCalls++; }
    setMapStyle(style) { styleCalls++; this.mapStyle = style; }
    setLayers() { assert.fail('setLayers would discard explicit rasters'); }
    add(items) { layerCalls++; for (const item of Array.isArray(items) ? items : [items]) this.layers.add(item); }
    remove(items) { layerCalls++; for (const item of items) this.layers.delete(item); }
  }
  const AMap = {
    Map: FakeNativeMap,
    Marker: FakeAmapPlaceMarker, TileLayer: FakeAmapTileLayer
  };
  const container = { append() {}, dataset: {} };
  const { AmapMapAdapter } = harness({
    document: { getElementById: () => container },
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; }
  });
  const adapter = new AmapMapAdapter(AMap, { container: 'typhoonMap', center: [125, 22], zoom: 4, mapStyle: amapStyleForTheme('dark') });
  assert.equal(observedContainer, container);

  observeCallback();
  observeCallback();
  assert.equal(frames.length, 1, 'ResizeObserver callbacks share one pending animation frame');
  frames.shift()();
  assert.equal(resizeCalls, 1);
  adapter.syncBasemap('light', 'satellite');
  adapter.syncBasemap('light', 'satellite');
  assert.equal(styleCalls, 0, 'raster theme changes never request vector styles');
  assert.equal(adapter.theme, 'light');
  assert.equal(layerCalls, 1, 'the constructor supplies the raster; satellite is added once');
  adapter.syncBasemap('dark', 'standard');
  assert.equal(styleCalls, 0);
  assert.equal(adapter.theme, 'dark');
  assert.equal(layerCalls, 2);
  adapter.syncBasemap('dark', 'standard');
  assert.equal(styleCalls, 0);
  assert.equal(layerCalls, 2);
  adapter.syncBasemap('dark', 'satellite');
  adapter.syncBasemap('dark', 'standard');
  assert.equal(styleCalls, 0, 'mode changes do not reset the native map style');
  assert.equal(layerCalls, 4);
  assert.equal(adapter.native.layers.size, 1, 'repeated switches leave only the added standard raster');

  adapter.scheduleResizeAfterLayout();
  while (frames.length) frames.shift()();
  assert.equal(resizeCalls, 4, 'complete and layout settling each reach native resize');
  adapter.remove();
});

test('AMap moveend, zoomend, complete and resize never clamp longitude or raise the fixed minimum zoom', async () => {
  class NativeMap {
    constructor(container, options) { this.options = options; this.center = options.center; this.zoom = options.zoom; this.events = new Map(); this.cameraWrites = 0; }
    on(name, callback) { this.events.set(name, callback); }
    fire(name) { this.events.get(name)?.(); }
    getSize() { return { width: 4096, height: 900 }; }
    getZoom() { return this.zoom; }
    getCenter() { return { lng: this.center[0], lat: this.center[1] }; }
    setZoom(zoom) { this.cameraWrites++; this.zoom = zoom; }
    setCenter(center) { this.cameraWrites++; this.center = center; }
    resize() {}
    add() {}
  }
  const { AmapMapAdapter } = harness({ document: { getElementById: () => ({ width: 4096, height: 900 }) } });
  const adapter = new AmapMapAdapter({ Map: NativeMap, Marker: FakeAmapPlaceMarker, TileLayer: FakeAmapTileLayer }, { container: 'map', center: [165.7, 22], zoom: 3 });
  assert.equal(JSON.stringify(adapter.native.options.zooms), '[3,18]');
  assert.equal(adapter.native.zoom, 3, 'minimum zoom is independent of viewport width');
  for (const option of ['dragEnable', 'zoomEnable', 'scrollWheel', 'touchZoom', 'doubleClickZoom']) assert.equal(adapter.native.options[option], true);
  assert.equal(adapter.native.events.has('moveend'), false);
  assert.equal(adapter.native.events.has('zoomend'), false);
  for (const longitude of [165.7, -165.7, 190, -190]) {
    adapter.native.center = [longitude, 22];
    for (const event of ['moveend', 'zoomend', 'complete']) adapter.native.fire(event);
    adapter.resize();
    assert.deepEqual(adapter.native.center, [longitude, 22]);
    assert.equal(adapter.native.zoom, 3);
  }
  await adapter.ready;
  assert.equal(adapter.native.cameraWrites, 0);
});

test('AMap startup replays theme and satellite choices made before complete', async () => {
  let nativeMap;
  class FakeNativeMap {
    constructor(container, options) { nativeMap = this; this.events = []; this.layers = [...options.layers]; }
    on(name, callback) { this.events.push([name, callback]); }
    fire(name) { this.events.filter(([event]) => event === name).forEach(([, callback]) => callback()); }
    setMapStyle(style) { this.mapStyle = style; }
    setLayers() { assert.fail('must preserve explicit rasters during startup'); }
    add(items) { this.layers.push(...(Array.isArray(items) ? items : [items])); }
    remove(items) { this.layers = this.layers.filter(layer => !items.includes(layer)); }
    resize() {}
  }
  const AMap = {
    Map: FakeNativeMap,
    Marker: FakeAmapPlaceMarker, TileLayer: FakeAmapTileLayer
  };
  const { state, initializeAmapMap, setBasemap, syncTheme } = harness({
    fetch: async () => ({ ok: true, json: async () => ({ key: 'public-key' }) }),
    loadAmapScript: async () => AMap,
    location: { origin: 'https://example.test' }
  });
  const startup = initializeAmapMap();
  await flush();
  syncTheme('light');
  setBasemap('satellite');
  nativeMap.fire('complete');
  await startup;
  assert.equal(state.map.theme, 'light');
  assert.equal(nativeMap.layers.length, 3);
  assert.equal(nativeMap.layers[0].visible, false);
  assert.equal(nativeMap.layers[1].tileUrl, basemap.AMAP_SATELLITE_TILE_URL);
  assert.equal(nativeMap.layers[2].createTile, basemap.createAmapLabelTile);
  assert.equal(state.basemap, 'satellite');
  assert.equal(state.theme, 'light');
  syncTheme('dark');
  assert.equal(state.map.theme, 'dark');
  setBasemap('standard');
  assert.equal(state.map.theme, 'dark');
  assert.equal(nativeMap.layers.length, 1);
  assert.equal(nativeMap.layers[0].visible, true);
});

function projectedAmap() {
  const project = ([lon, lat]) => [lon / 360, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)];
  const unproject = ([x, y]) => [x * 360, (2 * Math.atan(Math.exp(-y * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI];
  class NativeMap {
    constructor(container, options) { this.center = options.center; this.zoom = options.zoom; this.size = container; this.calls = []; }
    on() {}
    add() {}
    getSize() { return this.size; }
    getZoom() { return this.zoom; }
    setZoom(zoom) { this.zoom = Math.ceil(zoom); }
    setCenter(center) { this.center = center; }
    getCenter() { return [...this.center]; }
    setZoomAndCenter(zoom, center, immediately, duration) {
      this.calls.push({ zoom, center, immediately, duration });
      this.setZoom(zoom);
      this.setCenter(center);
    }
    setBounds() { this.setZoom(5.2); }
    lngLatToContainer(position) {
      const [x, y] = project(position), [cx, cy] = project(this.center), scale = 256 * 2 ** this.zoom;
      return { x: this.size.width / 2 + (x - cx) * scale, y: this.size.height / 2 + (y - cy) * scale };
    }
    containerToLngLat({ x, y }) {
      const [cx, cy] = project(this.center), scale = 256 * 2 ** this.zoom;
      return unproject([cx + (x - this.size.width / 2) / scale, cy + (y - this.size.height / 2) / scale]);
    }
  }
  return { Map: NativeMap, Marker: FakeAmapPlaceMarker, TileLayer: FakeAmapTileLayer, Bounds: class {}, Pixel: class { constructor(x, y) { this.x = x; this.y = y; } } };
}

test('AMap raster zoom rounding still fits the bounds inside asymmetric padding', () => {
  const AMap = projectedAmap();
  for (const [width, height, padding] of [[1440, 900, { top: 142, bottom: 76, left: 70, right: 408 }], [390, 844, { top: 130, bottom: 320, left: 38, right: 72 }]]) {
    const { AmapMapAdapter } = harness({ document: { getElementById: () => ({ width, height }) } });
    const adapter = new AmapMapAdapter(AMap, { container: 'map', center: [138.5, 24.8], zoom: 5 });
    const corners = [[138.5, 10.2], [166.7, 48.6]];
    adapter.fitBounds({ getSouthWest: () => corners[0], getNorthEast: () => corners[1] }, { padding, maxZoom: 7 });
    const pixels = corners.map(point => adapter.project(point));
    for (const { x, y } of pixels) {
      assert.ok(x >= padding.left - .001 && x <= width - padding.right + .001);
      assert.ok(y >= padding.top - .001 && y <= height - padding.bottom + .001);
    }
    assert.ok(Math.abs((pixels[0].x + pixels[1].x) / 2 - (width + padding.left - padding.right) / 2) < .001);
    assert.ok(Math.abs((pixels[0].y + pixels[1].y) / 2 - (height + padding.top - padding.bottom) / 2) < .001);
  }
});

test('AMap flyTo and easeTo put the target at the padded center at the committed zoom', () => {
  for (const [width, height, padding] of [
    [1440, 900, { top: 142, bottom: 76, left: 70, right: 408 }],
    [390, 844, { top: 150, bottom: 320, left: 38, right: 72 }],
    [1440, 900, 40],
    [390, 844, { left: 60, top: 100 }],
    [1440, 900, undefined]
  ]) for (const center of [[138.5, 25], [116.397, 39.908], [179, 25], [-179, 25]]) {
    const { AmapMapAdapter } = harness({ document: { getElementById: () => ({ width, height }) } });
    const adapter = new AmapMapAdapter(projectedAmap(), { container: 'map', center: [125, 20], zoom: 3 });
    const { dx, dy } = amapPaddingOffset(padding);
    for (const duration of [0, 650]) {
      adapter.flyTo({ center, zoom: 5.4, padding, duration });
      const assertTarget = () => {
        const pixel = adapter.project(center);
        assert.ok(Math.abs(pixel.x - (width / 2 + dx)) < 1e-6, `target x: ${pixel.x}`);
        assert.ok(Math.abs(pixel.y - (height / 2 + dy)) < 1e-6, `target y: ${pixel.y}`);
      };
      assertTarget();
      if (duration > 0) {
        assert.equal(adapter.native.calls.at(-1).immediately, false);
        assert.equal(adapter.native.calls.at(-1).duration, duration);
      }
      // A second flight must not accumulate padding or GCJ-02 conversion drift.
      adapter.easeTo({ center: { lng: center[0], lat: center[1] }, padding, duration });
      assertTarget();
      adapter.flyTo({ center, zoom: 3 });
      const pixel = adapter.project(center);
      assert.ok(Math.abs(pixel.x - width / 2) < 1e-6);
      assert.ok(Math.abs(pixel.y - height / 2) < 1e-6);
      assert.equal(adapter.getZoom(), 3);
    }
  }
});

test('initial hydration and storm switches focus the current storm, not distant history or cones', async () => {
  const { state, hydrateMapStyle, rebuildStormLayers, refreshMapForStorm } = harness();
  state.map = new FakeMap({ style: createFallbackStyle() });
  state.styleReady = true;
  state.detail = {
    storm: { position: { lon: 138.5, lat: 25 } },
    tracks: { observed: [{ position: { lon: 165, lat: 10 } }], forecasts: [] },
    mapConfig: { weatherLayers: [] }
  };
  state.map.fitBounds = () => assert.fail('startup must not fit the whole track');
  await hydrateMapStyle();
  const flight = state.map.flights[0];
  assert.equal(JSON.stringify(flight.center), '[138.5,25]');
  assert.equal(flight.zoom, 5);
  assert.equal(flight.duration, 0);
  assert.equal(flight.retainPadding, false);
  assert.ok(flight.padding);
  assert.equal(state.needsTrackFit, false);
  state.map.reset(createFallbackStyle());
  await hydrateMapStyle();
  assert.equal(state.map.flights.length, 1, 'ordinary style hydration preserves the user camera');
  state.detail.storm.position = { lon: 140, lat: 26 };
  await rebuildStormLayers();
  assert.equal(JSON.stringify(state.map.flights.at(-1).center), '[140,26]');
  state.styleReady = false;
  state.detail.storm.position = { lon: 142, lat: 27 };
  refreshMapForStorm();
  assert.equal(JSON.stringify(state.map.flights.at(-1).center), '[142,27]');
  assert.equal(state.map.flights.at(-1).zoom, 5);
  state.styleReady = true;
  state.map.reset(createFallbackStyle());
  await hydrateMapStyle();
  assert.equal(JSON.stringify(state.map.flights.at(-1).center), '[142,27]');
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
    const { mapPadding, AmapMapAdapter } = harness({ document: {
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
    const adapter = new AmapMapAdapter(projectedAmap(), { container: 'typhoonMap', center: [138.5, 25], zoom: 5 });
    adapter.native.size = mapRect;
    adapter.flyTo({ center: [138.5, 25], zoom: 5.4, padding });
    const { x, y } = adapter.project([138.5, 25]);
    assert.ok(Math.abs(x - (padding.left + mapRect.width - padding.right) / 2) < 1e-6);
    assert.ok(Math.abs(y - (padding.top + mapRect.height - padding.bottom) / 2) < 1e-6);
    if (mobile) {
      assert.ok(y < rectangles.trackPlayback.top);
      rectangles.nodeCard = rect(8, 520, 374, 316);
      assert.ok(mapPadding().bottom >= mapRect.bottom - rectangles.nodeCard.top + 12);
    } else assert.ok(x < rectangles.insightPanel.left);
  }
});

test('the opening phone view includes geographic context with the storm at the unobscured center', async () => {
  const { state, document, hydrateMapStyle, mapPadding } = harness();
  document.querySelector = () => null;
  document.getElementById('typhoonMap').getBoundingClientRect = () => ({ width: 390, height: 664, left: 0, top: 0, right: 390, bottom: 664 });
  document.getElementById('insightPanel').getBoundingClientRect = () => ({ width: 374, height: 196, left: 8, top: 460, right: 382, bottom: 656 });
  document.getElementById('trackPlayback').getBoundingClientRect = () => ({ width: 374, height: 64, left: 8, top: 383, right: 382, bottom: 447 });
  state.map = new FakeMap({ style: createFallbackStyle() });
  state.styleReady = true;
  state.detail = { storm: { position: { lon: 138.5, lat: 25.7 } }, tracks: { observed: [], forecasts: [] }, mapConfig: { weatherLayers: [] } };
  const padding = mapPadding();
  await hydrateMapStyle();
  const flight = state.map.flights[0];
  assert.equal(flight.zoom, 3);
  assert.equal(JSON.stringify(flight.center), '[138.5,25.7]');
  const y = (flight.padding.top + 664 - flight.padding.bottom) / 2;
  assert.equal(y, (padding.top + 664 - padding.bottom) / 2, 'keep the storm centered without a northward camera bias');
  assert.ok(y + 55 < 383, 'the opening wind circle remains above playback');
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
    fetch: url => String(url) === '/api/amap-config'
      ? Promise.resolve({ ok: true, json: async () => ({ key: null }) })
      : new Promise(resolve => requests.push({ url, resolve }))
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
