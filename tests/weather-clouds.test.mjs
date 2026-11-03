import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function fn(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.notEqual(start, -1, name);
  return html.slice(start, html.indexOf('\n        }', start) + 10);
}
function constant(name) {
  const start = html.indexOf(`        const ${name} = `);
  assert.notEqual(start, -1, name);
  const value = html.slice(start).match(/^        const \w+ = (?:`[\s\S]*?`;|\{[\s\S]*?\n        \};|[^\n]+;)/);
  return value[0];
}
function harness(names, globals = {}, constants = []) {
  return runInNewContext([...constants.map(constant), ...names.map(fn), `({${names.join(',')}})`].join('\n'), globals);
}
const classes = () => {
  const values = new Set();
  return { values, add: name => values.add(name), remove: name => values.delete(name), toggle: (name, on) => on ? values.add(name) : values.delete(name) };
};
function mockGL({ compiled = true, linked = true } = {}) {
  const uniforms = new Map(), deleted = [], calls = { draw: 0 };
  return { uniforms, deleted, calls, VERTEX_SHADER: 1, FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3, LINK_STATUS: 4, ONE: 1, ONE_MINUS_SRC_ALPHA: 771,
    createShader: type => ({ type }), shaderSource() {}, compileShader() {},
    getShaderParameter: () => compiled, deleteShader: shader => deleted.push(shader),
    createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => linked, deleteProgram: program => deleted.push(program),
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, deleteBuffer: buffer => deleted.push(buffer),
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation: (_, name) => name, enable() {}, blendFunc: (...args) => { calls.blend = args; },
    viewport: (...args) => { calls.viewport = args; }, useProgram() {}, clearColor() {}, clear() {},
    uniform1f: (key, value) => uniforms.set(key, value), uniform2f: (key, ...value) => uniforms.set(key, value),
    drawArrays: () => { calls.draw++; }
  };
}
function renderer(gl = mockGL()) {
  const scene = { classList: classes() };
  const state = { cloudCanvas: { width: 450, height: 300, getContext: () => gl }, width: 1000, height: 667,
    cloudShaderActive: false, cloudLight: { x: 0.7, y: 0.85 }, lightning: { flash: 0.8 }, cloudCover: 0.5 };
  const api = harness(['initializeWeatherClouds', 'compileWeatherCloudShader', 'renderWeatherCloudFrame', 'resolveWeatherCloudPreset', 'getWeatherCloudPhase'],
    { weatherSceneState: state, document: { getElementById: () => scene } },
    ['WEATHER_CLOUD_PRESETS', 'WEATHER_CLOUD_VERTEX_SHADER', 'WEATHER_CLOUD_FRAGMENT_SHADER']);
  return { gl, scene, state, api };
}

test('cloud families distinguish open cumulus, closed stratus, precipitation, storm, fog and haze', () => {
  const { resolveWeatherCloudPreset: resolve } = renderer().api;
  for (const [condition, style, family] of [
    ['CLEAR_DAY', null, 7], ['PARTLY_CLOUDY_DAY', 'thin', 0], ['PARTLY_CLOUDY_NIGHT', null, 1],
    ['CLOUDY', 'mostly', 1], ['CLOUDY', 'overcast', 2], ['MODERATE_RAIN', null, 3],
    ['HEAVY_SNOW', null, 3], ['SLEET', null, 3], ['HAIL', null, 3],
    ['THUNDER_SHOWER', null, 4], ['STORM_RAIN', null, 4], ['FOG', null, 5], ['HEAVY_HAZE', null, 6]
  ]) assert.equal(resolve(condition, { cloudStyle: style }).condition, family, condition);
  const partly = resolve('PARTLY_CLOUDY_DAY'), mostly = resolve('CLOUDY');
  const thin = resolve('', { cloudStyle: 'thin' }), storm = resolve('THUNDER_SHOWER');
  assert.ok(partly.coverage > mostly.coverage, 'mostly cloudy leaves fewer sky gaps');
  assert.ok(thin.opacity < partly.opacity);
  assert.ok(thin.anisotropy[1] / thin.anisotropy[0] > 10, 'cirrus fibres stretch horizontally');
  for (const preset of [partly, mostly, storm]) {
    assert.ok(preset.anisotropy[1] / preset.anisotropy[0] < 1.5, 'billows retain vertical volume');
    assert.ok(preset.extinction > thin.extinction, 'cumulus cores are denser than cirrus');
  }
  assert.ok(partly.farWeight < mostly.farWeight, 'background cumulus preserves open sky');
  assert.ok(storm.extinction > partly.extinction && storm.warp > partly.warp, 'storm bases are deeper and more turbulent');
  assert.equal(resolve('CLOUDY', { realtime: { cloudrate: 0.98 } }).condition, 2);
  assert.equal(resolve('CLOUDY', { realtime: { cloud: 95 } }).condition, 2);
  assert.equal(resolve('WIND', { realtime: { cloudrate: 0.78 } }).condition, 1);
});

