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

test('weather scene and glass canvas stay fixed while page cards scroll', () => {
  const sceneRule = html.match(/\.weather-scene \{[\s\S]*?\n        \}/)?.[0] || '';
  const glassRule = html.match(/\.weather-glass \{[\s\S]*?\n        \}/)?.[0] || '';
  assert.match(sceneRule, /position: fixed;/);
  assert.match(glassRule, /position: fixed;/);
  assert.match(html, /requestAnimationFrame\(drawWeatherParticles\)/);
});

test('scroll updates cached glass regions without triggering layout reads', () => {
  const scrollStart = html.indexOf("document.addEventListener('scroll'");
  const scrollEnd = html.indexOf('\n', html.indexOf(';', scrollStart) + 1);
  const scrollListener = html.slice(scrollStart, scrollEnd);
  assert.match(scrollListener, /syncGlassProtectedRegionsForScroll/);
  assert.doesNotMatch(scrollListener, /invalidateWeatherGlassLayout/);

  const scroller = { scrollTop: 0, scrollLeft: 0 };
  const state = {
    glassProtectedRegions: [{
      left: 10, right: 110, top: 120, bottom: 220,
      scrollSources: [{ element: scroller, top: 0, left: 0 }]
    }]
  };
  const { syncGlassProtectedRegionsForScroll } = runInNewContext(
    `${inlineFunction('syncGlassProtectedRegionsForScroll')}; ({ syncGlassProtectedRegionsForScroll })`,
    { weatherSceneState: state }
  );

  scroller.scrollTop = 180;
  scroller.scrollLeft = 12;
  syncGlassProtectedRegionsForScroll();
  assert.deepEqual(state.glassProtectedRegions[0], {
    left: -2, right: 98, top: -60, bottom: 40,
    scrollSources: [{ element: scroller, top: 180, left: 12 }]
  });
});
