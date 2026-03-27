// 市场情绪与宏观指标 API
// 数据源: Finnhub, FRED, Alternative.me, ForexFactory

const FINNHUB_KEY = 'd6n1ec1r01qir35irdl0d6n1ec1r01qir35irdlg';
const FRED_KEY = '492b3e5ebbb736ee9b8c1b05cf4031f1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const [vix, fearGreed, treasury10Y, treasury2Y, spread, dxy, events] = await Promise.all([
      // 1. VIX (via VIXY ETF)
      fetch(`https://finnhub.io/api/v1/quote?symbol=VIXY&token=${FINNHUB_KEY}`)
        .then(r => r.json())
        .catch(() => ({})),
      
      // 2. Fear & Greed (Crypto, 但趋势类似)
      fetch('https://api.alternative.me/fng/?limit=1')
        .then(r => r.json())
        .then(d => d.data?.[0] || {})
        .catch(() => ({})),
      
      // 3. 10Y Treasury
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${FRED_KEY}&file_type=json&limit=5&sort_order=desc`)
        .then(r => r.json())
        .then(d => d.observations || [])
        .catch(() => []),
      
      // 4. 2Y Treasury
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS2&api_key=${FRED_KEY}&file_type=json&limit=5&sort_order=desc`)
        .then(r => r.json())
        .then(d => d.observations || [])
        .catch(() => []),
      
      // 5. 10Y-2Y Spread
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key=${FRED_KEY}&file_type=json&limit=30&sort_order=desc`)
        .then(r => r.json())
        .then(d => d.observations || [])
        .catch(() => []),
      
      // 6. DXY (via UUP ETF)
      fetch(`https://finnhub.io/api/v1/quote?symbol=UUP&token=${FINNHUB_KEY}`)
        .then(r => r.json())
        .catch(() => ({})),
      
      // 7. Economic Calendar (ForexFactory 免费 API)
      fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json')
        .then(r => r.json())
        .catch(() => [])
    ]);

    // 计算 VIX 等级
    const vixValue = vix.c || 0;
    const vixLevel = vixValue > 30 ? 'extreme' : vixValue > 20 ? 'elevated' : 'normal';
    
    // Fear & Greed 等级
    const fgValue = parseInt(fearGreed.value) || 50;
    const fgLevel = fgValue <= 25 ? 'extreme_fear' : fgValue <= 45 ? 'fear' : fgValue <= 55 ? 'neutral' : fgValue <= 75 ? 'greed' : 'extreme_greed';

    // 利差倒挂检测
    const spreadValue = parseFloat(spread[0]?.value) || 0;
    const isInverted = spreadValue < 0;
    
      // 事件中文本地化映射
  const EVENT_I18N = {
    'CPI': {
      cn: 'CPI 消费者物价指数',
      desc: '衡量一篮子消费品和服务的价格变动，是最直接的通胀指标。高于预期 → 市场担忧 Fed 维持或加息，美债收益率上升，股市承压；低于预期 → 降息预期升温，股市通常反弹。'
    },
    'NFP': {
      cn: '非农就业数据',
      desc: '美国每月新增非农就业人数，反映劳动力市场强弱。数字强劲 → 经济健康但通胀风险上升，Fed 降息推迟；数字疲软 → 衰退担忧，市场波动加剧。是影响 Fed 政策的核心数据之一。'
    },
    'FOMC': {
      cn: 'FOMC 利率决议',
      desc: '美联储公开市场委员会的利率决定会议，每年8次。决定美国基准利率走向，直接影响全球资金成本。加息 → 美元走强、债券收益率上升、高估值股票承压；降息 → 风险资产通常上涨。'
    },
    'Fed': {
      cn: 'Fed 发言',
      desc: '美联储主席或官员的公开讲话。市场高度关注措辞中的鹰派（偏紧缩）或鸽派（偏宽松）信号，往往引发债券和股市的短期波动。'
    },
    'PCE': {
      cn: 'PCE 个人消费支出物价',
      desc: 'Fed 最偏爱的通胀指标（相比 CPI 覆盖更广）。Fed 的通胀目标就是以 PCE 为基准（目标 2%）。PCE 超预期 → 降息推迟，资产价格承压；低于预期 → 降息概率上升。'
    },
    'GDP': {
      cn: 'GDP 国内生产总值',
      desc: '衡量经济整体产出。连续两季度负增长即为衰退。初值影响最大；低于预期可能引发衰退担忧，带动避险情绪，黄金、债券上涨；高于预期可能推迟降息预期。'
    },
    'Retail Sales': {
      cn: '零售销售数据',
      desc: '美国零售消费额月度变动，反映消费者支出强弱（消费占 GDP 约 70%）。数据强 → 经济韧性强，但可能推迟降息；数据弱 → 衰退风险上升，市场可能抢跑降息预期。'
    },
    'Unemployment': {
      cn: '失业率',
      desc: '美国劳动力市场健康状况的关键指标。低失业率 = 经济强劲但工资通胀风险；高失业率 = 经济放缓，Fed 有降息空间。通常配合非农数据一起解读。'
    },
    'Interest Rate': {
      cn: '利率决议',
      desc: '央行对基准利率的调整决定。利率影响借贷成本和资金流向。加息周期 → 债券收益率上升、美元走强、成长股承压；降息周期 → 流动性宽松、风险资产受益。'
    },
    'PPI': {
      cn: 'PPI 生产者物价指数',
      desc: '衡量生产端的价格变动，是 CPI 的领先指标。PPI 上升 → 企业成本增加，未来 CPI 可能跟涨；市场通过 PPI 提前预判通胀走势。'
    },
    'ISM': {
      cn: 'ISM 采购经理人指数',
      desc: '反映制造业或服务业的扩张/收缩状况。50 以上为扩张，以下为收缩。是经济领先指标，对市场情绪有即时影响，数据低迷往往引发衰退担忧。'
    },
    'Durable Goods': {
      cn: '耐用品订单',
      desc: '使用寿命超过3年的商品订单量，反映企业资本支出意愿。订单增加 → 企业对未来乐观，经济有动力；订单下降 → 企业收缩投资，经济预期转弱。'
    },
    'Housing': {
      cn: '房屋数据',
      desc: '包括新屋开工、成屋销售等指标，是利率敏感型经济领域。利率上升 → 房贷成本增加，房市降温；利率下降 → 房市回暖。也是消费信心的晴雨表。'
    },
    'Trade Balance': {
      cn: '贸易差额',
      desc: '出口减去进口的差值。贸易逆差扩大可能拖累 GDP；在贸易战背景下，这一数据对市场影响尤其显著，也影响美元汇率走势。'
    },
    'Consumer Confidence': {
      cn: '消费者信心指数',
      desc: '反映消费者对当前经济状况和未来前景的信心。高信心 → 消费支出有望增加，经济向好；低信心 → 消费者捂紧钱包，经济下行风险上升。'
    }
  };

  // 匹配事件中文信息
  function getEventI18n(title) {
    for (const [key, val] of Object.entries(EVENT_I18N)) {
      if (title?.includes(key)) return val;
    }
    return null;
  }

  // 过滤重要事件 (Medium/High impact, 主要关注 USD)
    const seenEvents = new Set();
    const importantEvents = events
      .filter(e => {
        const isHighImpact = e.impact === 'High' || e.impact === 'Medium';
        const isUSD = e.country === 'USD';
        const isKeyEvent = Object.keys(EVENT_I18N).some(k => e.title?.includes(k));
        return (isHighImpact && isUSD) || isKeyEvent;
      })
      .filter(e => {
        // 去重：按标题+日期去重
        const key = `${e.title}_${e.date?.split('T')[0] || ''}`;
        if (seenEvents.has(key)) return false;
        seenEvents.add(key);
        return true;
      })
      .slice(0, 8);

    res.status(200).json({
      updated_at: new Date().toISOString(),
      
      vix: {
        value: vixValue,
        change: vix.dp || 0,
        level: vixLevel,
        label: vixLevel === 'extreme' ? '恐慌' : vixLevel === 'elevated' ? '警惕' : '平稳'
      },
      
      fear_greed: {
        value: fgValue,
        level: fgLevel,
        label: fearGreed.value_classification || 'Neutral',
        timestamp: fearGreed.timestamp
      },
      
      treasury: {
        y10: parseFloat(treasury10Y[0]?.value) || 0,
        y2: parseFloat(treasury2Y[0]?.value) || 0,
        spread: spreadValue,
        inverted: isInverted,
        spread_history: spread.slice(0, 14).map(d => parseFloat(d.value) || 0).reverse()
      },
      
      dxy: {
        value: dxy.c || 0,
        change: dxy.dp || 0,
        label: 'UUP ETF'
      },
      
      events: importantEvents.map(e => {
        const i18n = getEventI18n(e.title);
        return {
          date: e.date?.split('T')[0] || '',
          time: e.date?.split('T')[1]?.slice(0, 5) || '',
          event: e.title,
          event_cn: i18n?.cn || e.title,
          description: i18n?.desc || '',
          country: e.country === 'USD' ? 'US' : e.country,
          impact: e.impact === 'High' ? 3 : e.impact === 'Medium' ? 2 : 1,
          forecast: e.forecast,
          previous: e.previous
        };
      })
    });
  } catch (error) {
    console.error('Sentiment API error:', error);
    res.status(500).json({ error: error.message });
  }
}

// getMonday/getSunday no longer needed - ForexFactory returns thisweek automatically
