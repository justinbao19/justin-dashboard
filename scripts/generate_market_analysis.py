#!/usr/bin/env python3
"""
用兼容 OpenAI 的 LLM API 生成 market.json 分析字段。

必需环境变量:
- LLM_API_KEY
- LLM_BASE_URL
- LLM_MODEL
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
MARKET_PATH = ROOT / "data" / "market.json"
NEWS_PATH = ROOT / "data" / "news.json"
VALIDATE_JSON_SCRIPT = ROOT / "scripts" / "validate-json.py"


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def build_prompt(market: dict, news: dict) -> str:
    news_items = []
    for item in news.get("items", [])[:5]:
        if not isinstance(item, dict):
            continue
        news_items.append(
            {
                "title": item.get("title", ""),
                "summary": item.get("summary", ""),
                "source": item.get("source", ""),
            }
        )

    input_payload = {
        "market_snapshot": {
            key: market.get(key)
            for key in ["date", "ndx", "spx", "dji", "hsi", "hstec", "sse", "gold", "oil", "btc", "eth"]
        },
        "top_news": news_items,
    }

    schema = {
        "macro_summary": "100字内，一句话总结全局",
        "logic_chain": ["5条以内，每条是 因素A → 影响B → 结论C"],
        "market_analysis": [
            {
                "title": "🇺🇸 美股 / 🇭🇰 港股 / 🇨🇳 A股 / 🥇 黄金 / ₿ BTC 等",
                "status": "bullish 或 bearish 或 neutral",
                "summary": "80字内",
                "details": ["3条以内的要点"],
                "catalyst": "核心驱动因素",
                "next_watch": "下一步重点观察点",
            }
        ],
        "us_market_preview": {
            "title": "📊 美股短线预判",
            "summary": "120字内",
            "factors": ["5条以内"],
            "scenarios": [
                {
                    "condition": "触发条件",
                    "prediction": "对应判断",
                    "probability": "40%",
                }
            ],
        },
        "advice": {
            "summary": "60字内整体判断",
            "positions": [
                {
                    "asset": "美股/港股/A股/黄金/BTC 等",
                    "action": "持有/加仓/减仓/观望",
                    "reasoning": "原因",
                    "level": "关键价位或观察位",
                }
            ],
            "risks": ["4条以内主要风险"],
        },
    }

    return (
        "你是一位中文宏观与跨市场策略分析师。"
        "请只基于输入的市场快照和新闻，产出一个严格合法的 JSON 对象。"
        "不要输出 Markdown，不要解释，不要代码块。\n\n"
        "要求:\n"
        "1. 只输出 JSON。\n"
        "2. 语言是自然、简洁、专业的中文。\n"
        "3. 结论要像日报，不要空话，不要编造不存在的数据源。\n"
        "4. status 只能是 bullish、bearish、neutral。\n"
        "5. probability 用百分比字符串，例如 45%。\n\n"
        f"输入数据:\n{json.dumps(input_payload, ensure_ascii=False, indent=2)}\n\n"
        f"输出 JSON 结构:\n{json.dumps(schema, ensure_ascii=False, indent=2)}"
    )


def call_llm(prompt: str) -> dict:
    api_key = require_env("LLM_API_KEY")
    base_url = require_env("LLM_BASE_URL").rstrip("/")
    model = require_env("LLM_MODEL")

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only valid JSON."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 2200,
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            json=body,
            headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            },
            timeout=90,
        )
        resp.raise_for_status()
        payload = resp.json()
    except requests.HTTPError as exc:
        raise SystemExit(f"LLM request failed: HTTP {resp.status_code}: {resp.text}") from exc
    except requests.RequestException as exc:
        raise SystemExit(f"LLM request failed: {exc}") from exc

    try:
        content = payload["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as exc:
        raise SystemExit(f"Unexpected LLM response: {json.dumps(payload, ensure_ascii=False)[:2000]}") from exc


def validate_json_file(path: Path) -> None:
    subprocess.run(
        ["python3", str(VALIDATE_JSON_SCRIPT), str(path)],
        check=True,
    )


def main() -> int:
    market = load_json(MARKET_PATH)
    news = load_json(NEWS_PATH)
    analysis = call_llm(build_prompt(market, news))

    for field in [
        "macro_summary",
        "logic_chain",
        "market_analysis",
        "us_market_preview",
        "advice",
    ]:
        if field in analysis:
            market[field] = analysis[field]

    with MARKET_PATH.open("w", encoding="utf-8") as f:
        json.dump(market, f, ensure_ascii=False, indent=2)

    validate_json_file(MARKET_PATH)
    print(f"✅ Updated {MARKET_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
