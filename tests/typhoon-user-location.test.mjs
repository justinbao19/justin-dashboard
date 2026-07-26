import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const js = await readFile(new URL('../typhoon.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../typhoon.html', import.meta.url), 'utf8');

test('typhoon map restores cached device location and refreshes it from browser geolocation', () => {
  assert.match(js, /readCache\('pulse\.weather\.location\.v1', LOCATION_CACHE_MS\)/);
  assert.match(js, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(js, /maximumAge: 5 \* 60 \* 1000/);
  assert.match(js, /writeCache\('pulse\.weather\.location\.v1'/);
  assert.match(js, /new maplibregl\.Marker\(\{ element: markerElement, anchor: 'center' \}\)/);
  assert.match(html, /id="userLocationButton"[^>]*aria-label="定位到我的位置"/);
});

test('typhoon user marker is limited to device-derived coordinates', () => {
  assert.match(js, /function isDeviceLocation\(locationData\)/);
  assert.match(js, /\['device', 'device-cache', 'unknown'\]\.includes\(locationData\.source\)/);
  assert.match(js, /const locationData = isDeviceLocation\(cachedLocation\) \? cachedLocation : null;/);
});
