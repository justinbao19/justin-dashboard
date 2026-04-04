#!/usr/bin/env python3
"""
生成并发送微信简报。

用法:
  python3 scripts/send_wechat_briefing.py --mode morning --send
  python3 scripts/send_wechat_briefing.py --mode evening --send
  python3 scripts/send_wechat_briefing.py --mode evening --source local
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

from briefing_content import build_brief

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
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["morning", "evening"], required=True)
    parser.add_argument("--source", choices=["local", "remote", "auto"], default="remote")
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args()

    text = build_brief(args.mode, source=args.source)
    print(text)

    if args.send:
        print("\n--- sending to weixin ---", file=sys.stderr)
        send_message(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
