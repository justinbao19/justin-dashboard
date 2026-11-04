const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));

export function splashIntensity(intensity) {
  return clamp(intensity);
}

export function spawnRate(intensity) {
  const value = splashIntensity(intensity);
  return 2.5 + value * 25;
}

export function buildTargetRect(element) {
  const rect = element.getBoundingClientRect();
  // DOMRect coordinates are prototype getters, so object spread omits them.
  return {
    element,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
    right: rect.right,
    visible: true
  };
}

export function secondaryDropletCount(intensity, random = Math.random) {
  const value = splashIntensity(intensity);
  return 3 + Math.min(5, Math.floor(random() * (3 + value * 5)));
}

export function selectTopRowCards(rects, isMobile = false) {
  const visible = (Array.isArray(rects) ? rects : [])
    .filter(rect => rect && rect.visible !== false && Number(rect.width) > 0 && Number(rect.height) > 0)
    .sort((a, b) => (Number(a.top) || 0) - (Number(b.top) || 0) || (Number(a.left) || 0) - (Number(b.left) || 0));
  if (isMobile) return visible.slice(0, 1);
  if (!visible.length) return [];
  const firstTop = Number(visible[0].top) || 0;
  return visible.filter(rect => Math.abs((Number(rect.top) || 0) - firstTop) <= 4);
}

export function isRainSplashScene(scene) {
  if (!scene) return false;
  const source = typeof scene === 'string'
    ? scene
    : [scene.weatherState, scene.sceneType, scene.particleType, scene.className, scene.skycon]
      .filter(Boolean).join(' ');
  const normalized = String(source).toLowerCase().replace(/-/g, '_');
  if (/snow|sleet/.test(normalized)) return false;
  return /rain|thunder|storm/.test(normalized);
}

export function splashAnimationEnabled({ reducedMotion = false, active = true, hidden = false, inView = true } = {}) {
  return !reducedMotion && active && !hidden && inView;
}

export function createSplashSystem({ width = 1, edgeY = 42, intensity = 0.6, random = Math.random } = {}) {
  return {
    width: Math.max(1, Number(width) || 1),
    edgeY: Math.max(0, Number(edgeY) || 0),
    intensity: splashIntensity(intensity),
    random,
    incoming: [],
    droplets: [],
    arcs: [],
    beads: [],
    ripples: [],
    spawnAccumulator: 0,
    age: 0
  };
}

export function seedSplashSystem(system, count = 2, { windSlope = 0, random = system.random || Math.random } = {}) {
  const next = { ...system, incoming: [...(system.incoming || [])] };
  for (let index = 0; index < Math.max(0, count); index += 1) {
    next.incoming.push({
      x: random() * next.width,
      y: -8 - random() * 40,
      vx: (windSlope + (random() - 0.5) * 0.08) * (380 + random() * 260),
      vy: 440 + random() * 260 + next.intensity * 220,
      size: 0.7 + random() * 1.2,
      alpha: 0.45 + next.intensity * 0.35
    });
  }
  return next;
}

