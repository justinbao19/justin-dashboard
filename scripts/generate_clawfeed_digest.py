#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Any

import requests

DASHBOARD_URL = "https://justin-dashboard-xi.vercel.app"
NEWS_STREAM_URL = f"{DASHBOARD_URL}/api/news"


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def load_news_stream() -> dict[str, Any]:
    response = requests.get(NEWS_STREAM_URL, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise SystemExit("Unexpected news payload")
    return payload


def pick_items(section: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    featured = section.get("featured")
    items = []
    if isinstance(featured, dict):
        items.append(featured)
    extra = section.get("items", [])
    if isinstance(extra, list):
        items.extend(item for item in extra if isinstance(item, dict))
    return items[:limit]


def select_news(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    categories = payload.get("categories", {}) if isinstance(payload, dict) else {}
    return {
        "macro": pick_items(categories.get("macro", {}) if isinstance(categories, dict) else {}, 4),
        "tech": pick_items(categories.get("tech", {}) if isinstance(categories, dict) else {}, 6),
        "general": pick_items(categories.get("general", {}) if isinstance(categories, dict) else {}, 4),
    }


def clip_text(value: Any, limit: int = 80) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_prompt(edition: str, payload: dict[str, Any]) -> str:
    selected = select_news(payload)

    if edition == "morning":
        structure = {
            "title": "🤖 ClawFeed AI 科技早报 | YYYY年M月D日",
            "sections": [
                "🔥 今日热点（3-5条）",
                "💡 技术动态（3-4条）",
                "💬 大佬发言（2-3条）",
                "📊 行业趋势（2-3条）",
            ],
            "style": "中文，简洁、有判断、适合早上快速扫读",
        }
        timing_hint = "请按早报口吻组织，信息相对完整。"
    else:
        structure = {
            "title": "🤖 ClawFeed AI 科技午报 | YYYY年M月D日",
            "sections": [
                "🔥 上午热点（2-3条）",
                "💡 技术动态（2-3条）",
                "💬 值得关注（2-3条）",
            ],
            "style": "中文，更精简、更像午间 update",
        }
        timing_hint = "请按午报口吻组织，减少重复，强调新增变化。"

    return (
        "你是一位中文 AI/科技编辑。"
        "请只基于给定新闻流，生成一份可直接发送的纯文本 ClawFeed 摘要。"
        "不要输出 Markdown 代码块，不要解释，不要编造未提供的事实。"
        "如果某条是综合媒体新闻，也可以从 AI/科技投资、产品发布、开发者工具、行业情绪角度来组织。\n\n"
        f"{timing_hint}\n"
        "要求:\n"
        "1. 输出必须是纯文本。\n"
        "2. 每个要点 1-2 句，尽量有信息增量。\n"
        "3. 保留 emoji 小标题风格。\n"
        "4. 结尾不要再加 Telegram/微信 指令。\n\n"
        f"输出结构参考:\n{json.dumps(structure, ensure_ascii=False, indent=2)}\n\n"
        f"输入新闻流:\n{json.dumps(selected, ensure_ascii=False, indent=2)}"
    )


def build_fallback_digest(edition: str, payload: dict[str, Any]) -> str:
    selected = select_news(payload)
    today = datetime.now().strftime("%Y年%-m月%-d日")
    title = "🤖 ClawFeed AI 科技早报" if edition == "morning" else "🤖 ClawFeed AI 科技午报"

    def lines(items: list[dict[str, Any]], limit: int) -> list[str]:
        out: list[str] = []
        for item in items[:limit]:
            item_title = clip_text(item.get("title", ""), 70)
            source = clip_text(item.get("sourceLabel") or item.get("source") or "", 18)
            stamp = clip_text(item.get("stamp") or item.get("publishedAt") or "", 20)
            meta = " · ".join(part for part in [source, stamp] if part)
            out.append(f"- {item_title}" + (f"（{meta}）" if meta else ""))
        return out

    sections: list[tuple[str, list[str]]] = []
    macro_lines = lines(selected["macro"], 3 if edition == "morning" else 2)
    tech_lines = lines(selected["tech"], 4 if edition == "morning" else 3)
    general_lines = lines(selected["general"], 3 if edition == "morning" else 2)

    if macro_lines:
        sections.append(("🔥 今日热点" if edition == "morning" else "🔥 上午热点", macro_lines))
    if tech_lines:
        sections.append(("💡 技术动态", tech_lines))
    if general_lines:
        sections.append(("💬 值得关注", general_lines))

    parts = [f"{title} | {today}"]
    for heading, body in sections:
        parts.append(f"\n{heading}\n" + "\n".join(body))
    if len(parts) == 1:
        parts.append("\n💬 值得关注\n- 暂无足够的 AI/科技动态可供整理。")
    return "\n".join(parts).strip()


def call_llm(prompt: str) -> str:
    api_key = require_env("LLM_API_KEY")
    base_url = require_env("LLM_BASE_URL").rstrip("/")
    model = require_env("LLM_MODEL")
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You write concise Chinese AI/tech digests. "
                    "Return plain text only."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.5,
        "max_tokens": 1800,
    }

    try:
        response = requests.post(
            f"{base_url}/chat/completions",
            json=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=90,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.HTTPError as exc:
        detail = ""
        if exc.response is not None:
            detail = exc.response.text[:2000]
        raise SystemExit(
            f"LLM request failed: HTTP {exc.response.status_code if exc.response else 'unknown'}: {detail}"
        ) from exc
    except requests.RequestException as exc:
        raise SystemExit(f"LLM request failed: {exc}") from exc

    try:
        content = payload["choices"][0]["message"]["content"]
    except Exception as exc:
        raise SystemExit(
            f"Unexpected LLM response: {json.dumps(payload, ensure_ascii=False)[:2000]}"
        ) from exc
    return str(content).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--edition", choices=["morning", "noon"], required=True)
    args = parser.parse_args()

    payload = load_news_stream()
    prompt = build_prompt(args.edition, payload)
    try:
        text = call_llm(prompt)
    except SystemExit as exc:
        print(f"[warn] {exc}. Falling back to deterministic digest.", file=sys.stderr)
        text = build_fallback_digest(args.edition, payload)

    today = datetime.now().strftime("%Y年%-m月%-d日")
    if args.edition == "morning" and "ClawFeed AI 科技早报" not in text:
        text = f"🤖 ClawFeed AI 科技早报 | {today}\n\n{text}"
    if args.edition == "noon" and "ClawFeed AI 科技午报" not in text:
        text = f"🤖 ClawFeed AI 科技午报 | {today}\n\n{text}"

    print(text.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
