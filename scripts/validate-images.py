#!/usr/bin/env python3
"""
新闻图片验证和自动修复脚本
基于 smart-image-finder skill 的多来源策略

用法: python3 validate-images.py

策略优先级:
1. 验证现有图片是否可用
2. 失败则尝试从新闻原页面提取图片 (curl + grep)
3. 仍失败则用 Brave Image Search 搜索替换
"""

import json
import os
import sys
import time
import subprocess
import re
from pathlib import Path
from urllib.parse import urlparse, quote


# Brave API Key
BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "BSAccshg0ETDm8nWQSXnRyho54sEtrx")
NEWS_FILE = Path(__file__).parent.parent / "data" / "news.json"


# 来源提取规则 (来自 smart-image-finder skill)
SOURCE_PATTERNS = {
    "reuters.com": {
        "pattern": r'https://www\.reuters\.com/resizer/v2/[^"]+\.jpg[^"]*',
        "hd_param": "?width=3000&quality=100"
    },
    "techcrunch.com": {
        "pattern": r'https://techcrunch\.com/wp-content/uploads/[^"]+\.(jpg|png)',
        "hd_param": "?w=2048"
    },
    "bbc.com": {
        "pattern": r'https://ichef\.bbci\.co\.uk/news/[0-9]+/[^"]+\.jpg',
        "hd_param": ""  # 替换 URL 中的数字为 1024
    },
    "theguardian.com": {
        "pattern": r'https://i\.guim\.co\.uk/img/[^"]+\.jpg[^"]*',
        "hd_param": ""
    },
    "aljazeera.com": {
        "pattern": r'https://www\.aljazeera\.com/wp-content/uploads/[^"]+\.jpg[^"]*',
        "hd_param": ""
    },
    "cnn.com": {
        "pattern": r'https://media\.cnn\.com/api/v1/images/[^"]+\.jpg[^"]*',
        "hd_param": ""
    },
    "france24.com": {
        "pattern": r'https://s\.france24\.com/media/display/[^"]+\.jpg',
        "hd_param": ""  # w:1920 可加
    },
    "timesofisrael.com": {
        "pattern": r'https://static\.timesofisrael\.com/www/uploads/[^"]+\.jpg',
        "hd_param": ""
    },
    "apnews.com": {
        "pattern": r'https://dims\.apnews\.com/[^"]+\.jpg[^"]*',
        "hd_param": ""
    },
    "thepaper.cn": {
        "pattern": r'https://imagepphcloud\.thepaper\.cn/pph/image/[^"]+\.jpg',
        "hd_param": ""
    }
}


def run_curl(args: list, timeout: int = 15) -> str:
    """执行 curl 命令"""
    try:
        result = subprocess.run(
            ["curl", "-sL", "--max-time", str(timeout)] + args,
            capture_output=True,
            text=True,
            timeout=timeout + 5
        )
        return result.stdout
    except Exception:
        return ""


def check_image_url(url: str, timeout: int = 10) -> bool:
    """检查图片 URL 是否可访问"""
    if not url or not url.startswith("http"):
        return False
    
    try:
        result = subprocess.run(
            ["curl", "-sI", "--max-time", str(timeout), url],
            capture_output=True,
            text=True,
            timeout=timeout + 5
        )
        first_line = result.stdout.split("\n")[0].lower() if result.stdout else ""
        return "200" in first_line
    except Exception:
        return False


def extract_from_source(source_url: str) -> str | None:
    """从新闻原页面提取图片 URL"""
    if not source_url:
        return None
    
    domain = urlparse(source_url).netloc.replace("www.", "")
    
    # 找到匹配的提取规则
    pattern_info = None
    for source_domain, info in SOURCE_PATTERNS.items():
        if source_domain in domain:
            pattern_info = info
            break
    
    if not pattern_info:
        return None
    
    print(f"   尝试从 {domain} 提取图片...")
    
    # 获取页面 HTML
    html = run_curl([source_url])
    if not html:
        print(f"   无法获取页面")
        return None
    
    # 提取图片 URL
    matches = re.findall(pattern_info["pattern"], html)
    if not matches:
        print(f"   未找到匹配图片")
        return None
    
    # 取第一个有效的
    for match in matches[:5]:
        img_url = match if isinstance(match, str) else match[0]
        
        # 添加高清参数
        if pattern_info["hd_param"] and "?" not in img_url:
            img_url += pattern_info["hd_param"]
        
        print(f"   验证: {img_url[:50]}...", end=" ", flush=True)
        if check_image_url(img_url):
            print("✓")
            return img_url
        print("✗")
        time.sleep(0.3)
    
    return None


def search_brave_image(query: str, count: int = 5) -> list:
    """使用 Brave API 搜索图片"""
    encoded_query = quote(query)
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
    """从标题提取英文搜索关键词"""
    keyword_map = {
        "以色列": "Israel", "空袭": "airstrike", "德黑兰": "Tehran",
        "伊朗": "Iran", "特朗普": "Trump", "霍尔木兹": "Hormuz",
        "海峡": "strait", "黎巴嫩": "Lebanon", "战火": "war",
        "美军": "US military", "中东": "Middle East", "五角大楼": "Pentagon",
        "G7": "G7", "峰会": "summit", "法国": "France", "南非": "South Africa",
        "习近平": "Xi Jinping", "拜登": "Biden", "普京": "Putin",
        "乌克兰": "Ukraine", "俄罗斯": "Russia", "北约": "NATO",
    }
    
    keywords = [en for cn, en in keyword_map.items() if cn in title]
    
    if keywords:
        return " ".join(keywords[:5]) + " 2026"
    else:
        return re.sub(r'[「」『』【】《》，。！？、；：]', ' ', title)[:50] + " 2026"


def find_working_image(title: str, source_url: str) -> str | None:
    """多策略查找可用图片"""
    
    # 策略 1: 从新闻原页面提取
    img = extract_from_source(source_url)
    if img:
        return img
    
    # 策略 2: Brave 搜索
    print(f"   Brave 搜索备用...")
    keywords = extract_keywords(title)
    print(f"   关键词: {keywords}")
    
    candidates = search_brave_image(keywords)
    
    for i, url in enumerate(candidates):
        if not url:
            continue
        print(f"   验证候选 {i+1}/{len(candidates)}...", end=" ", flush=True)
        if check_image_url(url):
            print("✓")
            return url
        print("✗")
        time.sleep(0.3)
    
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
        source_url = item.get("url", "")
        
        print(f"[{i+1}/{len(items)}] {title_short}")
        
        if check_image_url(image_url):
            print(f"   ✅ 图片可用")
        else:
            print(f"   ❌ 图片不可用")
            
            new_url = find_working_image(title, source_url)
            
            if new_url:
                print(f"   🔄 已替换")
                item["image"] = new_url
                modified = True
            else:
                print(f"   ⚠️  无法找到替代图片")
                all_valid = False
        
        time.sleep(1.5)  # 速率限制
    
    if modified:
        from datetime import datetime, timezone, timedelta
        tz = timezone(timedelta(hours=8))
        data["lastUpdated"] = datetime.now(tz).strftime("%Y-%m-%dT%H:%M:%S+08:00")
        
        with open(NEWS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"\n✅ 已更新 news.json")
    
    return all_valid


def main():
    print("=" * 55)
    print("新闻图片验证和自动修复 (smart-image-finder 策略)")
    print("=" * 55 + "\n")
    
    success = validate_and_fix_news()
    
    print("\n" + "=" * 55)
    if success:
        print("✅ 所有图片验证通过")
    else:
        print("⚠️  部分图片无法修复，请手动处理")
    print("=" * 55)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
