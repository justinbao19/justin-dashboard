#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys

import requests

from briefing_content import build_brief


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def send_message(text: str) -> dict:
    bot_token = require_env("TELEGRAM_BOT_TOKEN")
    chat_id = require_env("TELEGRAM_CHAT_ID")
    thread_id = os.environ.get("TELEGRAM_THREAD_ID", "").strip()

    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": False,
    }
    if thread_id:
        payload["message_thread_id"] = thread_id

    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            data=payload,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.HTTPError as exc:
        raise SystemExit(f"Telegram send failed: HTTP {resp.status_code}: {resp.text}") from exc
    except requests.RequestException as exc:
        raise SystemExit(f"Telegram send failed: {exc}") from exc

    if not data.get("ok"):
        raise SystemExit(f"Telegram send failed: {json.dumps(data, ensure_ascii=False)}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["morning", "evening"], required=True)
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args()

    text = build_brief(args.mode)
    print(text)

    if args.send:
        result = send_message(text)
        print(
            f"\n✅ Sent via Telegram. Message ID: {result['result']['message_id']}",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
