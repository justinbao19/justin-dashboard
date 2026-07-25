import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('weather automatically attempts device geolocation on first entry unless permission is denied', () => {
  assert.match(html, /let automaticDeviceLocationAttempted = false;/);
  assert.match(
    html,
    /const shouldTryDevice = forceRelocate\s*\|\| permissionState === 'granted'\s*\|\| \(permissionState !== 'denied' && !automaticDeviceLocationAttempted\);/
  );
  assert.match(html, /preferDevice: shouldTryDevice/);
});

test('weather normalizes permission results and avoids repeated denied requests', () => {
  assert.match(html, /geolocationPermissionState = 'granted';\s*resolve\(position\);/);
  assert.match(html, /if \(normalizedError\.code === 1\) geolocationPermissionState = 'denied';/);
  assert.match(html, /if \(Number\(error\?\.code\) === 1\) break;/);
});

test('weather keeps a previous device location on transient GPS failures before using IP fallback', () => {
  assert.match(html, /previousDeviceLocation[\s\S]*source: 'device-cache'/);
  assert.match(html, /Number\(error\?\.code\) !== 1/);
  assert.match(html, /设备定位暂时不可用，已保留上次设备位置/);
  assert.match(html, /定位权限未开启，已根据网络位置匹配天气/);
});
