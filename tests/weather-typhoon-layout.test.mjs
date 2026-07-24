import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('weather prioritizes precipitation, then exposes a calm typhoon entry before hourly forecast', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const precipitationIndex = html.indexOf('class="weather-card weather-nowcast-card weather-precip-card"');
  const typhoonIndex = html.indexOf('class="weather-card weather-typhoon-card"');
  const hourlyIndex = html.indexOf('class="weather-card weather-hourly-card"');

  assert.ok(precipitationIndex > -1, 'precipitation window should exist');
  assert.ok(typhoonIndex > -1, 'typhoon entry should exist');
  assert.ok(precipitationIndex < typhoonIndex, 'precipitation window should be the first persistent weather card');
  assert.ok(typhoonIndex < hourlyIndex, 'typhoon entry should precede hourly forecast');
  assert.match(html, /id="nowcastTitle">降水窗口<\/span>/);
  assert.match(html, /id="rainChance">--%<\/strong>/);
  assert.match(html, /id="typhoonEntryCard" href="\/typhoon"/);
  assert.match(html, /id="typhoonCardTitle">台风动态<\/span>/);
  assert.match(html, /Promise\.all\(\[loadWeather\(\), loadTyphoons\(\)\]\)/);
  assert.match(html, /fetch\('\/api\/typhoons'/);
});

test('desktop weather cards use dense paired spans so optional alerts do not create gaps', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(html, /grid-auto-flow: row dense;/);
  assert.match(html, /\.weather-typhoon-card \{[\s\S]*?grid-column: span 5;/);
  assert.match(html, /\.weather-nowcast-card \{[\s\S]*?grid-column: span 7;/);
  assert.match(html, /\.weather-daily-card,[\s\S]*?\.weather-aqi-card \{[\s\S]*?grid-column: span 5;/);
  assert.match(html, /\.weather-commute-card,[\s\S]*?\.weather-life-card \{[\s\S]*?grid-column: span 7;/);
  assert.match(html, /\.weather-content > \.weather-grid,\s*\.weather-content > \.weather-stack \{\s*margin-bottom: 0;/);
});

test('weather exposes free-tier alert, nowcast and progressive disclosure surfaces', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(html, /id="weatherAlertCard"[^>]*hidden/);
  assert.match(html, /id="nowcastSummary"/);
  assert.match(html, /id="precipitationTimeline"/);
  assert.match(html, /id="lifeExpandButton"[^>]*aria-expanded="false"/);
  assert.match(html, /id="aqiExpandButton"[^>]*aria-expanded="false"/);
  assert.match(html, /life-index-grid:not\(\.is-expanded\)/);
});

test('mobile weather uses a bounded one-column layout, horizontal hourly rail and compact Bento metrics', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(html, /#page-weather \.weather-content \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-auto-columns: minmax\(0, 1fr\);/);
  assert.match(html, /#page-weather \.weather-content > \*[^}]*grid-column: 1 !important;[^}]*min-width: 0;/);
  assert.match(html, /id="hourlyScroll" tabindex="0" aria-label="逐小时天气预报，可左右滑动查看"/);
  assert.match(html, /\.hourly-scroll \{[\s\S]*?overflow-x: auto;[\s\S]*?scroll-snap-type: x proximity;[\s\S]*?touch-action: pan-x;/);
  assert.match(html, /\.weather-details-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(html, /weather-detail-humidity/);
  assert.match(html, /露点/);
  assert.match(html, /weather-detail-pressure/);
  assert.match(html, /接近常态/);
  assert.match(html, /weather-metric-gauge/);
  assert.match(html, /weather-metric-compass/);
  assert.match(html, /weather-metric-horizon/);
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test('typhoon route renders a useful empty state in Vercel and Sites builds', async () => {
  const [html, vercel, sites] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('vercel.json', root), 'utf8'),
    readFile(new URL('scripts/build-sites.mjs', root), 'utf8')
  ]);

  assert.match(html, /id="page-typhoon"/);
  assert.match(html, /id="typhoonEmptyTitle">当前无活跃台风<\/h1>/);
  assert.match(html, /typhoon: '\/typhoon'/);
  assert.match(vercel, /weather\|typhoon\|market\|news\|f1/);
  assert.match(sites, /pathname === '\/typhoon'/);
});
