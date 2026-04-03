const path = require('path');

const TRADING_FILE = path.join(__dirname, '../../data/trading.json');
const FINNHUB_KEY = 'd6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg';

const ASSETS = {
  SPY: { name: 'S&P 500 ETF', market: 'US', category: 'index', type: 'finnhub' },
  QQQ: { name: 'Nasdaq 100 ETF', market: 'US', category: 'index', type: 'finnhub' },
  GLD: { name: '黄金 ETF', market: 'COMMODITY', category: 'safe-haven', type: 'finnhub' },
  TLT: { name: '20年期美债 ETF', market: 'US', category: 'safe-haven', type: 'finnhub' },
  USO: { name: '原油 ETF', market: 'COMMODITY', category: 'commodity', type: 'finnhub' },
  bitcoin: { name: 'Bitcoin', market: 'CRYPTO', category: 'crypto', type: 'coingecko' }
};

const RULES = {
  minHoldDays: 7,
  minPositionPct: 10,
  maxPositionPct: 25,
  maxTotalPositionPct: 80,
  stopLossPct: -8,
  takeProfitPct: 25,
  cooldownDays: 3,
  targetAnnualReturn: 20,
  minAcceptableReturn: 10
};

const STOOQ_SYMBOLS = {
  SPY: 'spy.us',
  QQQ: 'qqq.us',
  GLD: 'gld.us',
  TLT: 'tlt.us',
  USO: 'uso.us',
  bitcoin: 'btc.v'
};

module.exports = {
  TRADING_FILE,
  FINNHUB_KEY,
  ASSETS,
  RULES,
  STOOQ_SYMBOLS
};
