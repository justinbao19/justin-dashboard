const fs = require('fs');
const { TRADING_FILE, ASSETS } = require('./config');

function loadTradingData() {
  return JSON.parse(fs.readFileSync(TRADING_FILE, 'utf8'));
}

function saveTradingData(tradingData) {
  fs.writeFileSync(TRADING_FILE, JSON.stringify(tradingData, null, 2));
}

function updatePositionMarks(portfolio, currentPrices) {
  for (const position of portfolio.positions) {
    const price = currentPrices[position.symbol]?.price || position.avgCost;
    position.currentValue = position.qty * price;
    position.pnl = (price - position.avgCost) * position.qty;
  }
}

function executeDecisions(tradingData, decisions, currentPrices) {
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
      const position = tradingData.portfolio.positions.find(item => item.symbol === decision.symbol);
      if (position) {
        tradingData.portfolio.cash += decision.qty * decision.price;
        tradingData.portfolio.positions = tradingData.portfolio.positions.filter(item => item.symbol !== decision.symbol);
        tradingData.history.trades.push(decision);
      }
    }
  }

  updatePositionMarks(tradingData.portfolio, currentPrices);
}

function updateEquityCurve(tradingData) {
  const totalEquity = tradingData.portfolio.cash + tradingData.portfolio.positions.reduce(
    (sum, position) => sum + (position.currentValue || 0),
    0
  );
  const today = new Date().toISOString().slice(0, 10);
  const existing = tradingData.history.equity.find(point => point.date === today);
  const rounded = Math.round(totalEquity * 100) / 100;
  if (existing) existing.value = rounded;
  else tradingData.history.equity.push({ date: today, value: rounded });
  return rounded;
}

module.exports = {
  loadTradingData,
  saveTradingData,
  updatePositionMarks,
  executeDecisions,
  updateEquityCurve
};
