const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const keyFor = (lon, lat) => `${Number(lon).toFixed(3)}:${Number(lat).toFixed(3)}`;

function hexToRgb(value) {
  const hex = String(value).replace('#', '');
  const normalized = hex.length === 3 ? [...hex].map(character => character + character).join('') : hex;
  return [0, 2, 4].map(index => Number.parseInt(normalized.slice(index, index + 2), 16));
}

export function interpolateFieldColor(stops, value) {
  const ordered = [...stops].sort((a, b) => a[0] - b[0]);
  if (!ordered.length) return [255, 255, 255];
  if (value <= ordered[0][0]) return hexToRgb(ordered[0][1]);
  if (value >= ordered.at(-1)[0]) return hexToRgb(ordered.at(-1)[1]);
  const upperIndex = ordered.findIndex(stop => value <= stop[0]);
  const lower = ordered[upperIndex - 1];
  const upper = ordered[upperIndex];
  const ratio = (value - lower[0]) / (upper[0] - lower[0] || 1);
  const from = hexToRgb(lower[1]);
  const to = hexToRgb(upper[1]);
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio));
}

function uniqueSorted(values) { return [...new Set(values.map(value => Number(value).toFixed(3)))].map(Number).sort((a, b) => a - b); }

export function buildFieldInterpolator(geojson) {
  const features = (geojson?.features || []).filter(feature => feature?.geometry?.type === 'Point');
  const lons = uniqueSorted(features.map(feature => feature.geometry.coordinates[0]));
  const lats = uniqueSorted(features.map(feature => feature.geometry.coordinates[1]));
  if (lons.length < 2 || lats.length < 2) return null;
  const cells = new Map(features.map(feature => [keyFor(feature.geometry.coordinates[0], feature.geometry.coordinates[1]), feature.properties || {}]));
  const minLon = lons[0], maxLon = lons.at(-1), minLat = lats[0], maxLat = lats.at(-1);
  const stepLon = Math.min(...lons.slice(1).map((value, index) => value - lons[index]).filter(value => value > 0));
  const stepLat = Math.min(...lats.slice(1).map((value, index) => value - lats[index]).filter(value => value > 0));

  function sample(lon, lat) {
    if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null;
    const xPosition = clamp((lon - minLon) / stepLon, 0, lons.length - 1);
    const yPosition = clamp((lat - minLat) / stepLat, 0, lats.length - 1);
    const x0 = Math.min(lons.length - 2, Math.floor(xPosition));
    const y0 = Math.min(lats.length - 2, Math.floor(yPosition));
    const tx = clamp(xPosition - x0, 0, 1);
    const ty = clamp(yPosition - y0, 0, 1);
    const candidates = [
      [cells.get(keyFor(lons[x0], lats[y0])), (1 - tx) * (1 - ty)],
      [cells.get(keyFor(lons[x0 + 1], lats[y0])), tx * (1 - ty)],
      [cells.get(keyFor(lons[x0], lats[y0 + 1])), (1 - tx) * ty],
      [cells.get(keyFor(lons[x0 + 1], lats[y0 + 1])), tx * ty]
    ];
    let weight = 0, value = 0, east = 0, north = 0, vectorWeight = 0;
    for (const [cell, cellWeight] of candidates) {
      if (!cell || !finite(cell.value) || cellWeight <= 0) continue;
      weight += cellWeight;
      value += Number(cell.value) * cellWeight;
      if (finite(cell.direction)) {
        const toward = (Number(cell.direction) + 180) * Math.PI / 180;
        east += Math.sin(toward) * cellWeight;
        north += Math.cos(toward) * cellWeight;
        vectorWeight += cellWeight;
      }
    }
    if (weight < .5) return null;
    const magnitude = Math.hypot(east, north);
    return {
      value: value / weight,
      east: magnitude && vectorWeight ? east / magnitude : 0,
      north: magnitude && vectorWeight ? north / magnitude : 0
    };
  }

  return { minLon, maxLon, minLat, maxLat, lonSpan: maxLon - minLon, latSpan: maxLat - minLat, sample };
}

