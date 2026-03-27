# Dashboard 数据更新规范

## ⚠️ 重要：JSON 验证规则

**写入任何 JSON 文件后，必须立即验证！**

```bash
cd ~/Projects/justin-dashboard
python3 scripts/validate-json.py data/market.json data/news.json
```

### 常见问题

| 问题 | 原因 | 预防 |
|------|------|------|
| 中文引号 `"..."` | 复制粘贴或 AI 生成 | 用 `「...」` 替代 |
| 缺少逗号 | 手动编辑遗漏 | 运行验证脚本 |
| 尾部逗号 | 数组/对象最后一项多余逗号 | 运行验证脚本 |

### 安全写入流程

1. 生成 JSON 内容
2. **写入文件前**：用 Python `json.dumps()` 确保格式正确
3. **写入文件后**：运行 `validate-json.py` 验证
4. 验证通过后再 `git commit`

### 示例：安全更新 market.json

```python
import json

data = {
    "date": "2026-03-28",
    "ndx": {"price": "21,500", "change": 0.5},
    # ... 其他数据
}

# 安全写入
with open("data/market.json", "w") as f:
    json.dump(data, ensure_ascii=False, indent=2, fp=f)
```

### 自动修复

如果 JSON 损坏，验证脚本会尝试自动修复：
- 中文引号 `""` → `「」`
- 中文单引号 `''` → `『』`

修复后会自动格式化并写回文件。

---

## 新闻图片规则

1. **不要使用编造的 URL** — 必须验证图片可访问
2. **优先使用 Brave Image Search** — 搜索后验证 200
3. **验证命令**：
   ```bash
   curl -sI "IMAGE_URL" | head -1  # 应返回 HTTP/2 200
   ```

## 数据文件

| 文件 | 内容 | 更新频率 |
|------|------|----------|
| `data/market.json` | 市场数据 + 分析 | 每日 2 次 |
| `data/news.json` | 国际新闻 | 每日 2 次 |
| `data/trading.json` | 交易信号 | 实时 |
