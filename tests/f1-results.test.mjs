import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('F1 session cards expose drill-down results UI', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="f1SessionResults"/);
  assert.match(html, /data-session-key="\$\{sessionKeyAttr\}"/);
  assert.match(html, /showF1SessionResults\(card\.dataset\.sessionKey\)/);
  assert.match(html, /\/api\/f1\?year=2026&session=\$\{encodeURIComponent\(sessionKey\)\}/);
  assert.doesNotMatch(html, /onclick=\"showF1SessionResults\(/);
});

test('both runtime API paths support session result lookup', async () => {
  const api = await readFile(new URL('../api/f1.js', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-sites.mjs', import.meta.url), 'utf8');
  for (const source of [api, build]) {
    assert.match(source, /session_result\?session_key=/);
    assert.match(source, /drivers\?session_key=/);
    assert.match(source, /driver_name/);
    assert.match(source, /gap_to_leader/);
    assert.match(source, /api\.jolpi\.ca\/ergast\/f1/);
  }
});

test('frontend no longer calls OpenF1 directly for weekend sessions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\/api\/f1\?year=2026&meeting=\$\{encodeURIComponent\(meetingKey\)\}/);
  assert.doesNotMatch(html, /fetch\(`https:\/\/api\.openf1\.org\/v1\/sessions\?meeting_key=/);
});

test('missing 2026 driver photos use verified official headshots', async () => {
  const api = await readFile(new URL('../api/f1.js', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-sites.mjs', import.meta.url), 'utf8');
  for (const source of [api, build]) {
    assert.match(source, /jakcra01/);
    assert.match(source, /arvlin01/);
  }
});

test('live badge stays in the card corner while round leads the content', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.f1-next-race > \*:not\(\.f1-next-track\):not\(\.f1-live-badge\)/);
  assert.match(html, /\.f1-live-badge\s*\{[\s\S]*?position:\s*absolute !important;[\s\S]*?display:\s*inline-flex !important;[\s\S]*?width:\s*fit-content;/);
  assert.match(html, /@media \(max-width: 600px\)[\s\S]*?\.f1-live-badge\s*\{[\s\S]*?top:\s*16px;[\s\S]*?right:\s*16px;/);
  assert.match(html, /\.f1-next-round\s*\{[\s\S]*?position:\s*static;[\s\S]*?max-width:\s*calc\(100% - 88px\);[\s\S]*?min-height:\s*26px;/);
  assert.doesNotMatch(html, /padding-top:\s*54px/);
});

test('mobile race session state sits below the session title without overlap', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.f1-session\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*48px minmax\(0, 1fr\)/);
  assert.match(html, /\.f1-session-meta\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?margin-top:\s*7px;/);
  assert.match(html, /\.f1-session-state\s*\{[\s\S]*?border-radius:\s*999px;/);
});

test('race day and session state share a responsive metadata group', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="f1-session-meta">\$\{raceDayLabel\}\$\{action\}/);
  assert.match(html, /const raceDayLabel = isRace \? '<span class="f1-race-day-label">比赛日<\/span>' : '';/);
  assert.doesNotMatch(html, /\.f1-session\.race::after\s*\{[\s\S]*?content:\s*'比赛日'/);
});

test('driver points chart follows its rendered container width', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /const w = Math\.max\(300, Math\.round\(svg\.getBoundingClientRect\(\)\.width/);
  assert.match(html, /svg\.setAttribute\('viewBox', `0 0 \$\{w\} \$\{h\}`\)/);
  assert.match(html, /labels\.style\.gridTemplateColumns = `repeat\(\$\{results\.length\}, minmax\(0, 1fr\)\)`/);
  assert.match(html, /new ResizeObserver\(entries =>/);
});

test('live badge keeps still while only its red dot breathes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="f1LiveBadge"[^>]*>LIVE<\/div>/);
  assert.match(html, /\.f1-live-badge::before\s*\{[\s\S]*?animation:\s*f1-live-dot-breathe/);
  assert.match(html, /@keyframes f1-live-dot-breathe/);
  assert.doesNotMatch(html, /animation:\s*f1-live-pulse/);
});

test('dashboard refreshes serverless data only on page entry or manual action', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const page of ['news', 'f1']) {
    assert.match(html, new RegExp(`id="${page}ManualRefresh"`));
  }
  assert.doesNotMatch(html, /id="weatherManualRefresh"/);
  assert.match(html, /id="weatherPullRefresh"/);
  assert.match(html, /function initializeWeatherPullRefresh\(\)/);
  assert.match(html, /touchmove[\s\S]*?\{ passive: false \}/);
  assert.match(html, /refreshPageData\('weather', \{ force: true, forceRelocate: true \}\)/);
  assert.match(html, /id="marketRefreshBtn" onclick="manualRefreshPage\('market'\)"/);
  assert.match(html, /refreshPageOnEntry\(normalizedPage\)/);
  assert.match(html, /function manualRefreshPage\(page\)/);
  assert.match(html, /visibilitychange[\s\S]*?refreshPageOnEntry\(getPageFromPathname\(\)\)/);
  assert.doesNotMatch(html, /setInterval\(\(\) => \{ loadWeather\(\); loadMarket\(\); loadNews\(\); loadSentiment\(\); \}, 5 \* 60 \* 1000\)/);
  assert.doesNotMatch(html, /setInterval\(\(\) => \{ loadMetar\(\); \}, 10 \* 60 \* 1000\)/);
});
