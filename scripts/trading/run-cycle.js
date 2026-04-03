const { ASSETS, RULES } = require('./config');
const { getPrice, getHistoricalPrices } = require('./market-data');
const { analyzeTechnicals, analyzeMacro, makeDecision, buildHoldDecision, generateReview } = require('./strategy');
const { loadTradingData, saveTradingData, updatePositionMarks, executeDecisions, updateEquityCurve } = require('./store');

function createLogger(logger) {
  return {
    log: (...args) => logger?.log?.(...args),
    error: (...args) => logger?.error?.(...args)
  };
}

async function runTradingCycle(options = {}) {
  const {
    persist = true,
    trigger = 'manual',
    logger = console
  } = options;

  const output = createLogger(logger);
  output.log('🤖 AI Trading Engine 自主周期启动');
  output.log(`📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  output.log(`📋 策略：最小持仓 ${RULES.minHoldDays} 天 | 止损 ${RULES.stopLossPct}% | 止盈 ${RULES.takeProfitPct}%`);

  const tradingData = loadTradingData();

  output.log('\n📊 获取市场数据...');
  const currentPrices = {};
  for (const [symbol, config] of Object.entries(ASSETS)) {
    const quote = await getPrice(symbol, config);
    if (quote?.error) {
      output.error(`  ⚠️ ${symbol}: ${quote.error}`);
      currentPrices[symbol] = null;
    } else {
      currentPrices[symbol] = quote;
      if (quote) {
        const change = quote.change;
        output.log(`  ${symbol.padEnd(8)} $${quote.price.toFixed(2).padStart(10)} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  output.log('\n📈 技术分析...');
  const assetAnalysis = {};
  for (const symbol of Object.keys(ASSETS)) {
    const history = await getHistoricalPrices(symbol, 60);
    assetAnalysis[symbol] = analyzeTechnicals(symbol, history);
    output.log(`  ${symbol.padEnd(8)} 得分 ${assetAnalysis[symbol].score}/100 (${assetAnalysis[symbol].trend})`);
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  output.log('\n🌍 宏观分析...');
  const macroAnalysis = analyzeMacro(currentPrices);
  output.log(`  市场状态: ${macroAnalysis.regime}`);
  output.log(`  ${macroAnalysis.factors.join('\n  ')}`);

  updatePositionMarks(tradingData.portfolio, currentPrices);

  output.log('\n🧠 决策分析...');
  const decisions = makeDecision(assetAnalysis, macroAnalysis, tradingData.portfolio, currentPrices, tradingData);
  let latestDecision;
  if (decisions.length === 0) {
    output.log('  📋 无交易信号，保持现有仓位');
    latestDecision = buildHoldDecision(macroAnalysis);
    tradingData.history.decisions.push(latestDecision);
  } else {
    for (const decision of decisions) {
      output.log(`  ${decision.type === 'buy' ? '📈' : '📉'} ${decision.type.toUpperCase()} ${decision.symbol}: ${decision.qty} @ $${decision.price.toFixed(2)}`);
    }
    latestDecision = decisions[0];
  }

  executeDecisions(tradingData, decisions, currentPrices);
  const totalEquity = updateEquityCurve(tradingData);
  const pnl = totalEquity - tradingData.meta.initialCapital;

  tradingData.meta.lastRunAt = new Date().toISOString();
  tradingData.meta.lastTrigger = trigger;
  tradingData.meta.lastDecisionAt = latestDecision?.date || null;
  tradingData.meta.lastAction = latestDecision?.action || latestDecision?.type || 'hold';

  const review = generateReview(tradingData, currentPrices);
  output.log(`\n${review}`);
  output.log('\n💰 当前状态');
  output.log(`  总资产: $${totalEquity.toFixed(2)}`);
  output.log(`  累计收益: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${(pnl / tradingData.meta.initialCapital * 100).toFixed(2)}%)`);
  output.log(`  现金: $${tradingData.portfolio.cash.toFixed(2)} (${(tradingData.portfolio.cash / totalEquity * 100).toFixed(0)}%)`);
  output.log(`  持仓: ${tradingData.portfolio.positions.length} 个`);

  if (persist) saveTradingData(tradingData);

  return {
    trigger,
    persisted: persist,
    latestDecision,
    decisionCount: decisions.length,
    macroAnalysis,
    totalEquity,
    pnl,
    review,
    tradingData
  };
}

module.exports = {
  runTradingCycle
};
