import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('weather scene uses a canvas particle layer instead of DOM rain drops', () => {
  assert.match(html, /<canvas class="weather-particles" id="weatherParticles"/);
  assert.doesNotMatch(html, /id="rain"/);
  assert.doesNotMatch(html, /className='raindrop'/);
  assert.match(html, /function buildWeatherParticles\(type, intensity, windDrift\)/);
  assert.match(html, /requestAnimationFrame\(drawWeatherParticles\)/);
});

test('scene motion responds to real wind, precipitation and astronomy values', () => {
  assert.match(html, /realtime\?\.precipitation\?\.local\?\.intensity/);
  assert.match(html, /const windSpeed = Number\(realtime\?\.wind\?\.speed \|\| 0\)/);
  assert.match(html, /const windDirection = Number\(realtime\?\.wind\?\.direction \|\| 0\)/);
  assert.match(html, /updateCelestialPosition\(scene, astro, sceneIsNight, weather\.celestialProgress\)/);
  assert.match(html, /const isNight = typeof weather\.forceNight === 'boolean'[\s\S]*\? \(now < sunrise \|\| now > sunset\)/);
  assert.match(html, /updateScene\(scenePreview\?\.skycon \|\| rt\.skycon \|\| 'CLEAR_DAY', scenePreview\?\.weather \|\| \{\s*realtime: rt,\s*hourly: d\.hourly \|\| \{\},\s*astro: d\.daily\?\.astro\?\.\[0\] \|\| \{\}/);
});

test('scene engine uses observed cloud cover and a continuous solar phase', () => {
  assert.match(html, /realtime\?\.cloudrate \?\? realtime\?\.cloud/);
  assert.match(html, /function resolveSolarPhase\(astro = \{\}, forcedProgress = null, forceNight = null\)/);
  assert.match(html, /scene\.style\.setProperty\('--cloud-density', normalizedCloudCover\.toFixed\(2\)\)/);
  assert.match(html, /clearDawn:/);
  assert.match(html, /clearDusk:/);
  assert.match(html, /clearTwilight:/);
});

test('rain combines atmospheric particles, ground splashes and visible glass drops', () => {
  assert.match(html, /<canvas class="weather-glass" id="weatherGlass"/);
  assert.match(html, /function drawWeatherGlass\(deltaSeconds\)/);
  assert.match(html, /function drawRainSplashes\(ctx, deltaSeconds\)/);
  assert.match(html, /glassCanvas\.dataset\.raining = glassEnabled \? 'true' : 'false'/);
  assert.match(html, /\.weather-glass\.is-active/);
});

test('weather animation has mobile performance and reduced-motion safeguards', () => {
  assert.match(html, /Math\.min\(window\.devicePixelRatio \|\| 1, weatherSceneState\.lowPower \? 1 : 1\.5\)/);
  assert.match(html, /const targetFrameMs = state\.lowPower \? 1000 \/ 30 : 1000 \/ 60/);
  assert.match(html, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(html, /if \(document\.hidden\) \{\s*stopWeatherSceneAnimation\(\)/);
  assert.match(html, /\.weather-particles \{\s*display: none !important;/);
});

test('sky, clouds and fog use independent depth layers', () => {
  assert.match(html, /id="weatherSkyA"/);
  assert.match(html, /id="weatherSkyB"/);
  assert.match(html, /cloud-layer-back/);
  assert.match(html, /cloud-layer-mid/);
  assert.match(html, /cloud-layer-front/);
  assert.match(html, /fog-bank-1/);
  assert.match(html, /fog-bank-2/);
  assert.match(html, /fog-bank-3/);
});

test('cloud motion remains visible and overcast weather obscures the moon', () => {
  assert.match(html, /@keyframes cloudVeilDrift/);
  assert.match(html, /--cloud-veil-duration/);
  assert.match(html, /scene-overcast\.scene-night \.moon/);
  assert.match(html, /scene-overcast \.clouds::before/);
  assert.match(html, /const isPartlyCloudy = isCloud && normalized\.includes\('PARTLY'\)/);
  assert.match(html, /isCloud \? \(isPartlyCloudy \? 'scene-partly-cloudy' : 'scene-overcast'\) : ''/);
  assert.match(html, /&& \(!isCloud \|\| isPartlyCloudy\)\) \? 'scene-sun' : ''/);
});

test('complete weather matrix distinguishes haze, fog, wind, sleet and hail', () => {
  assert.match(html, /THUNDER_SHOWER: '雷阵雨'/);
  assert.match(html, /SLEET: '雨夹雪'/);
  assert.match(html, /HAIL: '冰雹'/);
  assert.match(html, /const isHaze = normalized\.includes\('HAZE'\)/);
  assert.match(html, /const isWind = !isDust/);
  assert.match(html, /const particleType = isHail \? 'hail'/);
  assert.match(html, /type === 'sleet' \? \(index % 3 === 0 \? 'snow' : 'rain'\)/);
  assert.match(html, /particle\.kind === 'wind'/);
});

test('local-only scene preview supports visual regression checks without affecting production', () => {
  assert.match(html, /function getLocalWeatherScenePreview\(\)/);
  assert.match(html, /\['localhost', '127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.match(html, /const scenePreview = getLocalWeatherScenePreview\(\)/);
  assert.match(html, /scenePreview\?\.skycon \|\| rt\.skycon/);
});

test('dev preview accepts friendly weather query aliases, time of day and moon illumination', () => {
  assert.match(html, /params\.get\('weather'\)/);
  assert.match(html, /sunny: 'CLEAR_DAY'/);
  assert.match(html, /overcast: 'CLOUDY'/);
  assert.match(html, /'heavy-rain': 'HEAVY_RAIN'/);
  assert.match(html, /'heavy-snow': 'HEAVY_SNOW'/);
  assert.match(html, /windy: 'WIND'/);
  assert.match(html, /'windy-rain': 'WIND_RAIN'/);
  assert.match(html, /thunder: 'THUNDER_SHOWER'/);
  assert.match(html, /params\.get\('moon'\)/);
  assert.match(html, /params\.get\('time'\)/);
  assert.match(html, /params\.get\('wind'\)/);
  assert.match(html, /applyMoonPhaseToScene\(scene, weather\)/);
});

// Exercise the inline engine's behavior as well as its DOM/CSS integration contract.
function sceneFunction(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.notEqual(start, -1, `missing scene function ${name}`);
  return html.slice(start, html.indexOf('\n        }', start) + 10);
}
function sceneConstant(name) {
  const start = html.indexOf(`        const ${name} = {`);
  assert.notEqual(start, -1, `missing scene constant ${name}`);
  return html.slice(start, html.indexOf('\n        };', start) + 11);
}
function sceneHarness(names, globals = {}, constants = []) {
  return runInNewContext([
    ...constants.map(sceneConstant),
    ...names.map(sceneFunction),
    `({${names.join(',')}})`
  ].join('\n'), globals);
}

const previewAliases = ['sunny', 'cloudy', 'overcast', 'rain', 'heavy-rain', 'thunder', 'snow', 'heavy-snow', 'windy', 'windy-rain', 'fog', 'haze'];
test('preview preserves the complete weather/time matrix and treats missing moon as astronomy fallback', () => {
  for (const weather of previewAliases) {
    for (const time of ['day', 'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night']) {
      const api = sceneHarness(['getLocalWeatherScenePreview', 'clampWeatherValue'], {
        window: { location: { hostname: 'localhost', search: `?weather=${weather}&time=${time}` } },
        INITIAL_LOCATION_SEARCH: '', URLSearchParams, LOCAL_WEATHER_SCENE_VALUES: new Set()
      }, ['WEATHER_PREVIEW_ALIASES', 'SOLAR_PHASE_CONFIG']);
      const preview = api.getLocalWeatherScenePreview();
      assert.ok(preview.skycon);
      assert.equal(preview.weather.forcedSolarPhase, time);
      assert.equal(preview.weather.forceNight, time === 'night');
      assert.equal(preview.weather.moonIllumination, null);
      if (['sunny', 'cloudy', 'overcast', 'windy', 'fog', 'haze'].includes(weather)) {
        assert.equal(preview.weather.realtime.precipitation.local.intensity, 0);
      }
      if (weather === 'windy' || weather === 'windy-rain') assert.ok(preview.weather.realtime.wind.speed >= 38);
      if (weather === 'windy-rain') assert.ok(preview.weather.realtime.precipitation.local.intensity > 0);
    }
  }
  for (const [query, expected] of [['0', 0], ['0.25', 0.25], ['1', 1], ['2', 1], ['-1', 0], ['', null], ['invalid', null]]) {
    const api = sceneHarness(['getLocalWeatherScenePreview', 'clampWeatherValue'], {
      window: { location: { hostname: 'localhost', search: `?weather=sunny&moon=${query}` } },
      INITIAL_LOCATION_SEARCH: '', URLSearchParams, LOCAL_WEATHER_SCENE_VALUES: new Set()
    }, ['WEATHER_PREVIEW_ALIASES', 'SOLAR_PHASE_CONFIG']);
    assert.equal(api.getLocalWeatherScenePreview().weather.moonIllumination, expected);
  }
  const production = sceneHarness(['getLocalWeatherScenePreview'], {
    window: { location: { hostname: 'pulse.example.com' } }
  });
  assert.equal(production.getLocalWeatherScenePreview(), null);
  for (const [wind, expected] of [['0', 0], ['0.4', 0.4], ['1', 1], ['3', 1]]) {
    const api = sceneHarness(['getLocalWeatherScenePreview', 'clampWeatherValue'], {
      window: { location: { hostname: 'localhost', search: `?weather=windy&wind=${wind}` } },
      INITIAL_LOCATION_SEARCH: '', URLSearchParams, LOCAL_WEATHER_SCENE_VALUES: new Set()
    }, ['WEATHER_PREVIEW_ALIASES', 'SOLAR_PHASE_CONFIG']);
    const preview = api.getLocalWeatherScenePreview();
    assert.equal(preview.weather.windStrength, expected);
    assert.equal(preview.weather.realtime.wind.speed, expected * 45);
  }
});

test('moon shadow area follows illumination and mirrors waxing/waning without losing zero', () => {
  const values = new Map();
  const scene = { style: { setProperty: (name, value) => values.set(name, value) } };
  const { applyMoonPhaseToScene } = sceneHarness(['applyMoonPhaseToScene', 'clampWeatherValue'], {
    resolveMoonPhase: () => ({ className: 'phase-last-quarter' }), renderMoonSurface() {}
  }, ['MOON_PHASE_LIGHT']);
  for (const waxing of [true, false]) {
    for (const illumination of [0, 0.1, 0.25, 0.5, 0.75, 0.85, 1]) {
      applyMoonPhaseToScene(scene, { moonIllumination: illumination, moonWaxing: waxing });
      assert.equal(Number(values.get('--moon-illumination')), illumination);
      const points = [...values.get('--moon-shadow-path').matchAll(/([\d.]+)% ([\d.]+)%/g)].map(match => [Number(match[1]), Number(match[2])]);
      const area = Math.abs(points.reduce((sum, [x, y], i) => {
        const [nextX, nextY] = points[(i + 1) % points.length];
        return sum + x * nextY - nextX * y;
      }, 0)) / 2;
      assert.ok(Math.abs(area / (Math.PI * 2500) - (1 - illumination)) < 0.002);
      if (illumination === 0.5) assert.ok(points.every(([x]) => waxing ? x <= 50 : x >= 50));
    }
  }
  applyMoonPhaseToScene(scene, { moonIllumination: null });
  assert.equal(Number(values.get('--moon-illumination')), 0.5);
  applyMoonPhaseToScene(scene, { moonIllumination: 1 });
  const fullMoonStars = Number(values.get('--starlight'));
  applyMoonPhaseToScene(scene, { moonIllumination: 0 });
  assert.ok(Number(values.get('--starlight')) > fullMoonStars);
});

test('fog, haze, snow, sleet and dust keep their own sky palettes throughout the day', () => {
  let gradient;
  const scene = { style: { setProperty() {} }, dataset: {} };
  const state = { particles: [], lightning: { nextStrike: 1 } };
  const { updateScene } = sceneHarness(['updateScene', 'resolveSceneIntensity', 'clampWeatherValue'], {
    document: { getElementById: () => scene, querySelectorAll: () => [] },
    parseClockToDate: () => null, weatherSceneState: state,
    setWeatherSky: value => { gradient = value; },
    updateCelestialPosition() {}, applyMoonPhaseToScene() {}, ensureWeatherStars() {},
    stopWeatherSceneAnimation() {}, startWeatherSceneAnimation() {}, buildWeatherParticles() {}
  }, ['WEATHER_SKIES', 'SOLAR_PHASE_CONFIG']);
  const skyColors = { FOG: ['#6a7c88', '#17242e'], MODERATE_HAZE: ['#6a5e4e', '#1a1714'], MODERATE_SNOW: ['#5f7485', '#101d29'], SLEET: ['#42596a', '#0b1823'], DUST: ['#63584c', '#191816'] };
  for (const [skycon, [day, night]] of Object.entries(skyColors)) {
    for (const phase of ['day', 'dawn', 'dusk', 'night']) {
      updateScene(skycon, { forcedSolarPhase: phase });
      assert.ok(gradient.includes(phase === 'night' ? night : day), `${skycon}/${phase}: ${gradient}`);
    }
  }
  updateScene('CLEAR_DAY', { forcedSolarPhase: 'dawn' });
  const dawn = gradient;
  updateScene('CLEAR_DAY', { forcedSolarPhase: 'dusk' });
  assert.notEqual(gradient, dawn);
});

test('glass fades over reading surfaces while keeping faint viewport-wide coverage', () => {
  const regions = [{ left: 100, right: 300, top: 100, bottom: 200 }];
  const { glassBeadVisibility } = sceneHarness(['glassBeadVisibility', 'clampWeatherValue']);
  assert.equal(glassBeadVisibility(150, 150, 5, 10, regions), 0.22);
  assert.equal(glassBeadVisibility(95, 150, 6, 10, regions), 0.22);
  assert.equal(glassBeadVisibility(150, 88, 4, 14, regions), 0.22);
  assert.equal(glassBeadVisibility(50, 150, 5, 10, regions), 1);
  const approaching = [60, 70, 80, 90, 100].map(x => glassBeadVisibility(x, 150, 4, 8, regions));
  assert.ok(approaching.every((alpha, i) => i === 0 || alpha <= approaching[i - 1]));
  assert.ok(approaching.some(alpha => alpha > 0.22 && alpha < 1));
  const card = { ...regions[0], minimum: 0.5 };
  assert.equal(glassBeadVisibility(150, 150, 12, 18, [card]), 0.5);
  assert.equal(glassBeadVisibility(150, 150, 12, 18, [card, ...regions]), 0.22, 'key numbers receive stronger fading than the surrounding card');
});

test('glass reading regions are cached and refreshed after layout invalidation', () => {
  let reads = 0;
  let top = 60;
  const state = { glassLayoutDirty: true, height: 800 };
  const { refreshGlassProtectedRegions } = sceneHarness(['refreshGlassProtectedRegions'], {
    weatherSceneState: state,
    document: { querySelectorAll: () => [{ getBoundingClientRect() { reads++; return { left: 100, right: 300, top, bottom: top + 120, width: 200, height: 120 }; } }] }
  });
  refreshGlassProtectedRegions();
  const previousTop = state.glassProtectedRegions[0].top;
  for (let i = 0; i < 60; i++) refreshGlassProtectedRegions();
  assert.equal(reads, 1);
  top = 200; state.glassLayoutDirty = true;
  refreshGlassProtectedRegions();
  assert.equal(reads, 2);
  assert.equal(state.glassProtectedRegions[0].top - previousTop, 140);
});

test('fog and haze wrap with the wind without losing altitude or getting stuck offscreen', () => {
  const { wrapWeatherParticle } = sceneHarness(['wrapWeatherParticle']);
  const fog = { kind: 'fog', size: 20, x: -500, y: 240 };
  wrapWeatherParticle(fog, 1000, 800);
  assert.ok(fog.x > 1000);
  const wrappedX = fog.x;
  wrapWeatherParticle(fog, 1000, 800);
  assert.equal(fog.x, wrappedX);
  assert.equal(fog.y, 240);
  const haze = { kind: 'haze', size: 2, x: 1100, y: 320 };
  wrapWeatherParticle(haze, 1000, 800);
  assert.ok(haze.x < 0);
  assert.equal(haze.y, 320);
  const rain = { kind: 'rain', length: 70, x: 80, y: 900 };
  wrapWeatherParticle(rain, 1000, 800);
  assert.ok(rain.y < 0 && rain.x >= 0 && rain.x <= 1000);
});

test('rain glass is visible immediately, moves within a second and keeps bounded desktop/mobile budgets', () => {
  for (const lowPower of [false, true]) {
    const state = { width: lowPower ? 390 : 1440, height: 960, lowPower, glassContext: { clearRect() {} } };
    const api = sceneHarness(['buildWeatherParticles', 'glassDropStateMix', 'glassDropSpawnPoint', 'glassSweepDistance', 'advanceGlassDrops', 'respawnGlassDrop', 'clampWeatherValue'], {
      weatherSceneState: state, resizeWeatherCanvas() {}, refreshGlassProtectedRegions() {}, glassBeadVisibility: () => 1
    }, ['GLASS_DROP_MIX']);
    api.buildWeatherParticles('rain', 1, -0.5);
    assert.ok(state.glassDrops.length >= 40 && state.glassDrops.length <= (lowPower ? 52 : 80));
    assert.ok(state.particles.length <= (lowPower ? 300 : 670));
    assert.ok(state.glassDrops.every(drop => drop.radius >= 2 && drop.radius <= 18 && drop.alpha >= 0.8 && drop.delay === 0));
    assert.ok(state.glassDrops.filter(drop => drop.radius >= 10).length >= 4);
    const positions = state.glassDrops.map(drop => drop.y);
    for (let i = 0; i < 30; i++) api.advanceGlassDrops(state, 1 / 30);
    assert.ok(state.glassDrops.filter((drop, i) => drop.y - positions[i] > 30).length >= 3);
    for (let i = 0; i < 900; i++) api.advanceGlassDrops(state, 1 / 30);
    assert.ok(state.glassDrops.every(drop => drop.trail.length <= 8 && drop.stretch <= 1.85 && drop.speed <= 340));
    assert.ok(state.glassDrops.every(drop => drop.radius <= 18 && Number.isFinite(drop.x) && Number.isFinite(drop.y)));
    assert.ok(state.wetTrails.length <= (lowPower ? 800 : 1600));
    assert.ok(state.wetTrails.every(trail => trail.duration >= 2 && trail.duration <= 4));
    api.buildWeatherParticles('snow', 0.6, 0.2);
    assert.equal(state.glassDrops.length, 0);
  }
});

test('glass beads cover the whole viewport with tunable static, creeping and runner states', () => {
  const state = { width: 1440, height: 960, lowPower: false };
  const api = sceneHarness(['buildWeatherParticles', 'glassDropStateMix', 'glassDropSpawnPoint', 'clampWeatherValue'], {
    weatherSceneState: state, resizeWeatherCanvas() {}, refreshGlassProtectedRegions() {}
  }, ['GLASS_DROP_MIX']);
  api.buildWeatherParticles('rain', 1, 0.5);
  const drops = state.glassDrops;
  const quadrants = [0, 0, 0, 0];
  for (const drop of drops) quadrants[(drop.y >= state.height / 2 ? 2 : 0) + (drop.x >= state.width / 2 ? 1 : 0)] += 1;
  assert.ok(quadrants.every(count => count >= drops.length * 0.18), `quadrants: ${quadrants.join(',')}`);
  const counts = drops.reduce((result, drop) => { result[drop.mode] = (result[drop.mode] || 0) + 1; return result; }, {});
  assert.ok(counts.static > counts.creeping);
  assert.ok(counts.creeping > 0 && counts.runner > 0);
  assert.ok(counts.runner / drops.length <= 0.2);
  assert.ok(api.glassDropStateMix(1).runner > api.glassDropStateMix(0).runner);
  assert.ok(drops.every(drop => drop.x > 0 && drop.x < state.width && drop.y > 0 && drop.y < state.height));
});

test('heavy snow adds restrained frost patches and card edge accumulation', () => {
  assert.match(html, /id="weatherFrost"/);
  assert.match(html, /frost-patch-a/);
  assert.match(html, /@keyframes frostCreep/);
  assert.match(html, /weather-scene\.scene-snow:is\(\.scene-heavy, \.scene-storm\) ~ \.pages/);
  const classes = new Set();
  const scene = { style: { setProperty() {} }, dataset: {}, className: '' };
  const frost = { dataset: {}, classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } } };
  let particleType = null;
  const { updateScene } = sceneHarness(['updateScene', 'resolveSceneIntensity', 'clampWeatherValue'], {
    document: { getElementById: id => id === 'weatherFrost' ? frost : scene, querySelectorAll: () => [] },
    parseClockToDate: () => null, weatherSceneState: { particles: [], lightning: { nextStrike: 1 } },
    isWeatherSceneVisible: () => true,
    setWeatherSky() {}, updateCelestialPosition() {}, applyMoonPhaseToScene() {}, ensureWeatherStars() {},
    stopWeatherSceneAnimation() {}, startWeatherSceneAnimation() {},
    buildWeatherParticles: type => { particleType = type; }
  }, ['WEATHER_SKIES', 'SOLAR_PHASE_CONFIG']);
  updateScene('HEAVY_SNOW', { forcedSolarPhase: 'afternoon', realtime: { wind: { speed: 10, scale: 3 }, cloudrate: 0.98 } });
  assert.equal(particleType, 'snow');
  assert.ok(classes.has('is-active') && classes.has('is-heavy'));
});

test('wind scenes map speed and scale to gust strength, slant rain and tumble debris', () => {
  const state = { particles: [], lightning: { nextStrike: 1 }, windStrength: 0 };
  const scene = { style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } }, dataset: {}, className: '' };
  let particleType = null;
  const { updateScene } = sceneHarness(['updateScene', 'resolveSceneIntensity', 'clampWeatherValue'], {
    document: { getElementById: () => scene, querySelectorAll: () => [] },
    parseClockToDate: () => null, weatherSceneState: state,
    setWeatherSky() {}, updateCelestialPosition() {}, applyMoonPhaseToScene() {}, ensureWeatherStars() {},
    stopWeatherSceneAnimation() {}, startWeatherSceneAnimation() {},
    buildWeatherParticles: type => { particleType = type; }
  }, ['WEATHER_SKIES', 'SOLAR_PHASE_CONFIG']);
  updateScene('WIND_RAIN', { forcedSolarPhase: 'morning', realtime: { wind: { speed: 42, scale: 9, direction: 108 }, cloudrate: 0.96 } });
  assert.equal(particleType, 'wind-rain');
  assert.ok(state.windStrength > 0.9);
  assert.match(scene.className, /scene-windy/);
  assert.match(scene.className, /scene-wind-driven/);
  assert.equal(scene.style.values.get('--wind-strength'), state.windStrength.toFixed(2));

  const particleState = { width: 1000, height: 700, lowPower: false };
  const api = sceneHarness(['buildWeatherParticles', 'glassDropStateMix', 'glassDropSpawnPoint', 'clampWeatherValue'], { weatherSceneState: particleState, resizeWeatherCanvas() {} }, ['GLASS_DROP_MIX']);
  api.buildWeatherParticles('wind', 1, 0.9);
  const debris = particleState.particles.filter(particle => particle.kind === 'debris');
  assert.ok(debris.length > 0);
  assert.ok(new Set(debris.map(particle => particle.speed)).size > 1);
  assert.ok(debris.every(particle => particle.debrisShape && particle.spinSpeed !== 0));
});

test('dawn, morning, noon, afternoon, dusk and night have distinct solar visuals', () => {
  const scene = { style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } }, dataset: {}, className: '' };
  const state = { particles: [], lightning: { nextStrike: 1 } };
  const skies = [];
  const { updateScene } = sceneHarness(['updateScene', 'resolveSceneIntensity', 'clampWeatherValue'], {
    document: { getElementById: () => scene, querySelectorAll: () => [] },
    parseClockToDate: () => null, weatherSceneState: state,
    setWeatherSky: value => skies.push(value), updateCelestialPosition() {}, applyMoonPhaseToScene() {}, ensureWeatherStars() {},
    stopWeatherSceneAnimation() {}, startWeatherSceneAnimation() {}, buildWeatherParticles() {}
  }, ['WEATHER_SKIES', 'SOLAR_PHASE_CONFIG']);
  for (const phase of ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night']) {
    updateScene('CLEAR_DAY', { forcedSolarPhase: phase });
  }
  assert.equal(new Set(skies).size, 6);
  assert.equal(new Set(skies.map(value => value.match(/radial-gradient\(circle at [^,]+/)[0])).size, 6);
  assert.equal(scene.dataset.solarPhase, 'night');
});

test('CSS and canvas both pause when hidden, off-page or reduced-motion, then resume', () => {
  const classes = new Set();
  let visible = true;
  let cleared = 0;
  let cancellations = 0;
  const state = { particleType: 'rain', frame: null, context: { clearRect() { cleared++; } }, glassContext: { clearRect() { cleared++; } } };
  const motion = { matches: false };
  const document = { hidden: false, getElementById: () => ({ classList: {
    add: name => classes.add(name),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
  } }) };
  const api = sceneHarness(['startWeatherSceneAnimation', 'stopWeatherSceneAnimation'], {
    document, weatherSceneState: state, weatherMotionQuery: motion,
    isWeatherSceneVisible: () => visible, drawWeatherParticles() {},
    requestAnimationFrame: () => 7, cancelAnimationFrame: () => cancellations++
  });
  api.startWeatherSceneAnimation();
  assert.equal(state.frame, 7);
  assert.equal(classes.has('is-paused'), false);
  for (const reason of ['hidden', 'off-page', 'reduced-motion']) {
    document.hidden = reason === 'hidden'; visible = reason !== 'off-page'; motion.matches = reason === 'reduced-motion';
    api.startWeatherSceneAnimation();
    assert.equal(state.frame, null);
    assert.equal(classes.has('is-paused'), true);
  }
  document.hidden = false; visible = true; motion.matches = false;
  api.startWeatherSceneAnimation();
  assert.equal(state.frame, 7);
  api.stopWeatherSceneAnimation({ clear: true });
  assert.equal(cleared, 2);
  assert.ok(cancellations >= 2);
  state.particleType = null;
  api.startWeatherSceneAnimation();
  assert.equal(classes.has('is-paused'), false, 'sun and cloud CSS motion resumes even without precipitation');
  assert.equal(state.frame, null);
});

test('atmosphere is contained behind content and lightning never paints onto glass', () => {
  const sceneMarkup = html.slice(html.indexOf('id="weatherScene"'), html.indexOf('<canvas class="weather-glass"'));
  assert.match(sceneMarkup, /id="weatherForeground"/);
  assert.doesNotMatch(html, /scene-(?:fog|haze)[^{]*~ \.weather-foreground/);
  assert.doesNotMatch(sceneFunction('drawWeatherGlass'), /drawLightning/);
  assert.match(sceneFunction('drawWeatherParticles'), /drawLightningFlash\(ctx, state\)/);
  assert.match(html, /\.weather-glass\.is-active\.is-storm/);
  assert.doesNotMatch(html, /\.weather-glass\.is-storm\s*\{/);
});

test('preview overrides late live responses and forecasts without mutating production data', () => {
  const source = { realtime: { skycon: 'CLOUDY', skyconText: '多云', temperature: 20 },
    hourly: { skycon: [{ value: 'CLOUDY' }], description: '多云' },
    daily: { skycon: [{ value: 'CLOUDY' }] }, minutely: { summary: '10分钟后小雨' } };
  const original = structuredClone(source);
  for (const weather of ['snow', 'heavy-rain', 'thunder', 'thunderstorm']) {
    for (const time of ['day', 'night']) {
      const api = sceneHarness(['getLocalWeatherScenePreview', 'withWeatherScenePreview', 'clampWeatherValue'], {
        window: { location: { hostname: 'localhost', search: `?weather=${weather}&time=${time}` } },
        INITIAL_LOCATION_SEARCH: '', URLSearchParams, LOCAL_WEATHER_SCENE_VALUES: new Set(),
        SKYCON_LABELS: { MODERATE_SNOW: '中雪', HEAVY_RAIN: '大雨', THUNDER_SHOWER: '雷阵雨' }
      }, ['WEATHER_PREVIEW_ALIASES', 'SOLAR_PHASE_CONFIG']);
      const preview = api.getLocalWeatherScenePreview();
      assert.ok(preview.weather.realtime.cloudrate > 0.9);
      const initial = api.withWeatherScenePreview({}, preview);
      assert.ok(initial.daily.astro[0].sunrise.time && initial.daily.astro[0].sunset.time);
      assert.ok(Number.isFinite(initial.realtime.pressure) && initial.realtime.wind.scale);
      assert.ok(initial.realtime.air_quality.aqi.chn > 0);
      assert.equal(initial.realtime.life_index.ultraviolet.index, time === 'night' ? 0 : 3);
      const late = api.withWeatherScenePreview(source, preview);
      assert.equal(late.realtime.skycon, preview.skycon);
      assert.equal(late.realtime.skyconText, initial.realtime.skyconText);
      assert.equal(late.realtime.isNight, time === 'night');
      assert.equal(late.hourly.skycon.length, 24);
      assert.ok(late.hourly.skycon.concat(late.daily.skycon).every(row => row.value === preview.skycon));
      assert.ok(!late.minutely.summary.includes('小雨'));
      if (weather === 'snow') assert.ok(late.realtime.temperature < 0);
      assert.equal(api.withWeatherScenePreview(source, null), source);
      assert.deepEqual(source, original);
    }
  }
});

test('runners absorb beads while clinging drops stay still and wet film evaporates independently', () => {
  const drop = (id, x, y, radius) => ({ id, mode: 'static', x, y, radius, baseRadius: radius, delay: 0, age: 1,
    lifetime: 30, growth: 0.1, speed: 0, stretch: 1, runner: false, wobble: 0, trailTimer: 0, trail: [] });
  const state = { width: 1000, height: 800, windDrift: 0.2, lowPower: false, glassDrops: [drop(0,40,100,3), drop(1,42,100,3)], wetTrails: [] };
  const api = sceneHarness(['advanceGlassDrops', 'respawnGlassDrop', 'glassDropSpawnPoint', 'glassSweepDistance']);
  api.advanceGlassDrops(state, 0);
  assert.ok(state.glassDrops.every(drop => drop.radius === 3 && !drop.runner), 'contact alone does not turn clinging drops into runners');
  Object.assign(state.glassDrops[0], { mode: 'runner', runner: true });
  api.advanceGlassDrops(state, 0);
  assert.ok(Math.abs(state.glassDrops[0].radius - Math.cbrt(54)) < 0.001);
  assert.equal(state.glassDrops[0].runner, true);
  assert.ok(state.glassDrops[1].delay > 0 && state.glassDrops[1].age === 0);
  assert.ok(Number.isFinite(state.glassDrops[1].x) && Number.isFinite(state.glassDrops[1].y));
  for (let i = 0; i < 60; i++) api.advanceGlassDrops(state, 1 / 30);
  assert.ok(state.glassDrops[0].y > 130);
  assert.ok(state.wetTrails.length > 0);
  const survivingTrail = state.wetTrails.at(-1);
  const firstLife = survivingTrail.life;
  state.glassDrops = [];
  api.advanceGlassDrops(state, 0.5);
  assert.ok(survivingTrail.life < firstLife);
  assert.ok(state.wetTrails.includes(survivingTrail));
  api.advanceGlassDrops(state, 4);
  assert.equal(state.wetTrails.length, 0);
});

test('snow has visible foreground, middle and far layers within a mobile budget', () => {
  for (const lowPower of [false, true]) {
    const state = { width: lowPower ? 390 : 1440, height: 900, lowPower };
    const { buildWeatherParticles } = sceneHarness(['buildWeatherParticles', 'glassDropStateMix', 'glassDropSpawnPoint', 'clampWeatherValue'], {
      weatherSceneState: state, resizeWeatherCanvas() {}, refreshGlassProtectedRegions() {}
    }, ['GLASS_DROP_MIX']);
    buildWeatherParticles('snow', 0.62, 0.3);
    assert.ok(state.particles.length >= (lowPower ? 90 : 280));
    assert.ok(state.particles.length <= (lowPower ? 130 : 370));
    assert.ok(state.particles.some(p => p.depth < 0.46 && p.size < 3));
    assert.ok(state.particles.some(p => p.depth > 0.82 && p.size > 6));
    assert.ok(state.particles.every(p => p.alpha >= 0.5 && p.sway > 0));
    assert.equal(state.glassDrops.length, 0);
  }
});

test('storm lightning branches, illuminates the sky and cannot flash in reduced motion', () => {
  const motion = { matches: false };
  const api = sceneHarness(['advanceLightning', 'buildLightningBolt', 'fractalLightningPath', 'clampWeatherValue', 'drawLightningFlash'], { weatherMotionQuery: motion });
  const state = { width: 1440, height: 900, lightning: { nextStrike: 0.1, flash: 0, boltLife: 0, aftershock: 0 } };
  api.advanceLightning(state, 0.2);
  assert.equal(state.lightning.flash, 1);
  assert.ok(state.lightning.bolt.branches.length >= 2);
  assert.ok(state.lightning.bolt.main[0].x > 0 && state.lightning.bolt.main[0].x < 1440);
  assert.ok(state.lightning.bolt.main.length >= 16, 'ground and sheet paths use midpoint displacement');
  assert.ok(['sheet', 'cloud-to-ground'].includes(state.lightning.bolt.mode));
  assert.ok(state.lightning.flickersTotal >= 2 && state.lightning.flickersTotal <= 4);
  assert.ok(state.lightning.bolt.sheet.x > 0 && state.lightning.bolt.sheet.x < 1440);
  assert.ok(state.lightning.nextStrike >= 3 && state.lightning.nextStrike <= 7);
  api.advanceLightning(state, 0.04);
  assert.ok(state.lightning.boltLife > 0 && state.lightning.boltLife < 0.1, 'the first short pulse leaves only a faint afterglow');
  const nextStroke = state.lightning.strokes[1];
  api.advanceLightning(state, nextStroke.at - state.lightning.strikeAge + 0.001);
  assert.ok(state.lightning.boltLife > 0.5, 'a later return stroke brightens the same bolt');
  api.advanceLightning(state, 1.2);
  assert.equal(state.lightning.active, false);
  assert.equal(state.lightning.flash, 0);
  assert.equal(state.lightning.boltLife, 0);
  state.lightning.nextStrike = 0;
  api.advanceLightning(state, 0);
  assert.equal(state.lightning.flash, 1);
  motion.matches = true;
  api.advanceLightning(state, 10);
  assert.equal(state.lightning.flash, 0);
  assert.equal(state.lightning.boltLife, 0);
  api.drawLightningFlash({ fillRect() { assert.fail('reduced motion painted a flash'); } }, state);
});

test('a slow renderer keeps lightning on wall time and falls back to Canvas', () => {
  let disposed = 0;
  const state = { width: 1440, height: 900, lowPower: false, thunder: true, particles: [],
    context: { clearRect() {} }, particleType: 'rain', lastFrameAt: 1000,
    glassRefraction: { dispose() { disposed++; } },
    lightning: { nextStrike: 0.65, flash: 0, boltLife: 0, aftershock: 0 } };
  const api = sceneHarness(['drawWeatherParticles', 'weatherWindGust', 'advanceLightning', 'buildLightningBolt', 'fractalLightningPath', 'clampWeatherValue'], {
    weatherSceneState: state, document: { hidden: false }, weatherMotionQuery: { matches: false },
    isWeatherSceneVisible: () => true, requestAnimationFrame: () => 1,
    drawLightningFlash() {}, drawLightningBolt() {}, drawRainSplashes() {}, drawWeatherGlass() {}
  });
  const strikes = [];
  for (let now = 1100; now <= 20000; now += 100) {
    const previous = state.lightning.bolt;
    api.drawWeatherParticles(now);
    if (state.lightning.bolt !== previous) strikes.push((now - 1000) / 1000);
  }
  assert.ok(strikes[0] <= 0.8, 'first strike does not inherit the capped particle timestep');
  assert.ok(strikes.length >= 3);
  for (let i = 1; i < strikes.length; i++) assert.ok(strikes[i] - strikes[i - 1] >= 3 && strikes[i] - strikes[i - 1] <= 7.1);
  assert.equal(disposed, 1);
  assert.equal(state.glassRefraction, false);
});

test('short lightning strokes remain visible when a frame spans the entire pulse', () => {
  const { advanceLightning } = sceneHarness(['advanceLightning'], { weatherMotionQuery: { matches: false } });
  const state = { lightning: { active: true, nextStrike: 3, strikeAge: 0,
    strokes: [{ at: 0.037, width: 0.022, peak: 0.8 }] } };
  advanceLightning(state, 1 / 30);
  assert.ok(state.lightning.boltLife < 0.1);
  advanceLightning(state, 1 / 30);
  assert.equal(state.lightning.boltLife, 0.8, 'a complete pulse between two frames is still drawn once');
  advanceLightning(state, 1 / 30);
  assert.ok(state.lightning.boltLife < 0.1, 'the pulse does not linger into later frames');
});

test('software WebGL uses the complete Canvas lens fallback immediately', () => {
  let released = false;
  const gl = {
    getExtension(name) { return name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 1 } : { loseContext() { released = true; } }; },
    getParameter() { return 'ANGLE (Google, Vulkan SwiftShader Device)'; }
  };
  const api = sceneHarness(['createGlassRefraction'], {
    weatherSceneState: { lowPower: false }, document: { createElement: () => ({ getContext: () => gl }) }
  });
  assert.equal(api.createGlassRefraction(), false);
  assert.ok(released);
});

test('rendered moon has a mirrored terminator, soft edge and textured earthshine', () => {
  const size = 64;
  const albedo = { data: new Uint8ClampedArray(size * size * 4).fill(200) };
  let pixels;
  const canvas = { width: size, dataset: {}, getContext: () => ({
    createImageData: () => ({ data: new Uint8ClampedArray(size * size * 4) }),
    putImageData: image => { pixels = image.data; }
  }) };
  const { renderMoonSurface } = sceneHarness(['renderMoonSurface', 'clampWeatherValue'], {
    weatherSceneState: { moonAlbedo: albedo }, document: { getElementById: () => canvas }
  });
  const pixel = (x, y) => pixels[(y * size + x) * 4];
  renderMoonSurface(0.5, true);
  assert.ok(pixel(48, 32) > pixel(16, 32) * 3);
  assert.ok(pixel(16, 32) > 0, 'dark side retains earthshine');
  const waxing = Array.from(pixels);
  renderMoonSurface(0.5, false);
  for (let x = 4; x < 60; x++) assert.ok(Math.abs(pixel(x, 32) - waxing[(32 * size + size - x - 1) * 4]) <= 1);
  renderMoonSurface(0, true);
  assert.ok(pixel(32, 32) > 0 && pixel(32, 32) < 30);
  renderMoonSurface(1, true);
  assert.ok(pixel(32, 32) > 180);
  assert.equal(pixels[3], 0, 'outside the lunar limb is transparent');
  for (const illumination of [0.15, 0.5, 0.85]) {
    for (const waxing of [true, false]) {
      renderMoonSurface(illumination, waxing);
      let disc = 0, lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 0) { disc++; if (pixels[i] > 60) lit++; }
      }
      assert.ok(Math.abs(lit / disc - illumination) < 0.02, `${illumination}/${waxing}: rendered area ${lit / disc}`);
    }
  }
});

