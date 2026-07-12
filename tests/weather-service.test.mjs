import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryWeatherCache,
  createQWeatherJwt,
  getWeatherSnapshot,
  normalizeCaiyunPayload,
  normalizeQWeatherResources,
  normalizeWeatherLocation
} from '../lib/weather-service.mjs';

test('rounds coordinates to QWeather precision for shared cache keys', () => {
  assert.deepEqual(normalizeWeatherLocation('121.4054', '31.1234'), { lon: 121.41, lat: 31.12 });
  assert.deepEqual(normalizeWeatherLocation('bad', null), { lon: 121.405, lat: 31.123 });
});

test('normalizes Caiyun comprehensive weather into the provider-neutral snapshot shape', () => {
  const normalized = normalizeCaiyunPayload({
    server_time: 1780000000,
    result: {
      realtime: {
        temperature: 26.4, apparent_temperature: 27.1, skycon: 'PARTLY_CLOUDY_DAY', humidity: 0.72,
        visibility: 18, pressure: 100800, cloudrate: 0.45, wind: { speed: 12, direction: 90 },
        precipitation: { local: { intensity: 0 } },
        air_quality: { aqi: { chn: 42 }, description: { chn: '优' }, pm25: 15, pm10: 28 }
      },
      hourly: {
        description: '今天午后多云',
        temperature: [{ datetime: '2026-07-12T12:00+08:00', value: 27 }],
        skycon: [{ datetime: '2026-07-12T12:00+08:00', value: 'CLOUDY' }],
        precipitation: [{ datetime: '2026-07-12T12:00+08:00', value: 0, probability: 10 }]
      },
      daily: {
        temperature: [{ date: '2026-07-12T00:00+08:00', min: 24, max: 31 }],
        skycon: [{ date: '2026-07-12T00:00+08:00', value: 'CLOUDY' }],
        astro: [{ sunrise: { time: '05:00' }, sunset: { time: '19:02' } }]
      }
    }
  });
  assert.equal(normalized.current.humidity, 72);
  assert.equal(normalized.current.pressure, 1008);
  assert.equal(normalized.hourly[0].precipitationProbability, 10);
  assert.equal(normalized.daily[0].sunset, '19:02');
  assert.equal(normalized.airQuality.current.aqi, 42);
});

test('normalizes QWeather extended forecasts, alerts, air quality and astronomy', () => {
  const normalized = normalizeQWeatherResources({
    now: { now: { obsTime: '2026-07-12T10:00+08:00', temp: '30', feelsLike: '34', text: '多云', icon: '101', humidity: '70', windSpeed: '15', wind360: '135', pressure: '1002', vis: '20', cloud: '60', dew: '23' } },
    hourly: { hourly: [{ fxTime: '2026-07-12T11:00+08:00', temp: '31', text: '阵雨', icon: '300', pop: '65', precip: '0.8', humidity: '74', windSpeed: '18', wind360: '150' }] },
    daily: { daily: [{ fxDate: '2026-07-12', sunrise: '05:00', sunset: '19:02', moonrise: '20:11', moonset: '05:40', moonPhase: '亏凸月', tempMin: '25', tempMax: '33', textDay: '多云', iconDay: '101', textNight: '阵雨', iconNight: '305', uvIndex: '8' }] },
    minutely: { summary: '一小时后有雨', minutely: [{ fxTime: '2026-07-12T10:05+08:00', precip: '0.2', type: 'rain' }] },
    warning: { warning: [{ id: 'a1', title: '雷电黄色预警', sender: '上海中心气象台', pubTime: '2026-07-12T09:30+08:00', text: '注意防范雷电。', level: '黄色' }], refer: { sources: ['上海中心气象台'] } },
    indices: { daily: [{ date: '2026-07-12', type: '3', name: '穿衣指数', level: '2', category: '炎热', text: '建议短袖。' }] },
    airCurrent: { indexes: [{ code: 'cn-mee', aqi: 56, aqiDisplay: '56', category: '良', primaryPollutant: { name: 'O3' }, health: { advice: { generalPopulation: '可以正常活动。' } } }], pollutants: [{ code: 'pm2p5', concentration: { value: 18 } }] },
    airHourly: { hours: [{ forecastTime: '2026-07-12T11:00Z', indexes: [{ code: 'cn-mee', aqi: 62, category: '良' }] }] }
  });
  assert.equal(normalized.current.dewPoint, 23);
  assert.equal(normalized.hourly[0].conditionCode, 'LIGHT_RAIN');
  assert.equal(normalized.daily[0].moonPhase, '亏凸月');
  assert.equal(normalized.alerts[0].sources[0], '上海中心气象台');
  assert.equal(normalized.airQuality.current.primaryPollutant, 'O3');
  assert.equal(normalized.airQuality.hourly[0].aqi, 62);
});

test('reuses one complete per-location snapshot across aggregate requests', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      server_time: 1780000000,
      result: {
        realtime: { temperature: 25, apparent_temperature: 26, skycon: 'CLEAR_DAY', humidity: 0.5, pressure: 100000, wind: { speed: 5, direction: 0 } },
        hourly: { temperature: [], skycon: [], precipitation: [] },
        daily: { temperature: [], skycon: [], astro: [] }
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const cache = createMemoryWeatherCache();
  const options = { lon: 121.405, lat: 31.123, env: { CAIYUN_API_TOKEN: 'test' }, cache, fetchImpl };
  const first = await getWeatherSnapshot(options);
  const second = await getWeatherSnapshot(options);
  assert.equal(first.schemaVersion, '2');
  assert.equal(second.current.temperature, 25);
  assert.equal(first.snapshot.delivery, 'miss');
  assert.equal(second.snapshot.delivery, 'hit');
  assert.equal(calls, 1);
});

test('creates a short-lived Ed25519 JWT with the required QWeather claims', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privateBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const privateKey = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(privateBytes).toString('base64')}\n-----END PRIVATE KEY-----`;
  const token = await createQWeatherJwt({ projectId: 'project', credentialId: 'credential', privateKey }, 1780000000000);
  const [headerPart, payloadPart, signature] = token.split('.');
  const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  assert.deepEqual(decode(headerPart), { alg: 'EdDSA', kid: 'credential' });
  assert.equal(decode(payloadPart).sub, 'project');
  assert.ok(signature.length > 40);
});
