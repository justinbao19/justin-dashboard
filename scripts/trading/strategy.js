const { ASSETS, RULES } = require('./config');

function calculateMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i += 1) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function calculateVolatility(prices, period = 20) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const returns = [];
  for (let i = 1; i < slice.length; i += 1) {
    returns.push((slice[i] - slice[i - 1]) / slice[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function analyzeTechnicals(symbol, prices) {
  if (!prices || prices.length < 30) {
    return { score: 50, trend: 'unknown', signals: ['数据不足'] };
  }

  const ma20 = calculateMA(prices, 20);
  const ma50 = calculateMA(prices, 50);
  const rsi = calculateRSI(prices);
  const volatility = calculateVolatility(prices);
  const currentPrice = prices[prices.length - 1];
  const priceChange20d = ((currentPrice - prices[prices.length - 20]) / prices[prices.length - 20]) * 100;

  let score = 50;
  const signals = [];

  if (currentPrice > ma50) {
    score += 15;
    signals.push('价格在 MA50 上方（长期趋势向上）');
  } else {
    score -= 10;
    signals.push('价格在 MA50 下方（长期趋势偏弱）');
  }

  if (ma20 > ma50) {
    score += 10;
    signals.push('MA20 > MA50（中期趋势健康）');
  }

  if (rsi < 30) {
    score += 20;
    signals.push(`RSI ${rsi.toFixed(0)}（超卖，可能是买入机会）`);
  } else if (rsi > 70) {
    score -= 15;
    signals.push(`RSI ${rsi.toFixed(0)}（超买，谨慎追高）`);
  } else {
    signals.push(`RSI ${rsi.toFixed(0)}（中性）`);
  }

  if (volatility < 15) {
    score += 5;
    signals.push(`波动率 ${volatility.toFixed(1)}%（低，稳定）`);
  } else if (volatility > 30) {
    score -= 10;
    signals.push(`波动率 ${volatility.toFixed(1)}%（高，风险较大）`);
  }

  if (priceChange20d < -10) {
    score += 10;
    signals.push(`近20日跌 ${priceChange20d.toFixed(1)}%（回调可能是机会）`);
  } else if (priceChange20d > 15) {
    score -= 5;
    signals.push(`近20日涨 ${priceChange20d.toFixed(1)}%（短期涨幅较大）`);
  }

  const trend = score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'neutral';
  return { score: Math.max(0, Math.min(100, score)), trend, signals, ma20, ma50, rsi, volatility };
}

function analyzeMacro(marketData) {
  const analysis = {
    score: 50,
    factors: [],
    regime: 'neutral'
  };

  const changes = {};
  for (const [symbol, data] of Object.entries(marketData)) {
    if (data?.change !== undefined) changes[symbol] = data.change;
  }

  const stockAvg = ((changes.SPY || 0) + (changes.QQQ || 0)) / 2;
  if (stockAvg > 1) {
    analysis.score += 10;
    analysis.factors.push('股市走强，风险偏好回升');
  } else if (stockAvg < -1) {
    analysis.score -= 10;
    analysis.factors.push('股市走弱，避险情绪升温');
  }

  const goldChange = changes.GLD || 0;
  if (goldChange > 1 && stockAvg < 0) {
    analysis.regime = 'risk-off';
    analysis.factors.push('黄金涨+股市跌 → Risk-Off 模式');
  } else if (goldChange < -1 && stockAvg > 1) {
    analysis.regime = 'risk-on';
    analysis.factors.push('股市涨+黄金跌 → Risk-On 模式');
  }

  const bondChange = changes.TLT || 0;
  if (bondChange > 1) analysis.factors.push('长债上涨（利率下行预期/避险）');
  else if (bondChange < -1) analysis.factors.push('长债下跌（利率上行预期）');

  const oilChange = changes.USO || 0;
  if (oilChange > 3) {
    analysis.factors.push('原油大涨（通胀压力/地缘风险）');
    analysis.score -= 5;
  } else if (oilChange < -3) {
    analysis.factors.push('原油大跌（需求担忧/通缩信号）');
  }

  const btcChange = changes.bitcoin || 0;
  if (btcChange > 5) {
    analysis.factors.push('BTC 大涨（风险偏好强）');
    analysis.regime = 'risk-on';
  } else if (btcChange < -5) {
    analysis.factors.push('BTC 大跌（风险偏好弱）');
  }

  if (analysis.factors.length === 0) analysis.factors.push('市场整体平稳，无明显信号');
  return analysis;
}

function checkTradingRules(portfolio, symbol, action, tradingData) {
  const now = new Date();
  const reasons = [];

  const recentTrades = tradingData.history.trades.filter(trade =>
    trade.symbol === symbol &&
    (now - new Date(trade.date)) < RULES.cooldownDays * 24 * 60 * 60 * 1000
  );
  if (recentTrades.length > 0) reasons.push(`${symbol} 在 ${RULES.cooldownDays} 天冷却期内`);

  if (action === 'sell') {
    const position = portfolio.positions.find(item => item.symbol === symbol);
    if (position) {
      const holdDays = (now - new Date(position.entryDate)) / (24 * 60 * 60 * 1000);
      if (holdDays < RULES.minHoldDays) {
        reasons.push(`持仓仅 ${Math.floor(holdDays)} 天，未满 ${RULES.minHoldDays} 天最小持仓期`);
      }
    }
  }

  if (action === 'buy') {
    const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, position) => sum + (position.currentValue || position.qty * position.avgCost), 0);
    const positionValue = portfolio.positions.reduce((sum, position) => sum + (position.currentValue || position.qty * position.avgCost), 0);
    const positionPct = (positionValue / totalEquity) * 100;
    if (positionPct >= RULES.maxTotalPositionPct) {
      reasons.push(`总仓位 ${positionPct.toFixed(0)}% 已达上限 ${RULES.maxTotalPositionPct}%`);
    }
  }

  return { canTrade: reasons.length === 0, reasons };
}

function makeDecision(assetAnalysis, macroAnalysis, portfolio, currentPrices, tradingData) {
  const decisions = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, position) => {
    const price = currentPrices[position.symbol]?.price || position.avgCost;
    return sum + position.qty * price;
  }, 0);

  for (const position of portfolio.positions) {
    const currentPrice = currentPrices[position.symbol]?.price;
    if (!currentPrice) continue;

    const pnlPct = ((currentPrice - position.avgCost) / position.avgCost) * 100;
    const holdDays = (new Date() - new Date(position.entryDate)) / (24 * 60 * 60 * 1000);

    if (pnlPct <= RULES.stopLossPct) {
      decisions.push({
        type: 'sell',
        symbol: position.symbol,
        qty: position.qty,
        price: currentPrice,
        date: now,
        pnl: (currentPrice - position.avgCost) * position.qty,
        reasoning: `🛑 止损触发：亏损 ${pnlPct.toFixed(1)}% 超过止损线 ${RULES.stopLossPct}%。纪律执行，控制损失。`,
        trigger: 'stop-loss'
      });
      continue;
    }

    if (pnlPct >= RULES.takeProfitPct && holdDays >= RULES.minHoldDays) {
      decisions.push({
        type: 'sell',
        symbol: position.symbol,
        qty: position.qty,
        price: currentPrice,
        date: now,
        pnl: (currentPrice - position.avgCost) * position.qty,
        reasoning: `🎯 止盈触发：盈利 ${pnlPct.toFixed(1)}% 达到止盈线 ${RULES.takeProfitPct}%。落袋为安。`,
        trigger: 'take-profit'
      });
    }
  }

  for (const [symbol, analysis] of Object.entries(assetAnalysis)) {
    const config = ASSETS[symbol];
    const currentPrice = currentPrices[symbol]?.price;
    if (!currentPrice || !analysis) continue;
    if (portfolio.positions.find(position => position.symbol === symbol)) continue;

    const ruleCheck = checkTradingRules(portfolio, symbol, 'buy', tradingData);
    if (!ruleCheck.canTrade) continue;

    let finalScore = analysis.score * 0.5 + macroAnalysis.score * 0.3;
    if (macroAnalysis.regime === 'risk-off') {
      if (config.category === 'safe-haven') finalScore += 15;
      if (config.category === 'index') finalScore -= 10;
    } else if (macroAnalysis.regime === 'risk-on') {
      if (config.category === 'index') finalScore += 10;
      if (config.category === 'safe-haven') finalScore -= 5;
    }

    if (finalScore >= 70) {
      const positionPct = Math.min(
        RULES.maxPositionPct,
        Math.max(RULES.minPositionPct, RULES.minPositionPct + (finalScore - 70) * 0.5)
      );
      const buyValue = Math.min(totalEquity * positionPct / 100, portfolio.cash * 0.9);
      if (buyValue > 100) {
        const qty = symbol === 'bitcoin'
          ? Math.floor((buyValue / currentPrice) * 10000) / 10000
          : Math.floor(buyValue / currentPrice);
        if (qty > 0) {
          decisions.push({
            type: 'buy',
            symbol,
            qty,
            price: currentPrice,
            date: now,
            reasoning: `📈 买入信号（综合得分 ${finalScore.toFixed(0)}/100）\n技术面：${analysis.signals.join('；')}\n宏观：${macroAnalysis.factors.join('；')}\n仓位：${positionPct.toFixed(0)}%，约 $${buyValue.toFixed(0)}`,
            trigger: 'value-buy'
          });
        }
      }
    }
  }

  return decisions;
}

