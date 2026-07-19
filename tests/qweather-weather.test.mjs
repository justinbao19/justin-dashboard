import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchQWeatherWeather,
  normalizeQWeatherBundle
} from '../lib/qweather-weather.mjs';

const now = {
  code: '200',
  updateTime: '2026-07-20T09:10+08:00',
  now: {
    obsTime: '2026-07-20T09:05+08:00', temp: '31', feelsLike: '34', icon: '101', text: '多云',
    wind360: '120', windDir: '东南风', windScale: '2', windSpeed: '9', humidity: '68',
    precip: '0.0', pressure: '1004', vis: '18', cloud: '72', dew: '24'
  }
};

const hourly = {
  code: '200',
  hourly: [
    { fxTime: '2026-07-20T10:00+08:00', temp: '32', icon: '101', text: '多云', wind360: '130', windSpeed: '10', humidity: '67', pop: '20', precip: '0', pressure: '1004', cloud: '70', vis: '18' },
    { fxTime: '2026-07-20T11:00+08:00', temp: '32', icon: '305', text: '小雨', wind360: '140', windSpeed: '12', humidity: '73', pop: '65', precip: '0.4', pressure: '1003', cloud: '84', vis: '12' }
  ]
};

const daily = {
  code: '200',
  updateTime: '2026-07-20T08:00+08:00',
  daily: [{
    fxDate: '2026-07-20', sunrise: '05:04', sunset: '18:58', moonrise: '10:16', moonset: '23:03',
    moonPhase: '娥眉月', moonPhaseIcon: '802', tempMax: '34', tempMin: '27', iconDay: '101', textDay: '多云',
    iconNight: '305', textNight: '小雨', wind360Day: '130', windDirDay: '东南风', windSpeedDay: '12',
    humidity: '72', precip: '0.5', pressure: '1003', vis: '18', cloud: '73', uvIndex: '8'
  }]
};

const indices = {
  code: '200',
  daily: [
    { date: '2026-07-20', type: '3', name: '穿衣指数', level: '1', category: '炎热', text: '适合清凉透气的夏装。' },
    { date: '2026-07-20', type: '7', name: '过敏指数', level: '2', category: '较易发', text: '敏感人群外出请留意。' }
  ]
};

const air = {
  metadata: { tag: 'air-tag' },
  indexes: [{ code: 'cn-mee', name: '中国 AQI', aqi: 42, category: '优', health: { effect: '无明显影响', advice: { generalPopulation: '适合户外活动。', sensitivePopulation: '可以正常活动。' } } }],
  pollutants: [{ code: 'pm2p5', concentration: { value: 13, unit: 'μg/m3' } }, { code: 'o3', concentration: { value: 71, unit: 'μg/m3' } }]
};

test('normalizes the free QWeather bundle into the Pulse weather model', () => {
  const result = normalizeQWeatherBundle({
    now, hourly, daily, indices, air,
    minutely: { code: '200', summary: '40分钟后可能有小雨', minutely: [{ fxTime: '2026-07-20T09:15+08:00', precip: '0.2', type: 'rain' }] },
    alerts: { metadata: { zeroResult: false }, alerts: [{ id: 'alert-1', headline: '高温黄色预警' }] }
  }, { lon: 121.4, lat: 31.1 });

  assert.equal(result.source, 'qweather');
  assert.equal(result.result.realtime.temperature, 31);
  assert.equal(result.result.realtime.air_quality.aqi.local, 42);
  assert.equal(result.result.hourly.precipitation[1].probability, 65);
  assert.equal(result.result.daily.temperature[0].max, 34);
  assert.equal(result.result.daily.life_index.dressing[0].desc, '炎热');
  assert.equal(result.result.astronomy.daily[0].moonPhase, '娥眉月');
  assert.equal(result.result.minutely.summary, '40分钟后可能有小雨');
  assert.equal(result.result.alerts.count, 1);
});

test('fetches only free QWeather endpoints and skips China-only minutely data abroad', async () => {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const keyBuffer = Buffer.from(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const chunks = keyBuffer.toString('base64').match(/.{1,64}/g).join('\n');
  const paths = [];
  const payloadFor = path => {
    if (path.includes('/weather/now')) return now;
    if (path.includes('/weather/24h')) return hourly;
    if (path.includes('/weather/7d')) return daily;
    if (path.includes('/airquality/')) return air;
    if (path.includes('/indices/')) return indices;
    if (path.includes('/weatheralert/')) return { metadata: { zeroResult: true }, alerts: [] };
    throw new Error(`Unexpected path ${path}`);
  };
  const result = await fetchQWeatherWeather({
    env: {
      QWEATHER_API_HOST: 'test-api.qweather.example',
      QWEATHER_PROJECT_ID: 'project-id',
      QWEATHER_CREDENTIAL_ID: 'credential-id',
      QWEATHER_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${chunks}\n-----END PRIVATE KEY-----`
    },
    lon: 139.69,
    lat: 35.68,
    nowMs: new Date('2026-07-20T01:15:00Z').getTime(),
    fetchImpl: async value => {
      const url = new URL(value);
      paths.push(url.pathname);
      return new Response(JSON.stringify(payloadFor(url.pathname)), { status: 200 });
    }
  });

  assert.equal(result.result.minutely.supported, false);
  assert.equal(paths.length, 6);
  assert.equal(paths.some(path => path.includes('/minutely/')), false);
  assert.equal(paths.some(path => path.includes('/tropical/')), false);
  assert.equal(paths.some(path => path.includes('/ocean/')), false);
  assert.equal(paths.some(path => path.includes('/solar-radiation/')), false);
});
