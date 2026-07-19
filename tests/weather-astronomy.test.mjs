import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachAstronomy,
  fetchQWeatherAstronomy,
  normalizeQWeatherAstronomy
} from '../lib/weather-astronomy.mjs';

const qweatherPayload = {
  code: '200',
  updateTime: '2026-07-19T08:30+08:00',
  daily: [{
    fxDate: '2026-07-19',
    moonrise: '10:23',
    moonset: '23:12',
    moonPhase: '娥眉月',
    moonPhaseIcon: '802'
  }]
};

function toPem(buffer) {
  const base64 = Buffer.from(buffer).toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

test('normalizes QWeather moon phase, moonrise and moonset', () => {
  const result = normalizeQWeatherAstronomy(qweatherPayload);
  assert.equal(result.source, 'qweather');
  assert.equal(result.providerLabel, 'QWeather 和风天气');
  assert.deepEqual(result.daily[0], {
    date: '2026-07-19',
    moonrise: '10:23',
    moonset: '23:12',
    moonPhase: '娥眉月',
    moonPhaseIcon: '802'
  });
});

test('does not call QWeather when credentials are absent', async () => {
  let called = false;
  const result = await fetchQWeatherAstronomy({
    env: {},
    lon: 121.4,
    lat: 31.1,
    fetchImpl: async () => {
      called = true;
      throw new Error('should not be called');
    }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test('signs a JWT and requests the configured QWeather host', async () => {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privateKey = toPem(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const env = {
    QWEATHER_API_HOST: 'test-api.qweather.example',
    QWEATHER_PROJECT_ID: 'project-id',
    QWEATHER_CREDENTIAL_ID: 'credential-id',
    QWEATHER_PRIVATE_KEY: privateKey
  };
  const result = await fetchQWeatherAstronomy({
    env,
    lon: 121.405,
    lat: 31.123,
    fetchImpl: async (url, options) => {
      assert.equal(url.hostname, 'test-api.qweather.example');
      assert.equal(url.pathname, '/v7/weather/7d');
      assert.equal(url.searchParams.get('location'), '121.41,31.12');
      assert.match(options.headers.authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
      return new Response(JSON.stringify(qweatherPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  assert.equal(result.daily[0].moonPhase, '娥眉月');
});

test('keeps the original weather payload when astronomy is unavailable', () => {
  const weather = { status: 'ok', result: { realtime: { temperature: 28 } } };
  assert.equal(attachAstronomy(weather, null), weather);
  assert.deepEqual(attachAstronomy(weather, { source: 'qweather', daily: [] }), {
    ...weather,
    astronomy: { source: 'qweather', daily: [] }
  });
});
