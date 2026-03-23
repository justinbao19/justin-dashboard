#!/usr/bin/env python3
"""
新闻数据更新脚本
- 从多个新闻源抓取今日要闻
- 自动搜索相关配图（Unsplash API）
- 生成 news.json
"""

import json
import re
import requests
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

# === 配置 ===
DATA_DIR = Path(__file__).parent.parent / "data"

# Unsplash API (免费 50 请求/小时)
UNSPLASH_ACCESS_KEY = "your_unsplash_access_key"  # 需要注册获取

# Brave Search API (已配置，用于图片搜索)
BRAVE_API_KEY = "BSAccshg0ETDm8nWQSXnRyho54sEtrx"

# 新闻关键词 → 图片搜索词映射
KEYWORD_MAP = {
    # 地缘政治
    "伊朗": "iran conflict",
    "战争": "military conflict",
    "导弹": "missile defense",
    "空袭": "military aircraft",
    "以色列": "israel",
    "中东": "middle east",
    "黎巴嫩": "beirut lebanon",
    # 政治人物
    "特朗普": "trump president",
    "拜登": "biden president",
    "习近平": "china leader",
    # 经济
    "股市": "stock market",
    "油价": "oil price",
    "黄金": "gold bars",
    "加密货币": "bitcoin cryptocurrency",
    # 科技
    "AI": "artificial intelligence",
    "人工智能": "artificial intelligence robot",
    # 其他
    "气候": "climate change",
    "地震": "earthquake disaster",
}


def extract_keywords(title: str) -> list:
    """从标题提取关键词"""
    keywords = []
    for cn_word, en_search in KEYWORD_MAP.items():
        if cn_word in title:
            keywords.append(en_search)
    return keywords[:3]  # 最多3个


def search_unsplash(query: str) -> str | None:
    """搜索 Unsplash 图片"""
    if UNSPLASH_ACCESS_KEY == "your_unsplash_access_key":
        return None  # 未配置 API key
    
    url = f"https://api.unsplash.com/search/photos?query={quote(query)}&per_page=1&orientation=landscape"
    headers = {"Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"}
    
    try:
        r = requests.get(url, headers=headers, timeout=10)
        data = r.json()
        results = data.get("results", [])
        if results:
            # 返回适中尺寸的图片
            return results[0]["urls"]["regular"]
    except Exception as e:
        print(f"Unsplash error: {e}")
    return None


def search_brave_images(query: str, count: int = 10) -> str | None:
    """使用 Brave Search API 搜索图片，返回第一个可访问的 URL
    
    特点：
    - 搜新闻关键词 + 年份，相关度高
    - 验证图片可访问（避免防盗链 403）
    - 免费，已有 API key
    """
    if not BRAVE_API_KEY:
        return None
    
    url = f"https://api.search.brave.com/res/v1/images/search?q={quote(query)}&count={count}"
    headers = {"X-Subscription-Token": BRAVE_API_KEY}
    
    try:
        r = requests.get(url, headers=headers, timeout=15)
        data = r.json()
        results = data.get("results", [])
        
        # 遍历结果，找第一个能访问的
        for result in results:
            img_url = result.get("properties", {}).get("url", "")
            if not img_url:
                continue
            
            # 跳过已知会 403 的域名
            skip_domains = ["cnbcfm.com", "reuters.com/resizer", "guim.co.uk", "bbc", "cnn.com"]
            if any(d in img_url for d in skip_domains):
                continue
            
            # 验证可访问
            try:
                check = requests.head(img_url, timeout=3, allow_redirects=True)
                if check.status_code == 200:
                    return img_url
            except:
                continue
        
    except Exception as e:
        print(f"    Brave Images error: {e}")
    
    return None


def build_search_query(title: str) -> str:
    """从新闻标题构建搜索关键词
    
    策略：提取核心词 + 加年份，提高相关度
    """
    from datetime import datetime
    year = datetime.now().year
    
    # 关键词提取规则
    keywords = []
    
    # 人名/组织
    names = ["特朗普", "拜登", "习近平", "普京", "马斯克", "IEA", "OPEC"]
    for name in names:
        if name in title:
            keywords.append(name)
    
    # 地点
    places = ["伊朗", "以色列", "中东", "霍尔木兹", "波斯湾", "乌克兰", "台湾", "日本", "韩国"]
    for place in places:
        if place in title:
            keywords.append(place)
    
    # 事件类型
    events = ["导弹", "空袭", "战争", "冲突", "股市", "暴跌", "油价", "能源", "危机"]
    for event in events:
        if event in title:
            keywords.append(event)
    
    # 如果没提取到，用标题前20字
    if not keywords:
        keywords = [title[:20]]
    
    # 组合查询词 + 年份
    query = " ".join(keywords[:3]) + f" {year}"
    return query


