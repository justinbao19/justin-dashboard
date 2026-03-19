#!/usr/bin/env node
/**
 * AI Trading Engine - 价值投资版
 * 
 * 投资理念：
 * - 价值投资，不投机
 * - 不加杠杆，不高频交易
 * - 综合宏观经济、通胀、地缘政治判断
 * - 预期年化 20%，达标 10%
 * 
 * 交易纪律：
 * - 最小持仓周期：7天（避免频繁交易）
 * - 单笔仓位：10-25%（分散风险）
 * - 最大总仓位：80%（保留现金应对机会）
 * - 止损：-8%，止盈：+25%（让利润奔跑）
 */

const fs = require('fs');
const path = require('path');

const TRADING_FILE = path.join(__dirname, '../data/trading.json');
const FINNHUB_KEY = 'd6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg';

// 资产池 - 价值投资标的
const ASSETS = {
  // 宽基指数 ETF（核心配置）
  'SPY': { name: 'S&P 500 ETF', market: 'US', category: 'index', type: 'finnhub' },
  'QQQ': { name: 'Nasdaq 100 ETF', market: 'US', category: 'index', type: 'finnhub' },
  
  // 避险资产
  'GLD': { name: '黄金 ETF', market: 'COMMODITY', category: 'safe-haven', type: 'finnhub' },
  'TLT': { name: '20年期美债 ETF', market: 'US', category: 'safe-haven', type: 'finnhub' },
  
  // 大宗商品
  'USO': { name: '原油 ETF', market: 'COMMODITY', category: 'commodity', type: 'finnhub' },
  
  // 加密货币（小仓位）
  'bitcoin': { name: 'Bitcoin', market: 'CRYPTO', category: 'crypto', type: 'coingecko' }
};

