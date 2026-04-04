#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
MARKET_PATH = DATA_DIR / "market.json"
NEWS_PATH = DATA_DIR / "news.json"
DASHBOARD_URL = "https://justin-dashboard-xi.vercel.app"
WEATHER_URL = f"{DASHBOARD_URL}/api/weather"
REMOTE_MARKET_URL = f"{DASHBOARD_URL}/data/market.json"
REMOTE_NEWS_URL = f"{DASHBOARD_URL}/data/news.json"
SKYCON_LABELS = {
    "CLEAR_DAY": "晴",
    "CLEAR_NIGHT": "晴夜",
    "PARTLY_CLOUDY_DAY": "多云",
    "PARTLY_CLOUDY_NIGHT": "多云夜",
    "CLOUDY": "阴",
    "LIGHT_HAZE": "轻度雾霾",
    "MODERATE_HAZE": "中度雾霾",
    "HEAVY_HAZE": "重度雾霾",
    "LIGHT_RAIN": "小雨",
    "MODERATE_RAIN": "中雨",
    "HEAVY_RAIN": "大雨",
    "STORM_RAIN": "暴雨",
    "FOG": "雾",
    "LIGHT_SNOW": "小雪",
    "MODERATE_SNOW": "中雪",
    "HEAVY_SNOW": "大雪",
    "STORM_SNOW": "暴雪",
    "DUST": "浮尘",
    "SAND": "沙尘",
    "WIND": "大风",
}


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_json_from_url(url: str) -> dict:
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    return response.json()


def load_weather(source: str = "local") -> dict:
    if source in {"remote", "auto", "local"}:
        try:
            return load_json_from_url(WEATHER_URL)
        except requests.RequestException:
            if source == "remote":
                raise
            return {}
    raise ValueError(f"unsupported source: {source}")


def load_market_and_news(source: str = "local") -> tuple[dict, dict, dict]:
    if source == "local":
        return load_json(MARKET_PATH), load_json(NEWS_PATH), load_weather("local")
    if source == "remote":
        return (
            load_json_from_url(REMOTE_MARKET_URL),
            load_json_from_url(REMOTE_NEWS_URL),
            load_weather("remote"),
        )
    if source == "auto":
        try:
            return (
                load_json_from_url(REMOTE_MARKET_URL),
                load_json_from_url(REMOTE_NEWS_URL),
                load_weather("remote"),
            )
        except requests.RequestException:
            return load_json(MARKET_PATH), load_json(NEWS_PATH), load_weather("local")
    raise ValueError(f"unsupported source: {source}")


def format_weather_brief(weather: dict) -> list[str]:
    result = weather.get("result", {}) if isinstance(weather, dict) else {}
    realtime = result.get("realtime", {}) if isinstance(result, dict) else {}
    daily = result.get("daily", {}) if isinstance(result, dict) else {}

    if not realtime:
        return []

    temp = realtime.get("temperature")
    apparent = realtime.get("apparent_temperature")
    skycon = SKYCON_LABELS.get(realtime.get("skycon"), realtime.get("skycon", "未知"))
    comfort = (
        realtime.get("life_index", {})
        .get("comfort", {})
        .get("desc")
    )
    aqi = (
        realtime.get("air_quality", {})
        .get("aqi", {})
        .get("chn")
    )
    forecast_keypoint = result.get("forecast_keypoint", "")

    temp_line = f"🌤️ 天气: {skycon}"
    if temp is not None:
        temp_line += f" {round(temp)}°C"
    if apparent is not None:
        temp_line += f"，体感 {round(apparent)}°C"
    if comfort:
        temp_line += f"，{comfort}"
    if aqi is not None:
        temp_line += f"，AQI {aqi}"

    lines = [temp_line]

    temperatures = daily.get("temperature", []) if isinstance(daily, dict) else []
    if temperatures:
        today = temperatures[0]
        if isinstance(today, dict):
            min_temp = today.get("min")
            max_temp = today.get("max")
            if min_temp is not None and max_temp is not None:
                lines.append(f"🌡️ 今日温度: {round(min_temp)}~{round(max_temp)}°C")

    if forecast_keypoint:
        lines.append(f"☁️ 天气提示: {forecast_keypoint}")

    return lines