function createParticleAnimator(canvas, interpolator, mode, map) {
  const context = canvas.getContext('2d', { alpha: true });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const particles = [];
  let frameId = null;
  let lastTime = 0;
  let width = 0, height = 0;

  function resize() {
    const mapCanvas = map.getCanvas();
    width = Math.max(1, mapCanvas.clientWidth);
    height = Math.max(1, mapCanvas.clientHeight);
    const ratio = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  resize();
  const particleCount = Math.round(clamp(width * height / (mode === 'wind' ? 2600 : 3600), mode === 'wind' ? 120 : 90, mode === 'wind' ? 340 : 240));

  function sampleAt(x, y) {
    return interpolator.sample(
      interpolator.minLon + x * interpolator.lonSpan,
      interpolator.maxLat - y * interpolator.latSpan
    );
  }

  function respawn(particle) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const x = Math.random(), y = Math.random();
      const sample = sampleAt(x, y);
      if (!sample || (!sample.east && !sample.north)) continue;
      particle.x = x;
      particle.y = y;
      particle.age = 0;
      particle.maxAge = mode === 'wind' ? 55 + Math.random() * 75 : 20 + Math.random() * 34;
      return particle;
    }
    particle.age = Number.POSITIVE_INFINITY;
    return particle;
  }

  for (let index = 0; index < particleCount; index += 1) particles.push(respawn({}));

  function screenPoint(x, y) {
    return map.project([
      interpolator.minLon + x * interpolator.lonSpan,
      interpolator.maxLat - y * interpolator.latSpan
    ]);
  }

  function drawStatic() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round';
    context.strokeStyle = mode === 'wind' ? 'rgba(241,250,255,.64)' : 'rgba(226,249,255,.72)';
    context.lineWidth = mode === 'wind' ? .85 : 1.15;
    for (const particle of particles.slice(0, mode === 'wind' ? 150 : 110)) {
      const sample = sampleAt(particle.x, particle.y);
      if (!sample) continue;
      const point = screenPoint(particle.x, particle.y);
      const length = mode === 'wind' ? 5 + Math.min(10, sample.value * .22) : 4 + Math.min(9, sample.value * .75);
      context.beginPath();
      context.moveTo(point.x - sample.east * length, point.y + sample.north * length);
      context.lineTo(point.x + sample.east * length, point.y - sample.north * length);
      context.stroke();
    }
  }

  function animate(time) {
    const frameScale = clamp((time - lastTime || 16.7) / 16.7, .5, 2.2);
    lastTime = time;
    context.save();
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = mode === 'wind' ? 'rgba(0,0,0,.94)' : 'rgba(0,0,0,.82)';
    context.fillRect(0, 0, width, height);
    context.restore();
    context.lineCap = 'round';
    context.strokeStyle = mode === 'wind' ? 'rgba(241,250,255,.62)' : 'rgba(226,249,255,.78)';
    context.lineWidth = mode === 'wind' ? .8 : 1.15;

    for (const particle of particles) {
      if (particle.age++ > particle.maxAge) { respawn(particle); continue; }
      const sample = sampleAt(particle.x, particle.y);
      if (!sample || (!sample.east && !sample.north)) { respawn(particle); continue; }
      const travelDegrees = (mode === 'wind'
        ? .016 + Math.min(40, sample.value) * .0021
        : .012 + Math.min(12, sample.value) * .0024) * frameScale;
      const nextX = particle.x + sample.east * travelDegrees / interpolator.lonSpan;
      const nextY = particle.y - sample.north * travelDegrees / interpolator.latSpan;
      if (nextX < 0 || nextX > 1 || nextY < 0 || nextY > 1 || !sampleAt(nextX, nextY)) { respawn(particle); continue; }
      const currentPoint = screenPoint(particle.x, particle.y);
      const nextPoint = screenPoint(nextX, nextY);
      context.beginPath();
      if (mode === 'waves') {
        const length = 3.5 + Math.min(8, sample.value * .8);
        context.moveTo(currentPoint.x - sample.east * length * .35, currentPoint.y + sample.north * length * .35);
        context.lineTo(currentPoint.x + sample.east * length * .65, currentPoint.y - sample.north * length * .65);
      } else {
        context.moveTo(currentPoint.x, currentPoint.y);
        context.lineTo(nextPoint.x, nextPoint.y);
      }
      context.stroke();
      particle.x = nextX;
      particle.y = nextY;
    }
    frameId = requestAnimationFrame(animate);
  }

  return {
    start() {
      if (reducedMotion) { drawStatic(); return; }
      if (frameId === null) frameId = requestAnimationFrame(animate);
    },
    stop() {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      lastTime = 0;
    },
    clear() { context.clearRect(0, 0, width, height); },
    resize
  };
}

export function createFieldRenderer({ map, id, field, style, opacity = .7, beforeLayer }) {
  const interpolator = buildFieldInterpolator(field?.geojson);
  if (!interpolator) throw new Error(`${style.title}网格不足，无法生成连续场`);
  const maximum = style.colors.at(-1)[0];
  const weightStops = style.colors.flatMap(([value]) => [value, Math.max(.025, value / maximum)]);
  const colorStops = style.colors.slice(1).flatMap(([value, color]) => [value / maximum, color]);
  const isWave = style.payload === 'waves';
  const sourceId = `field-${id}`;
  const surfaceLayer = `field-${id}-surface`;
  const directionLayer = `field-${id}-direction`;
  map.addSource(sourceId, { type: 'geojson', data: field.geojson });
  map.addLayer({
    id: surfaceLayer,
    type: 'heatmap',
    source: sourceId,
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'value'], ...weightStops],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, isWave ? 1.08 : .62, 7, isWave ? 1.42 : .88],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, isWave ? 74 : 64, 5, isWave ? 132 : 112, 7, isWave ? 240 : 210, 10, isWave ? 520 : 460],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(44,123,182,0)', .02, style.colors[0][1], ...colorStops],
      'heatmap-opacity': opacity
    }
  }, beforeLayer);
  const particleCanvas = document.createElement('canvas');
  particleCanvas.className = `model-field-particle-canvas ${style.payload}`;
  particleCanvas.setAttribute('aria-hidden', 'true');
  particleCanvas.style.opacity = String(Math.min(1, opacity + .16));
  map.getCanvasContainer().appendChild(particleCanvas);
  const animator = createParticleAnimator(particleCanvas, interpolator, style.payload, map);
  const resize = () => animator.resize();
  map.on('resize', resize);
  animator.start();

  return {
    id,
    layerIds: [surfaceLayer],
    setVisible(visible) {
      if (map.getLayer(surfaceLayer)) map.setLayoutProperty(surfaceLayer, 'visibility', visible ? 'visible' : 'none');
      particleCanvas.hidden = !visible;
      visible ? animator.start() : animator.stop();
    },
    setOpacity(value) {
      if (map.getLayer(surfaceLayer)) map.setPaintProperty(surfaceLayer, 'heatmap-opacity', value);
      particleCanvas.style.opacity = String(Math.min(1, value + .16));
    },
    destroy({ remove = true } = {}) {
      animator.stop();
      animator.clear();
      map.off('resize', resize);
      particleCanvas.remove();
      if (!remove) return;
      if (map.getLayer(surfaceLayer)) map.removeLayer(surfaceLayer);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  };
}
