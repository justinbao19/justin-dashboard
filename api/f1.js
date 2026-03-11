// Vercel Serverless Function - F1 赛程数据
// 数据源：OpenF1 API (免费)

// 赛道元数据（长度、圈数、弯道、最高速度等）
const CIRCUIT_META = {
  'Melbourne': { fullName: 'Albert Park Circuit', country: '🇦🇺', length: 5.278, laps: 58, turns: 14, topSpeed: 330, elevation: 3 },
  'Shanghai': { fullName: 'Shanghai International Circuit', country: '🇨🇳', length: 5.451, laps: 56, turns: 16, topSpeed: 348, elevation: 7.4 },
  'Suzuka': { fullName: 'Suzuka International Racing Course', country: '🇯🇵', length: 5.807, laps: 53, turns: 18, topSpeed: 335, elevation: 40 },
  'Sakhir': { fullName: 'Bahrain International Circuit', country: '🇧🇭', length: 5.412, laps: 57, turns: 15, topSpeed: 340, elevation: 12 },
  'Jeddah': { fullName: 'Jeddah Corniche Circuit', country: '🇸🇦', length: 6.174, laps: 50, turns: 27, topSpeed: 330, elevation: 0 },
  'Miami': { fullName: 'Miami International Autodrome', country: '🇺🇸', length: 5.412, laps: 57, turns: 19, topSpeed: 340, elevation: 2 },
  'Montreal': { fullName: 'Circuit Gilles Villeneuve', country: '🇨🇦', length: 4.361, laps: 70, turns: 14, topSpeed: 340, elevation: 13 },
  'Monte Carlo': { fullName: 'Circuit de Monaco', country: '🇲🇨', length: 3.337, laps: 78, turns: 19, topSpeed: 290, elevation: 42 },
  'Catalunya': { fullName: 'Circuit de Barcelona-Catalunya', country: '🇪🇸', length: 4.657, laps: 66, turns: 16, topSpeed: 335, elevation: 30 },
  'Spielberg': { fullName: 'Red Bull Ring', country: '🇦🇹', length: 4.318, laps: 71, turns: 10, topSpeed: 330, elevation: 700 },
  'Silverstone': { fullName: 'Silverstone Circuit', country: '🇬🇧', length: 5.891, laps: 52, turns: 18, topSpeed: 340, elevation: 150 },
  'Spa-Francorchamps': { fullName: 'Circuit de Spa-Francorchamps', country: '🇧🇪', length: 7.004, laps: 44, turns: 19, topSpeed: 350, elevation: 104 },
  'Hungaroring': { fullName: 'Hungaroring', country: '🇭🇺', length: 4.381, laps: 70, turns: 14, topSpeed: 320, elevation: 260 },
  'Zandvoort': { fullName: 'Circuit Zandvoort', country: '🇳🇱', length: 4.259, laps: 72, turns: 14, topSpeed: 320, elevation: 5 },
  'Monza': { fullName: 'Autodromo Nazionale Monza', country: '🇮🇹', length: 5.793, laps: 53, turns: 11, topSpeed: 360, elevation: 162 },
  'Baku': { fullName: 'Baku City Circuit', country: '🇦🇿', length: 6.003, laps: 51, turns: 20, topSpeed: 350, elevation: -28 },
  'Singapore': { fullName: 'Marina Bay Street Circuit', country: '🇸🇬', length: 4.940, laps: 62, turns: 19, topSpeed: 320, elevation: 0 },
  'Austin': { fullName: 'Circuit of the Americas', country: '🇺🇸', length: 5.513, laps: 56, turns: 20, topSpeed: 340, elevation: 180 },
  'Mexico City': { fullName: 'Autódromo Hermanos Rodríguez', country: '🇲🇽', length: 4.304, laps: 71, turns: 17, topSpeed: 360, elevation: 2240 },
  'Interlagos': { fullName: 'Autódromo José Carlos Pace', country: '🇧🇷', length: 4.309, laps: 71, turns: 15, topSpeed: 335, elevation: 800 },
  'Las Vegas': { fullName: 'Las Vegas Street Circuit', country: '🇺🇸', length: 6.201, laps: 50, turns: 17, topSpeed: 350, elevation: 620 },
  'Lusail': { fullName: 'Lusail International Circuit', country: '🇶🇦', length: 5.419, laps: 57, turns: 16, topSpeed: 340, elevation: 10 },
  'Yas Marina Circuit': { fullName: 'Yas Marina Circuit', country: '🇦🇪', length: 5.281, laps: 58, turns: 16, topSpeed: 335, elevation: 5 },
  'Madring': { fullName: 'Madrid Street Circuit', country: '🇪🇸', length: 5.5, laps: 56, turns: 18, topSpeed: 340, elevation: 650 },
};