test('normal rain, heavy rain and thunder retain different skies and intensity in both day and night', () => {
  const scene = { style: { setProperty() {} }, dataset: {} };
  const state = { particles: [], lightning: { nextStrike: 1 } };
  let gradient, intensity;
  const { updateScene } = sceneHarness(['updateScene', 'resolveSceneIntensity', 'clampWeatherValue'], {
    document: { getElementById: () => scene, querySelectorAll: () => [] },
    parseClockToDate: () => null, weatherSceneState: state,
    setWeatherSky: value => { gradient = value; },
    updateCelestialPosition() {}, applyMoonPhaseToScene() {}, ensureWeatherStars() {},
    stopWeatherSceneAnimation() {}, startWeatherSceneAnimation() {},
    buildWeatherParticles: (_type, value) => { intensity = value; }
  }, ['WEATHER_SKIES', 'SOLAR_PHASE_CONFIG']);
  for (const phase of ['day', 'night']) {
    const gradients = [], intensities = [];
    for (const skycon of ['MODERATE_RAIN', 'HEAVY_RAIN', 'THUNDER_SHOWER']) {
      updateScene(skycon, { forcedSolarPhase: phase });
      gradients.push(gradient); intensities.push(intensity);
    }
    assert.equal(new Set(gradients).size, 3);
    assert.ok(intensities[0] < intensities[1] && intensities[1] <= intensities[2]);
    assert.equal(state.thunder, true);
    assert.ok(scene.className.includes('scene-thunder'));
  }
  state.thunder = false;
  updateScene('THUNDER_SHOWER', { preview: true, forcedSolarPhase: 'night' });
  assert.equal(state.lightning.nextStrike, 0, 'preview strikes on the first animated frame');
  state.lightning.nextStrike = 4;
  updateScene('THUNDER_SHOWER', { preview: true, forcedSolarPhase: 'night' });
  assert.equal(state.lightning.nextStrike, 4, 'refreshing data does not restart the lightning timer');
});
