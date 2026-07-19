# Pulse

个人信息仪表盘，集成天气、市场行情、新闻资讯等模块。

**线上地址**: https://justin-pulse.vercel.app

## 功能模块

### 🌤️ 天气
- 实时天气（彩云天气 API）
- 逐小时 / 逐日预报
- 空气质量 / 生活指数
- 日出、日落、月相与降水窗口（QWeather 可选增强）
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
- 天气 → `/api/weather` → 彩云天气 API；配置 QWeather 凭据后自动附加真实月相、月升与月落
- 市场价格 → `/api/market` → Finnhub + 新浪 + CoinGecko

### 静态数据（定时自动更新）
- 市场分析/建议 → `data/market.json`
- 新闻 → `data/news.json`

## 云端调度

项目现在采用 GitHub Actions 作为主调度器，尽量把“内容生成”和“消息分发”从本地机器迁出去。

### Pulse Briefing

- 文件: `.github/workflows/dashboard-briefing.yml`
- 定时: 每天北京时间 `08:20` 和 `22:50`
- 流程:
  1. 更新 `data/market.json` 的行情快照
  2. 更新 `data/news.json` 的新闻与配图
  3. 调用兼容 OpenAI 的 LLM API 生成市场分析字段
  4. 校验 JSON 与图片
  5. 提交数据变更回仓库

### F1 Standings Refresh

- 文件: `.github/workflows/f1-standings.yml`
- 定时: 比赛窗口自动跑；周六/周日赛后多次同步，周一北京时间 `00:20`、`03:20`、`06:20`、`08:20`、`09:20` 兜底
- 手动: 支持 `workflow_dispatch`
- 流程:
  1. 从 formula1.com 自动发现 2026 最新已完赛分站
  2. 更新 `index.html` 内的 `RACE_RESULTS_2026`、`DRIVER_STANDINGS`、`TEAM_STANDINGS`
  3. 跑 deploy guard 和 Vercel build 校验
  4. 有变化时自动提交并 push，触发 Vercel 部署

相关脚本:

- `scripts/update_market.py`
- `scripts/update_news.py`
- `scripts/generate_market_analysis.py`
- `scripts/update_f1_standings.py`
- `scripts/send_telegram_briefing.py`
- `scripts/send_wechat_briefing.py`
- `scripts/briefing_content.py`

### 为什么不用本地 cron 作为主入口

- 笔记本休眠、断网、关机时，本地任务会停
- Pulse 数据更新和消息推送会一起失效
- GitHub Actions 更适合定时抓取、生成、提交和 Telegram 分发

### 微信现状

微信当前仍通过本地 OpenClaw 会话发送，因为 `openclaw-weixin` 发送协议依赖会话 `contextToken`。  
现在已经把内容生成迁到云端可独立运行；微信只保留为“本地最薄转发层”，默认读取线上 Pulse 最新 `data/*.json`，不再承担内容抓取和分析职责。

## 本地开发

```bash
# 安装 Vercel CLI
npm i -g vercel

# 本地运行（支持 Serverless Functions）
vercel dev

# 部署到生产
vercel --prod
```

## GitHub Secrets

GitHub Actions / 云端运行依赖以下 secrets：

| Secret | 用途 |
|------|------|
| `FINNHUB_KEY` | 市场数据抓取 |
| `BRAVE_API_KEY` | 新闻图片搜索与校验 |
| `LLM_API_KEY` | 市场分析生成 |
| `LLM_BASE_URL` | 兼容 OpenAI 的模型网关地址 |
| `LLM_MODEL` | 分析使用的模型名 |
| `TELEGRAM_BOT_TOKEN` | Telegram 推送 |
| `TELEGRAM_CHAT_ID` | Telegram 目标群/聊天 |
| `TELEGRAM_THREAD_ID` | Telegram Topic/线程，可选 |

## Telegram Mini App

已配置为 Telegram Bot 的 Menu Button，可直接在 Telegram 内打开。

## 待办

- [ ] 航班监控模块
- [ ] FlightLog 集成
- [ ] 新闻自动抓取
- [ ] PWA 支持
