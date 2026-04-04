#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
import sys

import requests

from weather_briefing import build_weather_report

WEIXIN_CHANNEL = "openclaw-weixin"
WEIXIN_ACCOUNT = os.environ.get("WEIXIN_ACCOUNT_ID", "7718db65dcf1-im-bot")
WEIXIN_TARGET = os.environ.get("WEIXIN_TARGET_ID", "o9cq8097CyKn-7P-8ofBnaMlDlJw@im.wechat")
DASHBOARD_URL = "https://justin-dashboard-xi.vercel.app"


def send_message(text: str) -> None:
    cmd = [
        "openclaw",
        "message",
        "send",
        "--channel",
        WEIXIN_CHANNEL,
        "--account",
        WEIXIN_ACCOUNT,
        "--target",
        WEIXIN_TARGET,
        "--message",
        text,
    ]
    subprocess.run(cmd, check=True)


def load_generated_report() -> str:
    response = requests.get(
        f"{DASHBOARD_URL}/data/briefings/weather.txt",
        timeout=20,
    )
    response.raise_for_status()
    return response.text.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["generated", "live"], default="generated")
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args()

    text = load_generated_report() if args.source == "generated" else build_weather_report()
    print(text)
    if args.send:
        print("\n--- sending to weixin ---", file=sys.stderr)
        send_message(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
