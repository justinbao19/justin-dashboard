import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const indexPath = new URL('../index.html', import.meta.url);

async function exists(path) {
  try {
    await access(new URL(path, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

test('market and news desktop panels use bounded internal scroll regions', async () => {
  const html = await readFile(indexPath, 'utf8');

  assert.match(html, /class="data-scroll-region"[^>]*aria-label="重点行情列表"/);
  assert.match(html, /#page-market \.market-list-card \{[\s\S]*?max-height: clamp\(420px, 52vh, 520px\);[\s\S]*?overflow: hidden;/);
  assert.match(html, /#page-market #marketList \{[\s\S]*?overflow-y: auto;/);
  assert.match(html, /#page-market \.market-overview-card,[\s\S]*?#page-market \.market-advice-card \{[\s\S]*?height: clamp\(540px, 66vh, 680px\);/);
  assert.match(html, /#page-market \.pulse-layout,[\s\S]*?#page-news \.news-layout \{[\s\S]*?height: clamp\(540px, 66vh, 690px\);/);
  assert.match(html, /#page-market \.pulse-river,[\s\S]*?#page-news \.news-stack \{[\s\S]*?overflow-y: auto;/);
  assert.match(html, /@media \(max-width: 980px\)[\s\S]*?#page-market \.market-list-card,[\s\S]*?height: auto;[\s\S]*?overflow: visible;/);
});

test('AI trading page and autonomous trading service are removed', async () => {
  const html = await readFile(indexPath, 'utf8');

  assert.doesNotMatch(html, /data-segment="trading"|tradingPlayground|tradingData|AI 交易/);
  assert.equal(await exists('../.github/workflows/trading-cycle.yml'), false);
  assert.equal(await exists('../api/trading-cycle.js'), false);
  assert.equal(await exists('../scripts/trading-engine.js'), false);
  assert.equal(await exists('../data/trading.json'), false);
});

test('wide market and news headers separate controls from the title cluster', async () => {
  const html = await readFile(indexPath, 'utf8');

  assert.match(html, /@media \(min-width: 1100px\)[\s\S]*?#page-market \.market-page-header,[\s\S]*?#page-news \.page-header \{[\s\S]*?grid-template-areas:[\s\S]*?"title controls"[\s\S]*?"meta controls"/);
  assert.match(html, /width: min\(100%, 1180px\);[\s\S]*?margin: 0 auto;/);
  assert.match(html, /#page-market \.market-segment-control,[\s\S]*?#page-news \.news-tab-control \{[\s\S]*?grid-area: controls;[\s\S]*?justify-self: end;/);
});

test('market analysis stays visible with an explicit stale label', async () => {
  const html = await readFile(indexPath, 'utf8');

  assert.match(html, /analysis_stale:\s*!analysisFresh/);
  assert.doesNotMatch(html, /策略分析超过24小时，已停止展示/);
  assert.match(html, /旧分析，仅供参考/);
});

test('market sparklines use dense unsmoothed intraday samples', async () => {
  const source = await readFile(new URL('../scripts/market_snapshot.mjs', import.meta.url), 'utf8');

  assert.match(source, /const SPARKLINE_POINTS = 120;/);
  assert.match(source, /range=5d&interval=15m/);
  assert.match(source, /interval=15m&limit=\$\{SPARKLINE_POINTS\}/);
  assert.match(source, /market_chart\?vs_currency=usd&days=1/);
  assert.match(source, /clean\.slice\(-SPARKLINE_POINTS\)/);
});
