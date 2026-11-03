import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function inlineFunction(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  return html.slice(start, html.indexOf('\n        }', start) + 10);
}
function style() {
  return { setProperty(key, value) { this[key] = value; } };
}

test('hero shading reaches transparent on every edge, including bright-weather overrides', () => {
  const hero = html.match(/\.weather-header::before \{([^}]+)\}/g);
  assert.equal(hero.length, 2);
  assert.match(hero[0], /--hero-shade:/);
  assert.doesNotMatch(hero[0], /background:/, 'weather-specific tint must retain the same feather geometry');
  assert.match(hero[1], /radial-gradient\(ellipse closest-side at 50% 50%,[^;]+transparent 100%\)/);
  assert.doesNotMatch(hero[1], /backdrop-filter|clip-path|farthest-corner at/);
});

test('pull arrow rotates with progress but success, failure and spinner are upright', () => {
  const iconElement = {};
  const page = { style: style(), classList: { toggle() {} } };
  const indicator = { setAttribute() {}, querySelector: () => iconElement };
  const { setWeatherPullVisual } = runInNewContext(`${inlineFunction('setWeatherPullVisual')}; ({setWeatherPullVisual})`, {
    WEATHER_PULL_MAX: 96,
    weatherPullElements: () => ({ page, indicator, label: {} })
  });
  for (const [icon, rotation] of [['ph-arrow-down', '180deg'], ['ph-spinner-gap', '0deg'], ['ph-check', '0deg'], ['ph-warning', '0deg']]) {
    setWeatherPullVisual({ offset: 52, progress: 1, icon });
    assert.equal(page.style['--weather-pull-icon-rotation'], rotation);
    assert.equal(iconElement.className, `ph ${icon}`);
  }
  setWeatherPullVisual({ offset: 0, progress: 0, icon: 'ph-arrow-down' });
  assert.equal(page.style['--weather-pull-icon-rotation'], '0deg');
  assert.match(html, /\.is-pull-complete \.weather-pull-refresh-icon i \{\s*animation: none;\s*transform: none;/);
});

test('capsule refraction preserves the center and bends all four edges inward symmetrically', () => {
  const createMap = runInNewContext(`${inlineFunction('createDockDisplacementMap')}; createDockDisplacementMap`);
  for (const [width, height] of [[360, 54], [288, 54], [87, 44]]) {
    const pixels = createMap(width, height);
    const pixel = (x, y) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    assert.equal(pixels.length, width * height * 4);
    assert.deepEqual(pixel(Math.floor(width / 2), Math.floor(height / 2)), [128, 128, 128, 255]);
    assert.deepEqual(pixel(0, 0), [128, 128, 128, 255], 'outside the curved corner is neutral');
    const left = pixel(1, height / 2), right = pixel(width - 2, height / 2);
    const top = pixel(Math.floor(width / 2), 1), bottom = pixel(Math.floor(width / 2), height - 2);
    assert.ok(left[0] > 180 && right[0] < 76, 'rounded ends have horizontal lensing');
    assert.ok(top[1] > 180 && bottom[1] < 76, 'top and bottom have vertical lensing');
    assert.equal(left[0] + right[0], 256);
    assert.equal(top[1] + bottom[1], 256);
    assert.ok(pixel(Math.floor(width / 2), 5)[1] < top[1], 'refraction fades toward the interior');
  }
});

test('selection follows routes and resized buttons, cancels old morphs and respects reduced motion', () => {
  const selected = { dataset: { page: 'weather' }, offsetLeft: 5, offsetWidth: 87 };
  let animations = 0, cancellations = 0;
  const lens = { animate() { animations++; return { cancel() { cancellations++; } }; } };
  const selection = { dataset: {}, style: style(), querySelector: () => lens };
  const motion = { matches: false };
  const updateSelection = runInNewContext(`let dockLensAnimation = null; ${inlineFunction('updateDockSelection')}; updateDockSelection`, {
    tabNav: { querySelector: selector => selector === '.tab-item.active' ? selected : selection },
    dockMotionQuery: motion
  });
  updateSelection();
  assert.equal(animations, 0, 'initial placement does not animate');
  selected.dataset.page = 'market'; selected.offsetLeft = 92;
  updateSelection();
  assert.equal(selection.style['--dock-x'], '92px');
  assert.equal(animations, 1);
  selected.dataset.page = 'f1'; selected.offsetLeft = 266;
  updateSelection();
  assert.equal(cancellations, 1, 'rapid navigation cancels the previous morph');
  assert.equal(animations, 2);
  selected.offsetLeft = 221; selected.offsetWidth = 72;
  updateSelection(false);
  assert.equal(selection.style['--dock-x'], '221px');
  assert.equal(selection.style['--dock-width'], '72px');
  assert.equal(animations, 2, 'resize updates position without another morph');
  motion.matches = true; selected.dataset.page = 'news';
  updateSelection();
  assert.equal(animations, 2);
  selected.offsetWidth = 0; selected.offsetLeft = 0;
  updateSelection();
  assert.equal(selection.style['--dock-width'], '72px', 'tablet collapse preserves the expanded selection geometry');
});

test('dock retains navigation, compact touch targets, refraction and progressive CSS fallbacks', () => {
  for (const page of ['weather', 'market', 'news', 'f1']) {
    assert.match(html, new RegExp(`<button class="tab-item(?: active)?" data-page="${page}"`));
  }
  assert.match(html, /const navPage = normalizedPage === 'typhoon' \? 'weather' : normalizedPage/);
  assert.match(html, /setActivePage\(t.dataset.page, \{ updateHistory: true \}\)/);
  assert.match(html, /window.addEventListener\('popstate'/);
  assert.match(html, /\.tab-nav \.tab-item \{[^}]*min-width: 44px;[^}]*height: 44px;/);
  assert.match(html, /\.tab-nav \{[^}]*height: 54px;/);
  assert.match(html, /background: rgba\(var\(--dock-rgb\), 0.94\)/);
  assert.match(html, /backdrop-filter: blur\(18px\) saturate\(1.6\)/);
  assert.match(html, /backdrop-filter: blur\(3px\) saturate\(1.5\) url\(#dockGlassFilter\)/);
  assert.match(html, /<feDisplacementMap in="SourceGraphic" in2="lensMap"[^>]*xChannelSelector="R" yChannelSelector="G"/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.dock-selection,[^}]*transition: none !important;/);
});