test('cloud previews preserve aliases, all time/night variants and scene precedence', () => {
  for (const weather of ['thin', 'thin-clouds', 'cloudy', 'partly-cloudy', 'mostly-cloudy', 'overcast']) {
    for (const time of ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night']) {
      const { getLocalWeatherScenePreview: preview } = harness(['getLocalWeatherScenePreview', 'clampWeatherValue'], {
        window: { location: { hostname: 'localhost', search: `?weather=${weather}&time=${time}` } },
        INITIAL_LOCATION_SEARCH: '', URLSearchParams, LOCAL_WEATHER_SCENE_VALUES: new Set(['HEAVY_RAIN'])
      }, ['WEATHER_PREVIEW_ALIASES', 'SOLAR_PHASE_CONFIG']);
      const result = preview();
      assert.equal(result.weather.forcedSolarPhase, time);
      assert.equal(result.weather.forceNight, time === 'night');
      assert.equal(result.weather.realtime.precipitation.local.intensity, 0);
      const style = weather.startsWith('thin') ? 'thin' : weather === 'mostly-cloudy' ? 'mostly'
        : weather === 'overcast' ? 'overcast' : 'partly';
      assert.equal(result.weather.cloudStyle, style);
      if (style === 'thin' || style === 'partly') {
        assert.ok(result.weather.realtime.cloudrate < (style === 'thin' ? 0.3 : 0.6));
        assert.equal(result.skycon, time === 'night' ? 'PARTLY_CLOUDY_NIGHT' : 'PARTLY_CLOUDY_DAY');
      }
    }
  }
  for (const query of ['weather=thin&night=1', 'weather=thin&scene=HEAVY_RAIN&night=1']) {
    const { getLocalWeatherScenePreview: preview } = harness(['getLocalWeatherScenePreview', 'clampWeatherValue'], {
      window: { location: { hostname: '127.0.0.1', search: `?${query}` } }, INITIAL_LOCATION_SEARCH: '',
      URLSearchParams, LOCAL_WEATHER_SCENE_VALUES: new Set(['HEAVY_RAIN'])
    }, ['WEATHER_PREVIEW_ALIASES', 'SOLAR_PHASE_CONFIG']);
    assert.equal(preview().weather.forceNight, true);
    if (query.includes('scene=')) {
      assert.equal(preview().skycon, 'HEAVY_RAIN');
      assert.equal(preview().weather.cloudStyle, undefined);
    }
  }
});

test('every cloud family has a dimmer night variant, with warm and moonlight shader phases', () => {
  const { api, state, gl } = renderer();
  api.initializeWeatherClouds();
  for (const style of ['clear', 'thin', 'partly', 'mostly', 'overcast', 'rain', 'snow', 'thunderstorm', 'fog', 'haze']) {
    state.cloudPreset = api.resolveWeatherCloudPreset('', { cloudStyle: style });
    const opacities = [];
    let daytimeShape;
    for (const phase of ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night', 'twilight']) {
      state.solarPhase = phase;
      api.renderWeatherCloudFrame(1500);
      assert.equal(gl.uniforms.get('u_phase'), ({ dawn: 0, morning: 1, noon: 2, afternoon: 3, dusk: 4, night: 5, twilight: 5 })[phase]);
      opacities.push(gl.uniforms.get('u_opacity'));
      const shape = ['u_coverage', 'u_softness', 'u_warp', 'u_anisotropy', 'u_layerScale', 'u_farWeight', 'u_extinction']
        .map(name => gl.uniforms.get(name));
      assert.ok(shape.flat().every(Number.isFinite), `${style}: every family supplies valid morphology uniforms`);
      daytimeShape ??= shape;
      assert.deepEqual(shape, daytimeShape, `${style}: moonlight must retain the daytime silhouette and gaps`);
    }
    assert.ok(opacities[5] < opacities[2], style);
    assert.equal(opacities[5], opacities[6]);
  }
});

