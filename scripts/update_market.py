#!/usr/bin/env python3
"""
市场数据更新脚本

行情主源：stock-sdk（腾讯/东方财富聚合）
- 美股指数：直接取 NDX / INX(S&P 500) / DJI，不再用 QQQ/SPY/DIA 换算
- 港股/A股：stock-sdk 统一接口，不再手写新浪解析
- 加密货币：CoinGecko
- 汇率：open.er-api
"""

import json
import os
import subprocess
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
VALIDATE_JSON_SCRIPT = Path(__file__).resolve().parent / "validate-json.py"
MARKET_SNAPSHOT_SCRIPT = Path(__file__).resolve().parent / "market_snapshot.mjs"


def validate_json_file(path: Path) -> None:
    subprocess.run(["python3", str(VALIDATE_JSON_SCRIPT), str(path)], check=True)


def load_existing_market(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        print("发现损坏的 market.json，先尝试自动修复...")
        validate_json_file(path)
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)


def ensure_node_dependencies() -> None:
    node_module = Path(__file__).parent.parent / "node_modules" / "stock-sdk" / "package.json"
    if node_module.exists():
        return
    print("  安装 Node 行情依赖...")
    subprocess.run(
        ["npm", "install", "--no-audit", "--no-fund"],
        cwd=Path(__file__).parent.parent,
        check=True,
    )


def main() -> None:
    print("📊 更新市场数据（stock-sdk 主源）...")
    ensure_node_dependencies()
    market_file = DATA_DIR / "market.json"
    existing = load_existing_market(market_file)

    proc = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            (
                "import { buildMarketSnapshot } from './scripts/market_snapshot.mjs';"
                "const existing = JSON.parse(process.env.EXISTING_MARKET || '{}');"
                "const data = await buildMarketSnapshot({ existing, preserveStatic: true });"
                "process.stdout.write(JSON.stringify(data, null, 2));"
            ),
        ],
        cwd=Path(__file__).parent.parent,
        env={**os.environ, "EXISTING_MARKET": json.dumps(existing, ensure_ascii=False)},
        text=True,
        capture_output=True,
        check=False,
    )

    if proc.stderr:
        print(proc.stderr.strip())
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)

    market = json.loads(proc.stdout)
    with market_file.open("w", encoding="utf-8") as f:
        json.dump(market, f, ensure_ascii=False, indent=2)
        f.write("\n")

    validate_json_file(market_file)

    print(f"✅ 已更新 {market_file}")
    print(f"   NDX: {market.get('ndx', {}).get('price')} ({market.get('ndx', {}).get('change')}%)")
    print(f"   SPX: {market.get('spx', {}).get('price')} ({market.get('spx', {}).get('change')}%)")
    print(f"   HSI: {market.get('hsi', {}).get('price')} ({market.get('hsi', {}).get('change')}%)")
    print(f"   BTC: {market.get('btc', {}).get('price')} ({market.get('btc', {}).get('change')}%)")


if __name__ == "__main__":
    main()