// GP 名称映射
const GP_NAMES = {
  'Australia': 'Australian GP',
  'China': 'Chinese GP',
  'Japan': 'Japanese GP',
  'Bahrain': 'Bahrain GP',
  'Saudi Arabia': 'Saudi Arabian GP',
  'United States': 'Miami GP', // 需要根据城市区分
  'Canada': 'Canadian GP',
  'Monaco': 'Monaco GP',
  'Spain': 'Spanish GP',
  'Austria': 'Austrian GP',
  'United Kingdom': 'British GP',
  'Belgium': 'Belgian GP',
  'Hungary': 'Hungarian GP',
  'Netherlands': 'Dutch GP',
  'Italy': 'Italian GP',
  'Azerbaijan': 'Azerbaijan GP',
  'Singapore': 'Singapore GP',
  'Mexico': 'Mexico City GP',
  'Brazil': 'São Paulo GP',
  'Qatar': 'Qatar GP',
  'United Arab Emirates': 'Abu Dhabi GP',
};

// 根据城市返回正确的 GP 名称
function getGPName(country, location) {
  if (country === 'United States') {
    if (location.includes('Miami')) return 'Miami GP';
    if (location.includes('Austin')) return 'United States GP';
    if (location.includes('Las Vegas')) return 'Las Vegas GP';
  }
  if (country === 'Spain') {
    if (location.includes('Madrid')) return 'Madrid GP';
    return 'Spanish GP';
  }
  return GP_NAMES[country] || `${country} GP`;
}

async function fetchOpenF1Sessions(year) {
  try {
    const r = await fetch(`https://api.openf1.org/v1/sessions?year=${year}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error('OpenF1 error:', e);
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const { year = 2026, meeting } = req.query;

  try {
    const sessions = await fetchOpenF1Sessions(year);
    
    // 如果请求特定比赛的详情
    if (meeting) {
      const meetingSessions = sessions.filter(s => s.meeting_key === parseInt(meeting));
      if (meetingSessions.length === 0) {
        return res.status(404).json({ error: 'Meeting not found' });
      }

      const first = meetingSessions[0];
      const circuitMeta = CIRCUIT_META[first.circuit_short_name] || {};
      
      return res.status(200).json({
        meeting_key: first.meeting_key,
        circuit: first.circuit_short_name,
        circuit_full: circuitMeta.fullName || first.circuit_short_name,
        country: first.country_name,
        country_flag: circuitMeta.country || '',
        location: first.location,
        gp_name: getGPName(first.country_name, first.location),
        gmt_offset: first.gmt_offset,
        length_km: circuitMeta.length,
        laps: circuitMeta.laps,
        turns: circuitMeta.turns,
        top_speed_kmh: circuitMeta.topSpeed,
        elevation_m: circuitMeta.elevation,
        sessions: meetingSessions.map(s => ({
          session_key: s.session_key,
          type: s.session_type,
          name: s.session_name,
          date_start: s.date_start,
          date_end: s.date_end,
        })).sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
      });
    }

    // 返回赛历列表
    const meetings = {};
    sessions.forEach(s => {
      // 跳过测试赛
      if (s.session_name && s.session_name.includes('Day')) return;
      
      if (!meetings[s.meeting_key]) {
        const circuitMeta = CIRCUIT_META[s.circuit_short_name] || {};
        meetings[s.meeting_key] = {
          meeting_key: s.meeting_key,
          round: Object.keys(meetings).length + 1,
          circuit: s.circuit_short_name,
          country: s.country_name,
          country_flag: circuitMeta.country || '',
          location: s.location,
          gp_name: getGPName(s.country_name, s.location),
          date_start: s.date_start,
          date_end: s.date_start,
          has_sprint: false,
        };
      }
      
      // 更新日期范围
      const start = new Date(s.date_start);
      const end = new Date(s.date_end || s.date_start);
      const m = meetings[s.meeting_key];
      if (start < new Date(m.date_start)) m.date_start = s.date_start;
      if (end > new Date(m.date_end)) m.date_end = s.date_end || s.date_start;
      
      // 检查是否有冲刺赛
      if (s.session_type === 'Race' && s.session_name === 'Sprint') {
        m.has_sprint = true;
      }
    });

    // 转换为数组并按日期排序
    const calendar = Object.values(meetings)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
      .map((m, i) => ({ ...m, round: i + 1 }));

    res.status(200).json({
      year: parseInt(year),
      total_races: calendar.length,
      calendar
    });
  } catch (error) {
    console.error('F1 API error:', error);
    res.status(500).json({ error: 'Failed to fetch F1 data' });
  }
}
