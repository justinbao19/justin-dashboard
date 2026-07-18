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
