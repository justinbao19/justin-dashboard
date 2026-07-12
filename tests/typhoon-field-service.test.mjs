import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTyphoonFieldGrid, getTyphoonFields, normalizeTyphoonFields } from '../lib/typhoon-field-service.mjs';

test('builds a bounded model grid around the typhoon', () => {
  const points = buildTyphoonFieldGrid(32, 179);
  assert.equal(points.length, 99);
  assert(points.every(point => point.lat >= -70 && point.lat <= 70));
  assert(points.every(point => point.lon >= -180 && point.lon <= 180));
});

test('normalizes wind and wave fields while dropping missing marine cells', () => {
  const points = [{ lat: 30, lon: 120 }, { lat: 30, lon: 123 }];
  const fields = normalizeTyphoonFields(points,
    [{ current: { time: '2026-07-12T16:15', wind_speed_10m: 12, wind_direction_10m: 90, wind_gusts_10m: 18 } }, { current: { time: '2026-07-12T16:15', wind_speed_10m: 10 } }],
    [{ current: { time: '2026-07-12T16:15', wave_height: null } }, { current: { time: '2026-07-12T16:15', wave_height: 4.2, wave_direction: 160, wave_period: 8.4 } }]
  );
  assert.equal(fields.wind.geojson.features.length, 2);
  assert.equal(fields.waves.geojson.features.length, 1);
  assert.equal(fields.waves.geojson.features[0].properties.value, 4.2);
});

test('requests wind and marine data as one batched call per provider', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(String(url));
    const isMarine = String(url).includes('marine-api');
    const rows = Array.from({ length: 99 }, () => ({ current: isMarine
      ? { time: '2026-07-12T16:15', wave_height: 2, wave_direction: 150, wave_period: 7 }
      : { time: '2026-07-12T16:15', wind_speed_10m: 9, wind_direction_10m: 140, wind_gusts_10m: 13 } }));
    return { ok: true, json: async () => rows };
  };
  const payload = await getTyphoonFields(32, 118, { fetchImpl });
  assert.equal(urls.length, 2);
  assert.equal(payload.fields.wind.geojson.features.length, 99);
  assert.equal(payload.fields.waves.geojson.features.length, 99);
});
