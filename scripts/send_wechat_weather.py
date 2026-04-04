#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys

from weather_briefing import build_weather_report

WEIXIN_CHANNEL = "openclaw-weixin"
WEIXIN_ACCOUNT = os.environ.get("WEIXIN_ACCOUNT_ID", "7718db65dcf1-im-bot")
WEIXIN_TARGET = os.environ.get("WEIXIN_TARGET_ID", "o9cq8097CyKn-7P-8ofBnaMlDlJw@im.wechat")


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


def main() -> int:
    text = build_weather_report()
    print(text)
    if "--send" in sys.argv:
        print("\n--- sending to weixin ---", file=sys.stderr)
        send_message(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
