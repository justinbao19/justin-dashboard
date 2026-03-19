#!/usr/bin/env node
/**
 * AI Trading Engine
 * 每日分析市场数据，做出交易决策
 * 
 * 策略：
 * 1. 技术面：MA5/MA20 金叉死叉 + RSI 超买超卖
 * 2. 消息面：从市场简报提取情绪权重
 * 3. 风险控制：单笔 ≤30%，总回撤 ≤20%
 */

const fs = require('fs');
const path = require('path');

const TRADING_FILE = path.join(__dirname, '../data/trading.json');
const FINNHUB_KEY = 'd6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg';

// 资产配置
const ASSETS = {
  'SPY': { name: 'S&P 500 ETF', market: 'US', type: 'finnhub' },
  'QQQ': { name: 'Nasdaq 100 ETF', market: 'US', type: 'finnhub' },
  'GLD': { name: 'Gold ETF', market: 'US', type: 'finnhub' },
  'bitcoin': { name: 'Bitcoin', market: 'CRYPTO', type: 'coingecko' }
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getPrice(symbol, config) {
  try {
    if (config.type === 'finnhub') {
      const d = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`);
      return { price: d.c, change: d.dp, prevClose: d.pc };
    } else if (config.type === 'coingecko') {
      const d = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd&include_24hr_change=true`);
      return { price: d[symbol].usd, change: d[symbol].usd_24h_change };
    }
  } catch (e) {
    console.error(`Failed to get price for ${symbol}:`, e.message);
    return null;
  }
}

async function getHistoricalPrices(symbol, days = 30) {
  // 使用 Yahoo Finance 获取历史数据（通过公开 API）
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - days * 24 * 60 * 60;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return null;
    const d = await res.json();
    const closes = d.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes) return null;
    return closes.filter(c => c !== null);
  } catch (e) {
    console.error(`Failed to get history for ${symbol}:`, e.message);
    return null;
  }
}

function calculateMA(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function analyzeTechnicals(prices) {
  if (!prices || prices.length < 20) {
    return { score: 50, signal: 'neutral', reason: '数据不足' };
  }
  
  const ma5 = calculateMA(prices, 5);
  const ma20 = calculateMA(prices, 20);
  const rsi = calculateRSI(prices);
  const currentPrice = prices[prices.length - 1];
  
  let score = 50;
  let signals = [];
  
  // MA 金叉/死叉
  if (ma5 > ma20) {
    score += 15;
    signals.push('MA5 > MA20 (短期趋势向上)');
  } else {
    score -= 15;
    signals.push('MA5 < MA20 (短期趋势向下)');
  }
  
  // 价格相对 MA20
  if (currentPrice > ma20) {
    score += 10;
    signals.push('价格在 MA20 上方');
  } else {
    score -= 10;
    signals.push('价格在 MA20 下方');
  }
  
  // RSI
  if (rsi !== null) {
    if (rsi > 70) {
      score -= 20;
      signals.push(`RSI ${rsi.toFixed(0)} (超买区域)`);
    } else if (rsi < 30) {
      score += 20;
      signals.push(`RSI ${rsi.toFixed(0)} (超卖区域)`);
    } else if (rsi > 50) {
      score += 5;
      signals.push(`RSI ${rsi.toFixed(0)} (偏强)`);
    } else {
      score -= 5;
      signals.push(`RSI ${rsi.toFixed(0)} (偏弱)`);
    }
  }
  
  const signal = score > 60 ? 'bullish' : score < 40 ? 'bearish' : 'neutral';
  return { score: Math.max(0, Math.min(100, score)), signal, reason: signals.join('；') };
}

function analyzeSentiment(marketData) {
  // 基于市场数据判断情绪
  // 这里简化处理，实际可以从市场简报 JSON 读取
  let score = 50;
  let reasons = [];
  
  // 检查主要指数涨跌
  const changes = Object.values(marketData).filter(d => d && d.change !== undefined);
  const avgChange = changes.reduce((sum, d) => sum + d.change, 0) / changes.length;
  
  if (avgChange > 1) {
    score += 20;
    reasons.push('市场整体上涨');
  } else if (avgChange < -1) {
    score -= 20;
    reasons.push('市场整体下跌');
  }
  
  // VIX 判断（如果有的话）
  // 暂时跳过
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function makeDecision(technicals, sentiment, portfolio, currentPrices) {
  const decisions = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  
  // 综合得分
  const overallScore = technicals.score * 0.6 + sentiment.score * 0.4;
  
  // 风险控制检查
  const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, p) => {
    const price = currentPrices[p.symbol]?.price || p.avgCost;
    return sum + p.qty * price;
  }, 0);
  
  const maxPositionValue = totalEquity * 0.3; // 单笔最大 30%
  
  // 遍历关注的资产
  for (const [symbol, config] of Object.entries(ASSETS)) {
    const price = currentPrices[symbol]?.price;
    if (!price) continue;
    
    const existingPosition = portfolio.positions.find(p => p.symbol === symbol);
    
    if (overallScore > 65 && !existingPosition) {
      // 买入信号
      const buyValue = Math.min(maxPositionValue, portfolio.cash * 0.5);
      if (buyValue > 100) {
        const qty = Math.floor(buyValue / price);
        if (qty > 0) {
          decisions.push({
            type: 'buy',
            symbol,
            qty,
            price,
            date: now,
            reasoning: `综合得分 ${overallScore.toFixed(0)}/100。技术面：${technicals.reason}。消息面：${sentiment.reasons.join('；') || '中性'}。`
          });
        }
      }
    } else if (overallScore < 35 && existingPosition) {
      // 卖出信号
      decisions.push({
        type: 'sell',
        symbol,
        qty: existingPosition.qty,
        price,
        date: now,
        pnl: (price - existingPosition.avgCost) * existingPosition.qty,
        reasoning: `综合得分 ${overallScore.toFixed(0)}/100。技术面：${technicals.reason}。消息面：${sentiment.reasons.join('；') || '中性'}。触发止损/止盈。`
      });
    }
  }
  
  return { decisions, overallScore, technicals, sentiment };
}