def get_fallback_image(title: str, index: int = 0) -> str:
    """根据内容返回合适的 Unsplash 高质量图片
    
    保障链：关键词匹配 → 通用图片轮换（避免重复）
    """
    # 预设的高质量图片，按主题分类（都是 1200px 宽度）
    images = {
        # 军事/冲突
        "war": "https://images.unsplash.com/photo-1580130379624-3a069adbffc5?w=1200&q=80",
        "missile": "https://images.unsplash.com/photo-1517976487492-5750f3195933?w=1200&q=80",
        "military": "https://images.unsplash.com/photo-1579912437766-7896df6d3cd3?w=1200&q=80",
        "terror": "https://images.unsplash.com/photo-1453873531674-2151bcd01707?w=1200&q=80",
        
        # 政治
        "politics_us": "https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=1200&q=80",
        "politics_cn": "https://images.unsplash.com/photo-1547981609-4b6bfe67ca0b?w=1200&q=80",
        "government": "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=1200&q=80",
        "law": "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1200&q=80",
        
        # 地区
        "middle_east": "https://images.unsplash.com/photo-1569242840510-9fe6f0112cee?w=1200&q=80",
        "iran": "https://images.unsplash.com/photo-1564668007661-4c2e62e01bab?w=1200&q=80",
        "israel": "https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&q=80",
        "japan": "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1200&q=80",
        "australia": "https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?w=1200&q=80",
        
        # 经济/金融
        "stock": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200&q=80",
        "economy": "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=1200&q=80",
        "oil": "https://images.unsplash.com/photo-1518709766631-a6a7f45921c3?w=1200&q=80",
        "gold": "https://images.unsplash.com/photo-1610375461246-83df859d849d?w=1200&q=80",
        
        # 科技
        "tech": "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80",
        "ai": "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1200&q=80",
        "chip": "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80",
        "phone": "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=1200&q=80",
        
        # 社会
        "work": "https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?w=1200&q=80",
        "health": "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80",
        "education": "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1200&q=80",
        "sports": "https://images.unsplash.com/photo-1461896836934- voices-e08b5c?w=1200&q=80",
        "food": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80",
        "crime": "https://images.unsplash.com/photo-1589994965851-a8f479c573a9?w=1200&q=80",
        "panda": "https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?w=1200&q=80",
        "film": "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=1200&q=80",
        "children": "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=1200&q=80",
        
        # 通用新闻图片池（用于轮换，避免重复）
        "news_1": "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=1200&q=80",
        "news_2": "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&q=80",
        "news_3": "https://images.unsplash.com/photo-1586339949916-3e9457bef6d3?w=1200&q=80",
        "news_4": "https://images.unsplash.com/photo-1557992260-ec58e38d363c?w=1200&q=80",
        "news_5": "https://images.unsplash.com/photo-1478439911751-475f7dc979ea?w=1200&q=80",
        "world": "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80",
    }
    
    # 关键词匹配规则（按优先级排序，更详细）
    rules = [
        # 动物
        (["大熊猫", "熊猫", "国宝"], "panda"),
        
        # 恐怖袭击/枪击
        (["枪击", "恐袭", "恐怖", "袭击", "IS", "伊斯兰国"], "terror"),
        
        # 影视娱乐
        (["导演", "电影", "演员", "影片", "票房", "娱乐"], "film"),
        
        # 儿童/未成年
        (["儿童", "小天才", "手表", "未成年", "孩子"], "children"),
        
        # 军事/战争
        (["战争", "空袭", "轰炸", "入侵"], "war"),
        (["导弹", "发射", "核武"], "missile"),
        (["军事", "军队", "部队", "国防", "军方"], "military"),
        
        # 地区
        (["伊朗", "德黑兰"], "iran"),
        (["以色列", "特拉维夫", "耶路撒冷"], "israel"),
        (["中东", "黎巴嫩", "叙利亚", "也门"], "middle_east"),
        (["日本", "东京", "旅日"], "japan"),
        (["澳大利亚", "悉尼", "墨尔本", "澳洲"], "australia"),
        
        # 政治人物/政府
        (["特朗普", "拜登", "白宫", "美国总统"], "politics_us"),
        (["习近平", "李强", "两会", "政协", "人大", "总书记"], "politics_cn"),
        (["政府", "国会", "议会", "选举", "官员"], "government"),
        (["法院", "判决", "定罪", "审判", "司法"], "law"),
        
        # 经济金融
        (["股市", "A股", "港股", "美股", "纳斯达克", "证监会"], "stock"),
        (["油价", "原油", "石油", "OPEC"], "oil"),
        (["黄金", "金价"], "gold"),
        (["经济", "GDP", "通胀", "利率", "央行"], "economy"),
        
        # 科技
        (["AI", "人工智能", "ChatGPT", "大模型"], "ai"),
        (["芯片", "半导体", "英伟达", "台积电"], "chip"),
        (["手机", "智能手表", "电子产品"], "phone"),
        (["科技", "互联网", "数字化"], "tech"),
        
        # 社会
        (["就业", "失业", "裁员", "招聘", "体育局", "运动员"], "sports"),
        (["医疗", "健康", "疫情", "病毒", "体检"], "health"),
        (["教育", "学校", "高考", "大学", "理论武装"], "education"),
        (["食品", "陈皮", "造假", "市场"], "food"),
        (["杀害", "遇害", "凶杀", "犯罪"], "crime"),
    ]
    
    for keywords, category in rules:
        if any(kw in title for kw in keywords):
            return images[category]
    
    # 没有匹配到关键词时，使用通用图片轮换（根据 index 选择不同图片）
    news_keys = ["news_1", "news_2", "news_3", "news_4", "news_5", "world"]
    return images[news_keys[index % len(news_keys)]]


