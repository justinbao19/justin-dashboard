#!/usr/bin/env python3
"""
市场数据更新脚本
数据源：
- 美股：Finnhub API (SPY/QQQ/DIA)
- 港股/A股/黄金/原油：新浪财经
- Crypto：CoinGecko API
"""

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

import requests

# === 配置 ===
FINNHUB_KEY = os.environ.get("FINNHUB_KEY", "").strip()
DATA_DIR = Path(__file__).parent.parent / "data"
VALIDATE_JSON_SCRIPT = Path(__file__).resolve().parent / "validate-json.py"


def validate_json_file(path: Path) -> None:
    subprocess.run(
        ["python3", str(VALIDATE_JSON_SCRIPT), str(path)],
        check=True,
    )


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

def get_finnhub_quote(symbol: str) -> dict:
    """获取 Finnhub 实时报价"""
    if not FINNHUB_KEY:
        print(f"Finnhub key missing, skip {symbol}")
        return None
    url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={FINNHUB_KEY}"
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        return {"price": data.get("c", 0), "change": data.get("dp", 0)}
    except Exception as e:
        print(f"Finnhub error ({symbol}): {e}")
        return None

def get_sina_quote(symbol: str) -> dict:
    """获取新浪财经报价 (港股/A股)"""
    url = f"https://hq.sinajs.cn/list={symbol}"
    headers = {"Referer": "https://finance.sina.com.cn"}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        r.encoding = "gbk"
        line = r.text.split('"')[1]
        if not line:
            return None
        parts = line.split(",")
        
        # 不同市场解析方式不同
        if symbol.startswith("hk"):  # 港股
            price = float(parts[6])
            prev_close = float(parts[3])
        elif symbol.startswith("sh") or symbol.startswith("sz"):  # A股
            price = float(parts[3])
            prev_close = float(parts[2])
        else:
            return None
            
        change = ((price - prev_close) / prev_close * 100) if prev_close else 0
        return {"price": price, "change": round(change, 2)}
    except Exception as e:
        print(f"Sina error ({symbol}): {e}")
        return None

def get_commodity_from_etf(symbol: str, multiplier: float = 1.0) -> dict:
    """用 Finnhub ETF 数据换算商品价格"""
    data = get_finnhub_quote(symbol)
    if data:
        return {
            "price": round(data["price"] * multiplier, 2),
            "change": data["change"]
        }
    return None

def get_coingecko_quote(coin_id: str) -> dict:
    """获取 CoinGecko 报价"""
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies=usd&include_24hr_change=true"
    try:
        r = requests.get(url, timeout=10)
        data = r.json().get(coin_id, {})
        return {
            "price": data.get("usd", 0),
            "change": round(data.get("usd_24h_change", 0), 2)
        }
    except Exception as e:
        print(f"CoinGecko error ({coin_id}): {e}")
        return None

def format_price(price: float, prefix: str = "", decimals: int = 0) -> str:
    """格式化价格显示"""
    if decimals == 0:
        return f"{prefix}{price:,.0f}"
    return f"{prefix}{price:,.{decimals}f}"

def main():
    print("📊 更新市场数据...")
    
    # 美股 (Finnhub) - 用 ETF 代表指数
    print("  获取美股...")
    ndx = get_finnhub_quote("QQQ")  # Nasdaq 100
    spx = get_finnhub_quote("SPY")  # S&P 500
    dji = get_finnhub_quote("DIA")  # Dow Jones
    
    # 港股 (新浪)
    print("  获取港股...")
    hsi = get_sina_quote("hkHSI")      # 恒生指数
    hstec = get_sina_quote("hkHSTECH")  # 恒生科技
    
    # A股 (新浪)
    print("  获取A股...")
    sse = get_sina_quote("sh000001")   # 上证综指
    
    # 商品 (Finnhub ETF 换算)
    print("  获取商品...")
    gold = get_commodity_from_etf("GLD", 5.85)  # GLD ETF → 金价 (约 x5.85)
    oil = get_commodity_from_etf("USO", 0.62)   # USO ETF → 油价 (约 x0.62)
    
    # Crypto (CoinGecko)
    print("  获取加密货币...")
    btc = get_coingecko_quote("bitcoin")
    eth = get_coingecko_quote("ethereum")
    
    # 读取现有数据（保留 analysis 等字段）
    market_file = DATA_DIR / "market.json"
    market = load_existing_market(market_file)
    
    # 更新价格数据
    now = datetime.now()
    market["date"] = now.strftime("%Y年%-m月%-d日 实时")
    market["updated_at"] = now.isoformat()
    
    if ndx:
        market["ndx"] = {"price": format_price(ndx["price"] * 41, "", 0), "change": ndx["change"]}  # QQQ -> NDX 换算
    if spx:
        market["spx"] = {"price": format_price(spx["price"] * 10, "", 0), "change": spx["change"]}  # SPY -> SPX 换算
    if dji:
        market["dji"] = {"price": format_price(dji["price"] * 100, "", 0), "change": dji["change"]}  # DIA -> DJI 换算
    if hsi:
        market["hsi"] = {"price": format_price(hsi["price"]), "change": hsi["change"]}
    if hstec:
        market["hstec"] = {"price": format_price(hstec["price"]), "change": hstec["change"]}
    if sse:
        market["sse"] = {"price": format_price(sse["price"]), "change": sse["change"]}
    if gold:
        market["gold"] = {"price": format_price(gold["price"], "$", 0), "change": gold["change"]}
    if oil:
        market["oil"] = {"price": format_price(oil["price"], "$", 2), "change": oil["change"]}
    if btc:
        market["btc"] = {"price": format_price(btc["price"], "$", 0), "change": btc["change"]}
    if eth:
        market["eth"] = {"price": format_price(eth["price"], "$", 0), "change": eth["change"]}
    
    # 保存
    with open(market_file, "w", encoding="utf-8") as f:
        json.dump(market, f, ensure_ascii=False, indent=2)

    validate_json_file(market_file)

    print(f"✅ 已更新 {market_file}")
    print(f"   NDX: {market.get('ndx', {}).get('price')} ({market.get('ndx', {}).get('change')}%)")
    print(f"   SPX: {market.get('spx', {}).get('price')} ({market.get('spx', {}).get('change')}%)")
    print(f"   BTC: {market.get('btc', {}).get('price')} ({market.get('btc', {}).get('change')}%)")

if __name__ == "__main__":
    main()
