#!/usr/bin/env node

const { runTradingCycle } = require('./trading/run-cycle');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await runTradingCycle({
    persist: !dryRun,
    trigger: dryRun ? 'cli-dry-run' : 'cli'
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