def fetch_news_from_google_rss() -> list:
    """从 Google News RSS 获取新闻"""
    import xml.etree.ElementTree as ET
    
    # Google News 中文版 RSS
    url = "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
    
    try:
        r = requests.get(url, timeout=15)
        root = ET.fromstring(r.content)
        
        items = []
        for item in root.findall(".//item")[:10]:  # 最多10条
            title = item.find("title").text
            link = item.find("link").text
            pub_date = item.find("pubDate").text if item.find("pubDate") is not None else ""
            
            # 提取来源（Google News 格式：标题 - 来源）
            source = "Google News"
            if " - " in title:
                parts = title.rsplit(" - ", 1)
                if len(parts) == 2:
                    title, source = parts
            
            items.append({
                "title": title.strip(),
                "source": source.strip(),
                "url": link,
                "pub_date": pub_date
            })
        
        return items
    except Exception as e:
        print(f"Google News RSS error: {e}")
        return []


def fetch_news_from_thepaper() -> list:
    """从澎湃新闻 RSS 获取新闻（直接链接，无需解析）"""
    import xml.etree.ElementTree as ET
    
    url = "https://feedx.net/rss/thepaper.xml"
    
    try:
        r = requests.get(url, timeout=15)
        root = ET.fromstring(r.content)
        
        items = []
        for item in root.findall(".//item")[:15]:
            title_el = item.find("title")
            link_el = item.find("link")
            desc_el = item.find("description")
            pub_date_el = item.find("pubDate")
            
            if title_el is None or link_el is None:
                continue
            
            title = title_el.text.strip() if title_el.text else ""
            link = link_el.text.strip() if link_el.text else ""
            
            # 从 description 提取摘要（去掉 HTML 标签）
            summary = ""
            if desc_el is not None and desc_el.text:
                # 提取纯文本前200字
                text = re.sub(r'<[^>]+>', '', desc_el.text)
                text = re.sub(r'\s+', ' ', text).strip()
                summary = text[:300] if len(text) > 300 else text
            
            # 从 description 提取第一张图片
            image = ""
            if desc_el is not None and desc_el.text:
                # 澎湃用 data-src 存真实图片，src 是占位符
                # HTML 实体编码：&quot; = "
                desc_text = desc_el.text.replace('&quot;', '"').replace('&amp;', '&')
                img_match = re.search(r'data-src="(https://imgpai\.thepaper\.cn[^"]+)"', desc_text)
                if img_match:
                    image = img_match.group(1)
                else:
                    # 备选：任何 data-src
                    img_match = re.search(r'data-src="(https?://[^"]+\.(jpg|jpeg|png))"', desc_text)
                    if img_match:
                        image = img_match.group(1)
            
            items.append({
                "title": title,
                "source": "澎湃新闻",
                "url": link,
                "summary": summary,
                "image": image,
                "pub_date": pub_date_el.text if pub_date_el is not None else ""
            })
        
        return items
    except Exception as e:
        print(f"澎湃新闻 RSS error: {e}")
        return []


def fetch_news_from_newsapi() -> list:
    """从 NewsAPI 获取新闻（需要 API key）"""
    # NewsAPI 免费版限制较多，这里作为备选
    return []


