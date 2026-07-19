import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  assert.match(html, /updateCelestialPosition\(scene, astro, isNight, weather\.celestialProgress\)/);
  assert.match(html, /const isNight = typeof weather\.forceNight === 'boolean'[\s\S]*\? \(now < sunrise \|\| now > sunset\)/);
  assert.match(html, /updateScene\(scenePreview\?\.skycon \|\| rt\.skycon \|\| 'CLEAR_DAY', scenePreview\?\.weather \|\| \{\s*realtime: rt,\s*hourly: d\.hourly \|\| \{\},\s*astro: d\.daily\?\.astro\?\.\[0\] \|\| \{\}/);
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
