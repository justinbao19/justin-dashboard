import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('weather exposes a calm, accessible typhoon status entry before hourly forecast', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const typhoonIndex = html.indexOf('class="weather-card weather-typhoon-card"');
  const hourlyIndex = html.indexOf('class="weather-card weather-hourly-card"');

  assert.ok(typhoonIndex > -1, 'typhoon entry should exist');
  assert.ok(typhoonIndex < hourlyIndex, 'typhoon entry should precede hourly forecast');
  assert.match(html, /href="\/typhoon" aria-label="查看台风动态，当前无活跃台风"/);
  assert.match(html, /<span class="typhoon-card-title">当前无活跃台风<\/span>/);
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
