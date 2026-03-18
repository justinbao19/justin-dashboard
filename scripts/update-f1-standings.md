# F1 积分榜更新指南

## 更新时机
- 每个比赛周末的**周日正赛结束后**（通常是比赛日 UTC 时间晚上）
- 如果有冲刺赛，冲刺赛后也需要更新

## 2026 赛历（已知）
| R | 日期 | 大奖赛 | 备注 |
|---|------|--------|------|
| 1 | 3月8-9日 | 澳大利亚 | ✅ 已完成 |
| 2 | 3月14-16日 | 中国 (冲刺) | ✅ 已完成 |
| 3 | 4月12日 | ~~沙特~~ | ❌ 取消（中东冲突）|
| 4 | 4月19日 | ~~巴林~~ | ❌ 取消（中东冲突）|
| 5 | 4月26-27日 | 日本 | 待更新 |
| ... | ... | ... | ... |

## 更新步骤

### 1. 获取最新积分榜
搜索关键词：
- `F1 2026 driver standings after [GP名称]`
- `F1 2026 constructor standings [GP名称]`

### 2. 更新 index.html 中的数据

**车手积分榜** (`DRIVER_STANDINGS`):
```javascript
const DRIVER_STANDINGS = [
    { pos: 1, name: 'George Russell', team: 'Mercedes', teamId: 'mercedes', driverCode: 'georus01', color: '27F4D2', points: 51, nat: 'GBR' },
    // ...
];
```

**车队积分榜** (`TEAM_STANDINGS`):
```javascript
const TEAM_STANDINGS = [
    { pos: 1, name: 'Mercedes', color: '27F4D2', points: 98 },
    // ...
];
```

**分站成绩** (`RACE_RESULTS_2026`):
```javascript
const RACE_RESULTS_2026 = {
    'georus01': [
        { round: 1, race: '澳大利亚', flag: '🇦🇺', qual: 1, sprint: null, result: 1, points: 25 },
        { round: 2, race: '中国', flag: '🇨🇳', qual: 2, sprint: 1, result: 2, points: 26 },
        // 添加新分站...
    ],
    // ...
};
```

### 3. 提交并推送
```bash
cd ~/projects/justin-dashboard
git add -A
git commit -m "Update F1 standings after [GP名称] (R[轮次])"
git push
```

## 数据来源
- F1 官网: https://www.formula1.com/en/results/2026/drivers
- RacingNews365: https://racingnews365.com
- Motorsport.com

## 车手代码参考
| 车手 | driverCode | teamId |
|------|------------|--------|
| George Russell | georus01 | mercedes |
| Kimi Antonelli | andant01 | mercedes |
| Charles Leclerc | chalec01 | ferrari |
| Lewis Hamilton | lewham01 | ferrari |
| Oliver Bearman | olibea01 | haasf1team |
| Lando Norris | lannor01 | mclaren |
| Oscar Piastri | oscpia01 | mclaren |
| Max Verstappen | maxver01 | redbullracing |
| Liam Lawson | lialaw01 | redbullracing |
| Yuki Tsunoda | yuktsu01 | racingbulls |

## 国旗 Emoji
🇦🇺 澳大利亚 | 🇨🇳 中国 | 🇯🇵 日本 | 🇧🇭 巴林 | 🇸🇦 沙特
🇲🇨 摩纳哥 | 🇪🇸 西班牙 | 🇬🇧 英国 | 🇧🇪 比利时 | 🇮🇹 意大利
🇳🇱 荷兰 | 🇦🇹 奥地利 | 🇭🇺 匈牙利 | 🇸🇬 新加坡 | 🇺🇸 美国
🇲🇽 墨西哥 | 🇧🇷 巴西 | 🇶🇦 卡塔尔 | 🇦🇪 阿联酋
