#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import requests

WEATHER_URL = "https://justin-dashboard-xi.vercel.app/api/weather"
NEWS_URL = "https://justin-dashboard-xi.vercel.app/data/news.json"
DASHBOARD_WEATHER_URL = "https://justin-dashboard-xi.vercel.app/weather"

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

TIME_LABELS = {
    6: "早晨",
    9: "上午",
    12: "中午",
    15: "下午",
    18: "傍晚",
    21: "夜间",
}


def load_weather() -> dict:
    response = requests.get(WEATHER_URL, timeout=20)
    response.raise_for_status()
    return response.json()


def load_news() -> dict:
    response = requests.get(NEWS_URL, timeout=20)
    response.raise_for_status()
    return response.json()


def round_temp(value: float | int | None) -> str:
    if value is None:
        return "-"
    return f"{round(float(value))}°C"


def find_hourly_value(items: list[dict], hour: int) -> dict | None:
    for item in items:
        dt = item.get("datetime", "")
        if f"T{hour:02d}:" in dt:
            return item
    return None


def format_hourly_rows(hourly: dict) -> list[str]:
    temperatures = hourly.get("temperature", [])
    apparent = hourly.get("apparent_temperature", [])
    skycon = hourly.get("skycon", [])

    rows: list[str] = []
    for hour in [6, 9, 12, 15, 18, 21]:
        temp = find_hourly_value(temperatures, hour)
        feel = find_hourly_value(apparent, hour)
        sky = find_hourly_value(skycon, hour)
        if not temp:
            continue
        sky_label = SKYCON_LABELS.get(sky.get("value") if sky else "", "未知")
        rows.append(
            f"🕒 {TIME_LABELS[hour]}: {round_temp(temp.get('value'))} / 体感 {round_temp(feel.get('value') if feel else None)} / {sky_label}"
        )
    return rows


def format_percent(value: float | int | None) -> str:
    if value is None:
        return "-"
    return f"{round(float(value) * 100)}%"


def build_day_tip(today: datetime) -> str | None:
    if today.month == 4 and today.day in {4, 5, 6}:
        return "📅 假期提醒: 清明假期，出行和扫墓可优先安排白天时段。"
    return None


def build_human_advice(
    today_min: float | int | None,
    today_max: float | int | None,
    rain_risk: float,
    aqi: float | int | None,
    wind_speed: float | int | None,
    current_sky: str,
) -> str:
    min_temp = float(today_min) if today_min is not None else None
    max_temp = float(today_max) if today_max is not None else None
    wind = float(wind_speed) if wind_speed is not None else None

    clothing_bits: list[str] = []
    if min_temp is not None and min_temp <= 10:
        clothing_bits.append("早晚还有点凉，出门带件外套会更稳")
    elif min_temp is not None and min_temp <= 16:
        clothing_bits.append("薄外套或长袖就够，通勤体感会比较舒服")
    elif max_temp is not None and max_temp >= 28:
        clothing_bits.append("白天会偏热，短袖更轻松，注意补水")
    else:
        clothing_bits.append("今天整体不算难穿，按平时通勤那套来就行")

    travel_bits: list[str] = []
    if rain_risk >= 0.5:
        travel_bits.append("最好顺手带把伞，午后临时出门会更安心")
    elif rain_risk >= 0.25:
        travel_bits.append("天气有点摇摆，包里塞把折叠伞比较保险")

    if aqi is not None:
        if float(aqi) >= 150:
            travel_bits.append("空气一般偏差，久待户外记得戴口罩")
        elif float(aqi) >= 100:
            travel_bits.append("敏感人群今天尽量别在户外待太久")

    if wind is not None and wind >= 8:
        travel_bits.append("风会比较明显，骑车或步行时注意保暖和防风")

    if "雨" in current_sky and not any("伞" in item for item in travel_bits):
        travel_bits.append("路面可能偏湿，穿防滑一点的鞋会更省心")

    parts = [clothing_bits[0]]
    if travel_bits:
        parts.append(travel_bits[0])
    if len(travel_bits) > 1:
        parts.append(travel_bits[1])
    return "，".join(parts) + "。"


