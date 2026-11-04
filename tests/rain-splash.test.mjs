import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildTargetRect,
  createSplashSystem,
  isRainSplashScene,
  selectTopRowCards,
  splashAnimationEnabled,
  spawnRate,
  stepSplash
} from '../rain-splash.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const moduleSource = await readFile(new URL('../rain-splash.mjs', import.meta.url), 'utf8');

test('buildTargetRect copies getter-only DOMRect properties', () => {
  const prototype = {};
  for (const [name, value] of Object.entries({ top: 12, left: 24, width: 320, height: 88, bottom: 100, right: 344 })) {
    Object.defineProperty(prototype, name, { get: () => value });
  }
  const element = { getBoundingClientRect: () => Object.create(prototype) };
  const rect = buildTargetRect(element);
  assert.deepEqual(rect, { element, top: 12, left: 24, width: 320, height: 88, bottom: 100, right: 344, visible: true });
  assert.deepEqual(selectTopRowCards([rect], true), [rect]);
});

test('ballistic secondary droplets apply gravity and fade over their lifetime', () => {
  const system = createSplashSystem({ width: 120, edgeY: 100, intensity: 0.7 });
  system.droplets = [{ x: 20, y: 20, vx: 30, vy: -80, gravity: 500, drag: 1, age: 0, lifetime: 1, alpha: 1, size: 1 }];
  const stepped = stepSplash(system, 0.1, { random: () => 0.5 });
  const drop = stepped.droplets[0];
  assert.ok(drop.vy > -80, 'gravity increases vertical velocity');
  assert.ok(drop.x > 20, 'ballistic motion advances horizontally');
  assert.ok(drop.alpha < 1, 'lifetime fades alpha');
  assert.ok(drop.alpha > 0);
});

test('splash spawn rate increases monotonically with rain intensity', () => {
  const rates = [0, 0.25, 0.5, 0.75, 1].map(spawnRate);
  assert.deepEqual([...rates].sort((a, b) => a - b), rates);
  assert.ok(rates.at(-1) > rates[0]);
});

test('top-row selection keeps one mobile card and the desktop visual row', () => {
  const rects = [
    { element: 'first', top: 220, left: 32, width: 420, height: 100 },
    { element: 'second', top: 222, left: 476, width: 420, height: 100 },
    { element: 'third', top: 410, left: 32, width: 420, height: 100 },
    { element: 'hidden', top: 0, left: 0, width: 0, height: 0 }
  ];
  assert.deepEqual(selectTopRowCards(rects, true).map(rect => rect.element), ['first']);
  assert.deepEqual(selectTopRowCards(rects, false).map(rect => rect.element), ['first', 'second']);
});

test('activation accepts rain and thunder or storm rain while excluding snow and sleet', () => {
  assert.equal(isRainSplashScene({ particleType: 'rain', className: 'weather-scene scene-rain' }), true);
  assert.equal(isRainSplashScene({ particleType: 'rain', className: 'weather-scene scene-thunder' }), true);
  assert.equal(isRainSplashScene('scene-rain scene-storm'), true);
  assert.equal(isRainSplashScene({ particleType: 'snow', className: 'scene-snow scene-storm' }), false);
  assert.equal(isRainSplashScene({ particleType: 'sleet', className: 'scene-sleet' }), false);
});

test('reduced motion and inactive or offscreen states disable animation', () => {
  assert.equal(splashAnimationEnabled({ reducedMotion: true }), false);
  assert.equal(splashAnimationEnabled({ active: false }), false);
  assert.equal(splashAnimationEnabled({ hidden: true }), false);
  assert.equal(splashAnimationEnabled({ inView: false }), false);
  assert.equal(splashAnimationEnabled(), true);
});

test('index wires rain splash overlays to previews, motion, layout and scene state', () => {
  assert.match(html, /<script type="module" src="\.\/rain-splash\.mjs"><\/script>/);
  assert.match(html, /window\.__pulseWeatherScene = weatherSceneState/);
  assert.match(moduleSource, /className = 'rain-splash-canvas'/);
  assert.match(moduleSource, /aria-hidden/);
  assert.match(moduleSource, /requestAnimationFrame\(draw\)/);
  assert.match(moduleSource, /1000 \/ 30/);
  assert.match(moduleSource, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(moduleSource, /new IntersectionObserver/);
  assert.match(moduleSource, /new ResizeObserver/);
  assert.match(moduleSource, /prefers-reduced-motion/);
  assert.match(html, /'heavy-rain': 'HEAVY_RAIN'/);
  assert.match(html, /thunder: 'THUNDER_SHOWER'/);
});

test('glass droplets sit below weather content while splash overlays stay above it', () => {
  const glassZ = Number(html.match(/\.weather-glass\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  const pagesZ = Number(html.match(/\.pages\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  const contentZ = Number(html.match(/\.weather-content\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);
  const splashZ = Number(html.match(/\.rain-splash-canvas\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1]);

  assert.ok(Number.isFinite(glassZ));
  assert.ok(Number.isFinite(pagesZ));
  assert.ok(Number.isFinite(contentZ));
  assert.ok(Number.isFinite(splashZ));
  assert.ok(glassZ < pagesZ, 'glass must be below the page stacking context');
  assert.ok(glassZ < contentZ, 'glass must be below weather content');
  assert.ok(splashZ > contentZ, 'rain splash must stay above weather content');
});
