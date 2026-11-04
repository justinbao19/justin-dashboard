import {
  buildGibsDomainUrl,
  buildGibsWmtsUrl,
  chooseLatestAvailableTime,
  chooseSynchronizedFrame
} from '/typhoon-layer-clock.mjs';
import { createFieldRenderer } from '/typhoon-field-renderer.mjs';
import { AMAP_TIMEOUT_MS, BASEMAP_ATTRIBUTION, ESRI_ATTRIBUTION, BASEMAP_PALETTES, BASEMAP_TIMEOUT_MS, OPENFREEMAP_STYLES, AMAP_LABELED_TILE_URL, AMAP_SATELLITE_TILE_URL, AMAP_OVERVIEW_LABELS, createAmapDarkTile, createAmapLabelTile, amapPaddingOffset, normalizeMapPadding, createBasemapStyle, createFallbackStyle, createBasemapFailureMonitor, isAmapAuthError, loadAmapScript, loadMapLibre, nextBasemapProvider, parseAmapConfig, wgs84ToGcj02 } from '/typhoon-basemap.mjs';
import { createOutlineProjection } from '/typhoon-land.mjs';

(() => {
  const CACHE_MS = 5 * 60 * 1000;
  const LAYER_CACHE_MS = 10 * 60 * 1000;
  const LOCATION_CACHE_MS = 24 * 60 * 60 * 1000;
  const PLAYBACK_HISTORY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
  const state = {
    map: null,
    detail: null,
    stormId: null,
    stormsSummary: [],
    otherStormTracks: [],
    stormLoadToken: 0,
    theme: 'dark',
    basemap: 'standard',
    activeWeather: new Set(['radar']),
    activeSources: new Set(['observed']),
    selectedAgencyId: null,
    windCirclePoint: null,
    weatherOpacity: .58,
    markers: [],
    otherStormMarkers: [],
    userLocation: null,
    userLocationPromise: null,
    userLocationMarker: null,
    currentMarker: null,
    playbackPoints: [],
    playbackIndex: 0,
    playbackCurrentIndex: 0,
    playbackStartAt: 0,
    playbackEndAt: 0,
    playbackCurrentAt: 0,
    playbackCursorAt: 0,
    playbackAnimationStartedAt: 0,
    playbackAnimationFromAt: 0,
    playbackAnimationDuration: 0,
    playbackLastPanAt: 0,
    playbackTimer: null,
    playbackPlaying: false,
    playbackActive: false,
    pointsByKey: new Map(),
    layerClock: null,
    fieldData: null,
    fieldLoading: null,
    fieldRenderer: null,
    styleGeneration: 0,
    styleReady: false,
    basemapProvider: 'amap',
    basemapRequest: 0,
    basemapGeneration: 0,
    basemapTimer: null,
    basemapSourceIds: [],
    basemapLoadedSources: new Set(),
    basemapFailureMonitor: createBasemapFailureMonitor([]),
    vectorStyles: new Map(),
    rendererLoading: false,
    rendererUnavailable: false,
    needsTrackFit: true,
    boundLayerIds: new Set(),
    controlsInitialized: false
  };

  function amapStyleValue(value, properties, fallback) {
    if (!Array.isArray(value)) return value ?? fallback;
    const evaluate = expression => amapStyleValue(expression, properties, undefined);
    if (value[0] === 'get') return properties[value[1]] ?? fallback;
    if (value[0] === '==') return evaluate(value[1]) === evaluate(value[2]);
    if (value[0] === 'coalesce') return value.slice(1).map(evaluate).find(item => item != null) ?? fallback;
    if (value[0] === 'case') {
      for (let index = 1; index < value.length - 1; index += 2) if (evaluate(value[index])) return evaluate(value[index + 1]);
      return evaluate(value.at(-1)) ?? fallback;
    }
    return fallback;
  }

  function amapFeatureCoordinates(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return [];
    const positions = [];
    const collect = coordinates => {
      if (!Array.isArray(coordinates)) return;
      if (coordinates.length >= 2 && coordinates.slice(0, 2).every(value => Number.isFinite(Number(value)))) {
        positions.push([Number(coordinates[0]), Number(coordinates[1])]);
        return;
      }
      coordinates.forEach(collect);
    };
    collect(geometry.coordinates);
    return positions;
  }

  class AmapMarker {
    constructor(options = {}) { this.options = options; this.element = options.element; this.position = null; this.native = null; }
    setLngLat(position) { this.position = position; if (this.native) this.native.setPosition(this.adapter.toAmap(position)); return this; }
    addTo(map) {
      this.remove();
      this.adapter = map;
      // AMap positions a wrapper; the content must contribute its size so
      // anchor: 'center' centers the 48px storm/location button correctly.
      if (this.element) this.element.style.position = 'relative';
      this.native = new map.AMap.Marker({ map: map.native, position: map.toAmap(this.position), content: this.element, anchor: this.options.anchor || 'center', clickable: true, zIndex: 200 });
      map.native.add(this.native);
      return this;
    }
    remove() { this.native?.setMap(null); this.native = null; }
    getElement() { return this.element; }
  }

  class AmapMapAdapter {
    constructor(AMap, options) {
      this.AMap = AMap;
      this.isAmap = true;
      this.container = document.getElementById(options.container);
      this.standardLayer = new AMap.TileLayer({ tileUrl: AMAP_LABELED_TILE_URL, tileSize: 256, zooms: [3, 18], zIndex: 1, opacity: 1 });
      this.native = new AMap.Map(this.container, {
        viewMode: '2D',
        lang: 'zh_cn',
        layers: [this.standardLayer],
        features: [],
        showLabel: false,
        showIndoorMap: false,
        buildingAnimation: false,
        center: this.toAmap(options.center),
        zoom: Math.max(Number(options.zoom) || 3, 3),
        zooms: [3, 18],
        dragEnable: true,
        zoomEnable: true,
        scrollWheel: true,
        touchZoom: true,
        doubleClickZoom: true
      });
      this.placeLabels = AMAP_OVERVIEW_LABELS.map(({ name, position, kind }) => new AMap.Marker({
        map: this.native,
        position: this.toAmap(position),
        content: `<span class="typhoon-place-label typhoon-place-label--${kind}">${name}</span>`,
        anchor: 'center', zooms: [3, 4], zIndex: 5, clickable: false, bubble: true
      }));
      this.sources = {};
      this.layers = [];
      this.listeners = new Map();
      this.layerOverlays = new Map();
      this.canvasContainer = null;
      this.satelliteEnabled = false;
      this.theme = null;
      this.resizePending = false;
      this.resizeObserver = null;
      const ResizeObserverCtor = globalThis.ResizeObserver;
      if (typeof ResizeObserverCtor === 'function' && this.container) {
        this.resizeObserver = new ResizeObserverCtor(() => this.scheduleResize());
        this.resizeObserver.observe(this.container);
      }
      this.touchZoomRotate = { disableRotation() {} };
      this.ready = new Promise((resolve, reject) => {
        const complete = event => {
          if (this.complete) return;
          this.complete = true;
          this.scheduleResizeAfterLayout();
          this.emit('load', event);
          resolve(event);
        };
        this.native.on?.('complete', complete);
        // Raster completion is sufficient to start storm overlays without
        // waiting for unrelated SDK services.
        this.standardLayer.on?.('complete', complete);
        this.native.on?.('error', error => {
          if (isAmapAuthError(error)) reject(error);
        });
      });
    }
    toAmap(position) {
      // GeoJSON and AMap both use longitude first. Convert only at the SDK boundary.
      const [lon, lat] = Array.isArray(position) ? position : [position?.lon ?? position?.lng ?? position?.getLng?.(), position?.lat ?? position?.getLat?.()];
      if (![lon, lat].every(value => value != null && value !== '' && !Array.isArray(value) && Number.isFinite(Number(value)))) throw new TypeError('Invalid map coordinate');
      return wgs84ToGcj02(Number(lon), Number(lat));
    }
    fromAmap(position) { return [Number(position?.lng ?? position?.[0]), Number(position?.lat ?? position?.[1])]; }
    on(name, layerOrHandler, maybeHandler) {
      const layerId = typeof layerOrHandler === 'string' ? layerOrHandler : null;
      const handler = layerId ? maybeHandler : layerOrHandler;
      const entries = this.listeners.get(name) || [];
      entries.push({ layerId, handler });
      this.listeners.set(name, entries);
      return this;
    }
    off(name, layerOrHandler, maybeHandler) {
      const layerId = typeof layerOrHandler === 'string' ? layerOrHandler : null;
      const handler = layerId ? maybeHandler : layerOrHandler;
      this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item.layerId !== layerId || item.handler !== handler));
    }
    emit(name, event = {}, layerId = null) {
      for (const item of this.listeners.get(name) || []) if (!item.layerId || item.layerId === layerId) item.handler(event);
    }
    getStyle() { return { version: 8, metadata: this.metadata || {}, sources: this.sources, layers: this.layers }; }
    getSource(id) { return this.sources[id]; }
    getLayer(id) { return this.layers.find(layer => layer.id === id); }
    addSource(id, source) {
      const wrapped = { ...source, setData: data => { wrapped.data = data; this.refreshSource(id); } };
      this.sources[id] = wrapped;
    }
    addLayer(layer, beforeId) {
      if (this.getLayer(layer.id)) return;
      const beforeIndex = this.layers.findIndex(item => item.id === beforeId);
      this.layers.splice(beforeIndex < 0 ? this.layers.length : beforeIndex, 0, { ...layer, overlays: [] });
      this.refreshLayer(layer.id);
      this.layers.forEach((item, index) => item.overlays.forEach(overlay => overlay.setOptions?.({ zIndex: 20 + index })));
    }
    removeLayer(id) {
      const layer = this.getLayer(id);
      layer?.overlays?.forEach(overlay => overlay.setMap?.(null));
      this.layers = this.layers.filter(item => item.id !== id);
      this.layerOverlays.delete(id);
    }
    removeSource(id) { this.layers.filter(layer => layer.source === id).forEach(layer => this.removeLayer(layer.id)); delete this.sources[id]; }
    setLayoutProperty(id, property, value) {
      const layer = this.getLayer(id); if (!layer) return;
      layer.layout = { ...layer.layout, [property]: value };
      if (property === 'visibility') this.syncLayerVisibility(layer);
      else this.refreshLayer(id);
    }
    setPaintProperty(id, property, value) {
      const layer = this.getLayer(id); if (!layer) return;
      layer.paint = { ...layer.paint, [property]: value };
      this.refreshLayer(id);
    }
    addControl() {}
    resize() { this.native?.resize?.(); this.emit('resize'); }
    scheduleResize() {
      if (this.resizePending) return;
      this.resizePending = true;
      const run = () => {
        this.resizePending = false;
        this.resize();
      };
      if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(run);
      else setTimeout(run, 0);
    }
    scheduleResizeAfterLayout() {
      this.scheduleResize();
      const raf = callback => {
        if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(callback);
        else setTimeout(callback, 0);
      };
      raf(() => {
        this.scheduleResize();
        raf(() => this.scheduleResize());
      });
      const fontsReady = document.fonts?.ready;
      if (fontsReady?.then) fontsReady.then(() => this.scheduleResize(), () => {});
    }
    remove() {
      this.resizeObserver?.disconnect?.();
      this.layers.forEach(layer => layer.overlays?.forEach(overlay => overlay.setMap?.(null)));
      this.placeLabels.forEach(label => label.setMap(null));
      this.native?.destroy?.();
    }
    getZoom() { return this.native.getZoom?.() || 3; }
    getBounds() {
      const bounds = this.native.getBounds?.();
      return bounds ? { contains: position => bounds.contains?.(this.toAmap(position)) ?? false } : null;
    }
    flyTo({ center, zoom = this.getZoom(), padding, duration = 0 }) {
      const target = this.toAmap(center);
      const { dx, dy } = amapPaddingOffset(padding);
      const size = this.native.getSize?.();
      if ((!dx && !dy) || !size || !this.native.containerToLngLat) {
        this.native.setZoomAndCenter(zoom, target, duration === 0, duration);
        return;
      }
      const previousCenter = this.native.getCenter?.();
      const previousZoom = this.getZoom();
      // Project only after the target and zoom are committed synchronously.
      // The resulting center is already GCJ-02: never convert it a second time.
      this.native.setZoomAndCenter(zoom, target, true);
      const finalCenter = this.native.containerToLngLat(new this.AMap.Pixel(size.width / 2 - dx, size.height / 2 - dy));
      if (duration > 0 && previousCenter) {
        this.native.setZoomAndCenter(previousZoom, previousCenter, true);
        this.native.setZoomAndCenter(zoom, finalCenter, false, duration);
      } else {
        this.native.setCenter(finalCenter, true);
      }
    }
    easeTo(options) { this.flyTo(options); }
    fitBounds(bounds, options = {}) {
      if (bounds?.isEmpty?.()) return;
      // AMap 2.0 uses [top, bottom, left, right], unlike CSS/MapLibre padding.
      const normalizedPadding = normalizeMapPadding(options.padding);
      const padding = ['top', 'bottom', 'left', 'right'].map(side => normalizedPadding[side]);
      const southWest = this.toAmap(bounds.getSouthWest()), northEast = this.toAmap(bounds.getNorthEast());
      this.native.setBounds?.(
        new this.AMap.Bounds(southWest, northEast),
        true,
        padding
      );
      const maxZoom = Number(options.maxZoom);
      // Raster 2D can round a fractional zoom up on its next render frame.
      // Commit an integer zoom now so the fit remains valid after rendering.
      this.native.setZoom(Math.max(3, Math.floor(Math.min(this.getZoom(), Number.isFinite(maxZoom) ? maxZoom : 18))), true);
      // The SDK's projection may also change when that zoom is committed.
      // Check its actual projected extent, zoom out if needed, then recenter at
      // the middle of the unobscured viewport at that final zoom.
      const size = this.native.getSize?.();
      if (!size || !this.native.lngLatToContainer || !this.native.containerToLngLat) return;
      const [top, bottom, left, right] = padding;
      const width = Math.max(1, size.width - left - right), height = Math.max(1, size.height - top - bottom);
      let sw = this.native.lngLatToContainer(southWest), ne = this.native.lngLatToContainer(northEast);
      const overflow = Math.max(Math.abs(ne.x - sw.x) / width, Math.abs(ne.y - sw.y) / height);
      if (overflow > 1) this.native.setZoom(Math.max(3, Math.floor(this.getZoom() - Math.log2(overflow))), true);
      sw = this.native.lngLatToContainer(southWest);
      ne = this.native.lngLatToContainer(northEast);
      const centerPixel = new this.AMap.Pixel(
        size.width / 2 + (sw.x + ne.x) / 2 - (left + width / 2),
        size.height / 2 + (sw.y + ne.y) / 2 - (top + height / 2)
      );
      this.native.setCenter(this.native.containerToLngLat(centerPixel), true);
    }
    project(position) { const point = this.native.lngLatToContainer?.(this.toAmap(position)); return { x: point?.x || 0, y: point?.y || 0 }; }
    getCanvas() { return this.container; }
    getCanvasContainer() {
      if (!this.canvasContainer) { this.canvasContainer = document.createElement('div'); this.canvasContainer.className = 'amap-overlay-canvas-container'; this.container.append(this.canvasContainer); }
      return this.canvasContainer;
    }
    syncRasterFallbackTheme(theme) {
      const dark = theme === 'dark' && !this.satelliteEnabled;
      this.container?.classList?.toggle('amap-theme-dark', dark);
      // Mobile WebGL shares its canvas with storm overlays, so filter raster
      // textures instead. The DOM renderer uses the layer-scoped CSS filter.
      const darkTexture = dark && this.container?.querySelector?.('canvas.amap-layer');
      if (darkTexture && !this.darkStandardLayer) {
        this.darkStandardLayer = new this.AMap.TileLayer.Flexible({ createTile: createAmapDarkTile, tileSize: 256, zooms: [3, 18], zIndex: 1, opacity: 1 });
        this.native.add(this.darkStandardLayer);
      }
      if (this.darkStandardLayer) {
        if (darkTexture) this.darkStandardLayer.show();
        else this.darkStandardLayer.hide();
      }
      if (darkTexture || this.satelliteEnabled) this.standardLayer.hide();
      else this.standardLayer.show();
    }
    setSatellite(enabled) {
      enabled = Boolean(enabled);
      if (this.satelliteEnabled === enabled) {
        this.syncRasterFallbackTheme(this.theme);
        return;
      }
      this.satelliteEnabled = enabled;
      if (enabled) {
        this.satelliteLayer ||= new this.AMap.TileLayer({ tileUrl: AMAP_SATELLITE_TILE_URL, tileSize: 256, zooms: [3, 18], zIndex: 1, opacity: 1 });
        this.roadLayer ||= new this.AMap.TileLayer.Flexible({ createTile: createAmapLabelTile, tileSize: 256, zooms: [3, 18], zIndex: 2, opacity: 1 });
        this.native.add([this.satelliteLayer, this.roadLayer]);
      } else {
        this.native.remove([this.satelliteLayer, this.roadLayer]);
      }
      this.syncRasterFallbackTheme(this.theme);
    }
    syncBasemap(theme, mode) {
      this.theme = theme;
      this.container?.classList?.toggle('amap-reference-light', theme === 'light' && mode !== 'satellite');
      this.setSatellite(mode === 'satellite');
    }
    refreshSource(sourceId) { this.layers.filter(layer => layer.source === sourceId).forEach(layer => this.refreshLayer(layer.id)); }
    syncLayerVisibility(layer) {
      if (layer.layout?.visibility === 'none') layer.overlays.forEach(overlay => overlay.setMap(null));
      else if (layer.overlays.length) this.native.add(layer.overlays);
    }
    refreshLayer(layerId) {
      const layer = this.getLayer(layerId), source = layer && this.sources[layer.source];
      if (!layer || !source) return;
      layer.overlays?.forEach(overlay => overlay.setMap?.(null));
      layer.overlays = [];
      if (layer.type === 'raster') {
        const tileLayer = new this.AMap.TileLayer({ tileUrl: source.tiles?.[0], opacity: layer.paint?.['raster-opacity'] ?? 1, zIndex: 3 });
        layer.overlays.push(tileLayer);
        this.syncLayerVisibility(layer);
        return;
      }
      const features = source.data?.type === 'FeatureCollection' ? source.data.features : source.data?.type === 'Feature' ? [source.data] : source.data?.type ? [{ type: 'Feature', geometry: source.data }] : [];
      for (const feature of features) {
        if (!this.matchesFilter(layer.filter, feature.properties || {})) continue;
        const overlays = this.createFeatureOverlays(layer, feature);
        overlays.forEach(overlay => {
          overlay.setOptions?.({ zIndex: 20 + this.layers.indexOf(layer) });
          for (const [nativeEvent, eventName] of [['click', 'click'], ['mouseover', 'mouseenter'], ['mouseout', 'mouseleave']]) {
            overlay.on?.(nativeEvent, event => this.emit(eventName, { ...event, features: [feature] }, layer.id));
          }
        });
        layer.overlays.push(...overlays);
      }
      this.syncLayerVisibility(layer);
    }
    matchesFilter(filter, properties) { return !filter || (filter[0] === '==' && properties[filter[1]?.[1]] === filter[2]); }
    createFeatureOverlays(layer, feature) {
      const geometry = feature.geometry, properties = feature.properties || {}, paint = layer.paint || {};
      if (!geometry) return [];
      if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(child => this.createFeatureOverlays(layer, { ...feature, geometry: child }));
      const value = (name, fallback) => amapStyleValue(paint[name], properties, fallback);
      const path = coordinates => coordinates.map(point => this.toAmap(point));
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
      if (layer.type === 'line') {
        // Polygon coordinates are rings (and MultiPolygon adds another nesting level).
        const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : polygons.flat();
        return lines.filter(line => line.length >= 2).map(line => new this.AMap.Polyline({ path: path(line), strokeColor: value('line-color', '#4c88a5'), strokeWeight: value('line-width', 2), strokeOpacity: value('line-opacity', 1), strokeStyle: paint['line-dasharray'] ? 'dashed' : 'solid', strokeDasharray: paint['line-dasharray'] }));
      }
      if (layer.type === 'fill') return polygons.filter(polygon => polygon[0]?.length >= 3).map(polygon => new this.AMap.Polygon({ path: polygon.map(path), strokeWeight: 0, strokeOpacity: 0, fillColor: value('fill-color', '#5bb6df'), fillOpacity: value('fill-opacity', 1) }));
      const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'MultiPoint' ? geometry.coordinates : [];
      if (layer.type === 'circle' || layer.type === 'heatmap') return points.map(point => new this.AMap.CircleMarker({ center: this.toAmap(point), radius: value('circle-radius', layer.type === 'heatmap' ? 22 : 5), strokeColor: value('circle-stroke-color', '#fff'), strokeWeight: value('circle-stroke-width', 0), strokeOpacity: value('circle-opacity', 1), fillColor: value('circle-color', properties.color || '#4c88a5'), fillOpacity: value('circle-opacity', layer.type === 'heatmap' ? .26 : .9) }));
      if (layer.type === 'symbol') return points.map(point => new this.AMap.Text({ text: properties.label || `${properties.level || ''}级风圈`, position: this.toAmap(point), anchor: 'center', style: { color: windCircleStyles[properties.level]?.color || '#fff', background: 'rgba(8,24,35,.82)', border: `1px solid ${windCircleStyles[properties.level]?.color || '#ffd60a'}`, padding: '2px 5px', 'border-radius': '10px', 'font-size': '10px', 'line-height': '16px' } }));
      return [];
    }
  }

  const el = id => document.getElementById(id);
  const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const classLabels = {
    super_typhoon: '超强台风', severe_typhoon: '强台风', typhoon: '台风',
    severe_tropical_storm: '强热带风暴', tropical_storm: '热带风暴',
    tropical_depression: '热带低压', tropical_disturbance: '热带扰动', unknown: '热带气旋'
  };
  const intensityColors = {
    tropical_disturbance: '#94a3b8', tropical_depression: '#38bdf8', tropical_storm: '#34d399',
    severe_tropical_storm: '#facc15', typhoon: '#fb923c', severe_typhoon: '#f472b6', super_typhoon: '#c084fc'
  };
  const layerIcons = { 'himawari-ir': 'ph-cloud', 'himawari-visible': 'ph-sun-horizon', precipitation: 'ph-drop-half-bottom', 'wind-field': 'ph-wind', 'wave-height': 'ph-waves' };
  const exclusiveFieldLayers = new Set(['radar', 'wind-field', 'wave-height']);
  const modelFieldLayers = new Set(['wind-field', 'wave-height']);
  const modelFieldStyles = {
    'wind-field': { payload: 'wind', title: '近地面风场', unit: 'm/s', icon: 'ph-wind', motion: '流线表示风向', ticks: ['0', '5', '10', '20', '30', '40+'], surfaceAlpha: 190, colors: [[0, '#2c7bb6'], [5, '#00a6ca'], [10, '#00ccbc'], [15, '#90eb9d'], [20, '#ffff8c'], [25, '#f9d057'], [30, '#f29e2e'], [35, '#e76818'], [40, '#d7191c'], [50, '#7a0177']] },
    'wave-height': { payload: 'waves', title: '有效浪高', unit: 'm', icon: 'ph-waves', motion: '波纹表示浪向', ticks: ['0', '1', '2', '4', '8', '12+'], surfaceAlpha: 202, colors: [[0, '#2c7bb6'], [1, '#00a6ca'], [2, '#00ccbc'], [3, '#90eb9d'], [4, '#ffff8c'], [6, '#f9d057'], [8, '#f29e2e'], [10, '#e76818'], [12, '#d7191c'], [15, '#7a0177']] }
  };
  const windCircleStyles = {
    7: { color: '#ffd60a', label: '7级风圈', fillOpacity: .11 },
    10: { color: '#ff9f0a', label: '10级风圈', fillOpacity: .15 },
    12: { color: '#ff375f', label: '12级风圈', fillOpacity: .2 }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function currentIdFromPath() {
    return location.pathname.match(/^\/typhoon\/(gdacs-tc-\d+)\/?$/)?.[1] || null;
  }

  function readCache(key, maxAge = CACHE_MS) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!cached || !cached.savedAt || Date.now() - cached.savedAt > maxAge) return null;
      return cached.value;
    } catch { return null; }
  }

  function writeCache(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); }
    catch {}
  }

  function resolveTheme() {
    const mode = localStorage.getItem('themeMode') || localStorage.getItem('theme') || 'auto';
    if (mode === 'light' || mode === 'dark') return mode;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function formatDate(value, compact = false) {
    if (!value) return '时间待确认';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间待确认';
    return new Intl.DateTimeFormat('zh-CN', compact
      ? { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit' }
      : { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
    ).format(date);
  }

  function positionText(position) {
    const lat = Number(position?.lat), lon = Number(position?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(1)}°N · ${lon.toFixed(1)}°E` : '位置待确认';
  }

  function distanceKm(a, b) {
    const lat1 = Number(a?.lat), lon1 = Number(a?.lon), lat2 = Number(b?.lat), lon2 = Number(b?.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
    const rad = degree => degree * Math.PI / 180;
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function directionText(from, to) {
    const lat1 = Number(from?.lat), lon1 = Number(from?.lon), lat2 = Number(to?.lat), lon2 = Number(to?.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return '';
    const rad = degree => degree * Math.PI / 180;
    const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return ['北','东北','东','东南','南','西南','西','西北'][Math.round(bearing / 45) % 8];
  }

  function normalizeWeatherLocation(value) {
    if (!value) return null;
    const displayName = String(value.displayName || value.city || '所在地');
    const locationData = {
      lat: Number(value.lat),
      lon: Number(value.lon),
      label: String(value.city || displayName).split(/[·・|]/)[0].trim().replace(/市$/, '') || '所在地',
      displayName,
      source: String(value.source || 'unknown'),
      cached: true
    };
    return [locationData.lat, locationData.lon].every(Number.isFinite) ? locationData : null;
  }

  function storedWeatherLocation({ allowDefault = true } = {}) {
    const locationData = state.userLocation || normalizeWeatherLocation(readCache('pulse.weather.location.v1', LOCATION_CACHE_MS));
    if (locationData) return locationData;
    return allowDefault ? { lat: 31.123, lon: 121.405, label: '上海', displayName: '上海 · 闵行', source: 'default', cached: false } : null;
  }

  function isDeviceLocation(locationData) {
    return locationData && ['device', 'device-cache', 'unknown'].includes(locationData.source);
  }

  async function resolveUserLocation() {
    if (state.userLocationPromise) return state.userLocationPromise;
    const cached = storedWeatherLocation({ allowDefault: false });
    if (isDeviceLocation(cached)) state.userLocation = cached;
    if (!navigator.geolocation) return state.userLocation;

    state.userLocationPromise = new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000
      });
    }).then(async position => {
      const lat = Number(position.coords.latitude);
      const lon = Number(position.coords.longitude);
      if (![lat, lon].every(Number.isFinite)) return state.userLocation;
      const reverse = await fetchJson(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, 8000).catch(() => null);
      const displayName = reverse?.displayName || '当前位置';
      const locationData = normalizeWeatherLocation({ lat, lon, displayName, source: 'device' });
      if (!locationData) return state.userLocation;
      state.userLocation = locationData;
      writeCache('pulse.weather.location.v1', {
        lat,
        lon,
        displayName,
        source: 'device'
      });
      return locationData;
    }).catch(error => {
      console.warn('Typhoon user location unavailable:', error);
      return state.userLocation;
    }).finally(() => {
      state.userLocationPromise = null;
    });

    return state.userLocationPromise;
  }

  function referenceFor(position) {
    const locationData = storedWeatherLocation();
    if (!locationData) return null;
    const distance = distanceKm(locationData, position);
    if (distance === null) return null;
    const direction = directionText(locationData, position);
    return { label: `位于${locationData.label}以${direction}约 ${Math.round(distance)} 公里`, note: `相对${locationData.label}天气位置` };
  }

  async function fetchJson(url, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
      return payload;
    } finally { clearTimeout(timer); }
  }

  async function fetchText(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/xml,text/xml' } });
      if (!response.ok) throw new Error(`图层元数据请求失败（${response.status}）`);
      return response.text();
    } finally { clearTimeout(timer); }
  }

  function firstStormLayer() {
    return state.map?.getStyle()?.layers.find(layer => /^(track-|points-|forecast-cone|wind-circle-|playback-|other-track-)/.test(layer.id))?.id;
  }

  function layerConfig(id) {
    return (state.detail?.mapConfig?.weatherLayers || []).find(layer => layer.id === id);
  }

  function radarIcon() {
    return `<span class="layer-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 12 18.5 7.5"></path><path d="M12 4a8 8 0 0 1 8 8"></path></svg></span>`;
  }

  function layerIcon(layer) {
    if (layer.icon === 'radar') return radarIcon();
    return `<span class="layer-icon" aria-hidden="true"><i class="ph ${layerIcons[layer.id] || `ph-${layer.icon || 'cloud'}`}"></i></span>`;
  }

  function gibsRange(target, hoursBefore, hoursAfter = 1) {
    const center = Date.parse(target) || Date.now();
    return { start: new Date(center - hoursBefore * 3600000).toISOString(), end: new Date(center + hoursAfter * 3600000).toISOString() };
  }

  async function resolveWeatherLayerClock() {
    const targetAt = state.detail?.storm?.position?.validAt || state.detail?.storm?.updatedAt || new Date().toISOString();
    const cacheKey = `pulse.typhoon.layers.${targetAt}.v3`;
    const cached = readCache(cacheKey, LAYER_CACHE_MS);
    if (cached) return cached;

    const configs = Object.fromEntries((state.detail?.mapConfig?.weatherLayers || []).map(layer => [layer.id, layer]));
    const result = { targetAt, synchronizedAt: null, skewMinutes: null, layers: {}, message: '' };
    const rainResult = await Promise.allSettled([fetchJson('https://api.rainviewer.com/public/weather-maps.json', 12000)]).then(items => items[0]);

    if (rainResult.status === 'fulfilled') {
      const rain = rainResult.value;
      const frames = rain?.radar?.past || [];
      const frameTimes = frames.map(frame => Number(frame.time) * 1000).filter(Number.isFinite);
      const range = frameTimes.length
        ? { start: new Date(Math.min(...frameTimes) - 600000).toISOString(), end: new Date(Math.max(...frameTimes) + 600000).toISOString() }
        : gibsRange(targetAt, 3);
      const cloudConfigs = [configs['himawari-ir'], configs['himawari-visible']];
      const cloudDomains = await Promise.allSettled(cloudConfigs.map(layer => fetchText(buildGibsDomainUrl({ layer: layer.layer, tileMatrixSet: layer.tileMatrixSet, ...range }))));
      if (cloudDomains.every(item => item.status === 'fulfilled')) {
        const synchronized = chooseSynchronizedFrame({ frames, domainXml: cloudDomains.map(item => item.value), targetAt });
        if (synchronized && rain.host) {
          result.synchronizedAt = synchronized.observedAt;
          result.skewMinutes = synchronized.skewMinutes;
          result.layers.radar = { available: true, observedAt: synchronized.observedAt, tiles: [`${rain.host}${synchronized.path}/256/{z}/{x}/{y}/2/1_1.png`] };
          cloudConfigs.forEach(layer => {
            result.layers[layer.id] = { available: true, observedAt: synchronized.observedAt, tiles: [buildGibsWmtsUrl({ layer: layer.layer, time: synchronized.observedAt, tileMatrixSet: layer.tileMatrixSet })] };
          });
          const skew = Math.abs(synchronized.skewMinutes);
          result.message = `雷达与云图已对齐 ${formatDate(synchronized.observedAt)}${skew > 30 ? ` · 与台风实况相差 ${skew} 分钟` : ''}`;
        }
      }
      if (!result.layers.radar && frames.length && rain.host) {
        const fallback = [...frames].sort((a, b) => Math.abs(Number(a.time) * 1000 - Date.parse(targetAt)) - Math.abs(Number(b.time) * 1000 - Date.parse(targetAt)))[0];
        const observedAt = new Date(Number(fallback.time) * 1000).toISOString();
        result.layers.radar = { available: true, observedAt, tiles: [`${rain.host}${fallback.path}/256/{z}/{x}/{y}/2/1_1.png`] };
        result.message = `雷达采样 ${formatDate(observedAt)} · 云图暂无共同观测时次`;
      }
    }

    if (!result.layers.radar) result.layers.radar = { available: false, message: '天气雷达暂不可用' };
    for (const id of ['himawari-ir', 'himawari-visible']) {
      if (!result.layers[id]) result.layers[id] = { available: false, message: '暂无共同观测时次' };
    }

    const precipitation = configs.precipitation;
    if (precipitation) {
      try {
        const range = gibsRange(targetAt, 72, 1);
        const xml = await fetchText(buildGibsDomainUrl({ layer: precipitation.layer, tileMatrixSet: precipitation.tileMatrixSet, ...range }));
        const observedAt = chooseLatestAvailableTime(xml, targetAt);
        if (!observedAt) throw new Error('无可用降水时次');
        result.layers.precipitation = {
          available: true,
          observedAt,
          tiles: [buildGibsWmtsUrl({ layer: precipitation.layer, time: observedAt, tileMatrixSet: precipitation.tileMatrixSet })]
        };
      } catch (error) {
        result.layers.precipitation = { available: false, message: error.message || '降水估算暂不可用' };
      }
    }
    Object.values(configs).filter(layer => layer.type === 'model-grid').forEach(layer => {
      result.layers[layer.id] = { available: true, observedAt: null, message: '点击后加载最新模型场' };
    });
    if (!result.message) result.message = '天气图层时间同步暂不可用';
    writeCache(cacheKey, result);
    return result;
  }

  function layerOpacity(layer) {
    const multiplier = state.weatherOpacity / .58;
    return Math.min(.95, Math.max(.12, Number(layer.baseOpacity || .58) * multiplier));
  }

  async function addWeatherLayers(generation) {
    const map = state.map;
    if (!map || !state.styleReady || !state.layerClock) return;
    const config = state.detail?.mapConfig?.weatherLayers || [];
    for (const layer of config) {
      if (layer.type === 'model-grid') continue;
      const resolved = state.layerClock.layers?.[layer.id];
      if (!resolved?.available || generation !== state.styleGeneration || map.getSource(`weather-${layer.id}`)) continue;
      try {
        map.addSource(`weather-${layer.id}`, {
          type: 'raster',
          tiles: resolved.tiles,
          tileSize: 256,
          maxzoom: Number(layer.maxNativeZoom || 7),
          attribution: layer.provider
        });
        map.addLayer({
          id: `weather-${layer.id}`,
          type: 'raster',
          source: `weather-${layer.id}`,
          layout: { visibility: state.activeWeather.has(layer.id) ? 'visible' : 'none' },
          paint: { 'raster-opacity': layerOpacity(layer), 'raster-fade-duration': 180, 'raster-resampling': 'linear' }
        }, firstStormLayer());
      } catch (error) {
        console.warn(`${layer.label} unavailable:`, error);
      }
    }
  }

  function fieldLayerIds(id) { return [`field-${id}-surface`]; }

  function fieldOpacity() { return Math.min(.86, Math.max(.24, state.weatherOpacity * 1.12)); }

  function destroyModelFieldRenderer(remove = true) {
    if (!state.fieldRenderer) return;
    state.fieldRenderer.destroy({ remove });
    state.fieldRenderer = null;
  }

  function addModelFieldLayers() {
    const map = state.map;
    if (!map?.getStyle() || !state.styleReady || !state.fieldData?.fields) return;
    const id = [...modelFieldLayers].find(layerId => state.activeWeather.has(layerId));
    if (!id) { destroyModelFieldRenderer(); return; }
    if (state.fieldRenderer?.id === id && fieldLayerIds(id).every(layerId => map.getLayer(layerId))) {
      state.fieldRenderer.setVisible(true);
      return;
    }
    destroyModelFieldRenderer();
    const style = modelFieldStyles[id];
    const field = state.fieldData.fields[style.payload];
    if (!field?.geojson?.features?.length) return;
    const before = firstStormLayer();
    state.fieldRenderer = createFieldRenderer({ map, id, field, style, opacity: fieldOpacity(), beforeLayer: before });
  }

  function setModelFieldLayerVisibility(id, visible) {
    if (state.fieldRenderer?.id === id) {
      state.fieldRenderer.setVisible(visible);
      return;
    }
    fieldLayerIds(id).forEach(layerId => {
      if (state.map?.getLayer(layerId)) state.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    });
  }

  async function ensureFieldData() {
    if (state.fieldData) return state.fieldData;
    if (state.fieldLoading) return state.fieldLoading;
    const position = state.detail?.storm?.position;
    const cacheKey = `pulse.typhoon.fields.${Number(position?.lat).toFixed(1)}.${Number(position?.lon).toFixed(1)}.v2`;
    const cached = readCache(cacheKey, 30 * 60 * 1000);
    if (cached) {
      state.fieldData = cached;
      return cached;
    }
    state.fieldLoading = fetchJson(`/api/typhoon?fields=1&lat=${encodeURIComponent(position.lat)}&lon=${encodeURIComponent(position.lon)}&grid=2`, 20000)
      .then(payload => {
        state.fieldData = payload;
        writeCache(cacheKey, payload);
        return payload;
      })
      .finally(() => { state.fieldLoading = null; });
    return state.fieldLoading;
  }

  function lineFeature(points, properties = {}) {
    return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: points.map(point => [point.position.lon, point.position.lat]) } };
  }

  function pointCollection(points, sourceId, color) {
    return {
      type: 'FeatureCollection',
      features: points.map((point, index) => {
        const key = `${sourceId}:${index}`;
        state.pointsByKey.set(key, point);
        return { type: 'Feature', properties: { key, sourceId, color: intensityColors[point.classification] || color, kind: point.kind }, geometry: { type: 'Point', coordinates: [point.position.lon, point.position.lat] } };
      })
    };
  }

  function destinationCoordinate(position, bearingDegrees, distanceKmValue) {
    const radiusKm = 6371;
    const bearing = bearingDegrees * Math.PI / 180;
    const latitude = Number(position.lat) * Math.PI / 180;
    const longitude = Number(position.lon) * Math.PI / 180;
    const angularDistance = Number(distanceKmValue) / radiusKm;
    const targetLatitude = Math.asin(Math.sin(latitude) * Math.cos(angularDistance) + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing));
    const targetLongitude = longitude + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude), Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(targetLatitude));
    return [((targetLongitude * 180 / Math.PI + 540) % 360) - 180, targetLatitude * 180 / Math.PI];
  }

  function windRadiusForBearing(circle, bearing) {
    const quadrants = circle.quadrants || {};
    if (bearing < 90) return quadrants.northeast;
    if (bearing < 180) return quadrants.southeast;
    if (bearing < 270) return quadrants.southwest;
    return quadrants.northwest;
  }

  function windCircleCollection(point) {
    const position = point?.position;
    if (![Number(position?.lat), Number(position?.lon)].every(Number.isFinite)) return { type: 'FeatureCollection', features: [] };
    const features = (point.windCircles || []).map(circle => {
      const coordinates = [];
      for (let bearing = 0; bearing < 360; bearing += 3) coordinates.push(destinationCoordinate(position, bearing, windRadiusForBearing(circle, bearing)));
      if (coordinates.length) coordinates.push(coordinates[0]);
      return {
        type: 'Feature',
        properties: { kind: 'area', level: Number(circle.level), minRadiusKm: circle.minRadiusKm, maxRadiusKm: circle.maxRadiusKm },
        geometry: { type: 'Polygon', coordinates: [coordinates] }
      };
    });
    return { type: 'FeatureCollection', features };
  }

  function windCircleLabelCollection(point) {
    const position = point?.position;
    if (![Number(position?.lat), Number(position?.lon)].every(Number.isFinite)) return { type: 'FeatureCollection', features: [] };
    const labelBearings = { 7: 214, 10: 308, 12: 42 };
    const features = (point.windCircles || []).flatMap(circle => {
      const level = Number(circle.level);
      const bearing = labelBearings[level];
      const radius = windRadiusForBearing(circle, bearing);
      if (!hasNumber(bearing) || !hasNumber(radius) || Number(radius) <= 0) return [];
      return [{
        type: 'Feature',
        properties: { level, icon: `wind-circle-label-${level}` },
        geometry: { type: 'Point', coordinates: destinationCoordinate(position, bearing, Number(radius)) }
      }];
    });
    return { type: 'FeatureCollection', features };
  }

  function windCircleLabelImage(style, label) {
    const pixelRatio = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const width = 72;
    const height = 22;
    const canvas = document.createElement('canvas');
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const context = canvas.getContext('2d');
    context.scale(pixelRatio, pixelRatio);
    const inset = 1;
    const radius = height / 2;
    context.beginPath();
    context.moveTo(radius, inset);
    context.lineTo(width - radius, inset);
    context.arc(width - radius, radius, radius - inset, -Math.PI / 2, Math.PI / 2);
    context.lineTo(radius, height - inset);
    context.arc(radius, radius, radius - inset, Math.PI / 2, Math.PI * 1.5);
    context.closePath();
    context.fillStyle = 'rgba(8, 24, 35, .82)';
    context.fill();
    context.strokeStyle = style.color;
    context.globalAlpha = .82;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = style.color;
    context.font = '700 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, width / 2, height / 2 + .25);
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data, pixelRatio };
  }

  function ensureWindCircleLabelImages(map) {
    // AMap uses native Text overlays; only MapLibre needs sprite images.
    if (map.isAmap) return;
    Object.entries(windCircleStyles).forEach(([level, style]) => {
      const imageId = `wind-circle-label-${level}`;
      if (map.hasImage(imageId)) return;
      const image = windCircleLabelImage(style, `${level}级风圈`);
      map.addImage(imageId, { width: image.width, height: image.height, data: image.data }, { pixelRatio: image.pixelRatio });
    });
  }

  function windCircleRange(circle) {
    if (!circle) return '未提供';
    return circle.minRadiusKm === circle.maxRadiusKm ? `${circle.maxRadiusKm} km` : `${circle.minRadiusKm}–${circle.maxRadiusKm} km`;
  }

  function renderWindCircleLegend(point, { historical = false } = {}) {
    const circles = point?.windCircles || [];
    const legend = el('windCircleLegend');
    if (!circles.length) { legend.hidden = true; legend.innerHTML = ''; return; }
    legend.innerHTML = `<div class="wind-circle-legend-heading"><span>${historical ? '历史风圈' : '当前风圈'}</span><small>${escapeHtml(formatDate(point.validAt || point.position?.validAt, true))}</small></div><div class="wind-circle-legend-items">${circles.map(circle => {
      const style = windCircleStyles[circle.level] || windCircleStyles[7];
      return `<span style="--wind-circle-color:${style.color}"><i></i>${style.label}<small>${escapeHtml(windCircleRange(circle))}</small></span>`;
    }).join('')}</div>`;
    legend.hidden = false;
  }

  function setWindCirclePoint(point, { historical = false } = {}) {
    state.windCirclePoint = point || null;
    const collection = windCircleCollection(point);
    el('typhoonMap').dataset.windCircleCount = String(collection.features.length);
    const source = state.map?.getSource('wind-circles');
    if (source) source.setData(collection);
    const labelSource = state.map?.getSource('wind-circle-labels');
    if (labelSource) labelSource.setData(windCircleLabelCollection(point));
    renderWindCircleLegend(point, { historical });
  }

  function addWindCircleLayers() {
    const map = state.map;
    if (!map) return;
    ensureWindCircleLabelImages(map);
    if (!map.getSource('wind-circles')) map.addSource('wind-circles', { type: 'geojson', data: windCircleCollection(state.windCirclePoint) });
    if (!map.getSource('wind-circle-labels')) map.addSource('wind-circle-labels', { type: 'geojson', data: windCircleLabelCollection(state.windCirclePoint) });
    [7, 10, 12].forEach(level => {
      const style = windCircleStyles[level];
      if (!map.getLayer(`wind-circle-${level}-fill`)) map.addLayer({ id: `wind-circle-${level}-fill`, type: 'fill', source: 'wind-circles', filter: ['==', ['get', 'level'], level], paint: { 'fill-color': style.color, 'fill-opacity': style.fillOpacity } });
      if (!map.getLayer(`wind-circle-${level}-line`)) map.addLayer({ id: `wind-circle-${level}-line`, type: 'line', source: 'wind-circles', filter: ['==', ['get', 'level'], level], paint: { 'line-color': style.color, 'line-width': 1.35, 'line-opacity': .88 } });
    });
    if (!map.getLayer('wind-circle-label-symbols')) map.addLayer({
      id: 'wind-circle-label-symbols',
      type: 'symbol',
      source: 'wind-circle-labels',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });
  }

  function addTrackLayers() {
    const map = state.map;
    const tracks = state.detail?.tracks;
    if (!map || !map.getStyle() || !tracks) return;
    state.pointsByKey.clear();
    addForecastConeLayers();
    addWindCircleLayers();
    setWindCirclePoint(state.windCirclePoint);
    const observed = tracks.observed || [];
    if (observed.length) {
      map.addSource('track-observed', { type: 'geojson', data: observed.length > 1 ? lineFeature(observed, { sourceId: 'observed' }) : { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'track-observed-glow', type: 'line', source: 'track-observed', layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' }, paint: { 'line-color': '#c9efff', 'line-width': 8, 'line-opacity': .2, 'line-blur': 3 } });
      map.addLayer({ id: 'track-observed-line', type: 'line', source: 'track-observed', layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' }, paint: { 'line-color': state.theme === 'light' && state.basemap === 'standard' ? '#245573' : '#f2fbff', 'line-width': 2.6, 'line-opacity': .95 } });
      map.addSource('points-observed', { type: 'geojson', data: pointCollection(observed, 'observed', '#f2fbff') });
      map.addLayer({
        id: 'points-observed', type: 'circle', source: 'points-observed',
        layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' },
        paint: {
          'circle-radius': ['case', ['==', ['get','kind'], 'current'], 1, 3],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': state.theme === 'light' ? '#24475c' : '#f7fbfd',
          'circle-stroke-width': ['case', ['==', ['get','kind'], 'current'], 0, 1],
          'circle-opacity': ['case', ['==', ['get','kind'], 'current'], 0, .9]
        }
      });
    }
    for (const track of tracks.forecasts || []) {
      if (track.points.length < 2) continue;
      map.addSource(`track-${track.id}`, { type: 'geojson', data: lineFeature(track.points, { sourceId: track.id }) });
      map.addLayer({ id: `track-${track.id}`, type: 'line', source: `track-${track.id}`, layout: { visibility: state.activeSources.has(track.id) ? 'visible' : 'none' }, paint: { 'line-color': track.color, 'line-width': 2.2, 'line-opacity': .9, 'line-dasharray': [2, 1.6] } });
      map.addSource(`points-${track.id}`, { type: 'geojson', data: pointCollection(track.points, track.id, track.color) });
      map.addLayer({ id: `points-${track.id}`, type: 'circle', source: `points-${track.id}`, layout: { visibility: state.activeSources.has(track.id) ? 'visible' : 'none' }, paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-stroke-color': state.theme === 'light' ? '#24475c' : '#f7fbfd', 'circle-stroke-width': 1.2 } });
    }
    addPlaybackLayers();
  }

  function addForecastConeLayers() {
    // Only render uncertainty geometry supplied by the provider; do not infer a cone from agency spread.
    const features = (state.detail?.eventGeometry?.features || []).filter(feature =>
      ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
      && /cone|forecast.*(area|uncertainty)/i.test(feature.properties?.featureType || '')
    );
    if (!features.length) return;
    state.map.addSource('forecast-cone', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    state.map.addLayer({ id: 'forecast-cone-fill', type: 'fill', source: 'forecast-cone', paint: { 'fill-color': '#5bb6df', 'fill-opacity': .16 } });
    state.map.addLayer({ id: 'forecast-cone-line', type: 'line', source: 'forecast-cone', paint: { 'line-color': '#5bb6df', 'line-width': 1.4, 'line-dasharray': [3, 2] } });
  }

  function removeMarkers() {
    state.markers.forEach(marker => marker.remove());
    state.markers = [];
    state.userLocationMarker?.remove();
    state.userLocationMarker = null;
    state.currentMarker = null;
  }

  function removeOtherStormMarkers() {
    state.otherStormMarkers.forEach(marker => marker.remove());
    state.otherStormMarkers = [];
  }

  function markerLabel(point) { return formatDate(point.validAt, true).replace('日', '日 '); }

  function dateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function forecastDateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '日期待确认';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }).format(date);
  }

  function addMarker(point, sourceId, color, current = false, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.source = sourceId;
    button.style.setProperty('--storm-color', intensityColors[point.classification] || color);
    button.setAttribute('aria-label', `${point.sourceLabel || '路径'} ${formatDate(point.validAt)} 节点`);
    if (current) {
      button.className = 'current-marker';
      button.dataset.markerRole = 'typhoon-current';
      button.innerHTML = '<span class="typhoon-marker-core"><i class="ph ph-hurricane" aria-hidden="true"></i></span>';
    } else {
      button.className = `track-key-marker${options.className ? ` ${options.className}` : ''}`;
      button.style.setProperty('--source-color', intensityColors[point.classification] || color);
      button.innerHTML = `<span class="dot"></span><small>${escapeHtml(options.label || markerLabel(point))}</small>`;
    }
    button.classList.toggle('is-hidden', !current && !state.activeSources.has(sourceId));
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (!current) { showNode(point, false); return; }
      const playbackPoint = state.playbackPoints[state.playbackIndex]?.point || point;
      showNode(playbackPoint, state.playbackIndex === state.playbackCurrentIndex);
    });
    const marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat([point.position.lon, point.position.lat]).addTo(state.map);
    state.markers.push(marker);
    if (current) state.currentMarker = marker;
  }

  function addForecastDateMarkers(track) {
    const points = (track.points || []).filter(point => point.kind === 'forecast' && Number.isFinite(Date.parse(point.validAt)));
    let previousDate = '';
    points.forEach((point, index) => {
      const currentDate = dateKey(point.validAt);
      const isDateBoundary = index === 0 || index === points.length - 1 || currentDate !== previousDate;
      if (isDateBoundary) addMarker(point, track.id, track.color, false, { label: forecastDateLabel(point.validAt), className: 'forecast-date-marker' });
      previousDate = currentDate;
    });
  }

  function addOtherStormMarker(item, point) {
    if (!state.map || !point?.position) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'other-storm-marker';
    button.setAttribute('aria-label', `${item.name}，点击查看完整台风详情`);
    button.title = `${item.name}：点击查看详情`;
    button.innerHTML = `<span class="typhoon-marker-core"><i class="ph ph-hurricane" aria-hidden="true"></i></span><small>${escapeHtml(item.name)}</small>`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      selectStorm(item.id, item.zhejiangId || '');
    });
    const marker = new maplibregl.Marker({ element: button, anchor: 'center' })
      .setLngLat([point.position.lon, point.position.lat])
      .addTo(state.map);
    state.otherStormMarkers.push(marker);
  }

  function renderUserLocationMarker() {
    state.userLocationMarker?.remove();
    state.userLocationMarker = null;
    const cachedLocation = storedWeatherLocation({ allowDefault: false });
    const locationData = isDeviceLocation(cachedLocation) ? cachedLocation : null;
    const button = el('userLocationButton');
    if (!state.map || !locationData) { button.hidden = true; return; }
    const markerElement = document.createElement('button');
    markerElement.type = 'button';
    markerElement.className = 'user-location-marker';
    markerElement.setAttribute('aria-label', `我的位置：${locationData.displayName || locationData.label}`);
    markerElement.title = locationData.displayName || locationData.label;
    markerElement.innerHTML = '<i aria-hidden="true"></i>';
    markerElement.addEventListener('click', () => focusUserLocation());
    state.userLocationMarker = new maplibregl.Marker({ element: markerElement, anchor: 'center' }).setLngLat([locationData.lon, locationData.lat]).addTo(state.map);
    button.hidden = false;
  }

  function renderMarkers() {
    removeMarkers();
    const tracks = state.detail?.tracks;
    if (!state.map || !tracks) return;
    const observed = tracks.observed || [];
    if (!observed.length && state.detail?.storm?.position) addMarker(state.detail.storm, 'observed', '#f2fbff', true);
    const interval = Math.max(6, Math.ceil(observed.length / 10));
    observed.forEach((point, index) => {
      const current = index === observed.length - 1;
      if (current) addMarker(point, 'observed', '#f2fbff', true);
      else if (index % interval === 0) addMarker(point, 'observed', '#f2fbff');
    });
    for (const track of tracks.forecasts || []) addForecastDateMarkers(track);
    renderUserLocationMarker();
    syncPlaybackMap();
  }

  function playbackForecastTrack() {
    const tracks = state.detail?.tracks?.forecasts || [];
    return tracks.find(track => track.id === state.selectedAgencyId)
      || tracks.find(track => track.id === 'cma')
      || tracks[0]
      || null;
  }

  function buildPlaybackPoints() {
    const allObserved = [...(state.detail?.tracks?.observed || [])]
      .filter(point => hasNumber(point?.position?.lat) && hasNumber(point?.position?.lon) && Number.isFinite(Date.parse(point.validAt)))
      .sort((a, b) => Date.parse(a.validAt) - Date.parse(b.validAt));
    const current = allObserved.at(-1);
    const currentAt = Date.parse(current?.validAt);
    const observed = Number.isFinite(currentAt)
      ? allObserved.filter(point => Date.parse(point.validAt) >= currentAt - PLAYBACK_HISTORY_WINDOW_MS)
      : allObserved;
    const forecastTrack = playbackForecastTrack();
    const forecast = [...(forecastTrack?.points || [])]
      .filter(point => point.kind === 'forecast' && hasNumber(point?.position?.lat) && hasNumber(point?.position?.lon) && Number.isFinite(Date.parse(point.validAt)))
      .filter(point => !Number.isFinite(currentAt) || Date.parse(point.validAt) > currentAt)
      .sort((a, b) => Date.parse(a.validAt) - Date.parse(b.validAt));
    const points = [
      ...observed.map(point => ({ point, phase: point === current ? 'current' : 'history', track: null, at: Date.parse(point.validAt) })),
      ...forecast.map(point => ({ point, phase: 'forecast', track: forecastTrack, at: Date.parse(point.validAt) }))
    ];
    return {
      points,
      currentIndex: Math.max(0, observed.length - 1),
      startAt: points[0]?.at || 0,
      endAt: points.at(-1)?.at || 0,
      currentAt: Number.isFinite(currentAt) ? currentAt : (points[0]?.at || 0),
      forecastTrack
    };
  }

  function playbackLine(points) {
    const coordinates = points.map(item => [Number(item.point.position.lon), Number(item.point.position.lat)]);
    return coordinates.length > 1
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
      : { type: 'FeatureCollection', features: [] };
  }

  function interpolatePlaybackPosition(from, to, ratio) {
    const fromLon = Number(from?.lon), toLon = Number(to?.lon);
    const fromLat = Number(from?.lat), toLat = Number(to?.lat);
    let lonDelta = toLon - fromLon;
    if (Math.abs(lonDelta) > 180) lonDelta -= Math.sign(lonDelta) * 360;
    const lon = ((fromLon + lonDelta * ratio + 540) % 360) - 180;
    return { lon, lat: fromLat + (toLat - fromLat) * ratio };
  }

  function interpolatedPlaybackEntry(previous, next, time) {
    const span = Math.max(1, next.at - previous.at);
    const ratio = Math.max(0, Math.min(1, (time - previous.at) / span));
    const nearest = ratio < .5 ? previous : next;
    const phase = time < state.playbackCurrentAt ? 'history' : (time > state.playbackCurrentAt ? 'forecast' : 'current');
    return {
      point: {
        ...nearest.point,
        validAt: new Date(time).toISOString(),
        position: interpolatePlaybackPosition(previous.point.position, next.point.position, ratio)
      },
      phase,
      track: phase === 'forecast' ? (next.track || previous.track || playbackForecastTrack()) : null,
      at: time,
      dataEntry: nearest
    };
  }

  function playbackFrameAt(time) {
    const points = state.playbackPoints;
    if (!points.length) return null;
    const boundedTime = Math.max(state.playbackStartAt, Math.min(Number(time) || state.playbackStartAt, state.playbackEndAt));
    if (boundedTime <= points[0].at) return { ...points[0], dataEntry: points[0], index: 0 };
    if (boundedTime >= points.at(-1).at) return { ...points.at(-1), dataEntry: points.at(-1), index: points.length - 1 };
    const nextIndex = points.findIndex(entry => entry.at >= boundedTime);
    if (points[nextIndex].at === boundedTime) return { ...points[nextIndex], dataEntry: points[nextIndex], index: nextIndex };
    const previous = points[nextIndex - 1];
    const next = points[nextIndex];
    const frame = interpolatedPlaybackEntry(previous, next, boundedTime);
    return { ...frame, index: frame.dataEntry === previous ? nextIndex - 1 : nextIndex };
  }

  function playbackLineUntil(entries, cutoffAt) {
    if (!entries.length || cutoffAt < entries[0].at) return playbackLine([]);
    const visible = entries.filter(entry => entry.at <= cutoffAt);
    const next = entries.find(entry => entry.at > cutoffAt);
    if (visible.length && next && visible.at(-1).at < cutoffAt) {
      visible.push(interpolatedPlaybackEntry(visible.at(-1), next, cutoffAt));
    }
    return playbackLine(visible);
  }

  function playbackSegments(time = state.playbackCursorAt) {
    if (!state.playbackActive || !state.playbackPoints.length) {
      return { history: playbackLine([]), forecast: playbackLine([]) };
    }
    const currentIndex = state.playbackCurrentIndex;
    const history = state.playbackPoints.slice(0, currentIndex + 1);
    const forecast = state.playbackPoints.slice(currentIndex);
    return {
      history: playbackLineUntil(history, Math.min(time, state.playbackCurrentAt)),
      forecast: time > state.playbackCurrentAt ? playbackLineUntil(forecast, time) : playbackLine([])
    };
  }

  function addPlaybackLayers() {
    const map = state.map;
    if (!map?.getStyle() || map.getSource('playback-history')) return;
    const segments = playbackSegments();
    map.addSource('playback-history', { type: 'geojson', data: segments.history });
    map.addSource('playback-forecast', { type: 'geojson', data: segments.forecast });
    map.addLayer({
      id: 'playback-history-glow',
      type: 'line',
      source: 'playback-history',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#64d2ff', 'line-width': 8, 'line-opacity': .23, 'line-blur': 3 }
    });
    map.addLayer({
      id: 'playback-history-line',
      type: 'line',
      source: 'playback-history',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#eaf9ff', 'line-width': 3.2, 'line-opacity': .98 }
    });
    map.addLayer({
      id: 'playback-forecast-line',
      type: 'line',
      source: 'playback-forecast',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': playbackForecastTrack()?.color || '#ff7a45',
        'line-width': 3.3,
        'line-opacity': .98,
        'line-dasharray': [1.7, 1.25]
      }
    });
  }

  function syncPlaybackMap() {
    const frame = playbackFrameAt(state.playbackCursorAt);
    if (!frame) return;
    const segments = playbackSegments();
    state.map?.getSource('playback-history')?.setData(segments.history);
    state.map?.getSource('playback-forecast')?.setData(segments.forecast);
    if (state.map?.getLayer('playback-forecast-line')) {
      state.map.setPaintProperty('playback-forecast-line', 'line-color', playbackForecastTrack()?.color || '#ff7a45');
    }
    const marker = state.currentMarker;
    if (!marker) return;
    marker.setLngLat([frame.point.position.lon, frame.point.position.lat]);
    marker.getElement()?.classList.toggle('is-playback-active', state.playbackActive);
  }

  function pausePlayback() {
    if (state.playbackTimer) clearTimeout(state.playbackTimer);
    state.playbackTimer = null;
    state.playbackPlaying = false;
    const button = el('playbackToggle');
    if (!button) return;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', '播放台风路径');
    button.querySelector('i').className = 'ph ph-play';
    state.currentMarker?.getElement()?.classList.remove('is-playback-active');
  }

  function keepPlaybackPointVisible(point) {
    if (!state.map || !point?.position) return;
    const location = [point.position.lon, point.position.lat];
    if (state.map.getBounds().contains(location)) return;
    if (Date.now() - state.playbackLastPanAt < 900) return;
    state.playbackLastPanAt = Date.now();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.map.easeTo({ center: location, padding: mapPadding(), duration: reducedMotion ? 0 : 380 });
  }

  function updatePlaybackTime(time, { activate = false, keepVisible = false } = {}) {
    if (!state.playbackPoints.length) return;
    if (activate) state.playbackActive = true;
    state.playbackCursorAt = Math.max(state.playbackStartAt, Math.min(Number(time) || state.playbackStartAt, state.playbackEndAt));
    const entry = playbackFrameAt(state.playbackCursorAt);
    if (!entry) return;
    state.playbackIndex = entry.index;
    const slider = el('playbackSlider');
    slider.value = String(Math.round((state.playbackCursorAt - state.playbackStartAt) / 60000));
    const timelineSpan = Math.max(1, state.playbackEndAt - state.playbackStartAt);
    const progress = (state.playbackCursorAt - state.playbackStartAt) / timelineSpan * 100;
    el('trackPlayback').style.setProperty('--playback-progress', `${progress}%`);
    const stage = entry.phase === 'history' ? '历史实况' : (entry.phase === 'current' ? '当前位置' : `${entry.track?.label || '机构'}预报`);
    el('playbackStage').textContent = stage;
    el('playbackSource').textContent = entry.phase === 'forecast'
      ? (entry.track?.agency || entry.track?.label || '预报路径')
      : (entry.point.sourceLabel || '实况路径');
    el('playbackTime').textContent = formatDate(entry.point.validAt);
    slider.setAttribute('aria-valuetext', `${stage}，${formatDate(entry.point.validAt)}`);
    syncPlaybackMap();
    setWindCirclePoint(entry.dataEntry?.point || entry.point, { historical: entry.phase === 'history' });
    if (keepVisible) keepPlaybackPointVisible(entry.point);
  }

  function schedulePlaybackStep() {
    if (!state.playbackPlaying) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const delay = reducedMotion ? 900 : 180;
    state.playbackTimer = setTimeout(() => {
      const elapsed = performance.now() - state.playbackAnimationStartedAt;
      const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, state.playbackAnimationDuration)));
      const nextTime = state.playbackAnimationFromAt + (state.playbackEndAt - state.playbackAnimationFromAt) * progress;
      updatePlaybackTime(nextTime, { activate: true, keepVisible: true });
      if (progress >= 1) {
        pausePlayback();
        return;
      }
      schedulePlaybackStep();
    }, delay);
  }

  function togglePlayback() {
    if (state.playbackPlaying) { pausePlayback(); return; }
    if (state.playbackCursorAt >= state.playbackEndAt - 60000) {
      updatePlaybackTime(state.playbackStartAt, { activate: true, keepVisible: true });
    }
    state.playbackActive = true;
    state.playbackPlaying = true;
    state.playbackAnimationFromAt = state.playbackCursorAt;
    state.playbackAnimationStartedAt = performance.now();
    const remainingDays = Math.max(0, state.playbackEndAt - state.playbackCursorAt) / 86400000;
    state.playbackAnimationDuration = Math.max(14000, Math.min(36000, remainingDays * 2600));
    const button = el('playbackToggle');
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', '暂停台风路径');
    button.querySelector('i').className = 'ph ph-pause';
    syncPlaybackMap();
    schedulePlaybackStep();
  }

  function renderPlaybackDateTicks() {
    const container = el('playbackDateTicks');
    const span = state.playbackEndAt - state.playbackStartAt;
    if (!container || span <= 0) { if (container) container.innerHTML = ''; return; }
    const daySpan = span / 86400000;
    const count = Math.max(3, Math.min(5, Math.ceil(daySpan) + 1));
    const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
    container.innerHTML = Array.from({ length: count }, (_, index) => {
      const ratio = count === 1 ? 0 : index / (count - 1);
      const time = state.playbackStartAt + span * ratio;
      const edgeClass = index === 0 ? ' is-start' : (index === count - 1 ? ' is-end' : '');
      return `<span class="${edgeClass.trim()}" style="--tick-position:${(ratio * 100).toFixed(2)}%">${formatter.format(time)}</span>`;
    }).join('');
  }

  function preparePlayback() {
    pausePlayback();
    const playback = buildPlaybackPoints();
    state.playbackPoints = playback.points;
    state.playbackCurrentIndex = playback.currentIndex;
    state.playbackStartAt = playback.startAt;
    state.playbackEndAt = playback.endAt;
    state.playbackCurrentAt = playback.currentAt;
    state.playbackCursorAt = playback.currentAt;
    state.playbackIndex = playback.currentIndex;
    state.playbackActive = false;
    const slider = el('playbackSlider');
    slider.max = String(Math.max(0, Math.round((state.playbackEndAt - state.playbackStartAt) / 60000)));
    slider.value = String(Math.max(0, Math.round((state.playbackCurrentAt - state.playbackStartAt) / 60000)));
    const timelineSpan = state.playbackEndAt - state.playbackStartAt;
    const nowPercent = timelineSpan > 0 ? (state.playbackCurrentAt - state.playbackStartAt) / timelineSpan * 100 : 50;
    el('trackPlayback').style.setProperty('--playback-now', `${nowPercent}%`);
    el('trackPlayback').hidden = state.playbackPoints.length < 2;
    renderPlaybackDateTicks();
    updatePlaybackTime(state.playbackCursorAt);
  }

  function bindPointInteractions() {
    const layerIds = ['points-observed', ...(state.detail?.tracks?.forecasts || []).map(track => `points-${track.id}`)];
    layerIds.forEach(layerId => {
      if (state.boundLayerIds.has(layerId)) return;
      state.boundLayerIds.add(layerId);
      state.map.on('mouseenter', layerId, () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', layerId, () => { state.map.getCanvas().style.cursor = ''; });
      state.map.on('click', layerId, event => {
        const key = event.features?.[0]?.properties?.key;
        const point = state.pointsByKey.get(key);
        if (point) showNode(point, point.kind === 'current');
      });
    });
  }

  function mapPadding() {
    const mapRect = el('typhoonMap')?.getBoundingClientRect();
    if (!mapRect?.width || !mapRect?.height) return { top: 92, right: 70, bottom: 76, left: 70 };
    const topbarRect = document.querySelector('.topbar')?.getBoundingClientRect();
    const panelRect = el('insightPanel')?.getBoundingClientRect();
    const stripRect = el('sourceStrip')?.getBoundingClientRect();
    const playbackRect = el('trackPlayback')?.getBoundingClientRect();
    const cardRect = el('nodeCard')?.getBoundingClientRect();
    const toolbarRect = document.querySelector('.map-toolbar')?.getBoundingClientRect();
    const padding = {
      top: Math.max(24, Math.round((topbarRect?.bottom || mapRect.top + 64) - mapRect.top + 12)),
      right: 38,
      bottom: 38,
      left: 38
    };
    const panelIsBottomSheet = panelRect?.width > mapRect.width * .62 && panelRect.top > mapRect.top + mapRect.height * .4;
    if (panelIsBottomSheet) {
      const visibleBottom = Math.min(
        panelRect.top,
        stripRect?.height ? stripRect.top : panelRect.top,
        playbackRect?.height ? playbackRect.top : panelRect.top,
        cardRect?.height ? cardRect.top : panelRect.top
      ) - 12;
      padding.bottom = Math.max(38, Math.round(mapRect.bottom - visibleBottom));
      if (toolbarRect?.width) padding.right = Math.max(padding.right, mapRect.right - toolbarRect.left + 12);
      for (const id of ['stormSwitcher', 'radarIntensityLegend', 'fieldIntensityLegend']) {
        const rect = el(id)?.getBoundingClientRect();
        if (rect?.height) padding.top = Math.max(padding.top, rect.bottom - mapRect.top + 12);
      }
    } else if (panelRect?.width && panelRect.left > mapRect.left + mapRect.width * .45) {
      padding.right = Math.max(70, Math.round(mapRect.right - panelRect.left + 14));
      padding.bottom = 76;
      padding.left = 70;
      if (toolbarRect?.height) padding.top = Math.max(padding.top, toolbarRect.bottom - mapRect.top + 14);
    }
    // Very short viewports must still leave room for MapLibre's camera fit.
    for (const [start, end, size] of [['left', 'right', mapRect.width], ['top', 'bottom', mapRect.height]]) {
      const total = padding[start] + padding[end];
      const available = Math.max(0, size - 140);
      if (total > available) {
        padding[start] *= available / total;
        padding[end] *= available / total;
      }
    }
    return padding;
  }

  function fitTracks() {
    const tracks = state.detail?.tracks;
    if (!state.map || !state.detail) return;
    const bounds = new maplibregl.LngLatBounds();
    const points = [state.detail.storm, ...(tracks?.observed || []), ...(tracks?.forecasts || []).flatMap(track => track.points)];
    points.forEach(point => {
      if (hasNumber(point?.position?.lon) && hasNumber(point?.position?.lat)) bounds.extend([Number(point.position.lon), Number(point.position.lat)]);
    });
    (state.detail.eventGeometry?.features || [])
      .filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
        && /cone|forecast.*(area|uncertainty)/i.test(feature.properties?.featureType || ''))
      .flatMap(amapFeatureCoordinates)
      .forEach(position => bounds.extend(position));
    windCircleCollection(state.windCirclePoint).features.flatMap(amapFeatureCoordinates).forEach(position => bounds.extend(position));
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: mapPadding(), retainPadding: false, maxZoom: 7, duration: 700 });
  }

  function focusStormOnLoad() {
    if (!state.map || !state.detail) return;
    state.needsTrackFit = false;
    const position = state.detail.storm?.position;
    if (!hasNumber(position?.lon) || !hasNumber(position?.lat)) { fitTracks(); return; }
    const padding = mapPadding();
    const size = el('typhoonMap').getBoundingClientRect();
    const mobile = size.width > 0 && size.width <= 760;
    // A regional phone view includes the coast around offshore storms without
    // moving the current position out of the unobscured viewport's center.
    state.map.flyTo({ center: [Number(position.lon), Number(position.lat)], zoom: mobile ? 3 : 5, padding, retainPadding: false, duration: 0 });
  }

  async function hydrateMapStyle() {
    if (!state.styleReady || !state.detail) return;
    const generation = state.styleGeneration;
    addTrackLayers();
    renderMarkers();
    if (state.needsTrackFit) focusStormOnLoad();
    // Delegated MapLibre listeners survive setStyle; bind each layer id only once.
    bindPointInteractions();
    await addWeatherLayers(generation);
    if (generation !== state.styleGeneration || !state.styleReady) return;
    addModelFieldLayers();
    await renderOtherStormTracks();
  }

  async function resolveAndLoadWeatherLayers() {
    try {
      state.layerClock = await resolveWeatherLayerClock();
    } catch (error) {
      state.layerClock = { message: '天气图层时间同步暂不可用', layers: {} };
      (state.detail?.mapConfig?.weatherLayers || []).filter(layer => layer.type === 'model-grid').forEach(layer => {
        state.layerClock.layers[layer.id] = { available: true, observedAt: null, message: '点击后加载最新模型场' };
      });
      console.warn('Weather layer clock unavailable:', error);
    }
    renderLayerControls();
    await addWeatherLayers(state.styleGeneration);
  }

  function updateBasemapAttribution() {
    const provider = state.basemapProvider;
    el('basemapAttribution').innerHTML = provider === 'amap'
      ? `高德地图${state.basemap === 'satellite' ? ' · 卫星影像 · 路网' : ''}`
      : provider === 'openfreemap'
      ? `${BASEMAP_ATTRIBUTION}${state.basemap === 'satellite' ? ' · NASA GIBS Blue Marble' : ''}`
      : provider === 'esri'
        ? `${state.basemap === 'satellite' ? 'Esri World Imagery · ' : ''}${ESRI_ATTRIBUTION}`
        : '简化地理轮廓';
  }

  function basemapNotice(message = '') {
    el('basemapNotice').textContent = message;
    el('basemapNotice').hidden = !message;
    updateBasemapAttribution();
  }

  function renderOutlineMap() {
    const container = el('mapFallback');
    const rect = el('typhoonMap').getBoundingClientRect();
    const width = rect.width || 1200, height = rect.height || 800;
    const tracks = [{ id: 'observed', color: state.theme === 'light' ? '#245573' : '#f2fbff', points: state.detail?.tracks?.observed || [] }, ...(state.detail?.tracks?.forecasts || [])];
    const points = tracks.flatMap(track => track.points);
    if (state.detail?.storm?.position) points.push(state.detail.storm);
    const { project, path, landPaths } = createOutlineProjection({ width, height, padding: mapPadding(), positions: points.filter(point => point.position).map(point => [point.position.lon, point.position.lat]) });
    const palette = BASEMAP_PALETTES[state.theme];
    const shapes = landPaths.map(d => `<path d="${d}" fill="${palette.land}" stroke="${palette.border}" stroke-width=".8"/>`);
    for (const feature of state.detail?.eventGeometry?.features || []) {
      if (!/cone|forecast.*(area|uncertainty)/i.test(feature.properties?.featureType || '')) continue;
      const polygons = feature.geometry?.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
      for (const polygon of polygons) shapes.push(`<path d="${polygon.map(ring => path(ring) + 'Z').join(' ')}" fill="#5bb6df" fill-opacity=".16" stroke="#5bb6df"/>`);
    }
    state.pointsByKey.clear();
    for (const track of tracks.filter(track => state.activeSources.has(track.id))) {
      const valid = track.points.filter(point => hasNumber(point.position?.lon) && hasNumber(point.position?.lat));
      shapes.push(`<path d="${path(valid.map(point => [point.position.lon, point.position.lat]))}" fill="none" stroke="${escapeHtml(track.color)}" stroke-width="2.5" ${track.id === 'observed' ? '' : 'stroke-dasharray="6 4"'}/>`);
      valid.forEach((point, index) => {
        const key = `${track.id}:${index}`, [x, y] = project([point.position.lon, point.position.lat]);
        state.pointsByKey.set(key, point);
        shapes.push(`<circle cx="${x}" cy="${y}" r="${point.kind === 'current' ? 7 : 4}" fill="${intensityColors[point.classification] || '#94a3b8'}" stroke="${palette.label}" tabindex="0" role="button" data-point-key="${escapeHtml(key)}" aria-label="${escapeHtml(formatDate(point.validAt))}"><title>${escapeHtml(formatDate(point.validAt))}</title></circle>`);
      });
    }
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-label="台风路径与简化陆地轮廓"><rect width="${width}" height="${height}" fill="${palette.water}"/>${shapes.join('')}</svg>`;
    container.hidden = false;
  }

  function showOutlineFallback() {
    ++state.basemapRequest;
    clearTimeout(state.basemapTimer);
    state.basemapTimer = null;
    destroyModelFieldRenderer();
    removeMarkers();
    removeOtherStormMarkers();
    state.map?.remove();
    state.map = null;
    state.styleReady = false;
    state.rendererUnavailable = true;
    state.basemapProvider = nextBasemapProvider(state.basemapProvider, false);
    renderOutlineMap();
    basemapNotice('交互地图暂不可用，已显示简化路径地图');
  }

  function hasWebGLContext() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  }

  function armBasemapTimeout() {
    if (state.basemapTimer || !state.basemapSourceIds.length) return;
    const request = state.basemapRequest, generation = state.basemapGeneration;
    state.basemapTimer = setTimeout(() => {
      state.basemapTimer = null;
      if (request === state.basemapRequest && generation === state.basemapGeneration) fallbackBasemap();
    }, BASEMAP_TIMEOUT_MS);
  }

  function fallbackBasemap() {
    if (!state.map || !['openfreemap', 'esri'].includes(state.basemapProvider)) return;
    const provider = nextBasemapProvider(state.basemapProvider);
    applyBasemapStyle(createFallbackStyle(state.theme, provider, state.basemap), provider);
    basemapNotice(provider === 'esri' ? '高清底图暂不可用，已切换备用底图' : '底图加载失败，已切换简化底图');
  }

  function applyBasemapStyle(style, provider) {
    clearTimeout(state.basemapTimer);
    state.basemapTimer = null;
    // Keep the bundled outline visible while MapLibre replaces or fetches a remote style.
    renderOutlineMap();
    ++state.styleGeneration;
    state.styleReady = false;
    state.basemapProvider = provider;
    state.basemapSourceIds = Object.keys(style.sources).filter(id => style.sources[id].type !== 'geojson');
    state.basemapLoadedSources.clear();
    state.basemapFailureMonitor = createBasemapFailureMonitor(state.basemapSourceIds);
    style.metadata = { ...style.metadata, 'pulse:generation': ++state.basemapGeneration };
    destroyModelFieldRenderer();
    updateBasemapAttribution();
    try {
      // A complete replacement reliably emits style.load, including rapid toggles.
      state.map.setStyle(style, { diff: false });
      armBasemapTimeout();
    } catch (error) {
      console.warn('Basemap style unavailable:', error);
      if (provider === 'land') showOutlineFallback();
      else fallbackBasemap();
    }
  }

  async function fetchAmapConfig() {
    let timer;
    try {
      const response = await Promise.race([
        fetch('/api/amap-config', { headers: { accept: 'application/json' } }),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('AMap config timed out')), AMAP_TIMEOUT_MS); })
      ]);
      if (!response.ok) throw new Error(`AMap config failed (${response.status})`);
      return parseAmapConfig(await response.json());
    } finally { clearTimeout(timer); }
  }

  class AmapLngLatBounds {
    constructor() { this.points = []; }
    extend(position) { this.points.push([Number(position[0]), Number(position[1])]); return this; }
    isEmpty() { return !this.points.length; }
    getSouthWest() { return this.points.reduce((result, point) => [Math.min(result[0], point[0]), Math.min(result[1], point[1])], this.points[0]); }
    getNorthEast() { return this.points.reduce((result, point) => [Math.max(result[0], point[0]), Math.max(result[1], point[1])], this.points[0]); }
  }

  async function initializeAmapMap() {
    const config = await fetchAmapConfig();
    if (!config.key) throw new Error('AMap key unavailable');
    const browserWindow = globalThis.window || globalThis;
    const origin = globalThis.location?.origin || browserWindow.location?.origin || '';
    browserWindow._AMapSecurityConfig = { serviceHost: `${origin}${config.serviceHost}` };
    const AMap = await loadAmapScript({ document, window: browserWindow, key: config.key, timeoutMs: AMAP_TIMEOUT_MS });
    const position = state.detail?.storm?.position || { lon: 128, lat: 22 };
    const adapter = new AmapMapAdapter(AMap, { container: 'typhoonMap', center: [position.lon, position.lat], zoom: state.detail ? 5.2 : 3.2 });
    let readyTimer;
    try {
      await new Promise((resolve, reject) => {
        readyTimer = setTimeout(() => reject(new Error('AMap map timed out')), AMAP_TIMEOUT_MS);
        (adapter.ready || Promise.resolve()).then(resolve, reject);
      });
    } catch (error) {
      adapter.remove();
      throw error;
    } finally { clearTimeout(readyTimer); }
    // Theme and basemap can change while the SDK is loading. Replay the latest
    // state after complete so startup choices cannot be overwritten by the
    // constructor's older values.
    adapter.syncBasemap(state.theme, state.basemap);
    globalThis.maplibregl = { Marker: AmapMarker, LngLatBounds: AmapLngLatBounds };
    state.map = adapter;
    state.styleReady = true;
    state.rendererUnavailable = false;
    state.basemapProvider = 'amap';
    state.basemapSourceIds = [];
    state.basemapLoadedSources.clear();
    basemapNotice();
    el('mapFallback').hidden = true;
    await hydrateMapStyle();
    adapter.scheduleResizeAfterLayout();
    if (state.needsTrackFit) focusStormOnLoad();
    if (state.detail && !state.layerClock) resolveAndLoadWeatherLayers();
  }

  async function initializeMapLibre() {
    const renderer = await loadMapLibre();
    if (!hasWebGLContext()) throw new Error('WebGL unavailable');
    globalThis.maplibregl = renderer;
    const position = state.detail?.storm?.position || { lon: 128, lat: 22 };
    state.map = new renderer.Map({ container: 'typhoonMap', style: createFallbackStyle(state.theme), center: [position.lon, position.lat], zoom: state.detail ? 5.2 : 3.2, attributionControl: false, maxZoom: 10, dragRotate: false, touchPitch: false });
    state.map.touchZoomRotate.disableRotation();
    state.map.addControl(new renderer.NavigationControl({ showCompass: false }), 'bottom-right');
    state.map.on('style.load', () => {
      if (state.map.getStyle().metadata?.['pulse:generation'] !== state.basemapGeneration) return;
      state.styleReady = true;
      el('mapFallback').hidden = true;
      hydrateMapStyle().catch(error => console.warn('Map style restore failed:', error));
      if (state.needsTrackFit) focusStormOnLoad();
      if (state.detail && !state.layerClock) resolveAndLoadWeatherLayers();
    });
    state.map.on('sourcedataloading', event => {
      if (!state.basemapSourceIds.includes(event.sourceId)) return;
      state.basemapLoadedSources.delete(event.sourceId);
      armBasemapTimeout();
    });
    state.map.on('sourcedata', event => {
      if (!state.basemapSourceIds.includes(event.sourceId) || !event.tile || (event.sourceDataType && event.sourceDataType !== 'content')) return;
      state.basemapLoadedSources.add(event.sourceId);
      if (state.basemapSourceIds.every(id => state.basemapLoadedSources.has(id))) {
        clearTimeout(state.basemapTimer);
        state.basemapTimer = null;
      }
    });
    state.map.on('error', event => {
      const message = String(event?.error?.message || '');
      const styleError = !event.sourceId && !event.source && (!state.styleReady || /tiles\.openfreemap\.org/.test(event?.error?.url || message));
      if (state.basemapFailureMonitor(event) || styleError) {
        const generation = state.basemapGeneration;
        queueMicrotask(() => { if (generation === state.basemapGeneration) fallbackBasemap(); });
      }
      if (!/Failed to fetch|AJAXError/.test(message)) console.warn('Map error:', event?.error || event);
    });
    state.map.on('webglcontextlost', showOutlineFallback);
    await reloadMapStyle();
  }

  async function initializeMap() {
    if (state.map || state.rendererLoading) return;
    renderOutlineMap();
    if (state.rendererUnavailable) return;
    state.rendererLoading = true;
    try {
      try {
        await initializeAmapMap();
      } catch (amapError) {
        console.warn(isAmapAuthError(amapError) ? 'AMap authorization failed, using MapLibre fallback' : 'AMap unavailable, using MapLibre fallback:', amapError?.message || amapError);
        state.map = null;
        state.styleReady = false;
        await initializeMapLibre();
      }
    } catch (error) {
      console.warn('Map renderer unavailable:', error);
      showOutlineFallback();
    } finally { state.rendererLoading = false; }
  }

  async function reloadMapStyle() {
    if (!state.map) {
      if (state.rendererUnavailable) renderOutlineMap();
      return;
    }
    if (state.map.isAmap) {
      state.map.syncBasemap(state.theme, state.basemap);
      state.map.scheduleResizeAfterLayout?.();
      state.basemapProvider = 'amap';
      state.styleReady = true;
      basemapNotice();
      return;
    }
    const request = ++state.basemapRequest;
    const theme = state.theme, mode = state.basemap;
    // Immediate local map while styles/CDNs are slow; never wait on remote tiles.
    applyBasemapStyle(createFallbackStyle(theme), 'land');
    basemapNotice();
    try {
      let upstream = state.vectorStyles.get(theme);
      if (!upstream) upstream = await fetchJson(OPENFREEMAP_STYLES[theme], 8000);
      if (request !== state.basemapRequest || !state.map) return;
      const style = createBasemapStyle(theme, mode, upstream);
      state.vectorStyles.set(theme, upstream);
      applyBasemapStyle(style, 'openfreemap');
    } catch (error) {
      if (request !== state.basemapRequest || !state.map) return;
      applyBasemapStyle(createFallbackStyle(theme, 'esri', mode), 'esri');
      basemapNotice('高清底图暂不可用，已切换备用底图');
      console.warn('OpenFreeMap unavailable:', error);
    }
  }

  function setBasemap(id) {
    if (!['standard', 'satellite'].includes(id)) return;
    const changed = id !== state.basemap;
    state.basemap = id;
    document.querySelectorAll('[data-basemap]').forEach(button => button.classList.toggle('active', button.dataset.basemap === id));
    if (!changed) {
      if (state.map?.isAmap) state.map.syncBasemap(state.theme, state.basemap);
      return;
    }
    reloadMapStyle();
  }

  function syncTheme(theme = resolveTheme()) {
    if (!['light', 'dark'].includes(theme)) theme = resolveTheme();
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#dfe8ef' : '#07131d';
    if (theme === state.theme) {
      if (state.map?.isAmap) state.map.syncBasemap(theme, state.basemap);
      return;
    }
    state.theme = theme;
    reloadMapStyle();
  }

  function setSourceVisible(id, visible) {
    visible ? state.activeSources.add(id) : state.activeSources.delete(id);
    if (state.rendererUnavailable) renderOutlineMap();
    const layerIds = id === 'observed' ? ['track-observed-glow','track-observed-line','points-observed'] : [`track-${id}`,`points-${id}`];
    layerIds.forEach(layerId => { if (state.map?.getLayer(layerId)) state.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none'); });
    document.querySelectorAll(`.track-key-marker[data-source="${id}"]`).forEach(marker => marker.classList.toggle('is-hidden', !visible));
    document.querySelectorAll(`[data-source-toggle="${id}"]`).forEach(button => {
      button.classList.toggle('active', visible);
      button.setAttribute('aria-pressed', String(visible));
    });
  }

  function syncAgencySelectionUi() {
    const tracks = state.detail?.tracks?.forecasts || [];
    const selectedTrack = tracks.find(track => track.id === state.selectedAgencyId) || null;
    document.querySelectorAll('[data-agency-select]').forEach(button => {
      const selected = button.dataset.agencySelect === state.selectedAgencyId;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    el('clearAgencyFilter').hidden = !selectedTrack;
    el('agencyCount').textContent = selectedTrack ? `${selectedTrack.label} · 单线查看` : `${tracks.length} 个来源`;
  }

  function fitAgencyTrack(trackId) {
    if (!state.map) return;
    if (!trackId) { fitTracks(); return; }
    const track = state.detail?.tracks?.forecasts?.find(item => item.id === trackId);
    const current = state.detail?.tracks?.observed?.at(-1);
    if (!track?.points?.length) return;
    const bounds = new maplibregl.LngLatBounds();
    if (current) bounds.extend([current.position.lon, current.position.lat]);
    track.points.forEach(point => bounds.extend([point.position.lon, point.position.lat]));
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: mapPadding(), retainPadding: false, maxZoom: 7.5, duration: 520 });
  }

  function selectAgencyTrack(trackId = null) {
    const tracks = state.detail?.tracks?.forecasts || [];
    const nextId = trackId && state.selectedAgencyId !== trackId ? trackId : null;
    state.selectedAgencyId = nextId;
    setSourceVisible('observed', !nextId);
    tracks.forEach(track => setSourceVisible(track.id, !nextId || track.id === nextId));
    syncAgencySelectionUi();
    preparePlayback();
    fitAgencyTrack(nextId);
  }

  function updateLegend() {
    el('weatherLegend').hidden = !state.activeWeather.has('precipitation');
    const radar = state.layerClock?.layers?.radar;
    el('radarIntensityLegend').hidden = !state.activeWeather.has('radar') || !radar?.available;
    const activeField = [...modelFieldLayers].find(id => state.activeWeather.has(id));
    const legend = el('fieldIntensityLegend');
    legend.hidden = !activeField;
    if (!activeField) return;
    const style = modelFieldStyles[activeField];
    const observedAt = state.layerClock?.layers?.[activeField]?.observedAt;
    el('fieldLegendIcon').className = `ph ${style.icon}`;
    el('fieldLegendTitle').textContent = style.title;
    el('fieldLegendUnit').textContent = style.unit;
    el('fieldLegendScale').className = `field-legend-scale ${style.payload}`;
    el('fieldLegendTicks').innerHTML = style.ticks.map(tick => `<span>${tick}</span>`).join('');
    el('fieldLegendTime').textContent = observedAt ? `采样 ${formatDate(observedAt)}` : '正在加载模型场';
    el('fieldLegendMotion').textContent = style.motion;
  }

  function syncWeatherControlState() {
    document.querySelectorAll('[data-weather-layer]').forEach(input => { input.checked = state.activeWeather.has(input.dataset.weatherLayer); });
    for (const [id, buttonId] of [['wind-field', 'windFieldButton'], ['wave-height', 'waveHeightButton']]) {
      const button = el(buttonId);
      const active = state.activeWeather.has(id);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-busy', String(Boolean(state.fieldLoading && active)));
    }
    updateLegend();
  }

  async function setWeatherVisible(id, visible) {
    const resolved = state.layerClock?.layers?.[id];
    if (visible && !resolved?.available) return;
    if (visible && exclusiveFieldLayers.has(id)) {
      exclusiveFieldLayers.forEach(otherId => {
        if (otherId === id) return;
        state.activeWeather.delete(otherId);
        if (modelFieldLayers.has(otherId)) setModelFieldLayerVisibility(otherId, false);
        else if (state.map?.getLayer(`weather-${otherId}`)) state.map.setLayoutProperty(`weather-${otherId}`, 'visibility', 'none');
      });
    }
    visible ? state.activeWeather.add(id) : state.activeWeather.delete(id);
    if (modelFieldLayers.has(id)) {
      setModelFieldLayerVisibility(id, visible);
      syncWeatherControlState();
      if (visible) {
        try {
          await ensureFieldData();
          const style = modelFieldStyles[id];
          const field = state.fieldData?.fields?.[style.payload];
          if (!field?.geojson?.features?.length) throw new Error(`${style.title}当前区域暂无可用数据`);
          state.layerClock.layers[id] = { available: true, observedAt: field.observedAt, message: 'Open-Meteo 模型场' };
          addModelFieldLayers();
          setModelFieldLayerVisibility(id, state.activeWeather.has(id));
        } catch (error) {
          state.activeWeather.delete(id);
          state.layerClock.layers[id] = { available: false, message: error.message || '模型场暂不可用' };
          console.warn(`${modelFieldStyles[id].title} unavailable:`, error);
        }
        renderLayerControls();
        syncWeatherControlState();
      }
      return;
    }
    if (state.map?.getLayer(`weather-${id}`)) state.map.setLayoutProperty(`weather-${id}`, 'visibility', visible ? 'visible' : 'none');
    syncWeatherControlState();
  }

  function renderLayerControls() {
    const layers = state.detail?.mapConfig?.weatherLayers || [];
    if (!state.controlsInitialized) {
      state.activeWeather = new Set(layers.filter(layer => layer.defaultVisible).map(layer => layer.id));
      state.controlsInitialized = true;
    }
    el('weatherLayerOptions').innerHTML = layers.map(layer => {
      const resolved = state.layerClock?.layers?.[layer.id];
      const unavailable = state.layerClock && !resolved?.available;
      const status = !state.layerClock
        ? '正在获取采样时间'
        : (resolved?.available ? (resolved.observedAt ? `采样 ${formatDate(resolved.observedAt)}` : (resolved.message || '按需加载')) : (resolved?.message || '该时次不可用'));
      if (unavailable) state.activeWeather.delete(layer.id);
      return `<label class="layer-option${unavailable ? ' is-unavailable' : ''}">
        ${layerIcon(layer)}
        <span class="layer-option-copy"><span>${escapeHtml(layer.label)}</span><small>${escapeHtml(status)}</small></span>
        <input type="checkbox" data-weather-layer="${escapeHtml(layer.id)}" ${state.activeWeather.has(layer.id) ? 'checked' : ''} ${unavailable ? 'disabled' : ''}>
      </label>`;
    }).join('');
    el('weatherLayerOptions').querySelectorAll('input').forEach(input => input.addEventListener('change', () => { setWeatherVisible(input.dataset.weatherLayer, input.checked); }));
    const clock = el('layerClockStatus');
    const skew = Math.abs(Number(state.layerClock?.skewMinutes || 0));
    clock.classList.toggle('warning', Boolean(state.layerClock && (!state.layerClock.synchronizedAt || skew > 30)));
    clock.querySelector('span').textContent = state.layerClock?.message || '正在对齐观测时次';
    syncWeatherControlState();
  }

  function renderSourceControls() {
    const tracks = state.detail.tracks;
    const sources = [{ id: 'observed', label: '实况', color: '#f2fbff' }, ...tracks.forecasts];
    state.activeSources = new Set(sources.map(source => source.id));
    el('sourceStrip').innerHTML = sources.map(source => `
      <button class="source-toggle active" type="button" data-source-toggle="${source.id}" style="--source-color:${source.color}" aria-pressed="true">
        <i></i><span>${escapeHtml(source.label)}</span>
      </button>`).join('');
    el('sourceStrip').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
      state.selectedAgencyId = null;
      setSourceVisible(button.dataset.sourceToggle, !state.activeSources.has(button.dataset.sourceToggle));
      syncAgencySelectionUi();
    }));
  }

  function renderAgencyList() {
    const tracks = state.detail.tracks?.forecasts || [];
    el('agencyCount').textContent = `${tracks.length} 个来源`;
    el('agencyList').innerHTML = tracks.map(track => {
      const last = track.points.at(-1);
      const intensity = last?.intensity || {};
      const strength = last?.classification && last.classification !== 'unknown' ? classLabels[last.classification] : '强度待确认';
      const forecastPoints = track.points.filter(point => point.kind === 'forecast');
      const wind = hasNumber(intensity.windForceScale) && Number(intensity.windForceScale) > 0 ? `${intensity.windForceScale}级` : '风力未提供';
      return `<button class="agency-row" type="button" data-agency-select="${escapeHtml(track.id)}" aria-pressed="false" style="--source-color:${track.color}">
        <i class="agency-line" aria-hidden="true"></i>
        <span class="agency-copy"><span class="agency-name"><strong>${escapeHtml(track.label)}</strong><small>${escapeHtml(track.agency)}</small></span><span class="agency-meta">${forecastPoints.length} 个预报点 · 至 ${escapeHtml(formatDate(last?.validAt, true))}</span></span>
        <span class="agency-intensity"><strong>${escapeHtml(strength)}</strong><small class="${wind === '风力未提供' ? 'is-missing' : ''}">${escapeHtml(wind)}</small></span>
        <i class="ph ph-check-circle agency-check" aria-hidden="true"></i>
      </button>`;
    }).join('');
    el('agencyList').querySelectorAll('[data-agency-select]').forEach(button => button.addEventListener('click', () => selectAgencyTrack(button.dataset.agencySelect)));
    syncAgencySelectionUi();
  }

  function showNode(point, isCurrent = false) {
    const intensity = point.intensity || {};
    const isObserved = point.kind === 'observed';
    const reference = isCurrent ? referenceFor(point.position) : null;
    const source = point.sourceLabel || (isCurrent ? '实时位置' : '预报节点');
    el('nodeSource').textContent = source;
    el('nodeTime').textContent = formatDate(point.validAt);
    el('nodeMetrics').innerHTML = [
      ['中心位置', positionText(point.position)],
      ['最大风速', hasNumber(intensity.value) ? `${Math.round(Number(intensity.value))} ${intensity.unit || 'm/s'}${hasNumber(intensity.windForceScale) ? ` · ${intensity.windForceScale}级` : ''}` : '未提供'],
      ['中心气压', hasNumber(intensity.centralPressureHpa) ? `${Math.round(Number(intensity.centralPressureHpa))} hPa` : '未提供']
    ].map(([label, value]) => `<div class="node-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    const rows = [];
    if (reference) rows.push(`<div class="node-context-row"><i class="ph ph-map-pin"></i><span>${escapeHtml(reference.label)}</span></div>`);
    if (isCurrent && state.detail.trend?.summary) rows.push(`<div class="node-context-row"><i class="ph ph-navigation-arrow"></i><span>${escapeHtml(state.detail.trend.summary)}</span></div>`);
    if (isObserved) rows.push('<div class="node-context-row"><i class="ph ph-clock-counter-clockwise"></i><span>该节点为历史实况位置，风圈对应这一观测时次。</span></div>');
    else if (!isCurrent) rows.push(`<div class="node-context-row"><i class="ph ph-info"></i><span>该节点为 ${escapeHtml(source)} 预报位置，路径会随新一轮预报更新。</span></div>`);
    if (point.windCircles?.length) rows.push(`<div class="node-context-row"><i class="ph ph-circles-three-plus"></i><span>${point.windCircles.map(circle => `${circle.level}级 ${windCircleRange(circle)}`).join(' · ')}</span></div>`);
    el('nodeContext').innerHTML = rows.join('');
    el('nodeCard').hidden = false;
    setWindCirclePoint(point, { historical: !isCurrent });
  }

  function renderWindRadiusSummary(point) {
    const circles = point?.windCircles || [];
    const summary = el('windRadiusSummary');
    const values = el('windRadiusValues');
    summary.classList.toggle('is-unavailable', !circles.length);
    el('windRadiusStatus').textContent = circles.length ? `发布 ${formatDate(point.validAt || point.position?.validAt, true)}` : '当前未发布';
    values.innerHTML = circles.length
      ? circles.map(circle => {
        const style = windCircleStyles[circle.level] || windCircleStyles[7];
        return `<span style="--wind-circle-color:${style.color}"><i></i><strong>${circle.level}级</strong><small>${escapeHtml(windCircleRange(circle))}</small></span>`;
      }).join('')
      : '<p>气象部门当前未提供有效风圈半径，不使用历史数值替代。</p>';
  }

  function stormDisplayName(storm) {
    const zh = storm?.name?.zh;
    return zh || storm?.name?.display || '未命名系统';
  }

  function renderStormSwitcher() {
    const switcher = el('stormSwitcher');
    if (!switcher) return;
    const storms = state.stormsSummary.filter(storm => storm?.active && storm?.id);
    if (storms.length < 2) { switcher.hidden = true; switcher.innerHTML = ''; return; }
    const locationData = state.userLocation;
    const ranked = [...storms].sort((a, b) => {
      const distanceA = locationData ? (distanceKm(locationData, a.position) ?? Infinity) : 0;
      const distanceB = locationData ? (distanceKm(locationData, b.position) ?? Infinity) : 0;
      return distanceA - distanceB;
    });
    const selectedStorm = ranked.find(storm => storm.id === state.stormId) || ranked[0];
    switcher.innerHTML = `<button class="storm-switcher-trigger" type="button" aria-expanded="false" aria-controls="stormSwitcherMenu">
      <i class="ph ph-hurricane storm-switcher-icon" aria-hidden="true"></i>
      <span class="storm-switcher-copy"><strong>${escapeHtml(stormDisplayName(selectedStorm))}</strong><small>${storms.length} 个活跃台风</small></span>
      <i class="ph ph-caret-down" aria-hidden="true"></i>
    </button>
    <div class="storm-switcher-menu" id="stormSwitcherMenu" hidden>
      <div class="storm-switcher-menu-heading"><strong>活跃台风</strong><small>地图保留全部路径</small></div>
      <div class="storm-switcher-list">${ranked.map(storm => {
        const selected = storm.id === state.stormId;
        const classification = classLabels[storm.classification] || classLabels.unknown;
        const distance = locationData ? distanceKm(locationData, storm.position) : null;
        const proximity = distance === null ? '' : `${Math.round(distance).toLocaleString('zh-CN')} km`;
        return `<button class="storm-switch${selected ? ' active' : ''}" type="button" data-storm-id="${escapeHtml(storm.id)}" data-storm-zj="${escapeHtml(storm.providerIds?.zhejiang || '')}" aria-pressed="${selected}">
          <span class="storm-switch-dot" aria-hidden="true"></span>
          <span class="storm-switch-copy"><strong>${escapeHtml(stormDisplayName(storm))}</strong><small>${escapeHtml(classification)}${proximity ? ` · ${proximity}` : ''}</small></span>
          ${selected ? '<i class="ph ph-check" aria-hidden="true"></i>' : ''}
        </button>`;
      }).join('')}</div>
    </div>`;
    switcher.hidden = false;
    const trigger = switcher.querySelector('.storm-switcher-trigger');
    const menu = switcher.querySelector('.storm-switcher-menu');
    trigger.addEventListener('click', () => {
      const opening = menu.hidden;
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
    });
    switcher.querySelectorAll('[data-storm-id]').forEach(button => {
      button.addEventListener('click', () => {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (button.dataset.stormId !== state.stormId) selectStorm(button.dataset.stormId, button.dataset.stormZj || '');
      });
    });
  }

  async function loadStormsSummary() {
    try {
      const cached = readCache('pulse.typhoons.summary.detail.v1');
      const payload = cached || await fetchJson('/api/typhoons');
      if (!cached) writeCache('pulse.typhoons.summary.detail.v1', payload);
      state.stormsSummary = (payload?.storms || []).filter(storm => storm?.active);
      return true;
    } catch (error) {
      state.stormsSummary = [];
      console.warn('Typhoon summary for switcher unavailable:', error);
      return false;
    }
  }

  async function selectStorm(stormId, zhejiangId = '') {
    const token = ++state.stormLoadToken;
    state.stormId = stormId;
    const query = zhejiangId ? `?zj=${encodeURIComponent(zhejiangId)}` : '';
    history.replaceState(null, '', `/typhoon/${encodeURIComponent(stormId)}${query}`);
    el('topbarStormName').textContent = '正在切换';
    renderStormSwitcher();
    await loadStormDetail(stormId, zhejiangId, token);
  }

  async function loadStormDetail(stormId, zhejiangId = '', token = ++state.stormLoadToken) {
    const cacheKey = `pulse.typhoon.detail.${stormId}.${zhejiangId || 'fallback'}.v6`;
    let detail = readCache(cacheKey);
    if (!detail || detail.schemaVersion !== '3') {
      detail = await fetchJson(`/api/typhoon?id=${encodeURIComponent(stormId)}${zhejiangId ? `&zj=${encodeURIComponent(zhejiangId)}` : ''}`);
      writeCache(cacheKey, detail);
    }
    if (token !== state.stormLoadToken || stormId !== state.stormId) return;
    state.detail = detail;
    state.windCirclePoint = detail.tracks?.observed?.at(-1) || detail.storm;
    renderOverview();
    renderLayerControls();
    renderSourceControls();
    renderAgencyList();
    preparePlayback();
    if (!state.map) initializeMap();
    else refreshMapForStorm();
  }

  function refreshMapForStorm() {
    const position = state.detail?.storm?.position;
    if (!state.map || !position) return;
    if (state.styleReady) rebuildStormLayers().catch(error => console.warn('Storm layer rebuild failed:', error));
    else {
      focusStormOnLoad();
      state.needsTrackFit = true;
    }
  }

  async function rebuildStormLayers() {
    const map = state.map;
    if (!map || !state.styleReady) return;
    state.needsTrackFit = true;
    ++state.styleGeneration;
    removeMarkers();
    removeOtherStormMarkers();
    const layerIds = map.getStyle().layers.map(layer => layer.id);
    const stormLayer = /^(track-|points-|forecast-cone|wind-circle|playback-|other-track-|other-points-)/;
    const removable = layerIds.filter(id => stormLayer.test(id));
    removable.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    Object.keys(map.getStyle().sources).filter(id => stormLayer.test(id)).forEach(sourceId => map.removeSource(sourceId));
    await hydrateMapStyle();
  }

  async function renderOtherStormTracks() {
    const map = state.map;
    if (!map || !map.getStyle()) return;
    const generation = state.styleGeneration;
    const stormId = state.stormId;
    const others = state.stormsSummary.filter(storm => storm?.active && storm.id && storm.id !== state.stormId);
    const loaded = (await Promise.all(others.map(async storm => {
      try {
        const zj = storm.providerIds?.zhejiang || '';
        const cacheKey = `pulse.typhoon.detail.${storm.id}.${zj || 'fallback'}.v6`;
        let detail = readCache(cacheKey);
        if (!detail || detail.schemaVersion !== '3') {
          detail = await fetchJson(`/api/typhoon?id=${encodeURIComponent(storm.id)}${zj ? `&zj=${encodeURIComponent(zj)}` : ''}`);
          writeCache(cacheKey, detail);
        }
        const observed = detail?.tracks?.observed || [];
        const lines = [];
        if (observed.length > 1) lines.push({ points: observed, sourceId: 'observed', color: '#9ab7c8' });
        for (const track of detail?.tracks?.forecasts || []) {
          const points = track.points?.filter(point => hasNumber(point?.position?.lat) && hasNumber(point?.position?.lon));
          if (points?.length > 1) lines.push({ points, sourceId: track.id, color: track.color || '#9ab7c8' });
        }
        if (lines.length) return { id: storm.id, name: stormDisplayName(storm), zhejiangId: zj, lines, points: lines.flatMap(line => line.points) };
      } catch (error) {
        console.warn(`Other storm track unavailable for ${storm.id}:`, error);
      }
      return null;
    }))).filter(Boolean);
    if (generation !== state.styleGeneration || stormId !== state.stormId || !state.styleReady) return;
    state.otherStormTracks.forEach(item => {
      [`other-track-${item.id}`, `other-points-${item.id}`].forEach(id => {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      });
    });
    state.otherStormTracks = loaded;
    removeOtherStormMarkers();
    loaded.forEach(item => {
      if (state.stormId === item.id || map.getSource(`other-track-${item.id}`)) return;
      const features = item.lines.map(line => lineFeature(line.points, { sourceId: line.sourceId, color: line.color }));
      map.addSource(`other-track-${item.id}`, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({ id: `other-track-${item.id}`, type: 'line', source: `other-track-${item.id}`, paint: {
        'line-color': ['coalesce', ['get', 'color'], '#8fb6c9'], 'line-width': 1.8, 'line-opacity': .56, 'line-dasharray': [1.5, 1.8]
      } }, firstStormLayer());
      const observedLine = item.lines.find(line => line.sourceId === 'observed');
      const lastPoint = observedLine?.points.at(-1) || item.lines[0]?.points.at(0);
      if (!lastPoint?.position) return;
      addOtherStormMarker(item, lastPoint);
    });
    return loaded;
  }

  function renderOverview() {
    const detail = state.detail;
    const storm = detail.storm;
    const name = storm.name?.zh || storm.name?.display || '未命名热带系统';
    const fullName = storm.name?.en && storm.name.en !== name ? `${name}（${storm.name.en}）` : name;
    const intensity = storm.intensity || {};
    const classification = classLabels[storm.classification] || classLabels.unknown;
    const reference = referenceFor(storm.position);
    el('topbarStormName').textContent = fullName;
    el('topbarUpdated').textContent = `更新 ${formatDate(storm.updatedAt)}`;
    el('overviewUpdated').textContent = formatDate(storm.updatedAt, true);
    el('topbarStatusDot').className = `status-dot${detail.status === 'ok' ? '' : ' error'}`;
    el('stormName').textContent = fullName;
    el('stormSubtitle').textContent = `${classification} · ${storm.source?.provider || '台风路径汇聚'}`;
    el('windValue').textContent = hasNumber(intensity.value) ? `${Math.round(Number(intensity.value))} ${intensity.unit || 'm/s'}${hasNumber(intensity.windForceScale) ? ` · ${intensity.windForceScale}级` : ''}` : '未提供';
    el('windNote').textContent = intensity.windAveragePeriodMinutes ? `${intensity.windAveragePeriodMinutes} 分钟平均风` : '当前分析';
    el('pressureValue').textContent = hasNumber(intensity.centralPressureHpa) ? `${Math.round(Number(intensity.centralPressureHpa))} hPa` : '未提供';
    el('pressureNote').textContent = hasNumber(intensity.centralPressureHpa) ? '当前中心气压' : '等待官方分析更新';
    el('positionValue').textContent = positionText(storm.position);
    el('positionTime').textContent = formatDate(storm.position?.validAt);
    el('referenceValue').textContent = reference?.label || '暂无所在地信息';
    el('referenceNote').textContent = reference?.note || '返回天气页重新定位后可计算';
    renderWindRadiusSummary(storm);
    const trend = detail.trend || {};
    el('trendSource').textContent = trend.sourceLabel ? `参考 ${trend.sourceLabel}` : '综合最新路径';
    el('trendTitle').textContent = trend.strength || '趋势待确认';
    el('trendDetail').textContent = trend.summary || '等待最新预报路径';
    el('dataStatus').textContent = detail.status === 'ok' ? '数据正常' : '部分数据暂不可用';
    el('sourceHealth').innerHTML = (detail.sourceHealth || []).map(source => {
      const status = source.status === 'ok' ? '正常' : (source.status === 'linked' ? '已关联' : '暂不可用');
      return `<div class="health-row"><span>${escapeHtml(source.id.replace('zhejiang-multisource-track', '多机构路径').replace('gdacs-detail', 'GDACS 事件'))}</span><span>${status}</span></div>`;
    }).join('');
    el('disclaimer').textContent = detail.disclaimer || '';
    el('reportLink').href = storm.source?.url || 'https://typhoon.slt.zj.gov.cn/';
    document.title = `${fullName} 台风追踪 · Pulse`;
  }

  function focusCurrent() {
    const position = state.detail?.storm?.position;
    const current = state.detail?.tracks?.observed?.at(-1) || state.detail?.storm;
    pausePlayback();
    state.playbackActive = false;
    updatePlaybackTime(state.playbackCurrentAt);
    setWindCirclePoint(current);
    if (state.map && position) state.map.flyTo({ center: [position.lon, position.lat], zoom: 6.3, padding: mapPadding(), retainPadding: false, duration: 650 });
  }

  function focusUserLocation() {
    const locationData = storedWeatherLocation({ allowDefault: false });
    if (state.map && locationData) state.map.flyTo({ center: [locationData.lon, locationData.lat], zoom: 7.2, padding: mapPadding(), retainPadding: false, duration: 650 });
  }

  function setupInteractions() {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTheme);
    new MutationObserver(() => {
      const theme = document.documentElement.dataset.theme;
      if (theme !== state.theme && ['light', 'dark'].includes(theme)) syncTheme(theme);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    let resizeFrame;
    addEventListener('resize', () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        state.map?.resize();
        if (state.rendererUnavailable) renderOutlineMap();
        else fitAgencyTrack(state.selectedAgencyId);
      });
    }, { passive: true });
    const selectOutlinePoint = event => {
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const key = event.target.closest('[data-point-key]')?.dataset.pointKey;
      const point = state.pointsByKey.get(key);
      if (point) { event.preventDefault(); showNode(point, point.kind === 'current'); }
    };
    el('mapFallback').addEventListener('click', selectOutlinePoint);
    el('mapFallback').addEventListener('keydown', selectOutlinePoint);
    addEventListener('storage', event => {
      if (!event.key || ['themeMode', 'theme'].includes(event.key)) syncTheme();
    });
    addEventListener('pageshow', syncTheme);
    document.querySelectorAll('[data-basemap]').forEach(button => button.addEventListener('click', () => setBasemap(button.dataset.basemap)));
    el('layerButton').addEventListener('click', () => {
      const opening = el('layerPanel').hidden;
      el('layerPanel').hidden = !opening;
      el('layerButton').setAttribute('aria-expanded', String(opening));
      state.map?.scheduleResizeAfterLayout?.();
    });
    el('closeLayerButton').addEventListener('click', () => {
      el('layerPanel').hidden = true;
      el('layerButton').setAttribute('aria-expanded', 'false');
      state.map?.scheduleResizeAfterLayout?.();
    });
    el('closeNodeButton').addEventListener('click', () => { el('nodeCard').hidden = true; setWindCirclePoint(state.detail?.tracks?.observed?.at(-1) || state.detail?.storm); });
    el('windFieldButton').addEventListener('click', () => { setWeatherVisible('wind-field', !state.activeWeather.has('wind-field')); });
    el('waveHeightButton').addEventListener('click', () => { setWeatherVisible('wave-height', !state.activeWeather.has('wave-height')); });
    el('focusCurrentButton').addEventListener('click', focusCurrent);
    el('userLocationButton').addEventListener('click', focusUserLocation);
    el('clearAgencyFilter').addEventListener('click', () => selectAgencyTrack(null));
    el('playbackToggle').addEventListener('click', togglePlayback);
    el('playbackSlider').addEventListener('input', event => {
      pausePlayback();
      const time = state.playbackStartAt + Number(event.target.value) * 60000;
      updatePlaybackTime(time, { activate: true, keepVisible: true });
    });
    el('weatherOpacity').addEventListener('input', event => {
      state.weatherOpacity = Number(event.target.value) / 100;
      (state.detail?.mapConfig?.weatherLayers || []).forEach(layer => {
        if (state.map?.getLayer(`weather-${layer.id}`)) state.map.setPaintProperty(`weather-${layer.id}`, 'raster-opacity', layerOpacity(layer));
      });
      modelFieldLayers.forEach(id => {
        if (state.fieldRenderer?.id === id) state.fieldRenderer.setOpacity(fieldOpacity());
      });
    });
    el('shareButton').addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: document.title, url: location.href });
        else await navigator.clipboard.writeText(location.href);
      } catch {}
    });
    document.addEventListener('click', event => {
      const switcher = el('stormSwitcher');
      if (!switcher?.contains(event.target)) {
        const menu = switcher?.querySelector('.storm-switcher-menu');
        const trigger = switcher?.querySelector('.storm-switcher-trigger');
        if (menu && trigger) {
          menu.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
        }
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const switcher = el('stormSwitcher');
      const menu = switcher?.querySelector('.storm-switcher-menu');
      const trigger = switcher?.querySelector('.storm-switcher-trigger');
      if (menu && trigger) {
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  async function init() {
    syncTheme();
    setupInteractions();
    initializeMap();
    const userLocationRequest = resolveUserLocation();
    state.stormId = currentIdFromPath();
    const zhejiangId = new URLSearchParams(location.search).get('zj') || '';
    try {
      const summaryAvailable = await loadStormsSummary();
      if (!state.stormId) {
        if (!summaryAvailable) throw new Error('台风活动数据暂时不可用，请稍后重试');
        const storm = state.stormsSummary[0];
        if (storm) {
          state.stormId = storm.id;
        } else {
          el('topbarStormName').textContent = '当前无活跃台风';
          el('topbarUpdated').textContent = '暂无路径可显示';
          el('insightPanel').hidden = true;
          el('trackPlayback').hidden = true;
          el('sourceStrip').hidden = true;
          el('emptyMapState').hidden = false;
          el('typhoonApp').classList.add('is-empty');
          initializeMap();
          el('pageState').hidden = true;
          return;
        }
      }
      renderStormSwitcher();
      await loadStormDetail(state.stormId, zhejiangId);
      userLocationRequest.then(locationData => {
        if (!locationData) return;
        renderOverview();
        renderUserLocationMarker();
        renderStormSwitcher();
      });
      el('pageState').hidden = true;
    } catch (error) {
      el('topbarStatusDot').className = 'status-dot error';
      el('topbarUpdated').textContent = '数据连接失败';
      el('pageState').querySelector('strong').textContent = '台风资料暂时不可用';
      el('pageState').querySelector('span').textContent = error.name === 'AbortError' ? '请求超时，请稍后重试' : error.message;
    }
  }

  init();
})();