test('cloud render target caps DPR and pixel count for mobile, retina and large desktops', () => {
  const { weatherCloudDimensions: size } = harness(['weatherCloudDimensions'], {}, ['WEATHER_CLOUD_RENDER_SCALE']);
  assert.deepEqual({ ...size(1000, 600, 1) }, { width: 450, height: 270, dpr: 1, scale: 0.45 });
  for (const [width, height] of [[390, 844], [1440, 900], [3840, 2160]]) {
    for (const dpr of [1, 2, 3, 4]) {
      for (const lowPower of [false, true]) {
        const actual = size(width, height, dpr, lowPower);
        assert.ok(actual.dpr <= (lowPower ? 1 : 1.5));
        assert.ok(actual.width * actual.height <= 280000);
        assert.ok(Math.abs(actual.width / actual.height - width / height) < 0.02);
        assert.ok(actual.width > 0 && actual.height > 0);
      }
    }
  }
  assert.equal(size(0, 0, undefined).width, 1);
});

test('missing WebGL, exceptions, and shader/link failures leave the CSS fallback available', () => {
  for (const failure of ['unavailable', 'throws', 'compile', 'link']) {
    const gl = failure === 'unavailable' ? null : mockGL({ compiled: failure !== 'compile', linked: failure !== 'link' });
    const { state, scene, api } = renderer(gl);
    if (failure === 'throws') state.cloudCanvas.getContext = () => { throw new Error('disabled'); };
    assert.equal(api.initializeWeatherClouds(), false, failure);
    assert.equal(state.cloudFallback, true);
    assert.equal(scene.classList.values.has('shader-clouds-active'), false);
    assert.equal(api.renderWeatherCloudFrame(1000), false);
    state.cloudCanvas.getContext = () => assert.fail('failed initialization must not retry every resize');
    assert.equal(api.initializeWeatherClouds(), false);
    if (failure === 'compile' || failure === 'link') assert.ok(gl.deleted.length >= 2);
  }
});

