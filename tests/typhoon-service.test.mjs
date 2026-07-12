import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TyphoonServiceError,
  getActiveTyphoons,
  getTyphoonDetail,
  normalizeGdacsCurrentAnalysis,
  normalizeGdacsFeature,
  normalizeZhejiangTrack,
  parseTyphoonId
} from '../lib/typhoon-service.mjs';

const NOW = new Date('2026-07-11T12:00:00Z');

function feature(overrides = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [123.2, 26.6] },
    properties: {
      eventtype: 'TC', eventid: 1001279, episodeid: 42, eventname: 'BAVI-26',
      iscurrent: 'true', alertlevel: 'Red', source: 'JTWC',
      fromdate: '2026-07-01T00:00:00', todate: '2026-07-11T06:00:00',
      datemodified: '2026-07-11T11:50:16',
      affectedcountries: [{ countryname: 'Taiwan' }, { countryname: 'China' }],
      severitydata: { severity: 287.0352, severityunit: 'km/h' },
      ...overrides
    }
  };
}

function response(body, { status = 200, contentType = 'application/json' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body
  };
}

test('keeps GDACS event maximum separate from current analysis', () => {
  const storm = normalizeGdacsFeature(feature(), NOW);
  assert.equal(storm.id, 'gdacs-tc-1001279');
  assert.equal(storm.name.display, 'BAVI');
  assert.equal(storm.name.zh, '巴威');
  assert.equal(storm.classification, 'unknown');
  assert.equal(storm.intensity.basis, 'unknown');
  assert.equal(storm.historicalMaximum.basis, 'event_max');
  assert.equal(storm.historicalMaximum.value, 287.0352);
  assert.equal(storm.intensity.centralPressureHpa, null);
  assert.equal(storm.stale, false);
});

test('normalizes the current GDACS advisory using Chinese typhoon thresholds', () => {
  const current = normalizeGdacsCurrentAnalysis({ channel: { item: [
    { actual: 'True', current: 'false', latitude: '25', longitude: '124.6', wind_speed: '51.44', advisory_datetime: '11 Jul 2026 00:00' },
    { actual: 'True', current: 'true', latitude: '26.6', longitude: '123.2', wind_speed: '41.152', advisory_datetime: '11 Jul 2026 06:00' }
  ] } }, NOW);
  assert.equal(current.classification, 'typhoon');
  assert.equal(current.intensity.value, 41.152);
  assert.equal(current.intensity.unit, 'm/s');
  assert.equal(current.intensity.windForceScale, 13);
  assert.equal(current.intensity.basis, 'current_analysis');
  assert.equal(current.updatedAt, '2026-07-11T06:00:00.000Z');
});

test('normalizes observed and multi-agency Zhejiang forecast tracks', () => {
  const tracks = normalizeZhejiangTrack({ points: [
    { time: '2026-07-11 21:00:00', lng: '121.7', lat: '27.6', strong: '台风', power: '13', speed: '40', pressure: '950', movespeed: '29', movedirection: '北西' },
    { time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '台风', power: '13', speed: '40', pressure: '950', movespeed: '29', movedirection: '北西', radius7: '400|300|250|200', radius10: '200|150|120|100', radius12: '100|80|70|60', forecast: [
      { tm: '中国', forecastpoints: [
        { time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '台风', power: '13', speed: '40', pressure: '950' },
        { time: '2026-07-12 04:00:00', lng: '120.3', lat: '29.1', strong: '台风', power: '12', speed: '33', pressure: '975' }
      ] },
      { tm: '日本', forecastpoints: [
        { time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '台风', power: '13', speed: '40', pressure: '950' },
        { time: '2026-07-12 10:00:00', lng: '120.0', lat: '30.0', strong: '热带风暴', power: '9', speed: '23', pressure: '990' }
      ] }
    ] }
  ] });
  assert.equal(tracks.observed.length, 2);
  assert.equal(tracks.observed[1].validAt, '2026-07-11T14:00:00.000Z');
  assert.equal(tracks.observed[1].intensity.windForceScale, 13);
  assert.equal(tracks.observed[1].movement.directionText, '西北');
  assert.deepEqual(tracks.observed[1].windCircles[0].quadrants, { northeast: 400, southeast: 300, southwest: 200, northwest: 250 });
  assert.equal(tracks.observed[1].windCircles[0].minRadiusKm, 200);
  assert.equal(tracks.observed[1].windCircles[0].maxRadiusKm, 400);
  assert.equal(tracks.observed[1].windCircles.length, 3);
  assert.deepEqual(tracks.forecasts.map(track => track.id), ['cma', 'jma']);
  assert.equal(tracks.forecasts[0].points[1].intensity.centralPressureHpa, 975);
});