def resolve_google_news_url(google_url: str, title: str = "") -> str:
    """解析 Google News 跳转链接，获取真实 URL"""
    import base64
    
    # 方法1: 从 URL 提取 base64 编码的原始链接
    # Google News URL 格式: .../articles/CBMi...
    try:
        if "/articles/" in google_url:
            article_id = google_url.split("/articles/")[1].split("?")[0]
            # 尝试 base64 解码
            try:
                decoded = base64.urlsafe_b64decode(article_id + "==")
                # 在解码结果中查找 URL
                decoded_str = decoded.decode("utf-8", errors="ignore")
                url_match = re.search(r'https?://[^\s\x00-\x1f]+', decoded_str)
                if url_match:
                    result = url_match.group(0).rstrip('\x00\x01\x02\x03')
                    if "google" not in result:
                        return result
            except:
                pass
    except:
        pass
    
    # 方法2: 用 requests 跟随重定向
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        r = requests.get(google_url, headers=headers, timeout=8, allow_redirects=True)
        if r.url != google_url and "google" not in r.url:
            return r.url
    except:
        pass
    
    return google_url


def fetch_via_jina(url: str) -> dict | None:
    """用 Jina Reader 抓取网页，返回 {title, description, image, content}"""
    try:
        jina_url = f"https://r.jina.ai/{url}"
        headers = {
            "Accept": "application/json",
            "X-Return-Format": "json",
            "User-Agent": "Mozilla/5.0"
        }
        r = requests.get(jina_url, headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            return {
                "title": data.get("title", ""),
                "description": data.get("description", ""),
                "image": data.get("image", ""),
                "content": data.get("content", "")[:500]  # 截取前500字
            }
    except Exception as e:
        print(f"    Jina error: {e}")
    return None


def get_article_summary(url: str, jina_data: dict | None = None) -> str:
    """从新闻原文提取摘要"""
    # 优先使用 Jina 数据
    if jina_data:
        desc = jina_data.get("description", "")
        if desc and len(desc) > 20 and "Google News" not in desc:
            return desc[:300].strip()
        # 备选：用正文开头
        content = jina_data.get("content", "")
        if content and len(content) > 50:
            # 清理 markdown
            clean = re.sub(r'\[.*?\]\(.*?\)', '', content)
            clean = re.sub(r'[#*_`]', '', clean)
            clean = clean.strip()
            if len(clean) > 50:
                return clean[:300].strip()
    
    # 回退到直接抓取
    try:
        # 如果是 Google News 链接，先解析
        real_url = resolve_google_news_url(url) if "news.google.com" in url else url
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        r = requests.get(real_url, headers=headers, timeout=10)
        
        # 1. 优先提取 og:description
        match = re.search(r'<meta[^>]+(?:property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']|content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\'])', r.text)
        if match:
            desc = match.group(1) or match.group(2)
            if desc and len(desc) > 20:
                return desc[:300].strip()
        
        # 2. 备选：meta description
        match = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', r.text)
        if match:
            desc = match.group(1)
            if desc and len(desc) > 20:
                return desc[:300].strip()
        
        # 3. 提取第一段文字
        match = re.search(r'<p[^>]*>([^<]{50,300})</p>', r.text)
        if match:
            text = re.sub(r'<[^>]+>', '', match.group(1))
            return text[:300].strip()
            
    except Exception as e:
        print(f"    ⚠️ 获取摘要失败: {e}")
    return ""


def get_article_image(url: str) -> str | None:
    """尝试从新闻原文获取图片"""
    try:
        # 如果是 Google News 链接，先解析真实 URL
        if "news.google.com" in url:
            url = resolve_google_news_url(url)
            print(f"    → 真实链接: {url[:50]}...")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        r = requests.get(url, headers=headers, timeout=10)
        
        # 优先提取 og:image（社交分享图，通常质量好）
        # 匹配两种格式：property="og:image" content="..." 或 content="..." property="og:image"
        match = re.search(r'<meta[^>]+(?:property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']|content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\'])', r.text)
        if match:
            img_url = match.group(1) or match.group(2)
            # 过滤掉 logo、icon 等
            if img_url and not any(x in img_url.lower() for x in ["logo", "icon", "avatar", "favicon"]):
                if img_url.startswith("//"):
                    img_url = "https:" + img_url
                return img_url
        
        # 备选：twitter:image
        match = re.search(r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']', r.text)
        if match:
            img_url = match.group(1)
            if img_url.startswith("//"):
                img_url = "https:" + img_url
            return img_url
            
    except Exception as e:
        print(f"    ⚠️ 获取图片失败: {e}")
    return None


