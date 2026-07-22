import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAirQualityStandards } from '../lib/air-quality-standards.mjs';

function pollutant(code, value, subAqi = null, unit = 'μg/m3') {
  return {
    code,
    concentration: { value, unit },
    subIndexes: subAqi === null ? [] : [{ code: 'us-epa', aqi: subAqi }]
  };
}

test('keeps the local monitoring index and computes US and European standards from the same observation', () => {
  const standards = buildAirQualityStandards({
    indexes: [{
      code: 'chn-mee',
      name: '中国环境空气质量指数',
      aqi: 72,
      category: '良',
      primaryPollutant: { code: 'pm2p5', name: 'PM2.5' },
      health: { advice: { generalPopulation: '可以正常外出' } }
    }],
    pollutants: [
      pollutant('pm2p5', 35, 99),
      pollutant('pm10', 44, 46),
      pollutant('o3', 82, 38),
      pollutant('no2', 28, 25),
      pollutant('so2', 8, 6)
    ]
  });

  assert.deepEqual(standards.local, {
    code: 'local',
    label: '本地标准',
    name: '中国环境空气质量指数',
    aqi: 72,
    category: '良',
    primaryPollutant: 'PM2.5',
    healthAdvice: '可以正常外出',
    scaleMax: 300
  });
  assert.equal(standards.us.aqi, 99);
  assert.equal(standards.us.category, '良');
  assert.equal(standards.us.primaryPollutant, 'PM2.5');
  assert.equal(standards.us.scaleMax, 300);
  assert.equal(standards.european.aqi, 68);
  assert.equal(standards.european.category, '较差');
  assert.equal(standards.european.primaryPollutant, 'PM2.5');
  assert.equal(standards.european.scaleMax, 100);
});

test('converts gas concentrations supplied in ppb before calculating European AQI', () => {
  const standards = buildAirQualityStandards({
    indexes: [],
    pollutants: [pollutant('no2', 50, null, 'ppb')]
  });

  assert.equal(standards.european.aqi, 43);
  assert.equal(standards.european.primaryPollutant, 'NO₂');
});

test('calculates US EPA AQI from monitored concentrations when QWeather omits US sub-indexes', () => {
  const standards = buildAirQualityStandards({
    indexes: [{ code: 'chn-mee', aqi: 24, category: '优' }],
    pollutants: [
      pollutant('pm2p5', 17),
      pollutant('pm10', 23),
      pollutant('o3', 68),
      pollutant('no2', 18),
      pollutant('so2', 7),
      pollutant('co', 0.6, null, 'mg/m3')
    ]
  });

  assert.equal(standards.us.aqi, 66);
  assert.equal(standards.us.category, '良');
  assert.equal(standards.us.primaryPollutant, 'PM2.5');
});

test('returns unavailable values when an upstream payload has no usable indexes', () => {
  const standards = buildAirQualityStandards({ indexes: [], pollutants: [] });

  assert.equal(standards.local.aqi, null);
  assert.equal(standards.us.aqi, null);
  assert.equal(standards.european.aqi, null);
  assert.equal(standards.us.category, '暂无评级');
});
