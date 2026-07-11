import {
  buildGibsDomainUrl,
  buildGibsWmtsUrl,
  chooseLatestAvailableTime,
  chooseSynchronizedFrame
} from '/typhoon-layer-clock.mjs';

(() => {
  const CACHE_MS = 5 * 60 * 1000;
  const LAYER_CACHE_MS = 10 * 60 * 1000;
  const LOCATION_CACHE_MS = 24 * 60 * 60 * 1000;
  const state = {
    map: null,
    detail: null,
    stormId: null,
    theme: 'dark',
    basemap: 'standard',
    activeWeather: new Set(['radar']),
    activeSources: new Set(['observed']),
    weatherOpacity: .58,
    markers: [],
    userLocationMarker: null,
    pointsByKey: new Map(),
    layerClock: null,
    styleGeneration: 0,
    boundLayerIds: new Set(),
    controlsInitialized: false
  };

  const el = id => document.getElementById(id);
  const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const classLabels = {
    super_typhoon: '超强台风', severe_typhoon: '强台风', typhoon: '台风',
    severe_tropical_storm: '强热带风暴', tropical_storm: '热带风暴',
    tropical_depression: '热带低压', tropical_disturbance: '热带扰动', unknown: '热带气旋'
  };
  const layerIcons = { 'himawari-ir': 'ph-cloud', 'himawari-visible': 'ph-sun-horizon', precipitation: 'ph-drop-half-bottom' };

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

  function storedWeatherLocation({ allowDefault = true } = {}) {
    const value = readCache('pulse.weather.location.v1', LOCATION_CACHE_MS);
    if (!value) return allowDefault ? { lat: 31.123, lon: 121.405, label: '上海', cached: false } : null;
    const locationData = {
      lat: Number(value.lat),
      lon: Number(value.lon),
      label: String(value.city || value.displayName || '所在地').split('·')[0].trim().replace(/市$/, ''),
      cached: true
    };
    return [locationData.lat, locationData.lon].every(Number.isFinite) ? locationData : null;
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

  function standardStyle() {
    const tileTheme = state.theme === 'light' ? 'light_all' : 'dark_all';
    return {
      version: 8,
      sources: {
        carto: {
          type: 'raster', tileSize: 256,
          tiles: [`https://a.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}@2x.png`, `https://b.basemaps.cartocdn.com/${tileTheme}/{z}/{x}/{y}@2x.png`],
          attribution: 'CARTO · OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'basemap-standard', type: 'raster', source: 'carto' }]
    };
  }

  function satelliteStyle() {
    return {
      version: 8,
      sources: {
        imagery: { type: 'raster', tileSize: 256, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Esri World Imagery' },
        reference: { type: 'raster', tileSize: 256, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] }
      },
      layers: [
        { id: 'basemap-satellite', type: 'raster', source: 'imagery' },
        { id: 'basemap-reference', type: 'raster', source: 'reference', paint: { 'raster-opacity': .88 } }
      ]
    };
  }

  function mapStyle() { return state.basemap === 'satellite' ? satelliteStyle() : standardStyle(); }

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
    const cacheKey = `pulse.typhoon.layers.${targetAt}.v2`;
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
    if (!map || !map.getStyle() || !state.layerClock) return;
    const config = state.detail?.mapConfig?.weatherLayers || [];
    for (const layer of config) {
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
        }, map.getLayer('track-observed-glow') ? 'track-observed-glow' : undefined);
      } catch (error) {
        console.warn(`${layer.label} unavailable:`, error);
      }
    }
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
        return { type: 'Feature', properties: { key, sourceId, color, kind: point.kind }, geometry: { type: 'Point', coordinates: [point.position.lon, point.position.lat] } };
      })
    };
  }

  function addTrackLayers() {
    const map = state.map;
    const tracks = state.detail?.tracks;
    if (!map || !map.getStyle() || !tracks) return;
    state.pointsByKey.clear();
    const observed = tracks.observed || [];
    if (observed.length > 1) {
      map.addSource('track-observed', { type: 'geojson', data: lineFeature(observed, { sourceId: 'observed' }) });
      map.addLayer({ id: 'track-observed-glow', type: 'line', source: 'track-observed', layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' }, paint: { 'line-color': '#c9efff', 'line-width': 8, 'line-opacity': .2, 'line-blur': 3 } });
      map.addLayer({ id: 'track-observed-line', type: 'line', source: 'track-observed', layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' }, paint: { 'line-color': '#f2fbff', 'line-width': 2.6, 'line-opacity': .95 } });
      map.addSource('points-observed', { type: 'geojson', data: pointCollection(observed, 'observed', '#f2fbff') });
      map.addLayer({
        id: 'points-observed', type: 'circle', source: 'points-observed',
        layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' },
        paint: {
          'circle-radius': ['case', ['==', ['get','kind'], 'current'], 1, 3],
          'circle-color': '#f2fbff',
          'circle-stroke-color': '#2d9edb',
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
      map.addLayer({ id: `points-${track.id}`, type: 'circle', source: `points-${track.id}`, layout: { visibility: state.activeSources.has(track.id) ? 'visible' : 'none' }, paint: { 'circle-radius': 4, 'circle-color': track.color, 'circle-stroke-color': '#f7fbfd', 'circle-stroke-width': 1.2 } });
    }
  }

  function removeMarkers() {
    state.markers.forEach(marker => marker.remove());
    state.markers = [];
    state.userLocationMarker?.remove();
    state.userLocationMarker = null;
  }

  function markerLabel(point) { return formatDate(point.validAt, true).replace('日', '日 '); }

  function addMarker(point, sourceId, color, current = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.source = sourceId;
    button.setAttribute('aria-label', `${point.sourceLabel || '路径'} ${formatDate(point.validAt)} 节点`);
    if (current) {
      button.className = 'current-marker';
      button.innerHTML = '<span class="typhoon-marker-core"><i class="ph ph-hurricane" aria-hidden="true"></i></span>';
    } else {
      button.className = 'track-key-marker';
      button.style.setProperty('--source-color', color);
      button.innerHTML = `<span class="dot"></span><small>${escapeHtml(markerLabel(point))}</small>`;
    }
    button.classList.toggle('is-hidden', !state.activeSources.has(sourceId));
    button.addEventListener('click', event => { event.stopPropagation(); showNode(point, current); });
    const marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat([point.position.lon, point.position.lat]).addTo(state.map);
    state.markers.push(marker);
  }

  function renderUserLocationMarker() {
    const locationData = storedWeatherLocation({ allowDefault: false });
    const button = el('userLocationButton');
    if (!state.map || !locationData) { button.hidden = true; return; }
    const markerElement = document.createElement('button');
    markerElement.type = 'button';
    markerElement.className = 'user-location-marker';
    markerElement.setAttribute('aria-label', `${locationData.label}天气位置`);
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
    const interval = Math.max(6, Math.ceil(observed.length / 10));
    observed.forEach((point, index) => {
      const current = index === observed.length - 1;
      if (current) addMarker(point, 'observed', '#f2fbff', true);
      else if (index % interval === 0) addMarker(point, 'observed', '#f2fbff');
    });
    for (const track of tracks.forecasts || []) {
      track.points.slice(1).forEach((point, index, points) => {
        if (track.id === 'cma' || index === points.length - 1) addMarker(point, track.id, track.color);
      });
    }
    renderUserLocationMarker();
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
    if (window.innerWidth <= 640) {
      const sheet = Math.min(260, Math.max(196, window.innerHeight * .25));
      return { top: 110, right: 38, bottom: sheet + 84, left: 38 };
    }
    if (window.innerWidth <= 900 && matchMedia('(orientation: portrait)').matches) {
      const sheet = Math.min(390, Math.max(280, window.innerHeight * .34));
      return { top: 100, right: 50, bottom: sheet + 82, left: 50 };
    }
    const panel = window.innerWidth <= 1180 ? 370 : 410;
    return { top: 92, right: panel, bottom: 76, left: 70 };
  }

  function fitTracks() {
    const tracks = state.detail?.tracks;
    if (!state.map || !tracks?.observed?.length) return;
    const bounds = new maplibregl.LngLatBounds();
    tracks.observed.slice(-30).forEach(point => bounds.extend([point.position.lon, point.position.lat]));
    tracks.forecasts.forEach(track => track.points.forEach(point => bounds.extend([point.position.lon, point.position.lat])));
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: mapPadding(), maxZoom: 7, duration: 700 });
  }

  async function hydrateMapStyle() {
    const generation = ++state.styleGeneration;
    state.boundLayerIds.clear();
    addTrackLayers();
    renderMarkers();
    bindPointInteractions();
    await addWeatherLayers(generation);
  }

  async function resolveAndLoadWeatherLayers() {
    try {
      state.layerClock = await resolveWeatherLayerClock();
    } catch (error) {
      state.layerClock = { message: '天气图层时间同步暂不可用', layers: {} };
      console.warn('Weather layer clock unavailable:', error);
    }
    renderLayerControls();
    await addWeatherLayers(state.styleGeneration);
  }

  function initializeMap() {
    if (!window.maplibregl) { el('mapFallback').hidden = false; return; }
    const position = state.detail.storm.position;
    state.map = new maplibregl.Map({ container: 'typhoonMap', style: mapStyle(), center: [position.lon, position.lat], zoom: 5.2, attributionControl: false, maxZoom: 10 });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    state.map.on('load', async () => {
      await hydrateMapStyle();
      if (!state.map.__pulseFitted) { state.map.__pulseFitted = true; fitTracks(); }
      resolveAndLoadWeatherLayers();
    });
    state.map.on('error', event => {
      const message = String(event?.error?.message || '');
      if (!/Failed to fetch|AJAXError/.test(message)) console.warn('Map error:', event?.error || event);
    });
    addEventListener('resize', () => state.map?.resize(), { passive: true });
  }

  function setBasemap(id) {
    if (!state.map || id === state.basemap) return;
    state.basemap = id;
    document.querySelectorAll('[data-basemap]').forEach(button => button.classList.toggle('active', button.dataset.basemap === id));
    removeMarkers();
    state.map.once('styledata', () => setTimeout(() => hydrateMapStyle().catch(error => console.warn('Map style restore failed:', error)), 0));
    state.map.setStyle(mapStyle());
  }

  function setSourceVisible(id, visible) {
    visible ? state.activeSources.add(id) : state.activeSources.delete(id);
    const layerIds = id === 'observed' ? ['track-observed-glow','track-observed-line','points-observed'] : [`track-${id}`,`points-${id}`];
    layerIds.forEach(layerId => { if (state.map?.getLayer(layerId)) state.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none'); });
    document.querySelectorAll(`.track-key-marker[data-source="${id}"], .current-marker[data-source="${id}"]`).forEach(marker => marker.classList.toggle('is-hidden', !visible));
    document.querySelector(`[data-source-toggle="${id}"]`)?.classList.toggle('active', visible);
  }

  function updateLegend() {
    el('weatherLegend').hidden = !['radar', 'precipitation'].some(id => state.activeWeather.has(id));
  }

  function setWeatherVisible(id, visible) {
    const resolved = state.layerClock?.layers?.[id];
    if (visible && !resolved?.available) return;
    visible ? state.activeWeather.add(id) : state.activeWeather.delete(id);
    if (state.map?.getLayer(`weather-${id}`)) state.map.setLayoutProperty(`weather-${id}`, 'visibility', visible ? 'visible' : 'none');
    updateLegend();
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
        : (resolved?.available ? `采样 ${formatDate(resolved.observedAt)}` : (resolved?.message || '该时次不可用'));
      if (unavailable) state.activeWeather.delete(layer.id);
      return `<label class="layer-option${unavailable ? ' is-unavailable' : ''}">
        ${layerIcon(layer)}
        <span class="layer-option-copy"><span>${escapeHtml(layer.label)}</span><small>${escapeHtml(status)}</small></span>
        <input type="checkbox" data-weather-layer="${escapeHtml(layer.id)}" ${state.activeWeather.has(layer.id) ? 'checked' : ''} ${unavailable ? 'disabled' : ''}>
      </label>`;
    }).join('');
    el('weatherLayerOptions').querySelectorAll('input').forEach(input => input.addEventListener('change', () => setWeatherVisible(input.dataset.weatherLayer, input.checked)));
    const clock = el('layerClockStatus');
    const skew = Math.abs(Number(state.layerClock?.skewMinutes || 0));
    clock.classList.toggle('warning', Boolean(state.layerClock && (!state.layerClock.synchronizedAt || skew > 30)));
    clock.querySelector('span').textContent = state.layerClock?.message || '正在对齐观测时次';
    updateLegend();
  }

  function renderSourceControls() {
    const tracks = state.detail.tracks;
    const sources = [{ id: 'observed', label: '实况', color: '#f2fbff' }, ...tracks.forecasts];
    state.activeSources = new Set(sources.map(source => source.id));
    el('sourceStrip').innerHTML = sources.map(source => `
      <button class="source-toggle active" type="button" data-source-toggle="${source.id}" style="--source-color:${source.color}">
        <i></i><span>${escapeHtml(source.label)}</span>
      </button>`).join('');
    el('sourceStrip').querySelectorAll('button').forEach(button => button.addEventListener('click', () => setSourceVisible(button.dataset.sourceToggle, !state.activeSources.has(button.dataset.sourceToggle))));
  }

  function renderAgencyList() {
    const tracks = state.detail.tracks?.forecasts || [];
    el('agencyCount').textContent = `${tracks.length} 个来源`;
    el('agencyList').innerHTML = tracks.map(track => {
      const last = track.points.at(-1);
      const intensity = last?.intensity || {};
      const strength = classLabels[last?.classification] || '强度待确认';
      return `<div class="agency-row" style="--source-color:${track.color}"><i class="agency-line"></i><div><strong>${escapeHtml(track.label)}</strong><span>${escapeHtml(track.agency)}</span></div><small>${escapeHtml(strength)}${hasNumber(intensity.windForceScale) ? ` · ${intensity.windForceScale}级` : ''}</small></div>`;
    }).join('');
  }

  function showNode(point, isCurrent = false) {
    const intensity = point.intensity || {};
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
    if (!isCurrent) rows.push(`<div class="node-context-row"><i class="ph ph-info"></i><span>该节点为 ${escapeHtml(source)} 预报位置，路径会随新一轮预报更新。</span></div>`);
    el('nodeContext').innerHTML = rows.join('');
    el('nodeCard').hidden = false;
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
    if (state.map && position) state.map.flyTo({ center: [position.lon, position.lat], zoom: 6.3, duration: 650 });
  }

  function focusUserLocation() {
    const locationData = storedWeatherLocation({ allowDefault: false });
    if (state.map && locationData) state.map.flyTo({ center: [locationData.lon, locationData.lat], zoom: 7.2, duration: 650 });
  }

  function setupInteractions() {
    document.querySelectorAll('[data-basemap]').forEach(button => button.addEventListener('click', () => setBasemap(button.dataset.basemap)));
    el('layerButton').addEventListener('click', () => {
      const opening = el('layerPanel').hidden;
      el('layerPanel').hidden = !opening;
      el('layerButton').setAttribute('aria-expanded', String(opening));
    });
    el('closeLayerButton').addEventListener('click', () => { el('layerPanel').hidden = true; el('layerButton').setAttribute('aria-expanded', 'false'); });
    el('closeNodeButton').addEventListener('click', () => { el('nodeCard').hidden = true; });
    el('focusCurrentButton').addEventListener('click', focusCurrent);
    el('userLocationButton').addEventListener('click', focusUserLocation);
    el('weatherOpacity').addEventListener('input', event => {
      state.weatherOpacity = Number(event.target.value) / 100;
      (state.detail?.mapConfig?.weatherLayers || []).forEach(layer => {
        if (state.map?.getLayer(`weather-${layer.id}`)) state.map.setPaintProperty(`weather-${layer.id}`, 'raster-opacity', layerOpacity(layer));
      });
    });
    el('shareButton').addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: document.title, url: location.href });
        else await navigator.clipboard.writeText(location.href);
      } catch {}
    });
  }

  async function init() {
    state.theme = resolveTheme();
    document.documentElement.dataset.theme = state.theme;
    setupInteractions();
    state.stormId = currentIdFromPath();
    if (!state.stormId) {
      el('pageState').querySelector('strong').textContent = '台风地址无效';
      el('pageState').querySelector('span').textContent = '请返回天气页重新进入';
      return;
    }
    const zhejiangId = new URLSearchParams(location.search).get('zj') || '';
    const cacheKey = `pulse.typhoon.detail.${state.stormId}.${zhejiangId || 'fallback'}.v4`;
    try {
      let detail = readCache(cacheKey);
      if (!detail || detail.schemaVersion !== '3') {
        detail = await fetchJson(`/api/typhoon?id=${encodeURIComponent(state.stormId)}${zhejiangId ? `&zj=${encodeURIComponent(zhejiangId)}` : ''}`);
        writeCache(cacheKey, detail);
      }
      state.detail = detail;
      renderOverview();
      renderLayerControls();
      renderSourceControls();
      renderAgencyList();
      initializeMap();
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
