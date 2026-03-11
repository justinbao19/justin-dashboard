#!/usr/bin/env python3
"""
市场分析更新脚本
由 OpenClaw cron 调用，接收 JSON 格式的分析数据并合并到 market.json
用法: echo '{"macro_summary": "...", "logic_chain": [...], ...}' | python update_market_analysis.py
"""

import json
import sys
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

def main():
    # 从 stdin 读取分析数据
    try:
        input_data = sys.stdin.read()
        if not input_data.strip():
            print("❌ 没有输入数据")
            sys.exit(1)
        
        analysis_data = json.loads(input_data)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析错误: {e}")
        sys.exit(1)
    
    # 读取现有 market.json
    market_file = DATA_DIR / "market.json"
    if market_file.exists():
        with open(market_file, "r", encoding="utf-8") as f:
            market = json.load(f)
    else:
        market = {}
    
    # 更新分析字段（保留价格数据）
    now = datetime.now()
    
    # 可更新的字段
    updateable_fields = [
        "macro_summary",
        "logic_chain", 
        "market_analysis",
        "advice"
    ]
    
    for field in updateable_fields:
        if field in analysis_data:
            market[field] = analysis_data[field]
    
    # 更新时间戳
    market["date"] = now.strftime("%Y年%-m月%-d日 %H:%M")
    market["updated_at"] = now.isoformat()
    
    # 写入文件
    with open(market_file, "w", encoding="utf-8") as f:
        json.dump(market, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 已更新 {market_file}")
    print(f"   更新时间: {market['date']}")

if __name__ == "__main__":
    main()