test('treats upstream zero placeholders as missing forecast intensity', () => {
  const tracks = normalizeZhejiangTrack({ points: [{
    time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '台风', power: '13', speed: '40', pressure: '950', forecast: [
      { tm: '中国台湾', forecastpoints: [
        { time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '热带风暴', power: '9', speed: '23', pressure: '988' },
        { time: '2026-07-12 10:00:00', lng: '120.0', lat: '30.0', strong: '热带扰动', power: '0', speed: '0', pressure: '0' }
      ] }
    ]
  }] });
  const point = tracks.forecasts[0].points[1];
  assert.equal(point.classification, 'tropical_disturbance');
  assert.equal(point.intensity.value, null);
  assert.equal(point.intensity.windForceScale, null);
  assert.equal(point.intensity.centralPressureHpa, null);
});

test('filters inactive and out-of-basin events', async () => {
  const fetchImpl = async () => response({ features: [
    feature(),
    feature({ eventid: 2, iscurrent: 'false' }),
    { ...feature({ eventid: 3 }), geometry: { type: 'Point', coordinates: [-80, 20] } }
  ] });
  const result = await getActiveTyphoons({ fetchImpl, now: NOW });
  assert.equal(result.active, true);
  assert.deepEqual(result.storms.map(storm => storm.id), ['gdacs-tc-1001279']);
  assert.equal(result.sources.find(source => source.id === 'cwa').status, 'disabled');
});

test('enriches the active list with the latest dynamic GDACS advisory', async () => {
  const timelineUrl = 'https://www.gdacs.org/gdacsapi/api/export/gettimeline?id=765611';
  const fetchImpl = async url => {
    if (url.includes('geteventlist')) return response({ features: [feature()] });
    if (url.includes('geteventdata')) return response({ properties: { eventid: 1001279, impacts: [{ resource: { timeline: timelineUrl } }] } });
    if (url === timelineUrl) return response({ channel: { item: [{
      actual: 'True', current: 'true', latitude: '26.6', longitude: '123.2',
      wind_speed: '41.152', advisory_datetime: '11 Jul 2026 06:00'
    }] } });
    throw new Error(`Unexpected URL ${url}`);
  };
  const result = await getActiveTyphoons({ fetchImpl, now: NOW });
  assert.equal(result.storms[0].classification, 'typhoon');
  assert.equal(result.storms[0].intensity.basis, 'current_analysis');
  assert.equal(result.storms[0].intensity.value, 41.152);
  assert.equal(result.storms[0].intensity.windForceScale, 13);
});

test('returns a confirmed empty state only for a valid empty response', async () => {
  const result = await getActiveTyphoons({ fetchImpl: async () => response({ features: [] }), now: NOW });
  assert.equal(result.status, 'ok');
  assert.equal(result.active, false);
  assert.deepEqual(result.storms, []);
});

test('merges configured CWA official analysis over GDACS event-maximum fields', async () => {
  const cwaPayload = { records: { tropicalCyclones: { tropicalCyclone: [{
    typhoonName: 'BAVI', cwaTyphoonName: '巴威', typhoonNumber: '202601',
    analysisData: { fix: [{
      coordinate: { coordinateLatitude: 26.7, coordinateLongitude: 123.3 },
      maxWindSpeed: 45, centralPressure: 950, fixTime: '2026-07-11T11:00:00Z',
      movingDirection: '西北', movingSpeed: 18
    }] }
  }] } } };
  const fetchImpl = async url => url.includes('opendata.cwa.gov.tw')
    ? response(cwaPayload)
    : response({ features: [feature()] });
  const result = await getActiveTyphoons({ fetchImpl, cwaApiKey: 'test-key', now: NOW });
  assert.equal(result.status, 'ok');
  assert.equal(result.storms[0].name.zh, '巴威');
  assert.equal(result.storms[0].intensity.basis, 'current_analysis');
  assert.equal(result.storms[0].intensity.centralPressureHpa, 950);
  assert.equal(result.storms[0].intensity.windForceScale, 14);
  assert.equal(result.storms[0].providerIds.cwa, '202601');
});