function buildHoldDecision(macroAnalysis) {
  return {
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    analysis: `宏观：${macroAnalysis.factors.join('；')}。技术面未达买入阈值或在冷却期内。继续观望。`,
    action: 'hold'
  };
}

function generateReview(tradingData, currentPrices) {
  const { portfolio, history, meta } = tradingData;
  const review = [];
  const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, position) => {
    const price = currentPrices[position.symbol]?.price || position.avgCost;
    return sum + position.qty * price;
  }, 0);
  const totalReturn = ((totalEquity - meta.initialCapital) / meta.initialCapital) * 100;
  const daysElapsed = (new Date() - new Date(meta.startDate)) / (24 * 60 * 60 * 1000);
  const annualizedReturn = (totalReturn / daysElapsed) * 365;

  review.push('📊 业绩回顾');
  review.push(`  总收益：${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
  review.push(`  年化收益：${annualizedReturn >= 0 ? '+' : ''}${annualizedReturn.toFixed(1)}%`);
  review.push(`  运行天数：${Math.floor(daysElapsed)} 天`);

  if (annualizedReturn >= RULES.targetAnnualReturn) review.push(`  ✅ 超越目标年化 ${RULES.targetAnnualReturn}%`);
  else if (annualizedReturn >= RULES.minAcceptableReturn) review.push(`  ✓ 达到及格线 ${RULES.minAcceptableReturn}%`);
  else if (daysElapsed > 30) review.push('  ⚠️ 未达及格线，需要复盘策略');

  const trades = history.trades;
  if (trades.length > 0) {
    const wins = trades.filter(trade => trade.type === 'sell' && trade.pnl > 0).length;
    const losses = trades.filter(trade => trade.type === 'sell' && trade.pnl < 0).length;
    const sellTrades = wins + losses;
    if (sellTrades > 0) {
      review.push('\n📋 交易统计');
      review.push(`  总交易：${trades.length} 笔`);
      review.push(`  胜率：${sellTrades > 0 ? (wins / sellTrades * 100).toFixed(0) : '--'}%`);
    }
  }

  if (portfolio.positions.length > 0) {
    review.push('\n📦 持仓复盘');
    for (const position of portfolio.positions) {
      const price = currentPrices[position.symbol]?.price || position.avgCost;
      const pnlPct = ((price - position.avgCost) / position.avgCost) * 100;
      const holdDays = Math.floor((new Date() - new Date(position.entryDate)) / (24 * 60 * 60 * 1000));
      review.push(`  ${position.symbol}: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% (持有 ${holdDays} 天)`);
    }
  }

  return review.join('\n');
}

module.exports = {
  analyzeTechnicals,
  analyzeMacro,
  makeDecision,
  buildHoldDecision,
  generateReview
};