test('successful cloud rendering opts in with premultiplied alpha and shares the lightning envelope', () => {
  const { state, scene, api, gl } = renderer();
  assert.equal(api.initializeWeatherClouds(), true);
  assert.ok(scene.classList.values.has('shader-clouds-active'));
  assert.deepEqual(gl.calls.blend, [gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
  state.cloudPreset = api.resolveWeatherCloudPreset('THUNDER_SHOWER');
  state.lightning.bolt = { sheet: { x: 250, y: 133.4 } };
  api.renderWeatherCloudFrame(2000);
  assert.equal(gl.uniforms.get('u_flash'), 0.8);
  assert.deepEqual(gl.uniforms.get('u_flashPosition'), [0.25, 0.8]);
  assert.equal(gl.uniforms.get('u_time'), 2);
  api.renderWeatherCloudFrame(2000, true);
  assert.equal(gl.uniforms.get('u_flash'), 0, 'reduced motion never illuminates the clouds');
  assert.equal(gl.uniforms.get('u_time'), 0);
});

test('reduced motion paints one static cloud frame and resumes without requiring particles', () => {
  const state = { cloudShaderActive: true, particleType: null, frame: null };
  const scene = { classList: classes() }, motion = { matches: true };
  const document = { hidden: false, getElementById: () => scene };
  let draws = 0, scheduled = 0, visible = true;
  const api = harness(['startWeatherSceneAnimation', 'stopWeatherSceneAnimation'], {
    weatherSceneState: state, weatherMotionQuery: motion, document,
    isWeatherSceneVisible: () => visible, drawWeatherParticles() {},
    renderWeatherCloudFrame: (time, staticFrame) => { assert.equal(time, 0); assert.equal(staticFrame, true); draws++; },
    requestAnimationFrame: () => ++scheduled, cancelAnimationFrame() {}
  });
  api.startWeatherSceneAnimation();
  assert.equal(draws, 1);
  assert.equal(scheduled, 0);
  assert.equal(state.frame, null);
  motion.matches = false;
  api.startWeatherSceneAnimation();
  assert.equal(state.frame, 1);
  for (const reason of ['hidden', 'off-page', 'offscreen']) {
    document.hidden = reason === 'hidden'; visible = reason !== 'off-page'; state.sceneInView = reason !== 'offscreen';
    api.startWeatherSceneAnimation();
    assert.equal(state.frame, null, reason);
  }
  document.hidden = false; visible = true; state.sceneInView = true;
  api.startWeatherSceneAnimation();
  assert.equal(state.frame, 2);
});

test('cloud animation is throttled independently and lightning reaches the cloud draw in the same frame', () => {
  const state = { cloudShaderActive: true, particles: [], particleType: null, frame: null,
    context: { clearRect() {} }, lowPower: false, lastFrameAt: 0, lightning: { flash: 0 } };
  const draws = [];
  const api = harness(['drawWeatherParticles'], {
    weatherSceneState: state, weatherMotionQuery: { matches: false }, document: { hidden: false },
    isWeatherSceneVisible: () => true, weatherWindGust: () => 1, requestAnimationFrame: () => 1,
    renderWeatherCloudFrame: time => draws.push({ time, flash: state.lightning.flash }),
    advanceLightning: () => { state.lightning.flash = 0.7; }, drawLightningFlash() {}, drawLightningBolt() {}
  });
  for (const time of [1000, 1017, 1034, 1051, 1068]) api.drawWeatherParticles(time);
  assert.equal(draws.length, 3);
  assert.ok(draws.at(-1).time > draws[0].time);
  state.thunder = true;
  api.drawWeatherParticles(1085);
  assert.equal(draws.at(-1).flash, 0.7);
  assert.equal(state.frame, 1);
});

test('the fixed cloud canvas feathers every edge and hides all fallback sprites only after initialization', () => {
  assert.match(html, /<canvas class="weather-clouds" id="weatherClouds" aria-hidden="true">/);
  const rule = html.match(/\.weather-clouds \{[\s\S]*?\n        \}/)[0];
  assert.match(rule, /inset: -8% -4% -8%/);
  assert.match(rule, /mask-image: linear-gradient\(180deg, transparent 0%[^;]+transparent 100%\)/);
  assert.match(html, /\.shader-clouds-active \.clouds,[\s\S]*?opacity: 0 !important/);
  assert.match(html, /weatherSceneObserver\?\.observe\(document.getElementById\('weatherScene'\)\)/);
  const scrollListener = html.match(/document.addEventListener\('scroll'[^;]+;/)[0];
  assert.doesNotMatch(scrollListener, /stopWeather|startWeather|renderWeather|resizeWeather/);
});

test('scene updates retain the chosen cloud morphology and align lighting with the sun or moon', () => {
  const style = { values: new Map([['--sun-x', '80%'], ['--sun-y', '12%'], ['--moon-x', '24%'], ['--moon-y', '10%']]),
    setProperty(key, value) { this.values.set(key, value); }, getPropertyValue(key) { return this.values.get(key); } };
  const scene = { style, className: '', classList: classes(), dataset: {} };
  const state = { particles: [], lightning: { nextStrike: 1 }, cloudShaderActive: true };
  const api = harness(['updateScene', 'resolveSceneIntensity', 'clampWeatherValue', 'resolveWeatherCloudPreset', 'updateWeatherClouds'], {
    weatherSceneState: state, document: { getElementById: () => scene, querySelectorAll: () => [] },
    parseClockToDate: () => null, isWeatherSceneVisible: () => true,
    setWeatherSky() {}, updateCelestialPosition() {}, applyMoonPhaseToScene() {}, ensureWeatherStars() {},
    stopWeatherSceneAnimation() {}, startWeatherSceneAnimation() {}, buildWeatherParticles() {}
  }, ['WEATHER_CLOUD_PRESETS', 'WEATHER_SKIES', 'SOLAR_PHASE_CONFIG']);
  for (const phase of ['noon', 'night']) {
    for (const [condition, cloudStyle, family, cover] of [['PARTLY_CLOUDY_DAY', 'thin', 0, .22], ['CLOUDY', 'mostly', 1, .78], ['CLOUDY', 'overcast', 2, .98], ['THUNDER_SHOWER', undefined, 4, .98]]) {
      api.updateScene(condition, { cloudStyle, forcedSolarPhase: phase, realtime: { cloudrate: cover } });
      assert.equal(state.cloudPreset.condition, family);
      assert.equal(state.solarPhase, phase);
      assert.ok(scene.className.includes('shader-clouds-active'), 'updates must not bring back blob sprites');
      assert.equal(state.cloudLight.x, phase === 'night' ? .24 : .8);
      assert.equal(state.cloudLight.y, phase === 'night' ? .9 : .88);
      if (cloudStyle === 'mostly') {
        assert.ok(scene.className.includes('scene-mostly-cloudy'));
        assert.ok(!scene.className.includes('scene-overcast'));
      }
    }
  }
});