// 投资纪律参数
const RULES = {
  minHoldDays: 7,           // 最小持仓天数
  minPositionPct: 10,       // 单笔最小仓位
  maxPositionPct: 25,       // 单笔最大仓位
  maxTotalPositionPct: 80,  // 最大总仓位（保留20%现金）
  stopLossPct: -8,          // 止损线
  takeProfitPct: 25,        // 止盈线
  cooldownDays: 3,          // 交易冷却期（同一标的）
  targetAnnualReturn: 20,   // 目标年化
  minAcceptableReturn: 10,  // 达标年化
};

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPrice(symbol, config) {
  try {
    if (config.type === 'finnhub') {
      const d = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
      return { price: d.c, change: d.dp, high: d.h, low: d.l, prevClose: d.pc };
    } else if (config.type === 'coingecko') {
      const d = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd&include_24hr_change=true`);
      return { price: d[symbol].usd, change: d[symbol].usd_24h_change };
    }
  } catch (e) {
    console.error(`  ⚠️ ${symbol}: ${e.message}`);
    return null;
  }
}

async function getHistoricalPrices(symbol, days = 60) {
  // 尝试多个数据源
  const sources = [
    async () => {
      // Yahoo Finance
      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - days * 24 * 60 * 60;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
      const d = await fetchJson(url);
      const closes = d.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (!closes || closes.length < 10) throw new Error('No data');
      return closes.filter(c => c !== null);
    },
    async () => {
      // 备用：Alpha Vantage demo
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=demo`;
      const d = await fetchJson(url);
      const ts = d['Time Series (Daily)'];
      if (!ts) throw new Error('No data');
      return Object.values(ts).slice(0, days).map(v => parseFloat(v['4. close'])).reverse();
    }
  ];
  
  for (const source of sources) {
    try {
      const result = await source();
      if (result && result.length >= 20) return result;
    } catch (e) {
      // Try next source
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

// ========== 技术分析 ==========
function calculateMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
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
  for (let i = 1; i < slice.length; i++) {
    returns.push((slice[i] - slice[i-1]) / slice[i-1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100; // 年化波动率
}

function analyzeTechnicals(symbol, prices) {
  if (!prices || prices.length < 50) {
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
  
  // 长期趋势（MA50）- 价值投资更看重长期
  if (currentPrice > ma50) {
    score += 15;
    signals.push('价格在 MA50 上方（长期趋势向上）');
  } else {
    score -= 10;
    signals.push('价格在 MA50 下方（长期趋势偏弱）');
  }
  
  // 中期趋势（MA20）
  if (ma20 > ma50) {
    score += 10;
    signals.push('MA20 > MA50（中期趋势健康）');
  }
  
  // RSI - 寻找超卖机会（价值投资逢低买入）
  if (rsi < 30) {
    score += 20;
    signals.push(`RSI ${rsi.toFixed(0)}（超卖，可能是买入机会）`);
  } else if (rsi > 70) {
    score -= 15;
    signals.push(`RSI ${rsi.toFixed(0)}（超买，谨慎追高）`);
  } else {
    signals.push(`RSI ${rsi.toFixed(0)}（中性）`);
  }
  
  // 波动率 - 低波动更适合价值投资
  if (volatility < 15) {
    score += 5;
    signals.push(`波动率 ${volatility.toFixed(1)}%（低，稳定）`);
  } else if (volatility > 30) {
    score -= 10;
    signals.push(`波动率 ${volatility.toFixed(1)}%（高，风险较大）`);
  }
  
  // 近期回撤 - 寻找回调买点
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

// ========== 宏观分析 ==========
function analyzeMacro(marketData) {
  const analysis = {
    score: 50,
    factors: [],
    regime: 'neutral' // risk-on, risk-off, neutral
  };
  
  // 分析各类资产表现判断市场状态
  const changes = {};
  for (const [symbol, data] of Object.entries(marketData)) {
    if (data?.change !== undefined) {
      changes[symbol] = data.change;
    }
  }
  
  // 股市表现
  const stockAvg = ((changes.SPY || 0) + (changes.QQQ || 0)) / 2;
  if (stockAvg > 1) {
    analysis.score += 10;
    analysis.factors.push('股市走强，风险偏好回升');
  } else if (stockAvg < -1) {
    analysis.score -= 10;
    analysis.factors.push('股市走弱，避险情绪升温');
  }
  
  // 黄金与股市的关系
  const goldChange = changes.GLD || 0;
  if (goldChange > 1 && stockAvg < 0) {
    analysis.regime = 'risk-off';
    analysis.factors.push('黄金涨+股市跌 → Risk-Off 模式');
  } else if (goldChange < -1 && stockAvg > 1) {
    analysis.regime = 'risk-on';
    analysis.factors.push('股市涨+黄金跌 → Risk-On 模式');
  }
  
  // 债券信号（TLT）
  const bondChange = changes.TLT || 0;
  if (bondChange > 1) {
    analysis.factors.push('长债上涨（利率下行预期/避险）');
  } else if (bondChange < -1) {
    analysis.factors.push('长债下跌（利率上行预期）');
  }
  
  // 原油
  const oilChange = changes.USO || 0;
  if (oilChange > 3) {
    analysis.factors.push('原油大涨（通胀压力/地缘风险）');
    analysis.score -= 5;
  } else if (oilChange < -3) {
    analysis.factors.push('原油大跌（需求担忧/通缩信号）');
  }
  
  // BTC 作为风险资产晴雨表
  const btcChange = changes.bitcoin || 0;
  if (btcChange > 5) {
    analysis.factors.push('BTC 大涨（风险偏好强）');
    analysis.regime = 'risk-on';
  } else if (btcChange < -5) {
    analysis.factors.push('BTC 大跌（风险偏好弱）');
  }
  
  if (analysis.factors.length === 0) {
    analysis.factors.push('市场整体平稳，无明显信号');
  }
  
  return analysis;
}

// ========== 仓位管理 ==========
function checkTradingRules(portfolio, symbol, action, tradingData) {
  const now = new Date();
  const reasons = [];
  
  // 检查冷却期
  const recentTrades = tradingData.history.trades.filter(t => 
    t.symbol === symbol && 
    (now - new Date(t.date)) < RULES.cooldownDays * 24 * 60 * 60 * 1000
  );
  if (recentTrades.length > 0) {
    reasons.push(`${symbol} 在 ${RULES.cooldownDays} 天冷却期内`);
  }
  
  // 检查最小持仓期
  if (action === 'sell') {
    const position = portfolio.positions.find(p => p.symbol === symbol);
    if (position) {
      const holdDays = (now - new Date(position.entryDate)) / (24 * 60 * 60 * 1000);
      if (holdDays < RULES.minHoldDays) {
        reasons.push(`持仓仅 ${Math.floor(holdDays)} 天，未满 ${RULES.minHoldDays} 天最小持仓期`);
      }
    }
  }
  
  // 检查总仓位
  if (action === 'buy') {
    const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, p) => sum + (p.currentValue || p.qty * p.avgCost), 0);
    const positionValue = portfolio.positions.reduce((sum, p) => sum + (p.currentValue || p.qty * p.avgCost), 0);
    const positionPct = (positionValue / totalEquity) * 100;
    if (positionPct >= RULES.maxTotalPositionPct) {
      reasons.push(`总仓位 ${positionPct.toFixed(0)}% 已达上限 ${RULES.maxTotalPositionPct}%`);
    }
  }
  
  return { canTrade: reasons.length === 0, reasons };
}

// ========== 决策引擎 ==========
function makeDecision(assetAnalysis, macroAnalysis, portfolio, currentPrices, tradingData) {
  const decisions = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  
  const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, p) => {
    const price = currentPrices[p.symbol]?.price || p.avgCost;
    return sum + p.qty * price;
  }, 0);
  
  // 1. 先检查止损/止盈
  for (const position of portfolio.positions) {
    const currentPrice = currentPrices[position.symbol]?.price;
    if (!currentPrice) continue;
    
    const pnlPct = ((currentPrice - position.avgCost) / position.avgCost) * 100;
    const holdDays = (new Date() - new Date(position.entryDate)) / (24 * 60 * 60 * 1000);
    
    // 止损（强制执行，不受最小持仓期限制）
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
    
    // 止盈（需满足最小持仓期）
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
  
  // 2. 寻找买入机会
  for (const [symbol, analysis] of Object.entries(assetAnalysis)) {
    const config = ASSETS[symbol];
    const currentPrice = currentPrices[symbol]?.price;
    if (!currentPrice || !analysis) continue;
    
    // 已有持仓则跳过
    if (portfolio.positions.find(p => p.symbol === symbol)) continue;
    
    // 检查交易规则
    const ruleCheck = checkTradingRules(portfolio, symbol, 'buy', tradingData);
    if (!ruleCheck.canTrade) continue;
    
    // 综合评分：技术面 50% + 宏观 30% + 资产类别适配 20%
    let finalScore = analysis.score * 0.5 + macroAnalysis.score * 0.3;
    
    // 根据市场状态调整资产偏好
    if (macroAnalysis.regime === 'risk-off') {
      if (config.category === 'safe-haven') finalScore += 15;
      if (config.category === 'index') finalScore -= 10;
    } else if (macroAnalysis.regime === 'risk-on') {
      if (config.category === 'index') finalScore += 10;
      if (config.category === 'safe-haven') finalScore -= 5;
    }
    
    // 买入阈值：70分（保守策略）
    if (finalScore >= 70) {
      const positionPct = Math.min(RULES.maxPositionPct, Math.max(RULES.minPositionPct, 
        RULES.minPositionPct + (finalScore - 70) * 0.5
      ));
      const buyValue = Math.min(totalEquity * positionPct / 100, portfolio.cash * 0.9);
      
      if (buyValue > 100) {
        const qty = symbol === 'bitcoin' 
          ? Math.floor(buyValue / currentPrice * 10000) / 10000  // BTC 精确到 0.0001
          : Math.floor(buyValue / currentPrice);
          
        if (qty > 0) {
          decisions.push({
            type: 'buy',
            symbol,
            qty,
            price: currentPrice,
            date: now,
            reasoning: `📈 买入信号（综合得分 ${finalScore.toFixed(0)}/100）\n` +
              `技术面：${analysis.signals.join('；')}\n` +
              `宏观：${macroAnalysis.factors.join('；')}\n` +
              `仓位：${positionPct.toFixed(0)}%，约 $${buyValue.toFixed(0)}`,
            trigger: 'value-buy'
          });
        }
      }
    }
  }
  
  return decisions;
}

// ========== 复盘分析 ==========
function generateReview(tradingData, currentPrices) {
  const { portfolio, history, meta } = tradingData;
  const review = [];
  
  // 计算业绩
  const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, p) => {
    const price = currentPrices[p.symbol]?.price || p.avgCost;
    return sum + p.qty * price;
  }, 0);
  const totalReturn = ((totalEquity - meta.initialCapital) / meta.initialCapital) * 100;
  const daysElapsed = (new Date() - new Date(meta.startDate)) / (24 * 60 * 60 * 1000);
  const annualizedReturn = (totalReturn / daysElapsed) * 365;
  
  review.push(`📊 业绩回顾`);
  review.push(`  总收益：${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`);
  review.push(`  年化收益：${annualizedReturn >= 0 ? '+' : ''}${annualizedReturn.toFixed(1)}%`);
  review.push(`  运行天数：${Math.floor(daysElapsed)} 天`);
  
  if (annualizedReturn >= RULES.targetAnnualReturn) {
    review.push(`  ✅ 超越目标年化 ${RULES.targetAnnualReturn}%`);
  } else if (annualizedReturn >= RULES.minAcceptableReturn) {
    review.push(`  ✓ 达到及格线 ${RULES.minAcceptableReturn}%`);
  } else if (daysElapsed > 30) {
    review.push(`  ⚠️ 未达及格线，需要复盘策略`);
  }
  
  // 分析历史交易
  const trades = history.trades;
  if (trades.length > 0) {
    const wins = trades.filter(t => t.type === 'sell' && t.pnl > 0).length;
    const losses = trades.filter(t => t.type === 'sell' && t.pnl < 0).length;
    const sellTrades = wins + losses;
    if (sellTrades > 0) {
      review.push(`\n📋 交易统计`);
      review.push(`  总交易：${trades.length} 笔`);
      review.push(`  胜率：${sellTrades > 0 ? (wins / sellTrades * 100).toFixed(0) : '--'}%`);
    }
  }
  
  // 持仓分析
  if (portfolio.positions.length > 0) {
    review.push(`\n📦 持仓复盘`);
    for (const p of portfolio.positions) {
      const price = currentPrices[p.symbol]?.price || p.avgCost;
      const pnlPct = ((price - p.avgCost) / p.avgCost) * 100;
      const holdDays = Math.floor((new Date() - new Date(p.entryDate)) / (24 * 60 * 60 * 1000));
      review.push(`  ${p.symbol}: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% (持有 ${holdDays} 天)`);
    }
  }
  
  return review.join('\n');
}

// ========== 主流程 ==========
async function main() {
  console.log('🤖 AI Trading Engine (价值投资版) 启动\n');
  console.log(`📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log(`📋 策略：最小持仓 ${RULES.minHoldDays} 天 | 止损 ${RULES.stopLossPct}% | 止盈 ${RULES.takeProfitPct}%\n`);
  
  // 读取数据
  let tradingData;
  try {
    tradingData = JSON.parse(fs.readFileSync(TRADING_FILE, 'utf8'));
  } catch (e) {
    console.error('❌ 无法读取 trading.json:', e.message);
    process.exit(1);
  }
  
  // 获取当前价格
  console.log('📊 获取市场数据...');
  const currentPrices = {};
  for (const [symbol, config] of Object.entries(ASSETS)) {
    currentPrices[symbol] = await getPrice(symbol, config);
    if (currentPrices[symbol]) {
      const chg = currentPrices[symbol].change;
      console.log(`  ${symbol.padEnd(8)} $${currentPrices[symbol].price.toFixed(2).padStart(10)} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  
  // 技术分析
  console.log('\n📈 技术分析...');
  const assetAnalysis = {};
  for (const [symbol, config] of Object.entries(ASSETS)) {
    if (config.type === 'finnhub') {
      const history = await getHistoricalPrices(symbol, 60);
      assetAnalysis[symbol] = analyzeTechnicals(symbol, history);
      console.log(`  ${symbol.padEnd(8)} 得分 ${assetAnalysis[symbol].score}/100 (${assetAnalysis[symbol].trend})`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  // 宏观分析
  console.log('\n🌍 宏观分析...');
  const macroAnalysis = analyzeMacro(currentPrices);
  console.log(`  市场状态: ${macroAnalysis.regime}`);
  console.log(`  ${macroAnalysis.factors.join('\n  ')}`);
  
  // 更新持仓市值
  for (const position of tradingData.portfolio.positions) {
    const price = currentPrices[position.symbol]?.price || position.avgCost;
    position.currentValue = position.qty * price;
    position.pnl = (price - position.avgCost) * position.qty;
  }
  
  // 生成决策
  console.log('\n🧠 决策分析...');
  const decisions = makeDecision(assetAnalysis, macroAnalysis, tradingData.portfolio, currentPrices, tradingData);
  
  if (decisions.length === 0) {
    console.log('  📋 无交易信号，保持现有仓位');
    tradingData.history.decisions.push({
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      analysis: `宏观：${macroAnalysis.factors.join('；')}。技术面未达买入阈值或在冷却期内。继续观望。`,
      action: 'hold'
    });
  } else {
    for (const d of decisions) {
      console.log(`  ${d.type === 'buy' ? '📈' : '📉'} ${d.type.toUpperCase()} ${d.symbol}: ${d.qty} @ $${d.price.toFixed(2)}`);
    }
  }
  
  // 执行交易
  for (const decision of decisions) {
    if (decision.type === 'buy') {
      const cost = decision.qty * decision.price;
      if (cost <= tradingData.portfolio.cash) {
        tradingData.portfolio.cash -= cost;
        tradingData.portfolio.positions.push({
          symbol: decision.symbol,
          market: ASSETS[decision.symbol].market,
          qty: decision.qty,
          avgCost: decision.price,
          entryDate: decision.date,
          currentValue: cost,
          pnl: 0
        });
        tradingData.history.trades.push(decision);
      }
    } else if (decision.type === 'sell') {
      const position = tradingData.portfolio.positions.find(p => p.symbol === decision.symbol);
      if (position) {
        tradingData.portfolio.cash += decision.qty * decision.price;
        tradingData.portfolio.positions = tradingData.portfolio.positions.filter(p => p.symbol !== decision.symbol);
        tradingData.history.trades.push(decision);
      }
    }
  }
  
  // 更新权益曲线
  const totalEquity = tradingData.portfolio.cash + tradingData.portfolio.positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const lastEquity = tradingData.history.equity[tradingData.history.equity.length - 1];
  if (lastEquity.date !== today) {
    tradingData.history.equity.push({ date: today, value: Math.round(totalEquity * 100) / 100 });
  } else {
    lastEquity.value = Math.round(totalEquity * 100) / 100;
  }
  
  // 保存
  fs.writeFileSync(TRADING_FILE, JSON.stringify(tradingData, null, 2));
  
  // 复盘
  console.log('\n' + generateReview(tradingData, currentPrices));
  
  // 输出当前状态
  const pnl = totalEquity - tradingData.meta.initialCapital;
  console.log(`\n💰 当前状态`);
  console.log(`  总资产: $${totalEquity.toFixed(2)}`);
  console.log(`  累计收益: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${(pnl / tradingData.meta.initialCapital * 100).toFixed(2)}%)`);
  console.log(`  现金: $${tradingData.portfolio.cash.toFixed(2)} (${(tradingData.portfolio.cash / totalEquity * 100).toFixed(0)}%)`);
  console.log(`  持仓: ${tradingData.portfolio.positions.length} 个`);
}

main().catch(console.error);
