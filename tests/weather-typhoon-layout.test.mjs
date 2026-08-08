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
  assert.match(html, /typhoon-card-status/);
  assert.doesNotMatch(html, /优先显示影响最大的/);
  assert.match(html, /Promise\.all\(\[loadWeather\(\{ forceRelocate \}\), loadTyphoons\(\{ force \}\)\]\)/);
  assert.match(html, /fetch\('\/api\/typhoons'/);
});

test('desktop weather cards use dense paired spans so optional alerts do not create gaps', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(html, /grid-auto-flow: row dense;/);
  assert.match(html, /\.weather-typhoon-card \{[\s\S]*?grid-column: span 5;/);
  assert.match(html, /\.weather-typhoon-card \.typhoon-card-metrics \{[\s\S]*?grid-template-columns: minmax\(0, 1\.35fr\) minmax\(0, \.9fr\) minmax\(0, \.9fr\);/);
  assert.match(html, /id="typhoonCardMetricLocation"/);
  assert.match(html, /id="typhoonCardMetricIntensity"/);
  assert.match(html, /id="typhoonCardMetricUpdated"/);
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
  assert.match(html, /weather-metric-pressure/);
  assert.match(html, /weather-metric-compass/);
  assert.match(html, /weather-metric-horizon/);
  assert.match(html, /metric-uv-scale/);
  assert.match(html, /日落后紫外线已降至 0/);
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test('night sky uses seeded irregular positions instead of arithmetic rows', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(html, /const random = \(\) =>/);
  assert.match(html, /positions\.some\(point =>/);
  assert.doesNotMatch(html, /left:\$\{\(index \* 37\.7\) % 100\}/);
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

test('mobile typhoon layout keeps map controls edge-aligned, removes duplicate sources and labels wind circles', async () => {
  const [html, css, js] = await Promise.all([
    readFile(new URL('typhoon.html', root), 'utf8'),
    readFile(new URL('typhoon.css', root), 'utf8'),
    readFile(new URL('typhoon.js', root), 'utf8')
  ]);

  assert.match(css, /@media \(max-width: 900px\) and \(orientation: portrait\)[\s\S]*?\.map-toolbar \{[\s\S]*?flex-direction: column;/);
  assert.match(css, /@media \(max-width: 900px\) and \(orientation: portrait\)[\s\S]*?\.source-strip,\s*\.wind-circle-legend \{ display: none; \}/);
  assert.match(css, /\.agency-list \{ width: 100%; gap: 2px; overflow: visible; \}/);
  assert.match(css, /@media \(max-width: 900px\) and \(orientation: portrait\)[\s\S]*?\.radar-intensity-legend,[\s\S]*?width: 144px;/);
  assert.match(html, /class="track-playback" id="trackPlayback"/);
  assert.match(html, /id="playbackSlider"/);
  assert.match(html, /id="playbackDateTicks"/);
  assert.doesNotMatch(css, /\.wind-circle-map-label \{/);
  assert.match(css, /\.track-playback \{/);
  assert.match(css, /\.playback-date-ticks span \{/);
  assert.doesNotMatch(js, /windCircleLabelMarkers/);
  assert.match(js, /map\.addSource\('wind-circle-labels'/);
  assert.match(js, /id: 'wind-circle-label-symbols'/);
  assert.match(js, /'icon-image': \['get', 'icon'\]/);
  assert.match(js, /const labelBearings = \{ 7: 214, 10: 308, 12: 42 \};/);
  assert.match(js, /function buildPlaybackPoints\(\)/);
  assert.match(js, /PLAYBACK_HISTORY_WINDOW_MS = 5 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(js, /function playbackFrameAt\(time\)/);
  assert.match(js, /state\.playbackCurrentAt - state\.playbackStartAt/);
  assert.match(js, /remainingDays \* 2600/);
  assert.match(js, /tracks\.find\(track => track\.id === 'cma'\)/);
  assert.match(js, /function schedulePlaybackStep\(\)/);
  assert.match(js, /function addForecastDateMarkers\(track\)/);
  assert.match(js, /className: 'forecast-date-marker'/);
  assert.match(js, /const marker = state\.currentMarker;/);
  assert.match(js, /marker\.setLngLat\(\[frame\.point\.position\.lon, frame\.point\.position\.lat\]\)/);
  assert.match(css, /\.storm-switcher-menu-heading, \.storm-switcher-list \{ text-align: left; \}/);
  assert.match(css, /\.storm-switch \{[\s\S]*?text-align: left;/);
});

test('typhoon detail supports switching between multiple active storms on one map', async () => {
  const [html, jsSource] = await Promise.all([
    readFile(new URL('typhoon.html', root), 'utf8'),
    readFile(new URL('typhoon.js', root), 'utf8')
  ]);

  assert.match(html, /id="stormSwitcher"[^>]*aria-label="切换台风"/);
  assert.match(jsSource, /function renderStormSwitcher\(\)/);
  assert.match(jsSource, /function selectStorm\(stormId, zhejiangId = ''\)/);
  assert.match(jsSource, /history\.replaceState\(null, '', `\/typhoon\/\$\{encodeURIComponent\(stormId\)\}\$\{query\}`\)/);
  assert.match(jsSource, /function renderOtherStormTracks\(\)/);
  assert.match(jsSource, /other-track-\$\{item\.id\}/);
  assert.match(jsSource, /detail\?\.tracks\?\.forecasts/);
  assert.match(jsSource, /FeatureCollection', features/);
  assert.match(jsSource, /state\.otherStormTracks\.forEach/);
  assert.doesNotMatch(jsSource, /others\.slice\(0, 4\)/);
  assert.match(jsSource, /Promise\.all\(others\.map/);
  assert.match(jsSource, /storm\.id !== state\.stormId/);
  assert.match(jsSource, /distanceKm\(locationData, a\.position\)/);
  assert.match(jsSource, /function addOtherStormMarker\(item, point\)/);
  assert.match(jsSource, /function removeOtherStormMarkers\(\)/);
  assert.match(jsSource, /state\.otherStormMarkers/);
  assert.match(jsSource, /selectStorm\(item\.id, item\.zhejiangId \|\| ''\)/);
  assert.match(jsSource, /state\.windCirclePoint = detail\.tracks\?\.observed\?\.at\(-1\) \|\| detail\.storm;/);
});

test('typhoon switching stays compact and homepage ranking accounts for approach direction', async () => {
  const [css, index, html] = await Promise.all([
    readFile(new URL('typhoon.css', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('typhoon.html', root), 'utf8')
  ]);

  assert.match(css, /storm-switcher-trigger/);
  assert.match(css, /storm-switcher-icon/);
  assert.match(css, /rotate\(-360deg\)/);
  assert.match(css, /storm-switcher-menu/);
  assert.match(css, /width: min\(232px, 70vw\)/);
  assert.match(css, /max-height: min\(/);
  assert.match(css, /\.storm-switcher-menu \{[\s\S]*?left: 0;[\s\S]*?right: auto;/);
  assert.match(css, /\.storm-switch \{[\s\S]*?gap: 6px;/);
  assert.match(css, /\.storm-switch-copy strong \{[\s\S]*?font-size: 12px;/);
  assert.match(css, /\.storm-switch-copy small \{[\s\S]*?font-size: 10px;/);
  assert.match(css, /\.other-storm-marker \{/);
  assert.doesNotMatch(css, /\.storm-switcher::-webkit-scrollbar/);
  assert.match(index, /function typhoonImpactScore\(location, storm\)/);
  assert.match(index, /typhoonMovementBearing\(storm\)/);
  assert.match(index, /scoreB - scoreA/);
  assert.match(html, /降雨强度/);
  assert.doesNotMatch(html, /反射率 dBZ/);
});
