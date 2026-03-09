# Justin Dashboard

个人信息仪表盘，集成天气、市场行情、新闻资讯等模块。

**线上地址**: https://justinbao-dashboard.vercel.app

## 功能模块

### 🌤️ 天气
- 实时天气（彩云天气 API）
- 逐小时 / 逐日预报
- 空气质量 / 生活指数
- 动态背景（晴/云/雨/夜）

### 📊 市场行情
- 美股：标普500 / 纳斯达克 / 道琼斯（Finnhub API）
- 港股：恒生指数 / 恒生科技（新浪财经）
- A股：上证指数（新浪财经）
- 商品：黄金 / 原油（Finnhub ETF）
- 加密货币：BTC / ETH（CoinGecko API）
- 详细市场分析 + 操作建议

### 📰 新闻
- 今日要闻摘要
- 配图展示
- 展开全文

## 技术栈

- **前端**: 纯 HTML/CSS/JS（无框架）
- **托管**: Vercel
- **API 代理**: Vercel Serverless Functions

## 项目结构

```
justin-dashboard/
├── index.html          # 主页面（所有前端代码）
├── api/
│   ├── weather.js      # 天气 API 代理（彩云）
│   └── market.js       # 市场 API 代理（Finnhub + 新浪 + CoinGecko）
├── data/
│   ├── market.json     # 市场分析数据（静态，含 analysis/advice）
│   └── news.json       # 新闻数据（静态）
└── scripts/
    └── update_market.py  # 本地市场数据更新脚本
```

## 数据流

### 实时数据（每次打开页面获取）
- 天气 → `/api/weather` → 彩云天气 API
- 市场价格 → `/api/market` → Finnhub + 新浪 + CoinGecko

### 静态数据（需手动更新）
- 市场分析/建议 → `data/market.json`
- 新闻 → `data/news.json`

## 本地开发

```bash
# 安装 Vercel CLI
npm i -g vercel

# 本地运行（支持 Serverless Functions）
vercel dev

# 部署到生产
vercel --prod
```

## API Keys（已配置在代码中）

| 服务 | 用途 | 限制 |
|------|------|------|
| 彩云天气 | 天气数据 | 免费版 |
| Finnhub | 美股数据 | 60 calls/min |
| CoinGecko | 加密货币 | 免费无限制 |
| 新浪财经 | 港股/A股 | 免费无限制 |

## Telegram Mini App

已配置为 Telegram Bot 的 Menu Button，可直接在 Telegram 内打开。

## 待办

- [ ] 航班监控模块
- [ ] FlightLog 集成
- [ ] 新闻自动抓取
- [ ] PWA 支持