function addImpact(system, x, { intensity, windSlope, random }) {
  const value = splashIntensity(intensity ?? system.intensity);
  const count = secondaryDropletCount(value, random);
  const next = { ...system };
  next.arcs = [...(system.arcs || []),
    { x, y: system.edgeY, radius: 1.5, width: 5 + value * 10, height: 1.5, age: 0, lifetime: 0.28 + random() * 0.18, alpha: 0.48 + value * 0.25 },
    { x: x + (random() - 0.5) * 3, y: system.edgeY, radius: 0.5, width: 2 + value * 5, height: 1, age: 0.03, lifetime: 0.2 + random() * 0.16, alpha: 0.36 + value * 0.22 }
  ];
  next.ripples = [...(system.ripples || []), { x, y: system.edgeY + 0.5, radius: 1, age: 0, lifetime: 0.3 + random() * 0.24, alpha: 0.36 + value * 0.22 }];
  next.droplets = [...(system.droplets || [])];
  for (let index = 0; index < count; index += 1) {
    const spread = (random() - 0.5) * (2.2 + value * 3.6);
    next.droplets.push({
      x: x + (random() - 0.5) * 2,
      y: system.edgeY - 1,
      vx: (windSlope * (70 + random() * 75)) + spread * (45 + value * 55),
      vy: -(120 + random() * 170 + value * 85),
      gravity: 430 + value * 180,
      drag: 0.985,
      age: 0,
      lifetime: 0.46 + random() * 0.42,
      alpha: 0.42 + random() * 0.34 + value * 0.14,
      size: 0.7 + random() * (1.1 + value * 1.4),
      landed: false,
      landedAge: 0
    });
  }
  if (random() < 0.18 + value * 0.2) {
    next.beads = [...(system.beads || []), {
      x: x + (random() - 0.5) * 7, y: system.edgeY - 0.4,
      radius: 0.9 + random() * (1 + value * 1.4),
      slide: (windSlope * 8) + (random() - 0.5) * (8 + value * 12),
      age: 0, lifetime: 0.8 + random() * 1.2, alpha: 0.34 + value * 0.26
    }];
  }
  return next;
}

export function stepSplash(system, deltaSeconds, {
  gravity = 560,
  windSlope = 0,
  random = system.random || Math.random
} = {}) {
  const dt = Math.min(0.08, Math.max(0, Number(deltaSeconds) || 0));
  const next = { ...system, age: (system.age || 0) + dt };
  next.random = random;
  next.incoming = [];
  next.droplets = [];
  next.arcs = [];
  next.beads = [];
  next.ripples = [];
  let working = next;

  let accumulator = (system.spawnAccumulator || 0) + spawnRate(system.intensity) * dt;
  while (accumulator >= 1 && working.incoming.length < 42) {
    accumulator -= 1;
    working.incoming.push({
      x: random() * working.width,
      y: -3 - random() * 16,
      vx: (windSlope + (random() - 0.5) * 0.045) * (430 + random() * 240),
      vy: 520 + random() * 260 + working.intensity * 230,
      size: 0.6 + random() * (0.9 + working.intensity * 0.8),
      alpha: 0.42 + working.intensity * 0.38
    });
  }
  working.spawnAccumulator = accumulator;

  for (const drop of system.incoming || []) {
    const moved = { ...drop, x: drop.x + drop.vx * dt, y: drop.y + drop.vy * dt };
    if (moved.y >= working.edgeY) working = addImpact(working, moved.x, { intensity: working.intensity, windSlope, random });
    else working.incoming.push(moved);
  }

  for (const drop of system.droplets || []) {
    const moved = { ...drop };
    moved.age += dt;
    if (moved.landed) {
      moved.landedAge += dt;
      if (moved.landedAge < 0.18) working.droplets.push(moved);
      continue;
    }
    moved.x += moved.vx * dt;
    moved.y += moved.vy * dt;
    moved.vx *= Math.pow(moved.drag ?? 0.985, dt * 60);
    moved.vy += (moved.gravity ?? gravity) * dt;
    moved.baseAlpha ??= moved.alpha;
    moved.alpha = Math.max(0, moved.baseAlpha * (1 - moved.age / moved.lifetime));
    if (moved.y >= working.edgeY && moved.vy > 0) {
      moved.y = working.edgeY;
      moved.vx = 0;
      moved.vy = 0;
      moved.landed = true;
      moved.landedAge = 0;
    }
    if (moved.age < moved.lifetime) working.droplets.push(moved);
  }
  for (const arc of system.arcs || []) {
    const moved = { ...arc, age: arc.age + dt, radius: arc.radius + dt * 15 };
    if (moved.age < moved.lifetime) working.arcs.push(moved);
  }
  for (const bead of system.beads || []) {
    const moved = { ...bead, age: bead.age + dt, x: bead.x + bead.slide * dt, slide: bead.slide * Math.pow(0.94, dt * 60) };
    if (moved.age < moved.lifetime) working.beads.push(moved);
  }
  for (const ripple of system.ripples || []) {
    const moved = { ...ripple, age: ripple.age + dt, radius: ripple.radius + dt * (18 + working.intensity * 16) };
    if (moved.age < moved.lifetime) working.ripples.push(moved);
  }
  return working;
}

