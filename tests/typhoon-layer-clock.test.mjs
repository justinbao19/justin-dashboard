import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGibsDomainUrl,
  buildGibsWmtsUrl,
  chooseLatestAvailableTime,
  chooseSynchronizedFrame,
  parseDurationMs,
  parseGibsDomainXml,
  timeInIntervals
} from '../typhoon-layer-clock.mjs';

const domain = value => `<Domains><DimensionDomain><Domain>${value}</Domain></DimensionDomain></Domains>`;

test('parses GIBS duration and interval domains', () => {
  assert.equal(parseDurationMs('PT10M'), 600000);
  assert.equal(parseDurationMs('PT30M'), 1800000);
  const intervals = parseGibsDomainXml(domain('2026-07-11T14:00:00Z/2026-07-11T15:20:00Z/PT10M'));
  assert.equal(intervals.length, 1);
  assert.equal(timeInIntervals('2026-07-11T15:00:00Z', intervals), true);
  assert.equal(timeInIntervals('2026-07-11T15:05:00Z', intervals), false);
});

test('chooses the latest shared frame not after the storm analysis', () => {
  const frames = [
    { time: Date.parse('2026-07-11T14:50:00Z') / 1000, path: '/radar/1450' },
    { time: Date.parse('2026-07-11T15:00:00Z') / 1000, path: '/radar/1500' },
    { time: Date.parse('2026-07-11T15:10:00Z') / 1000, path: '/radar/1510' }
  ];
  const infrared = domain('2026-07-11T14:40:00Z/2026-07-11T15:20:00Z/PT10M');
  const visible = domain('2026-07-11T14:50:00Z/2026-07-11T15:20:00Z/PT10M');
  const result = chooseSynchronizedFrame({ frames, domainXml: [infrared, visible], targetAt: '2026-07-11T15:05:00Z' });
  assert.equal(result.observedAt, '2026-07-11T15:00:00.000Z');
  assert.equal(result.path, '/radar/1500');
  assert.equal(result.skewMinutes, -5);
});

test('returns null instead of silently mixing unavailable cloud times', () => {
  const frames = [{ time: Date.parse('2026-07-11T15:00:00Z') / 1000, path: '/radar/1500' }];
  const infrared = domain('2026-07-11T14:00:00Z/2026-07-11T14:30:00Z/PT10M');
  const visible = domain('2026-07-11T15:00:00Z/2026-07-11T15:20:00Z/PT10M');
  assert.equal(chooseSynchronizedFrame({ frames, domainXml: [infrared, visible], targetAt: '2026-07-11T15:00:00Z' }), null);
});

test('selects the latest precipitation slot not after the shared observation', () => {
  const precipitation = domain('2026-07-09T00:00:00Z/2026-07-10T18:30:00Z/PT30M');
  assert.equal(chooseLatestAvailableTime(precipitation, '2026-07-11T15:00:00Z'), '2026-07-10T18:30:00.000Z');
});

test('builds bounded WMTS and Domains URLs', () => {
  assert.equal(
    buildGibsWmtsUrl({ layer: 'IMERG_Precipitation_Rate_30min', time: '2026-07-10T18:30:00.000Z', tileMatrixSet: 'GoogleMapsCompatible_Level6' }),
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/2026-07-10T18%3A30%3A00.000Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png'
  );
  assert.match(
    buildGibsDomainUrl({ layer: 'Himawari_AHI_Band13_Clean_Infrared', tileMatrixSet: 'GoogleMapsCompatible_Level6', start: '2026-07-11T12:00:00Z', end: '2026-07-11T16:00:00Z' }),
    /2026-07-11T12:00:00Z--2026-07-11T16:00:00Z\.xml$/
  );
});
