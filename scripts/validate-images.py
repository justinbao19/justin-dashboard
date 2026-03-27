#!/usr/bin/env python3
"""
新闻图片验证和自动修复脚本
用法: python3 validate-images.py

功能:
1. 检查 news.json 中所有图片 URL 是否可访问
2. 失败的图片自动用 Brave Image Search 搜索替换
3. 验证替换后的图片确实可用

在更新 news.json 后调用此脚本确保图片全部可用
"""

import json
import os
import sys
import time
import subprocess
import re
from pathlib import Path


# Brave API Key
BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "BSAccshg0ETDm8nWQSXnRyho54sEtrx")
NEWS_FILE = Path(__file__).parent.parent / "data" / "news.json"


def check_image_url(url: str, timeout: int = 10) -> bool:
    """检查图片 URL 是否可访问（使用 curl）"""
    if not url or not url.startswith("http"):
        return False
    
    try:
        result = subprocess.run(
            ["curl", "-sI", "--max-time", str(timeout), url],
            capture_output=True,
            text=True,
            timeout=timeout + 5
        )
        output = result.stdout.lower()
        # 检查 HTTP 状态码是否为 200
        return "200" in output.split("\n")[0] if output else False
    except Exception:
        return False


def search_brave_image(query: str, count: int = 5) -> list:
    """使用 Brave API 搜索图片（使用 curl）"""
    import urllib.parse
    encoded_query = urllib.parse.quote(query)
    url = f"https://api.search.brave.com/res/v1/images/search?q={encoded_query}&count={count}"
    
    try:
        result = subprocess.run(
            ["curl", "-s", "--max-time", "15", "-H", f"X-Subscription-Token: {BRAVE_API_KEY}", url],
            capture_output=True,
            text=True,
            timeout=20
        )
        if result.returncode != 0:
            return []
        
        data = json.loads(result.stdout)
        return [r.get("properties", {}).get("url") for r in data.get("results", []) if r.get("properties", {}).get("url")]
    except Exception as e:
        print(f"   Brave 搜索失败: {e}")
        return []


def extract_keywords(title: str) -> str:
    """从标题提取搜索关键词（英文更有效）"""
    # 中英文关键词映射
    keyword_map = {
        "以色列": "Israel",
        "空袭": "airstrike",
        "德黑兰": "Tehran",
        "伊朗": "Iran",
        "特朗普": "Trump",
        "霍尔木兹": "Hormuz",
        "海峡": "strait",
        "黎巴嫩": "Lebanon",
        "战火": "war",
        "美军": "US military",
        "中东": "Middle East",
        "五角大楼": "Pentagon",
        "G7": "G7",
        "峰会": "summit",
        "法国": "France",
        "南非": "South Africa",
    }
    
    # 构建英文搜索词
    keywords = []
    for cn, en in keyword_map.items():
        if cn in title:
            keywords.append(en)
    
    if keywords:
        return " ".join(keywords[:5]) + " 2026"
    else:
        # 直接用原标题
        return re.sub(r'[「」『』【】《》，。！？、；：]', ' ', title)[:50] + " 2026"


def find_working_image(title: str, current_url: str) -> str | None:
    """搜索可用的替代图片"""
    keywords = extract_keywords(title)
    print(f"   搜索: {keywords}")
    
    # 搜索候选图片
    candidates = search_brave_image(keywords)
    
    if not candidates:
        print("   未找到候选图片")
        return None
    
    # 验证每个候选图片
    for i, url in enumerate(candidates):
        if not url:
            continue
        print(f"   验证候选 {i+1}/{len(candidates)}...", end=" ", flush=True)
        if check_image_url(url):
            print("✓")
            return url
        else:
            print("✗")
        time.sleep(0.3)
    
    print("   所有候选图片都不可用")
    return None


def validate_and_fix_news():
    """验证并修复新闻图片"""
    if not NEWS_FILE.exists():
        print(f"❌ 文件不存在: {NEWS_FILE}")
        return False
    
    with open(NEWS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    items = data.get("items", [])
    if not items:
        print("⚠️  没有新闻条目")
        return True
    
    modified = False
    all_valid = True
    
    print(f"检查 {len(items)} 条新闻的图片...\n")
    
    for i, item in enumerate(items):
        title = item.get("title", f"新闻 {i+1}")
        title_short = title[:35] + "..." if len(title) > 35 else title
        image_url = item.get("image", "")
        
        print(f"[{i+1}/{len(items)}] {title_short}")
        
        if check_image_url(image_url):
            print(f"   ✅ 图片可用")
        else:
            print(f"   ❌ 图片不可用")
            
            # 尝试搜索替代图片
            new_url = find_working_image(title, image_url)
            
            if new_url:
                print(f"   🔄 已替换")
                item["image"] = new_url
                modified = True
            else:
                print(f"   ⚠️  无法找到替代图片")
                all_valid = False
        
        # Brave API 速率限制
        time.sleep(1.5)
    
    if modified:
        # 更新时间戳
        from datetime import datetime, timezone, timedelta
        tz = timezone(timedelta(hours=8))
        data["lastUpdated"] = datetime.now(tz).strftime("%Y-%m-%dT%H:%M:%S+08:00")
        
        # 写回文件
        with open(NEWS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n✅ 已更新 news.json")
    
    return all_valid


def main():
    print("=" * 50)
    print("新闻图片验证和自动修复")
    print("=" * 50 + "\n")
    
    success = validate_and_fix_news()
    
    print("\n" + "=" * 50)
    if success:
        print("✅ 所有图片验证通过")
    else:
        print("⚠️  部分图片无法修复，请手动处理")
    print("=" * 50)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