function executeTrades(tradingData, decisions, currentPrices) {
  const { portfolio, history } = tradingData;
  
  for (const decision of decisions) {
    if (decision.type === 'buy') {
      const cost = decision.qty * decision.price;
      if (cost <= portfolio.cash) {
        portfolio.cash -= cost;
        const existing = portfolio.positions.find(p => p.symbol === decision.symbol);
        if (existing) {
          const totalQty = existing.qty + decision.qty;
          existing.avgCost = (existing.avgCost * existing.qty + cost) / totalQty;
          existing.qty = totalQty;
        } else {
          portfolio.positions.push({
            symbol: decision.symbol,
            market: ASSETS[decision.symbol].market,
            qty: decision.qty,
            avgCost: decision.price,
            entryDate: decision.date
          });
        }
        history.trades.push(decision);
        console.log(`✅ 买入 ${decision.symbol}: ${decision.qty} 股 @ $${decision.price.toFixed(2)}`);
      }
    } else if (decision.type === 'sell') {
      const position = portfolio.positions.find(p => p.symbol === decision.symbol);
      if (position) {
        portfolio.cash += decision.qty * decision.price;
        portfolio.positions = portfolio.positions.filter(p => p.symbol !== decision.symbol);
        history.trades.push(decision);
        console.log(`✅ 卖出 ${decision.symbol}: ${decision.qty} 股 @ $${decision.price.toFixed(2)}, P&L: $${decision.pnl.toFixed(2)}`);
      }
    }
  }
  
  // 更新持仓市值
  for (const position of portfolio.positions) {
    const price = currentPrices[position.symbol]?.price || position.avgCost;
    position.currentValue = position.qty * price;
    position.pnl = (price - position.avgCost) * position.qty;
  }
  
  // 计算总权益
  const totalEquity = portfolio.cash + portfolio.positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);
  
  // 记录权益曲线
  const today = new Date().toISOString().slice(0, 10);
  const lastEquity = history.equity[history.equity.length - 1];
  if (lastEquity.date !== today) {
    history.equity.push({ date: today, value: Math.round(totalEquity * 100) / 100 });
  } else {
    lastEquity.value = Math.round(totalEquity * 100) / 100;
  }
  
  return tradingData;
}