def find_image_for_news(news_item: dict, jina_data: dict | None = None, index: int = 0) -> str:
    """为新闻项找配图
    
    优先级：
    1. Jina 返回的图片
    2. 新闻原文 og:image
    3. Brave Image Search（推荐，相关度高）
    4. Unsplash API
    5. 预设图片兜底
    """
    title = news_item["title"]
    url = news_item.get("url", "")
    
    # 1. 优先使用 Jina 返回的图片
    if jina_data:
        img = jina_data.get("image", "")
        if img and not any(x in img.lower() for x in ["logo", "icon", "avatar", "favicon"]):
            # 验证可访问
            try:
                check = requests.head(img, timeout=3, allow_redirects=True)
                if check.status_code == 200:
                    print(f"    ✓ Jina 图片")
                    return img
            except:
                pass
    
    # 2. 尝试从新闻原文获取图片
    if url:
        real_url = resolve_google_news_url(url) if "news.google.com" in url else url
        original_img = get_article_image(real_url)
        if original_img and not "logo" in original_img.lower():
            # 验证可访问
            try:
                check = requests.head(original_img, timeout=3, allow_redirects=True)
                if check.status_code == 200:
                    print(f"    ✓ 原文图片")
                    return original_img
            except:
                pass
    
    # 3. Brave Image Search（推荐）
    query = build_search_query(title)
    brave_img = search_brave_images(query)
    if brave_img:
        print(f"    ✓ Brave 搜图: {query[:30]}")
        return brave_img
    
    # 4. 尝试 Unsplash API 搜索（如果配置了 key）
    keywords = extract_keywords(title)
    if keywords and UNSPLASH_ACCESS_KEY != "your_unsplash_access_key":
        query = " ".join(keywords)
        img = search_unsplash(query)
        if img:
            print(f"    ✓ Unsplash: {query}")
            return img
    
    # 5. 使用高质量预设图片（根据内容智能匹配 + 轮换）
    img = get_fallback_image(title, index)
    print(f"    → 预设配图")
    return img


def update_news():
    """更新新闻数据"""
    print("📰 更新新闻数据...")
    
    # 获取新闻（优先澎湃，直接链接，无需解析）
    news_items = fetch_news_from_thepaper()
    if not news_items:
        print("  澎湃新闻 RSS 失败，尝试 Google News...")
        news_items = fetch_news_from_google_rss()
    
    if not news_items:
        print("⚠️ 未获取到新闻")
        return
    
    print(f"  获取到 {len(news_items)} 条新闻")
    
    # 处理新闻，添加图片和摘要
    processed = []
    for idx, item in enumerate(news_items[:5]):  # Dashboard 只显示5条
        print(f"  [{idx+1}] {item['title'][:30]}...")
        
        url = item["url"]
        title = item["title"]
        
        # === 图片保障链 ===
        # 1. RSS 自带图片（验证可访问）
        # 2. Jina Reader 抓取 og:image
        # 3. 原文页面 og:image
        # 4. Brave Image Search（推荐，相关度高）
        # 5. Unsplash API
        # 6. 预设图片轮换
        
        image = item.get("image", "")
        summary = item.get("summary", "")
        jina_data = None
        
        # 层级1: RSS 图片（验证可访问）
        if image:
            try:
                check = requests.head(image, timeout=3, allow_redirects=True)
                if check.status_code == 200:
                    print(f"    ✓ RSS 图片")
                else:
                    image = ""  # 不可访问，清空
            except:
                image = ""
        
        if not image:
            # 使用统一的配图函数（包含 Brave Search）
            jina_data = fetch_via_jina(url)
            image = find_image_for_news(item, jina_data, idx)
        
        # 摘要：优先 RSS，其次 Jina
        if not summary and jina_data:
            summary = get_article_summary(url, jina_data)
        
        if summary:
            print(f"    ✓ 摘要: {summary[:40]}...")
        
        processed.append({
            "title": title,
            "source": item["source"],
            "image": image,
            "summary": summary,
            "full_content": "",
            "url": url
        })
    
    # 生成 news.json
    now = datetime.now()
    news_data = {
        "date": now.strftime("%Y年%-m月%-d日"),
        "items": processed,
        "updated_at": now.isoformat()
    }
    
    news_file = DATA_DIR / "news.json"
    with open(news_file, "w", encoding="utf-8") as f:
        json.dump(news_data, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 已更新 {news_file}")


if __name__ == "__main__":
    update_news()
