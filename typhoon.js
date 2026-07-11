(() => {
  const CACHE_MS = 5 * 60 * 1000;
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
    pointsByKey: new Map(),
    rainViewer: null,
    styleGeneration: 0,
    boundLayerIds: new Set()
  };

  const el = id => document.getElementById(id);
  const hasNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const classLabels = {
    super_typhoon: '超强台风', severe_typhoon: '强台风', typhoon: '台风',
    severe_tropical_storm: '强热带风暴', tropical_storm: '热带风暴',
    tropical_depression: '热带低压', tropical_disturbance: '热带扰动', unknown: '热带气旋'
  };
  const layerIcons = { radar: 'ph-radar', 'himawari-ir': 'ph-cloud', 'himawari-visible': 'ph-sun-horizon', precipitation: 'ph-drop-half-bottom' };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function currentIdFromPath() {
    return location.pathname.match(/^\/typhoon\/(gdacs-tc-\d+)\/?$/)?.[1] || null;
  }

  function readCache(key) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!cached || !cached.savedAt || Date.now() - cached.savedAt > CACHE_MS) return null;
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

  function storedWeatherLocation() {
    const value = readCache('pulse.weather.location.v1');
    if (!value) return { lat: 31.123, lon: 121.405, label: '上海' };
    return { lat: Number(value.lat), lon: Number(value.lon), label: String(value.city || value.displayName || '所在地').split('·')[0].trim().replace(/市$/, '') };
  }

  function referenceFor(position) {
    const locationData = storedWeatherLocation();
    if (!locationData) return null;
    const distance = distanceKm(locationData, position);
    if (distance === null) return null;
    const direction = directionText(locationData, position);
    return { label: `位于${locationData.label}以${direction}约 ${Math.round(distance)} 公里`, note: `相对${locationData.label}当前位置` };
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(payload?.error?.message || `请求失败（${response.status}）`);
      return payload;
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

  function wmsTiles(layerName) {
    const time = state.detail?.storm?.position?.validAt ? new Date(state.detail.storm.position.validAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    return [`https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${encodeURIComponent(layerName)}&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}&TIME=${time}`];
  }

  async function getRainViewer() {
    if (state.rainViewer) return state.rainViewer;
    const payload = await fetchJson('https://api.rainviewer.com/public/weather-maps.json');
    const frame = payload?.radar?.nowcast?.[0] || payload?.radar?.past?.at(-1);
    if (!payload?.host || !frame?.path) throw new Error('雷达图层暂不可用');
    state.rainViewer = { tiles: [`${payload.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`], validAt: new Date(Number(frame.time) * 1000).toISOString() };
    return state.rainViewer;
  }

  async function addWeatherLayers(generation) {
    const map = state.map;
    if (!map || !map.getStyle()) return;
    const config = state.detail?.mapConfig?.weatherLayers || [];
    for (const layer of config) {
      if (generation !== state.styleGeneration || map.getSource(`weather-${layer.id}`)) continue;
      try {
        const tiles = layer.type === 'rainviewer' ? (await getRainViewer()).tiles : wmsTiles(layer.layer);
        if (generation !== state.styleGeneration || !map.getStyle()) return;
        map.addSource(`weather-${layer.id}`, { type: 'raster', tiles, tileSize: 256, attribution: layer.provider });
        map.addLayer({
          id: `weather-${layer.id}`,
          type: 'raster',
          source: `weather-${layer.id}`,
          layout: { visibility: state.activeWeather.has(layer.id) ? 'visible' : 'none' },
          paint: { 'raster-opacity': state.weatherOpacity, 'raster-fade-duration': 180 }
        }, map.getLayer('track-observed-glow') ? 'track-observed-glow' : undefined);
      } catch (error) {
        const input = document.querySelector(`[data-weather-layer="${layer.id}"]`);
        if (input) { input.checked = false; input.disabled = true; }
        state.activeWeather.delete(layer.id);
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
      map.addLayer({ id: 'points-observed', type: 'circle', source: 'points-observed', layout: { visibility: state.activeSources.has('observed') ? 'visible' : 'none' }, paint: { 'circle-radius': ['case', ['==', ['get','kind'], 'current'], 7, 3], 'circle-color': '#f2fbff', 'circle-stroke-color': '#2d9edb', 'circle-stroke-width': ['case', ['==', ['get','kind'], 'current'], 3, 1], 'circle-opacity': .9 } });
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
  }

  function markerLabel(point) { return formatDate(point.validAt, true).replace('日', '日 '); }

  function addMarker(point, sourceId, color, current = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.source = sourceId;
    button.setAttribute('aria-label', `${point.sourceLabel || '路径'} ${formatDate(point.validAt)} 节点`);
    if (current) {
      button.className = 'current-marker';
      button.innerHTML = '<i></i>';
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

  function fitTracks() {
    const tracks = state.detail?.tracks;
    if (!state.map || !tracks?.observed?.length) return;
    const bounds = new maplibregl.LngLatBounds();
    tracks.observed.slice(-30).forEach(point => bounds.extend([point.position.lon, point.position.lat]));
    tracks.forecasts.forEach(track => track.points.forEach(point => bounds.extend([point.position.lon, point.position.lat])));
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: window.innerWidth < 640 ? { top: 100, right: 42, bottom: 100, left: 42 } : 90, maxZoom: 7, duration: 700 });
  }

  async function hydrateMapStyle() {
    const generation = ++state.styleGeneration;
    addTrackLayers();
    renderMarkers();
    bindPointInteractions();
    await addWeatherLayers(generation);
  }

  function initializeMap() {
    if (!window.maplibregl) { el('mapFallback').hidden = false; return; }
    const position = state.detail.storm.position;
    state.map = new maplibregl.Map({ container: 'typhoonMap', style: mapStyle(), center: [position.lon, position.lat], zoom: 5.2, attributionControl: false, maxZoom: 10 });
    state.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    state.map.on('load', async () => {
      await hydrateMapStyle();
      if (!state.map.__pulseFitted) { state.map.__pulseFitted = true; fitTracks(); }
    });
    state.map.on('error', event => {
      const message = String(event?.error?.message || '');
      if (!/Failed to fetch|AJAXError/.test(message)) console.warn('Map error:', event?.error || event);
    });
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

  function setWeatherVisible(id, visible) {
    visible ? state.activeWeather.add(id) : state.activeWeather.delete(id);
    if (state.map?.getLayer(`weather-${id}`)) state.map.setLayoutProperty(`weather-${id}`, 'visibility', visible ? 'visible' : 'none');
  }

  function renderLayerControls() {
    const layers = state.detail?.mapConfig?.weatherLayers || [];
    state.activeWeather = new Set(layers.filter(layer => layer.defaultVisible).map(layer => layer.id));
    el('weatherLayerOptions').innerHTML = layers.map(layer => `
      <label class="layer-option">
        <i class="ph ${layerIcons[layer.id] || 'ph-cloud'}"></i>
        <span>${escapeHtml(layer.label)}<small>${escapeHtml(layer.provider)}</small></span>
        <input type="checkbox" data-weather-layer="${escapeHtml(layer.id)}" ${layer.defaultVisible ? 'checked' : ''}>
      </label>`).join('');
    el('weatherLayerOptions').querySelectorAll('input').forEach(input => input.addEventListener('change', () => setWeatherVisible(input.dataset.weatherLayer, input.checked)));
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
    el('weatherOpacity').addEventListener('input', event => {
      state.weatherOpacity = Number(event.target.value) / 100;
      (state.detail?.mapConfig?.weatherLayers || []).forEach(layer => { if (state.map?.getLayer(`weather-${layer.id}`)) state.map.setPaintProperty(`weather-${layer.id}`, 'raster-opacity', state.weatherOpacity); });
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
    const cacheKey = `pulse.typhoon.detail.${state.stormId}.${zhejiangId || 'fallback'}.v3`;
    try {
      let detail = readCache(cacheKey);
      if (!detail || detail.schemaVersion !== '2') {
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
