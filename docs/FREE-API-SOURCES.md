# 市场数据免费 API 清单

## 7 个板块的数据源方案

### 1. ✅ VIX 恐慌指数

| 数据源 | 免费额度 | 状态 |
|--------|----------|------|
| **Finnhub** | 60次/分钟 | ✅ 你已有 Key |
| Financial Modeling Prep | 250次/天 | 需申请 |
| Twelve Data | 800次/天 | 需申请 |

**Finnhub 用法：**
```bash
# 用 CBOE VIX ETF (VIXY) 或直接 ^VIX
curl "https://finnhub.io/api/v1/quote?symbol=VIXY&token=YOUR_KEY"
```

---

### 2. ✅ Fear & Greed 恐惧贪婪指数

| 数据源 | 类型 | 状态 |
|--------|------|------|
| **Alternative.me** | Crypto F&G | ✅ 免费无限制 |
| CNN Fear & Greed | 股市 | ❌ 有反爬 |

**Alternative.me 用法（Crypto 版，但趋势相似）：**
```bash
curl "https://api.alternative.me/fng/?limit=1"
# 返回: {"value": "26", "value_classification": "Fear"}
```

**自建股市 F&G（基于公开数据计算）：**
- VIX 占比 25%
- 股价动量 占比 25%
- 新高新低比 占比 25%
- Put/Call Ratio 占比 25%

---

### 3. ✅ 美债收益率 (10Y / 2Y / 利差)

| 数据源 | 免费额度 | 状态 |
|--------|----------|------|
| **FRED API** | 无限制 | ✅ 需申请免费 Key |
| Alpha Vantage | 25次/天 | 需申请 |
| Finnhub | 60次/分钟 | ✅ 你已有 |

**FRED API 用法（推荐）：**
```bash
# 申请 Key: https://fred.stlouisfed.org/docs/api/api_key.html
# 完全免费，无调用限制

# 10年期
curl "https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=YOUR_KEY&file_type=json&limit=1&sort_order=desc"

# 2年期
curl "https://api.stlouisfed.org/fred/series/observations?series_id=DGS2&api_key=YOUR_KEY&file_type=json&limit=1&sort_order=desc"

# 利差 (10Y-2Y)
curl "https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=YOUR_KEY&file_type=json&limit=1&sort_order=desc"
```

---

### 4. ✅ 美元指数 (DXY)

| 数据源 | 免费额度 | 状态 |
|--------|----------|------|
| **Finnhub** | 60次/分钟 | ✅ 你已有 |
| Twelve Data | 800次/天 | 需申请 |

**Finnhub 用法：**
```bash
# 用 UUP (美元指数 ETF) 代替 DXY
curl "https://finnhub.io/api/v1/quote?symbol=UUP&token=YOUR_KEY"
```

---

### 5. ⚠️ 关键事件日历

| 数据源 | 免费额度 | 状态 |
|--------|----------|------|
| **Finnhub Economic Calendar** | 60次/分钟 | ✅ 你已有 |
| Trading Economics | 付费 | ❌ |
| 手动维护 JSON | 免费 | ✅ |

**Finnhub 用法：**
```bash
curl "https://finnhub.io/api/v1/calendar/economic?from=2026-03-18&to=2026-03-25&token=YOUR_KEY"
```

---

### 6. ✅ 资金流向

**A股北向资金（新浪免费）：**
```bash
# 沪股通+深股通 实时净流入
curl "https://hq.sinajs.cn/list=sh000001" | iconv -f gbk -t utf-8
# 或用东方财富接口
```

**ETF 资金流向（需爬取或付费）：**
- ETF.com / ETFdb.com 有数据但无 API
- 替代方案：用 ETF 成交量变化推断

---

### 7. ⚠️ 板块热力图

| 数据源 | 免费额度 | 状态 |
|--------|----------|------|
| Finviz | 爬取 | ⚠️ 可能被封 |
| **Finnhub Sector Performance** | 60次/分钟 | ✅ |
| 新浪行业板块 | 免费 | ✅ |

**Finnhub 用法：**
```bash
# 美股板块
curl "https://finnhub.io/api/v1/stock/sector-performance?token=YOUR_KEY"
```

**新浪行业板块（A股）：**
```bash
curl "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_bkzj_bk?page=1&num=10&sort=netamount&asc=0&fenlei=1"
```

---

## 总结：推荐方案

| 板块 | 推荐数据源 | 是否需要新 Key |
|------|------------|----------------|
| VIX | Finnhub | ❌ 已有 |
| Fear & Greed | Alternative.me | ❌ 免费 |
| 美债收益率 | FRED | ✅ 需申请（免费） |
| 美元指数 | Finnhub (UUP) | ❌ 已有 |
| 事件日历 | Finnhub | ❌ 已有 |
| 北向资金 | 新浪 | ❌ 免费 |
| 板块热力图 | Finnhub + 新浪 | ❌ 已有 |

**唯一需要申请的**：FRED API Key（完全免费，无限制）

申请地址：https://fred.stlouisfed.org/docs/api/api_key.html

---

## API Keys 汇总

```
Finnhub: d6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg (已有)
FRED: (待申请)
```
