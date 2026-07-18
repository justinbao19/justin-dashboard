import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('F1 session cards expose drill-down results UI', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="f1SessionResults"/);
  assert.match(html, /showF1SessionResults\(\$\{s\.session_key\}\)/);
  assert.match(html, /\/api\/f1\?year=2026&session=\$\{sessionKey\}/);
});

test('both runtime API paths support session result lookup', async () => {
  const api = await readFile(new URL('../api/f1.js', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-sites.mjs', import.meta.url), 'utf8');
  for (const source of [api, build]) {
    assert.match(source, /session_result\?session_key=/);
    assert.match(source, /drivers\?session_key=/);
    assert.match(source, /driver_name/);
    assert.match(source, /gap_to_leader/);
  }
});

test('missing 2026 driver photos use verified official headshots', async () => {
  const api = await readFile(new URL('../api/f1.js', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-sites.mjs', import.meta.url), 'utf8');
  for (const source of [api, build]) {
    assert.match(source, /jakcra01/);
    assert.match(source, /arvlin01/);
  }
});

test('mobile live badge stays content-sized and flows above the race title', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.f1-live-badge\s*\{[\s\S]*?position:\s*relative;[\s\S]*?width:\s*fit-content;[\s\S]*?min-height:\s*26px;[\s\S]*?margin:\s*0 0 14px;/);
  assert.match(html, /\.f1-next-round\s*\{[\s\S]*?position:\s*static;[\s\S]*?max-width:\s*100%/);
  assert.doesNotMatch(html, /padding-top:\s*54px/);
});

test('mobile race session state sits below the session title without overlap', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.f1-session\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*48px minmax\(0, 1fr\)/);
  assert.match(html, /\.f1-session-state,[\s\S]*?\.f1-session-action\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*2;[\s\S]*?margin-top:\s*7px;/);
  assert.match(html, /\.f1-session-state\s*\{[\s\S]*?border-radius:\s*999px;/);
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
  for (const page of ['weather', 'news', 'f1']) {
    assert.match(html, new RegExp(`id="${page}ManualRefresh"`));
  }
  assert.match(html, /id="marketRefreshBtn" onclick="manualRefreshPage\('market'\)"/);
  assert.match(html, /refreshPageOnEntry\(normalizedPage\)/);
  assert.match(html, /function manualRefreshPage\(page\)/);
  assert.match(html, /visibilitychange[\s\S]*?refreshPageOnEntry\(getPageFromPathname\(\)\)/);
  assert.doesNotMatch(html, /setInterval\(\(\) => \{ loadWeather\(\); loadMarket\(\); loadNews\(\); loadSentiment\(\); \}, 5 \* 60 \* 1000\)/);
  assert.doesNotMatch(html, /setInterval\(\(\) => \{ loadMetar\(\); \}, 10 \* 60 \* 1000\)/);
});