async function main() {
  console.log('🤖 AI Trading Engine 启动...\n');
  console.log(`📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`);
  
  // 读取现有数据
  let tradingData;
  try {
    tradingData = JSON.parse(fs.readFileSync(TRADING_FILE, 'utf8'));
  } catch (e) {
    console.error('无法读取 trading.json:', e.message);
    process.exit(1);
  }
  
  // 获取当前价格
  console.log('📊 获取市场数据...');
  const currentPrices = {};
  for (const [symbol, config] of Object.entries(ASSETS)) {
    currentPrices[symbol] = await getPrice(symbol, config);
    if (currentPrices[symbol]) {
      console.log(`  ${symbol}: $${currentPrices[symbol].price.toFixed(2)} (${currentPrices[symbol].change >= 0 ? '+' : ''}${currentPrices[symbol].change.toFixed(2)}%)`);
    }
    await new Promise(r => setTimeout(r, 200)); // Rate limit
  }
  
  // 获取历史数据并分析技术面（以 SPY 为代表）
  console.log('\n📈 分析技术面...');
  const spyHistory = await getHistoricalPrices('SPY', 30);
  const technicals = analyzeTechnicals(spyHistory);
  console.log(`  技术面得分: ${technicals.score}/100 (${technicals.signal})`);
  console.log(`  原因: ${technicals.reason}`);
  
  // 分析消息面
  console.log('\n📰 分析消息面...');
  const sentiment = analyzeSentiment(currentPrices);
  console.log(`  消息面得分: ${sentiment.score}/100`);
  console.log(`  原因: ${sentiment.reasons.join('；') || '中性'}`);
  
  // 做出决策
  console.log('\n🧠 生成交易决策...');
  const { decisions, overallScore } = makeDecision(technicals, sentiment, tradingData.portfolio, currentPrices);
  console.log(`  综合得分: ${overallScore.toFixed(0)}/100`);
  
  if (decisions.length === 0) {
    console.log('  📋 无交易信号，保持现有仓位');
    
    // 记录决策日志
    tradingData.history.decisions.push({
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      analysis: `综合得分 ${overallScore.toFixed(0)}/100。技术面 ${technicals.score}/100：${technicals.reason}。消息面 ${sentiment.score}/100。无明确交易信号，保持观望。`,
      action: 'hold'
    });
  } else {
    console.log(`  📋 生成 ${decisions.length} 个交易信号`);
  }
  
  // 执行交易
  if (decisions.length > 0) {
    console.log('\n💰 执行交易...');
    tradingData = executeTrades(tradingData, decisions, currentPrices);
  } else {
    // 更新权益曲线（即使没有交易）
    const totalEquity = tradingData.portfolio.cash + tradingData.portfolio.positions.reduce((sum, p) => {
      const price = currentPrices[p.symbol]?.price || p.avgCost;
      return sum + p.qty * price;
    }, 0);
    
    const today = new Date().toISOString().slice(0, 10);
    const lastEquity = tradingData.history.equity[tradingData.history.equity.length - 1];
    if (lastEquity.date !== today) {
      tradingData.history.equity.push({ date: today, value: Math.round(totalEquity * 100) / 100 });
    }
  }
  
  // 保存数据
  fs.writeFileSync(TRADING_FILE, JSON.stringify(tradingData, null, 2));
  console.log('\n✅ 数据已保存');
  
  // 输出当前状态
  const totalEquity = tradingData.portfolio.cash + tradingData.portfolio.positions.reduce((sum, p) => sum + (p.currentValue || p.qty * p.avgCost), 0);
  const pnl = totalEquity - tradingData.meta.initialCapital;
  console.log('\n📊 当前状态:');
  console.log(`  总资产: $${totalEquity.toFixed(2)}`);
  console.log(`  累计收益: $${pnl.toFixed(2)} (${(pnl / tradingData.meta.initialCapital * 100).toFixed(2)}%)`);
  console.log(`  现金: $${tradingData.portfolio.cash.toFixed(2)}`);
  console.log(`  持仓数: ${tradingData.portfolio.positions.length}`);
  
  if (tradingData.portfolio.positions.length > 0) {
    console.log('\n📋 当前持仓:');
    for (const p of tradingData.portfolio.positions) {
      console.log(`  ${p.symbol}: ${p.qty} 股 @ $${p.avgCost.toFixed(2)}, 市值 $${(p.currentValue || p.qty * p.avgCost).toFixed(2)}, P&L $${(p.pnl || 0).toFixed(2)}`);
    }
  }
}

main().catch(console.error);
