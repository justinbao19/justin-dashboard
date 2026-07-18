import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldInterpolator, interpolateFieldColor } from '../typhoon-field-renderer.mjs';

test('interpolates field colors between standard scale stops', () => {
  assert.deepEqual(interpolateFieldColor([[0, '#000000'], [10, '#ffffff']], 5), [128, 128, 128]);
  assert.deepEqual(interpolateFieldColor([[0, '#123456'], [10, '#ffffff']], -1), [18, 52, 86]);
});

test('bilinearly interpolates scalar values and circular directions', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [
      [120, 30, 0], [122, 30, 10], [120, 32, 20], [122, 32, 30]
    ].map(([lon, lat, value]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { value, direction: 90 }
    }))
  };
  const interpolator = buildFieldInterpolator(geojson);
  const sample = interpolator.sample(121, 31);
  assert.equal(sample.value, 15);
  assert(sample.east < -.99);
  assert(Math.abs(sample.north) < .01);
  assert.equal(interpolator.sample(119, 31), null);
});