export function rainSlope({ windDrift = 0, windStrength = 0, windGust = 1, windDriven = false } = {}) {
  return Number(windDrift || 0) * (windDriven ? 0.72 + clamp(windStrength) * 0.26 : 0.26) * (Number(windGust) || 1);
}

export function drawSplashSystem(ctx, system, { dark = true } = {}) {
  if (!ctx || !system) return;
  const highlight = dark ? '224,244,255' : '116,178,214';
  const shadow = dark ? '120,190,231' : '74,139,182';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const edge = ctx.createLinearGradient(0, system.edgeY - 1, 0, system.edgeY + 2);
  edge.addColorStop(0, `rgba(${highlight},0.08)`);
  edge.addColorStop(0.5, `rgba(${highlight},0.35)`);
  edge.addColorStop(1, `rgba(${shadow},0.05)`);
  ctx.fillStyle = edge;
  ctx.fillRect(0, system.edgeY - 1, system.width, 3);
  for (const drop of system.incoming || []) {
    ctx.beginPath(); ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${highlight},${drop.alpha})`; ctx.fill();
  }
  for (const drop of system.droplets || []) {
    const alpha = Math.max(0, drop.alpha);
    ctx.beginPath(); ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${highlight},${alpha})`; ctx.fill();
    ctx.beginPath(); ctx.arc(drop.x - drop.size * 0.28, drop.y - drop.size * 0.32, Math.max(0.35, drop.size * 0.24), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.75})`; ctx.fill();
  }
  for (const arc of system.arcs || []) {
    const alpha = arc.alpha * Math.max(0, 1 - arc.age / arc.lifetime);
    ctx.beginPath();
    ctx.ellipse(arc.x, arc.y, arc.radius + arc.width * arc.age / arc.lifetime, arc.height + arc.width * 0.12, 0, Math.PI, Math.PI * 2);
    ctx.lineWidth = 0.8 + system.intensity * 0.65;
    ctx.strokeStyle = `rgba(${highlight},${alpha})`; ctx.stroke();
  }
  for (const bead of system.beads || []) {
    const alpha = bead.alpha * Math.max(0, 1 - bead.age / bead.lifetime);
    ctx.beginPath(); ctx.arc(bead.x, bead.y, bead.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${highlight},${alpha})`; ctx.fill();
  }
  for (const ripple of system.ripples || []) {
    const alpha = ripple.alpha * Math.max(0, 1 - ripple.age / ripple.lifetime);
    ctx.beginPath(); ctx.ellipse(ripple.x, ripple.y, ripple.radius, Math.max(0.4, ripple.radius * 0.16), 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.55;
    ctx.strokeStyle = `rgba(${shadow},${alpha})`; ctx.stroke();
  }
  ctx.restore();
}