def build_weather_report() -> str:
    payload = load_weather()
    news_payload = load_news()
    result = payload.get("result", {})
    realtime = result.get("realtime", {})
    hourly = result.get("hourly", {})
    daily = result.get("daily", {})

    now_dt = datetime.now(ZoneInfo("Asia/Shanghai"))
    now = now_dt.strftime("%Y年%-m月%-d日 %H:%M")
    current_sky = SKYCON_LABELS.get(realtime.get("skycon"), realtime.get("skycon", "未知"))
    current_temp = round_temp(realtime.get("temperature"))
    current_feel = round_temp(realtime.get("apparent_temperature"))
    comfort = realtime.get("life_index", {}).get("comfort", {}).get("desc", "")
    aqi = realtime.get("air_quality", {}).get("aqi", {}).get("chn")
    humidity = format_percent(realtime.get("humidity"))
    wind_speed = realtime.get("wind", {}).get("speed")
    visibility = realtime.get("visibility")

    today_temp = (daily.get("temperature") or [{}])[0]
    tomorrow_temp = (daily.get("temperature") or [{}, {}])[1]
    today_astro = (daily.get("astro") or [{}])[0]
    sunrise = today_astro.get("sunrise", {}).get("time", "-")
    sunset = today_astro.get("sunset", {}).get("time", "-")
    forecast = result.get("forecast_keypoint", "")
    precipitation = hourly.get("precipitation", [])
    rain_risk = max((item.get("probability", 0) for item in precipitation[:18]), default=0)
    day_tip = build_day_tip(now_dt)
    outfit_advice = build_human_advice(
        today_temp.get("min"),
        today_temp.get("max"),
        rain_risk,
        aqi,
        wind_speed,
        current_sky,
    )

    lines = [
        "🌤️✨ 天气主报",
        now,
        "",
        f"🌡️ 此刻天气: {current_sky} {current_temp}，体感 {current_feel}" + (f"，{comfort}" if comfort else ""),
        f"😷 空气质量: AQI {aqi}" if aqi is not None else "😷 空气质量: 暂无",
        f"💧 湿度 / 能见度: {humidity} / {round(float(visibility), 1) if visibility is not None else '-'} km",
        f"🍃 风速: {round(float(wind_speed), 1)} m/s" if wind_speed is not None else "🍃 风速: 暂无",
        f"📈 今日气温: {round_temp(today_temp.get('min'))} ~ {round_temp(today_temp.get('max'))}",
        f"📅 明日气温: {round_temp(tomorrow_temp.get('min'))} ~ {round_temp(tomorrow_temp.get('max'))}",
        f"🌅 日出 / 🌇 日落: {sunrise} / {sunset}",
    ]

    if forecast:
        lines.extend(["", f"☁️ 天气提示: {forecast}"])

    lines.append(
        f"☔ 降雨提醒: 今日白天降雨概率最高 {round(rain_risk * 100)}%"
    )

    hourly_rows = format_hourly_rows(hourly)
    if hourly_rows:
        lines.extend(["", "🗓️ 今日日程天气:"])
        lines.extend(hourly_rows)

    if outfit_advice:
        lines.extend(["", f"🧥 出门建议: {outfit_advice}"])

    if day_tip:
        lines.extend(["", day_tip])

    news_items = news_payload.get("items", []) if isinstance(news_payload, dict) else []
    if isinstance(news_items, list):
        picked = [item for item in news_items if isinstance(item, dict)][:2]
        if picked:
            lines.extend(["", "📰 国际要闻:"])
            for idx, item in enumerate(picked, start=1):
                title = item.get("title", "未命名新闻")
                summary = item.get("summary", "")
                short_summary = summary[:45] + ("..." if len(summary) > 45 else "")
                if short_summary:
                    lines.append(f"{idx}. {title}")
                    lines.append(f"   {short_summary}")
                else:
                    lines.append(f"{idx}. {title}")

    lines.extend(["", "🔗 Dashboard 天气页", DASHBOARD_WEATHER_URL])

    return "\n".join(lines).strip()
