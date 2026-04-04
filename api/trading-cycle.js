const { runTradingCycle } = require('../scripts/trading/run-cycle');

function isAuthorized(req) {
  const secret = process.env.TRADING_CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization || '';
  return header === `Bearer ${secret}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const dryRun = String(req.query?.dryRun || req.body?.dryRun || '') === '1';
    const result = await runTradingCycle({
      persist: !dryRun,
      trigger: dryRun ? 'api-dry-run' : 'api'
    });

    res.status(200).json({
      ok: true,
      dryRun,
      persisted: !dryRun,
      totalEquity: result.totalEquity,
      pnl: result.pnl,
      latestDecision: result.latestDecision,
      decisionCount: result.decisionCount,
      lastRunAt: result.tradingData.meta.lastRunAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Trading cycle failed' });
  }
};