def format_change(value: float | int | None) -> str:
    if value is None:
        return "0.00%"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.2f}%"


def market_line(label: str, key: str, market: dict) -> str | None:
    item = market.get(key)
    if not isinstance(item, dict):
        return None
    price = item.get("price")
    change = item.get("change")
    if price is None:
        return None
    return f"{label} {price} ({format_change(change)})"


def pick_news_items(news: dict, limit: int = 3) -> list[dict]:
    items = news.get("items", [])
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)][:limit]


def build_morning_brief(market: dict, news: dict, weather: dict) -> str:
    lines = [
        "🌅 早报",
        market.get("date", ""),
        "",
    ]

    lines.extend([
        f"🧭 宏观一句话: {market.get('macro_summary', '暂无')}",
        "",
        "📈 市场观察:",
    ])

    for label, key in [
        ("纳指", "ndx"),
        ("标普", "spx"),
        ("恒指", "hsi"),
        ("黄金", "gold"),
        ("BTC", "btc"),
    ]:
        line = market_line(label, key, market)
        if line:
            lines.append(f"- {line}")

    preview = market.get("us_market_preview", {})
    if isinstance(preview, dict) and preview.get("summary"):
        lines.extend(["", f"🇺🇸 美股预判: {preview['summary']}"])

    items = pick_news_items(news)
    if items:
        lines.extend(["", "📰 今日要闻:"])
        for idx, item in enumerate(items, start=1):
            lines.append(f"{idx}. {item.get('title', '未命名新闻')}")

    advice = market.get("advice", {})
    if isinstance(advice, dict) and advice.get("summary"):
        lines.extend(["", f"💡 操作建议: {advice['summary']}"])

    lines.extend(["", "🔗 Dashboard", DASHBOARD_URL])
    return "\n".join(lines).strip()


def build_evening_brief(market: dict, news: dict, weather: dict) -> str:
    lines = [
        "🌙 晚报",
        market.get("date", ""),
        "",
    ]

    lines.extend([
        f"🧭 收盘判断: {market.get('macro_summary', '暂无')}",
        "",
        "📊 核心资产:",
    ])

    for label, key in [
        ("纳指", "ndx"),
        ("标普", "spx"),
        ("道指", "dji"),
        ("恒指", "hsi"),
        ("A股", "sse"),
        ("黄金", "gold"),
        ("原油", "oil"),
        ("BTC", "btc"),
        ("ETH", "eth"),
    ]:
        line = market_line(label, key, market)
        if line:
            lines.append(f"- {line}")

    analysis = market.get("market_analysis", [])
    if isinstance(analysis, list):
        lines.extend(["", "🧩 市场脉络:"])
        for item in analysis[:3]:
            if not isinstance(item, dict):
                continue
            lines.append(f"- {item.get('title', '板块')}: {item.get('summary', '')}")

    items = pick_news_items(news)
    if items:
        lines.extend(["", "📰 晚间要闻:"])
        for idx, item in enumerate(items, start=1):
            lines.append(f"{idx}. {item.get('title', '未命名新闻')}")

    advice = market.get("advice", {})
    positions = advice.get("positions", []) if isinstance(advice, dict) else []
    if positions:
        lines.extend(["", "💼 仓位建议:"])
        for pos in positions[:4]:
            if not isinstance(pos, dict):
                continue
            lines.append(f"- {pos.get('asset', '资产')}: {pos.get('action', '观望')}，{pos.get('reasoning', '')}")

    lines.extend(["", "🔗 Dashboard", DASHBOARD_URL])
    return "\n".join(lines).strip()


def build_brief(mode: str, source: str = "local") -> str:
    market, news, weather = load_market_and_news(source=source)
    if mode == "morning":
        return build_morning_brief(market, news, weather)
    if mode == "evening":
        return build_evening_brief(market, news, weather)
    raise ValueError(f"unsupported mode: {mode}")
