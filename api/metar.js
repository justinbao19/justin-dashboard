// Vercel Serverless Function - METAR 数据代理
// 数据源: Aviation Weather Center (aviationweather.gov)

const AWC_BASE = 'https://aviationweather.gov/api/data/metar';
const UA = 'JustinDashboard/1.0';

// 天气现象代码
const WEATHER_CODES = {
  '+': '强', '-': '弱', 'VC': '附近',
  'MI': '浅薄', 'PR': '部分', 'BC': '散片', 'DR': '低吹', 'BL': '高吹',
  'SH': '阵性', 'TS': '雷暴', 'FZ': '冻',
  'RA': '雨', 'DZ': '毛毛雨', 'SN': '雪', 'GR': '冰雹', 'GS': '小冰雹',
  'IC': '冰晶', 'PL': '冰粒', 'SG': '雪粒', 'UP': '未知降水',
  'BR': '轻雾', 'FG': '雾', 'FU': '烟', 'VA': '火山灰',
  'DU': '浮尘', 'SA': '沙', 'HZ': '霾', 'PY': '水雾',
  'PO': '尘卷', 'SQ': '飑', 'FC': '漏斗云', 'SS': '沙暴', 'DS': '尘暴'
};

const CLOUD_CODES = {
  'FEW': '少云', 'SCT': '疏云', 'BKN': '多云', 'OVC': '阴天',
  'CLR': '晴', 'SKC': '晴', 'NSC': '无重要云', 'NCD': '无云', 'CAVOK': '能见度好'
};

function decodeMetar(raw) {
  if (!raw || raw.length < 10) return null;
  
  try {
    const parts = raw.split(' ');
    // METAR 格式: "METAR ZSSS..." 或 "ZSSS..."
    const stationIdx = parts[0] === 'METAR' ? 1 : 0;
    const result = {
      station: parts[stationIdx],
      time: '',
      wind: '',
      visibility: '',
      weather: '',
      clouds: '',
      temperature: '',
      dewpoint: '',
      pressure: '',
      remarks: ''
    };
    
    // 时间 (DDHHMMz)
    const timeMatch = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
    if (timeMatch) {
      result.time = `${timeMatch[2]}:${timeMatch[3]}Z`;
    }
    
    // 风 (dddssKT 或 dddssGggKT)
    const windMatch = raw.match(/\b(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)\b/);
    if (windMatch) {
      const dir = windMatch[1] === 'VRB' ? '不定' : `${windMatch[1]}°`;
      const speed = windMatch[2];
      const unit = windMatch[5] === 'MPS' ? 'm/s' : 'kt';
      result.wind = `${dir} ${speed}${unit}`;
      if (windMatch[4]) result.wind += ` 阵风${windMatch[4]}${unit}`;
    } else if (raw.includes('00000')) {
      result.wind = '静风';
    }
    
    // CAVOK
    if (raw.includes('CAVOK')) {
      result.visibility = '>10km';
      result.clouds = '能见度好';
    } else {
      // 能见度
      const visMatch = raw.match(/\b(\d{4})\b/);
      if (visMatch) {
        const vis = parseInt(visMatch[1]);
        result.visibility = vis >= 9999 ? '>10km' : `${vis}m`;
      }
      
      // 云
      const cloudMatches = raw.matchAll(/(FEW|SCT|BKN|OVC|CLR|SKC|NSC)(\d{3})?/g);
      const clouds = [];
      for (const m of cloudMatches) {
        const type = CLOUD_CODES[m[1]] || m[1];
        if (m[2]) {
          clouds.push(`${type}${parseInt(m[2]) * 100}ft`);
        } else {
          clouds.push(type);
        }
      }
      result.clouds = clouds.join(' ') || '晴';
    }
    
    // 天气现象
    const wxMatch = raw.match(/\s([+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:RA|DZ|SN|GR|GS|IC|PL|SG|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)\s/);
    if (wxMatch) {
      let wx = wxMatch[1];
      for (const [code, text] of Object.entries(WEATHER_CODES)) {
        wx = wx.replace(code, text);
      }
      result.weather = wx;
    }
    
    // 温度/露点
    const tempMatch = raw.match(/\b(M?\d{2})\/(M?\d{2})\b/);
    if (tempMatch) {
      result.temperature = tempMatch[1].replace('M', '-') + '°C';
      result.dewpoint = tempMatch[2].replace('M', '-') + '°C';
    }
    
    // 气压
    const qnhMatch = raw.match(/Q(\d{4})/);
    if (qnhMatch) {
      result.pressure = qnhMatch[1] + ' hPa';
    }
    
    // NOSIG/TEMPO 等
    if (raw.includes('NOSIG')) result.remarks = '无显著变化';
    else if (raw.includes('TEMPO')) result.remarks = '有临时变化';
    else if (raw.includes('BECMG')) result.remarks = '逐渐变化';
    
    return result;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 缓存5分钟
  
  const { stations = 'ZSSS,ZSPD' } = req.query;
  
  try {
    const url = `${AWC_BASE}?ids=${stations}&format=raw`;
    const response = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      throw new Error(`AWC returned ${response.status}`);
    }
    
    const text = (await response.text()).trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    const result = {};
    for (const line of lines) {
      // METAR 格式: "METAR ZSSS 091330Z..." 或 "ZSSS 091330Z..."
      const parts = line.split(' ');
      const station = parts[0] === 'METAR' ? parts[1] : parts[0];
      if (station && station.length === 4) {
        result[station] = {
          raw: line,
          decoded: decodeMetar(line),
          fetchedAt: new Date().toISOString()
        };
      }
    }
    
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch METAR data' });
  }
}
