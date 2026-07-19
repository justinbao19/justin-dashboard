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

test('desktop weather cards share explicit grid rows so both columns stay aligned', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(html, /\.weather-support-stack,\s*\.weather-primary-stack \{\s*display: contents;/);
  assert.match(html, /\.weather-sun-card,\s*\.weather-commute-card \{\s*grid-row: 4;/);
  assert.match(html, /\.weather-aqi-card,\s*\.weather-life-card \{\s*grid-row: 5;/);
  assert.match(html, /\.weather-content > \.weather-grid,\s*\.weather-content > \.weather-stack \{\s*margin-bottom: 0;/);
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