function installRainSplashController() {
  const scene = document.getElementById('weatherScene');
  const page = document.getElementById('page-weather');
  if (!scene || !page) return;
  const OVERLAY_ABOVE = 42;
  const OVERLAY_HEIGHT = 60;
  const systems = new Map();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frame = null;
  let lastFrame = 0;
  let visible = true;

  const getState = () => window.__pulseWeatherScene || {};
  const isMobile = () => window.matchMedia?.('(max-width: 760px)').matches ?? window.innerWidth <= 760;
  const targetElements = () => {
    const cards = [...page.querySelectorAll('.weather-content .weather-card, .weather-content .weather-detail-card')]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
      });
    // Keep the header in the same candidate family as the snow selector, but
    // use it only when the content has no visible card row to receive impact.
    if (cards.length) return cards;
    return [...page.querySelectorAll('.weather-header')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    });
  };
  const measureTargets = () => {
    if (!isRainSplashScene({ className: scene.className, particleType: getState().particleType })) {
      for (const [element, record] of systems) record.canvas.remove();
      systems.clear();
      return;
    }
    if (reducedMotion?.matches || !page.classList.contains('active')) {
      for (const [element, record] of systems) record.canvas.remove();
      systems.clear();
      return;
    }
    const elements = targetElements();
    const rects = elements.map(buildTargetRect);
    const selected = new Set(selectTopRowCards(rects, isMobile()).map(rect => rect.element));
    for (const [element, record] of systems) {
      if (!selected.has(element)) { record.canvas.remove(); systems.delete(element); }
    }
    const state = getState();
    const intensity = splashIntensity(state.intensity);
    const slope = rainSlope({ windDrift: state.windDrift, windStrength: state.windStrength, windGust: state.windGust, windDriven: state.particleType === 'wind-rain' });
    for (const element of selected) {
      const rect = element.getBoundingClientRect();
      let record = systems.get(element);
      if (!record) {
        const canvas = document.createElement('canvas');
        canvas.className = 'rain-splash-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.pointerEvents = 'none';
        document.body.appendChild(canvas);
        record = { canvas, system: seedSplashSystem(createSplashSystem({ width: rect.width, edgeY: OVERLAY_ABOVE, intensity }), 2, { windSlope: slope }), inView: true };
        systems.set(element, record);
      }
      record.system.width = Math.max(1, rect.width);
      record.system.intensity = intensity;
      record.slope = slope;
      record.canvas.style.left = `${rect.left}px`;
      record.canvas.style.top = `${Math.max(0, rect.top - OVERLAY_ABOVE)}px`;
      record.canvas.style.width = `${rect.width}px`;
      record.canvas.style.height = `${OVERLAY_HEIGHT}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (record.canvas.width !== Math.round(rect.width * dpr) || record.canvas.height !== Math.round(OVERLAY_HEIGHT * dpr)) {
        record.canvas.width = Math.max(1, Math.round(rect.width * dpr));
        record.canvas.height = Math.round(OVERLAY_HEIGHT * dpr);
        record.ctx = record.canvas.getContext('2d', { alpha: true });
        record.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    schedule();
  };
  const draw = now => {
    frame = null;
    if (!splashAnimationEnabled({ reducedMotion: reducedMotion?.matches, active: page.classList.contains('active'), hidden: document.hidden, inView: visible }) || !systems.size) return;
    if (now - lastFrame < 1000 / 30) { schedule(); return; }
    const dt = Math.min(0.06, lastFrame ? (now - lastFrame) / 1000 : 1 / 30);
    lastFrame = now;
    for (const record of systems.values()) {
      record.system = stepSplash(record.system, dt, { windSlope: record.slope || 0 });
      if (!record.ctx) continue;
      record.ctx.clearRect(0, 0, record.canvas.width, record.canvas.height);
      drawSplashSystem(record.ctx, record.system, { dark: document.documentElement.dataset.theme !== 'light' && !scene.classList.contains('scene-day') });
    }
    schedule();
  };
  function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
  const cleanup = () => { if (frame) cancelAnimationFrame(frame); frame = null; for (const record of systems.values()) record.canvas.remove(); systems.clear(); lastFrame = 0; };
  const refresh = () => { cleanup(); measureTargets(); };
  const sceneObserver = new MutationObserver(refresh);
  sceneObserver.observe(scene, { attributes: true, attributeFilter: ['class', 'data-weather-state', 'data-wind-strength'] });
  const pageObserver = new MutationObserver(refresh);
  pageObserver.observe(page, { attributes: true, attributeFilter: ['class'] });
  const layoutObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measureTargets) : null;
  layoutObserver?.observe(page);
  window.addEventListener('resize', measureTargets, { passive: true });
  window.addEventListener('scroll', measureTargets, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) measureTargets(); else cleanup(); });
  const visibilityObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    if (visible) measureTargets(); else cleanup();
  }, { threshold: 0.01 }) : null;
  visibilityObserver?.observe(page);
  const motionListener = () => refresh();
  reducedMotion?.addEventListener?.('change', motionListener);
  reducedMotion?.addListener?.(motionListener);
  measureTargets();
}

export { installRainSplashController };

if (typeof window !== 'undefined' && typeof document !== 'undefined') installRainSplashController();