test('keeps GDACS storms visible when configured CWA is unavailable', async () => {
  const fetchImpl = async url => url.includes('opendata.cwa.gov.tw')
    ? response({ error: true }, { status: 503 })
    : response({ features: [feature()] });
  const result = await getActiveTyphoons({ fetchImpl, cwaApiKey: 'test-key', now: NOW });
  assert.equal(result.status, 'degraded');
  assert.equal(result.active, true);
  assert.equal(result.storms[0].intensity.basis, 'unknown');
  assert.equal(result.storms[0].historicalMaximum.basis, 'event_max');
  assert.equal(result.sources.find(source => source.id === 'cwa').status, 'error');
});

test('does not expose CWA-only entries without a supported detail route', async () => {
  const cwaPayload = { records: { tropicalCyclones: { tropicalCyclone: [{
    typhoonName: 'REMOTE', typhoonNumber: '202699',
    analysisData: { fix: [{ coordinate: { coordinateLatitude: 5, coordinateLongitude: 175 }, maxWindSpeed: 20, fixTime: '2026-07-11T11:00:00Z' }] }
  }] } } };
  const fetchImpl = async url => url.includes('opendata.cwa.gov.tw') ? response(cwaPayload) : response({ features: [feature()] });
  const result = await getActiveTyphoons({ fetchImpl, cwaApiKey: 'test-key', now: NOW });
  assert.deepEqual(result.storms.map(storm => storm.id), ['gdacs-tc-1001279']);
});

test('rejects malformed upstream data instead of reporting no storms', async () => {
  await assert.rejects(
    getActiveTyphoons({ fetchImpl: async () => response({ unexpected: true }), now: NOW }),
    error => error instanceof TyphoonServiceError && error.code === 'INVALID_RESPONSE'
  );
});

test('validates public detail ids', () => {
  assert.equal(parseTyphoonId('gdacs-tc-1001279'), '1001279');
  assert.throws(() => parseTyphoonId('https://example.com/'), /ID/);
  assert.throws(() => parseTyphoonId('../1001279'), /ID/);
});

test('returns detail even when optional geometry fails', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return response(feature());
    return response({ error: true }, { status: 502 });
  };
  const result = await getTyphoonDetail('gdacs-tc-1001279', { fetchImpl, now: NOW });
  assert.equal(result.status, 'degraded');
  assert.equal(result.storm.id, 'gdacs-tc-1001279');
  assert.equal(result.eventGeometry.features.length, 0);
});

test('uses a Zhejiang id fast path without waiting for GDACS detail', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    return response({
      name: '巴威', enname: 'BAVI', starttime: '2026-07-02 08:00:00',
      points: [
        { time: '2026-07-11 21:00:00', lng: '121.7', lat: '27.6', strong: '台风', power: '13', speed: '40', pressure: '950', movespeed: '29', movedirection: '西北' },
        { time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '台风', power: '13', speed: '40', pressure: '950', movespeed: '29', movedirection: '西北', forecast: [{ tm: '中国', forecastpoints: [
          { time: '2026-07-11 22:00:00', lng: '121.5', lat: '27.8', strong: '台风', power: '13', speed: '40', pressure: '950' },
          { time: '2026-07-12 04:00:00', lng: '120.3', lat: '29.1', strong: '台风', power: '12', speed: '33', pressure: '975' }
        ] }] }
      ]
    });
  };
  const result = await getTyphoonDetail('gdacs-tc-1001279', { fetchImpl, zhejiangId: '202609', now: NOW });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /TyphoonInfo\/202609$/);
  assert.equal(result.status, 'ok');
  assert.equal(result.storm.name.zh, '巴威');
  assert.equal(result.tracks.forecasts[0].id, 'cma');
});

test('sanitizes long upstream names and keeps stale active data visible', () => {
  const storm = normalizeGdacsFeature(feature({
    eventname: `<script>${'X'.repeat(120)}</script>-26`,
    datemodified: '2026-07-10T00:00:00Z'
  }), NOW);
  assert.ok(storm.name.display.length <= 80);
  assert.ok(!storm.name.display.includes('<'));
  assert.equal(storm.stale, true);
  assert.equal(storm.active, true);
});
