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
    
    // 过滤重要事件 (Medium/High impact, 主要关注 USD)
    const importantEvents = events
      .filter(e => {
        const isHighImpact = e.impact === 'High' || e.impact === 'Medium';
        const isUSD = e.country === 'USD';
        const isKeyEvent = ['FOMC', 'CPI', 'NFP', 'GDP', 'Fed', 'PCE', 'Retail Sales', 'Unemployment', 'Interest Rate'].some(k => e.title?.includes(k));
        return (isHighImpact && isUSD) || isKeyEvent;
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
      
      events: importantEvents.map(e => ({
        date: e.date?.split('T')[0] || '',
        time: e.date?.split('T')[1]?.slice(0, 5) || '',
        event: e.title,
        country: e.country === 'USD' ? 'US' : e.country,
        impact: e.impact === 'High' ? 3 : e.impact === 'Medium' ? 2 : 1,
        forecast: e.forecast,
        previous: e.previous
      }))
    });
  } catch (error) {
    console.error('Sentiment API error:', error);
    res.status(500).json({ error: error.message });
  }
}

// getMonday/getSunday no longer needed - ForexFactory returns thisweek automatically
