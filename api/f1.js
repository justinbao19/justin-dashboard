// Vercel Serverless Function - F1 赛程数据
// 主源：OpenF1；直播锁流/401 时回退 Jolpica (Ergast-compatible)

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
  'Barcelona': { fullName: 'Circuit de Barcelona-Catalunya', country: '🇪🇸', length: 4.657, laps: 66, turns: 16, topSpeed: 335, elevation: 30 },
  'Spielberg': { fullName: 'Red Bull Ring', country: '🇦🇹', length: 4.318, laps: 71, turns: 10, topSpeed: 330, elevation: 700 },
  'Silverstone': { fullName: 'Silverstone Circuit', country: '🇬🇧', length: 5.891, laps: 52, turns: 18, topSpeed: 340, elevation: 150 },
  'Spa-Francorchamps': { fullName: 'Circuit de Spa-Francorchamps', country: '🇧🇪', length: 7.004, laps: 44, turns: 19, topSpeed: 350, elevation: 104 },
  'Spa': { fullName: 'Circuit de Spa-Francorchamps', country: '🇧🇪', length: 7.004, laps: 44, turns: 19, topSpeed: 350, elevation: 104 },
  'Hungaroring': { fullName: 'Hungaroring', country: '🇭🇺', length: 4.381, laps: 70, turns: 14, topSpeed: 320, elevation: 260 },
  'Budapest': { fullName: 'Hungaroring', country: '🇭🇺', length: 4.381, laps: 70, turns: 14, topSpeed: 320, elevation: 260 },
  'Zandvoort': { fullName: 'Circuit Zandvoort', country: '🇳🇱', length: 4.259, laps: 72, turns: 14, topSpeed: 320, elevation: 5 },
  'Monza': { fullName: 'Autodromo Nazionale Monza', country: '🇮🇹', length: 5.793, laps: 53, turns: 11, topSpeed: 360, elevation: 162 },
  'Baku': { fullName: 'Baku City Circuit', country: '🇦🇿', length: 6.003, laps: 51, turns: 20, topSpeed: 350, elevation: -28 },
  'Singapore': { fullName: 'Marina Bay Street Circuit', country: '🇸🇬', length: 4.940, laps: 62, turns: 19, topSpeed: 320, elevation: 0 },
  'Marina Bay': { fullName: 'Marina Bay Street Circuit', country: '🇸🇬', length: 4.940, laps: 62, turns: 19, topSpeed: 320, elevation: 0 },
  'Austin': { fullName: 'Circuit of the Americas', country: '🇺🇸', length: 5.513, laps: 56, turns: 20, topSpeed: 340, elevation: 180 },
  'Mexico City': { fullName: 'Autódromo Hermanos Rodríguez', country: '🇲🇽', length: 4.304, laps: 71, turns: 17, topSpeed: 360, elevation: 2240 },
  'Interlagos': { fullName: 'Autódromo José Carlos Pace', country: '🇧🇷', length: 4.309, laps: 71, turns: 15, topSpeed: 335, elevation: 800 },
  'São Paulo': { fullName: 'Autódromo José Carlos Pace', country: '🇧🇷', length: 4.309, laps: 71, turns: 15, topSpeed: 335, elevation: 800 },
  'Las Vegas': { fullName: 'Las Vegas Street Circuit', country: '🇺🇸', length: 6.201, laps: 50, turns: 17, topSpeed: 350, elevation: 620 },
  'Lusail': { fullName: 'Lusail International Circuit', country: '🇶🇦', length: 5.419, laps: 57, turns: 16, topSpeed: 340, elevation: 10 },
  'Yas Marina Circuit': { fullName: 'Yas Marina Circuit', country: '🇦🇪', length: 5.281, laps: 58, turns: 16, topSpeed: 335, elevation: 5 },
  'Abu Dhabi': { fullName: 'Yas Marina Circuit', country: '🇦🇪', length: 5.281, laps: 58, turns: 16, topSpeed: 335, elevation: 5 },
  'Madring': { fullName: 'Madrid Street Circuit', country: '🇪🇸', length: 5.5, laps: 56, turns: 18, topSpeed: 340, elevation: 650 },
  'Madrid': { fullName: 'Madrid Street Circuit', country: '🇪🇸', length: 5.5, laps: 56, turns: 18, topSpeed: 340, elevation: 650 },
  'Kuala Lumpur': { fullName: 'Sepang International Circuit', country: '🇲🇾', length: 5.543, laps: 56, turns: 15, topSpeed: 330, elevation: 50 },
};

const GP_NAMES = {
  'Australia': 'Australian GP',
  'China': 'Chinese GP',
  'Japan': 'Japanese GP',
  'Bahrain': 'Bahrain GP',
  'Saudi Arabia': 'Saudi Arabian GP',
  'United States': 'Miami GP',
  'USA': 'United States GP',
  'Canada': 'Canadian GP',
  'Monaco': 'Monaco GP',
  'Spain': 'Spanish GP',
  'Austria': 'Austrian GP',
  'United Kingdom': 'British GP',
  'UK': 'British GP',
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
  'UAE': 'Abu Dhabi GP',
  'Malaysia': 'Bahrain GP',
};

const DRIVER_HEADSHOT_OVERRIDES = {
  34: 'https://media.formula1.com/image/upload/c_lfill,w_256/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000000/common/f1/2026/astonmartin/jakcra01/2026astonmartinjakcra01right.webp',
  41: 'https://media.formula1.com/image/upload/c_lfill,w_256/q_auto/d_common:f1:2026:fallback:driver:2026fallbackdriverright.webp/v1740000000/common/f1/2026/racingbulls/arvlin01/2026racingbullsarvlin01right.webp',
};

const SESSION_DURATIONS_MIN = {
  'Practice 1': 60,
  'Practice 2': 60,
  'Practice 3': 60,
  'Sprint Qualifying': 45,
  'Sprint': 45,
  'Qualifying': 60,
  'Race': 130,
};

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';

function getGPName(country, location = '', raceName = '') {
  const loc = location || '';
  if (country === 'United States' || country === 'USA') {
    if (loc.includes('Miami')) return 'Miami GP';
    if (loc.includes('Austin')) return 'United States GP';
    if (loc.includes('Las Vegas')) return 'Las Vegas GP';
  }
  if (country === 'Spain') {
    if (loc.includes('Madrid')) return 'Madrid GP';
    return 'Spanish GP';
  }
  if (raceName) {
    const cleaned = raceName.replace(/Grand Prix.*/i, 'GP').replace(/\s+/g, ' ').trim();
    if (cleaned && cleaned !== 'GP') return cleaned.includes('GP') ? cleaned : `${cleaned} GP`;
  }
  return GP_NAMES[country] || `${country} GP`;
}

function circuitLookup(...keys) {
  for (const key of keys) {
    if (!key) continue;
    if (CIRCUIT_META[key]) return CIRCUIT_META[key];
    const hit = Object.keys(CIRCUIT_META).find(k => key.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(key.toLowerCase()));
    if (hit) return CIRCUIT_META[hit];
  }
  return {};
}

function toIso(date, time) {
  if (!date) return null;
  const t = time || '12:00:00Z';
  return new Date(`${date}T${t.replace(/Z?$/, 'Z')}`).toISOString();
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

function parseClockToSeconds(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (!text || text.startsWith('+') || /lap/i.test(text)) return null;
  const parts = text.split(':').map(Number);
  if (parts.some(n => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

async function fetchJson(url, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'JustinPulse/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenF1Sessions(year) {
  try {
    return await fetchJson(`https://api.openf1.org/v1/sessions?year=${encodeURIComponent(year)}`);
  } catch (error) {
    console.error('OpenF1 sessions error:', error?.message || error);
    return null;
  }
}

async function fetchSessionResults(sessionKey) {
  const [resultsResponse, driversResponse] = await Promise.all([
    fetch(`https://api.openf1.org/v1/session_result?session_key=${encodeURIComponent(sessionKey)}`),
    fetch(`https://api.openf1.org/v1/drivers?session_key=${encodeURIComponent(sessionKey)}`),
  ]);
  if (!resultsResponse.ok) throw new Error(`OpenF1 results HTTP ${resultsResponse.status}`);
  if (!driversResponse.ok) throw new Error(`OpenF1 drivers HTTP ${driversResponse.status}`);
  const [results, drivers] = await Promise.all([resultsResponse.json(), driversResponse.json()]);
  const driversByNumber = new Map(drivers.map(driver => [driver.driver_number, driver]));
  return results.map(result => {
    const driver = driversByNumber.get(result.driver_number) || {};
    return {
      position: result.position,
      driver_number: result.driver_number,
      driver_name: driver.full_name || driver.broadcast_name || `#${result.driver_number}`,
      driver_code: driver.name_acronym || '',
      team_name: driver.team_name || '',
      team_colour: driver.team_colour || '',
      headshot_url: DRIVER_HEADSHOT_OVERRIDES[result.driver_number] || driver.headshot_url || '',
      laps: result.number_of_laps,
      duration: result.duration,
      gap_to_leader: result.gap_to_leader,
      dnf: result.dnf,
      dns: result.dns,
      dsq: result.dsq,
    };
  });
}

function buildOpenF1Calendar(sessions, year) {
  const meetings = {};
  sessions.forEach(s => {
    if (s.session_name && s.session_name.includes('Day')) return;
    if (!meetings[s.meeting_key]) {
      const circuitMeta = circuitLookup(s.circuit_short_name, s.location);
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
        source: 'openf1',
      };
    }
    const start = new Date(s.date_start);
    const end = new Date(s.date_end || s.date_start);
    const m = meetings[s.meeting_key];
    if (start < new Date(m.date_start)) m.date_start = s.date_start;
    if (end > new Date(m.date_end)) m.date_end = s.date_end || s.date_start;
    if (s.session_type === 'Race' && s.session_name === 'Sprint') m.has_sprint = true;
  });

  const calendar = Object.values(meetings)
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
    .map((m, i) => ({ ...m, round: i + 1 }));

  return {
    year: parseInt(year, 10),
    total_races: calendar.length,
    calendar,
    source: 'openf1',
  };
}

function buildOpenF1Meeting(sessions, meetingKey) {
  const meetingSessions = sessions
    .filter(s => String(s.meeting_key) === String(meetingKey))
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  if (!meetingSessions.length) return null;
  const first = meetingSessions[0];
  const circuitMeta = circuitLookup(first.circuit_short_name, first.location);
  return {
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
    source: 'openf1',
    sessions: meetingSessions.map(s => ({
      session_key: s.session_key,
      type: s.session_type,
      name: s.session_name,
      date_start: s.date_start,
      date_end: s.date_end,
    })),
  };
}

function jolpicaSessionDefs(race) {
  const defs = [];
  const push = (key, name, type, block) => {
    if (!block?.date) return;
    const date_start = toIso(block.date, block.time);
    if (!date_start) return;
    const minutes = SESSION_DURATIONS_MIN[name] || 60;
    defs.push({
      key,
      name,
      type,
      date_start,
      date_end: addMinutes(date_start, minutes),
    });
  };

  push('fp1', 'Practice 1', 'Practice', race.FirstPractice);
  if (race.Sprint) {
    push('sq', 'Sprint Qualifying', 'Qualifying', race.SprintQualifying || race.SprintShootout);
    push('sprint', 'Sprint', 'Race', race.Sprint);
    push('q', 'Qualifying', 'Qualifying', race.Qualifying);
  } else {
    push('fp2', 'Practice 2', 'Practice', race.SecondPractice);
    push('fp3', 'Practice 3', 'Practice', race.ThirdPractice);
    push('q', 'Qualifying', 'Qualifying', race.Qualifying);
  }
  push('race', 'Race', 'Race', { date: race.date, time: race.time });
  return defs.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
}

function encodeJolpicaSessionKey(year, round, key) {
  return `j${year}r${round}_${key}`;
}

function parseJolpicaSessionKey(sessionKey) {
  const match = String(sessionKey).match(/^j(\d{4})r(\d+)_(fp1|fp2|fp3|sq|sprint|q|race)$/);
  if (!match) return null;
  return { year: match[1], round: match[2], kind: match[3] };
}

function mapJolpicaRaceToMeeting(race, year) {
  const location = race.Circuit?.Location || {};
  const locality = location.locality || '';
  const country = location.country || '';
  const circuitName = race.Circuit?.circuitName || locality;
  const circuitMeta = circuitLookup(locality, circuitName, race.Circuit?.circuitId);
  const sessions = jolpicaSessionDefs(race).map(s => ({
    session_key: encodeJolpicaSessionKey(year, race.round, s.key),
    type: s.type,
    name: s.name,
    date_start: s.date_start,
    date_end: s.date_end,
  }));
  const date_start = sessions[0]?.date_start || toIso(race.date, race.time);
  const date_end = sessions[sessions.length - 1]?.date_end || date_start;
  return {
    meeting_key: Number(race.round),
    round: Number(race.round),
    circuit: locality || circuitName,
    circuit_full: circuitMeta.fullName || circuitName,
    country,
    country_flag: circuitMeta.country || '',
    location: locality,
    gp_name: getGPName(country, locality, race.raceName),
    gmt_offset: null,
    length_km: circuitMeta.length,
    laps: circuitMeta.laps,
    turns: circuitMeta.turns,
    top_speed_kmh: circuitMeta.topSpeed,
    elevation_m: circuitMeta.elevation,
    date_start,
    date_end,
    has_sprint: Boolean(race.Sprint),
    source: 'jolpica',
    sessions,
  };
}

async function fetchJolpicaSeason(year) {
  const data = await fetchJson(`${JOLPICA_BASE}/${encodeURIComponent(year)}.json?limit=100`);
  return data?.MRData?.RaceTable?.Races || [];
}

async function fetchJolpicaRace(year, round) {
  const data = await fetchJson(`${JOLPICA_BASE}/${encodeURIComponent(year)}/${encodeURIComponent(round)}.json`);
  return data?.MRData?.RaceTable?.Races?.[0] || null;
}

function mapJolpicaResultRow(row, { duration = null, gap = null } = {}) {
  const status = String(row.status || '');
  const positionText = String(row.positionText || row.position || '');
  const dnf = /Retired|Accident|Collision|Engine|Gearbox|Electrical|Brakes|Suspension|Overheating|Oil|Water|Throttle|Transmission|Clutch|Hydraulics|Wheel|Puncture|Spun off|Excluded|Withdrew|Power/i.test(status)
    || positionText === 'R';
  const dns = positionText === 'W' || /Did not start|Not classified/i.test(status);
  const dsq = positionText === 'D' || /Disqualified/i.test(status);
  const number = Number(row.number || row.Driver?.permanentNumber || 0);
  return {
    position: Number(row.position || 0) || null,
    driver_number: number,
    driver_name: `${row.Driver?.givenName || ''} ${row.Driver?.familyName || ''}`.trim() || `#${number}`,
    driver_code: row.Driver?.code || '',
    team_name: row.Constructor?.name || '',
    team_colour: '',
    headshot_url: DRIVER_HEADSHOT_OVERRIDES[number] || '',
    laps: row.laps != null ? Number(row.laps) : null,
    duration,
    gap_to_leader: gap,
    dnf,
    dns,
    dsq,
  };
}

async function fetchJolpicaSessionResults(year, round, kind) {
  const raceMeta = await fetchJolpicaRace(year, round);
  if (!raceMeta) return null;
  const sessionDefs = jolpicaSessionDefs(raceMeta);
  const def = sessionDefs.find(item => item.key === kind);
  if (!def) return null;

  const sessionPayload = {
    session_key: encodeJolpicaSessionKey(year, round, kind),
    meeting_key: Number(round),
    name: def.name,
    type: def.type,
    date_start: def.date_start,
    date_end: def.date_end,
    status: 'pending',
    results: [],
    source: 'jolpica',
  };

  // Practice sessions have no official classification in Jolpica.
  if (kind === 'fp1' || kind === 'fp2' || kind === 'fp3' || kind === 'sq') {
    return sessionPayload;
  }

  if (kind === 'q') {
    const data = await fetchJson(`${JOLPICA_BASE}/${year}/${round}/qualifying.json`);
    const rows = data?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults || [];
    sessionPayload.results = rows.map(row => {
      const best = row.Q3 || row.Q2 || row.Q1 || null;
      return mapJolpicaResultRow(row, {
        duration: parseClockToSeconds(best),
        gap: Number(row.position) === 1 ? 0 : null,
      });
    });
    sessionPayload.status = sessionPayload.results.length ? 'complete' : 'pending';
    return sessionPayload;
  }

  if (kind === 'sprint') {
    const data = await fetchJson(`${JOLPICA_BASE}/${year}/${round}/sprint.json`);
    const rows = data?.MRData?.RaceTable?.Races?.[0]?.SprintResults || [];
    let leaderMillis = null;
    sessionPayload.results = rows.map(row => {
      const millis = row.Time?.millis != null ? Number(row.Time.millis) / 1000 : parseClockToSeconds(row.Time?.time);
      if (Number(row.position) === 1 && millis != null) leaderMillis = millis;
      let gap = null;
      if (Number(row.position) === 1) gap = 0;
      else if (millis != null && leaderMillis != null) gap = Number((millis - leaderMillis).toFixed(3));
      else if (row.Time?.time && String(row.Time.time).startsWith('+')) gap = parseClockToSeconds(String(row.Time.time).slice(1));
      return mapJolpicaResultRow(row, { duration: millis, gap });
    });
    sessionPayload.status = sessionPayload.results.length ? 'complete' : 'pending';
    return sessionPayload;
  }

  if (kind === 'race') {
    const data = await fetchJson(`${JOLPICA_BASE}/${year}/${round}/results.json`);
    const rows = data?.MRData?.RaceTable?.Races?.[0]?.Results || [];
    let leaderMillis = null;
    sessionPayload.results = rows.map(row => {
      const millis = row.Time?.millis != null ? Number(row.Time.millis) / 1000 : parseClockToSeconds(row.Time?.time);
      if (Number(row.position) === 1 && millis != null) leaderMillis = millis;
      let gap = null;
      if (Number(row.position) === 1) gap = 0;
      else if (millis != null && leaderMillis != null) gap = Number((millis - leaderMillis).toFixed(3));
      else if (row.Time?.time && String(row.Time.time).startsWith('+')) gap = parseClockToSeconds(String(row.Time.time).slice(1));
      return mapJolpicaResultRow(row, { duration: millis, gap });
    });
    sessionPayload.status = sessionPayload.results.length ? 'complete' : 'pending';
    return sessionPayload;
  }

  return sessionPayload;
}

async function buildJolpicaCalendar(year) {
  const races = await fetchJolpicaSeason(year);
  const calendar = races.map(race => {
    const meeting = mapJolpicaRaceToMeeting(race, year);
    return {
      meeting_key: meeting.meeting_key,
      round: meeting.round,
      circuit: meeting.circuit,
      country: meeting.country,
      country_flag: meeting.country_flag,
      location: meeting.location,
      gp_name: meeting.gp_name,
      date_start: meeting.date_start,
      date_end: meeting.date_end,
      has_sprint: meeting.has_sprint,
      source: 'jolpica',
    };
  });
  return {
    year: parseInt(year, 10),
    total_races: calendar.length,
    calendar,
    source: 'jolpica',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800');

  const { year = 2026, meeting, session } = req.query;

  try {
    if (session) {
      const jolpicaKey = parseJolpicaSessionKey(session);
      if (jolpicaKey) {
        const payload = await fetchJolpicaSessionResults(jolpicaKey.year, jolpicaKey.round, jolpicaKey.kind);
        if (!payload) return res.status(404).json({ error: 'Session not found' });
        return res.status(200).json(payload);
      }

      try {
        const sessions = await fetchOpenF1Sessions(year);
        if (sessions) {
          const sessionKey = parseInt(session, 10);
          const sessionMeta = sessions.find(item => item.session_key === sessionKey);
          if (sessionMeta) {
            const results = await fetchSessionResults(sessionKey);
            return res.status(200).json({
              session_key: sessionKey,
              meeting_key: sessionMeta.meeting_key,
              name: sessionMeta.session_name,
              type: sessionMeta.session_type,
              date_start: sessionMeta.date_start,
              date_end: sessionMeta.date_end,
              status: results.length ? 'complete' : 'pending',
              results,
              source: 'openf1',
            });
          }
        }
      } catch (error) {
        console.error('OpenF1 session path failed:', error?.message || error);
      }

      // Numeric session keys from OpenF1 become unavailable during live lockouts.
      // Fall back by treating meeting as round only if session was already jolpica-shaped.
      return res.status(503).json({ error: 'Session results temporarily unavailable' });
    }

    if (meeting) {
      const openf1Sessions = await fetchOpenF1Sessions(year);
      if (openf1Sessions) {
        const detail = buildOpenF1Meeting(openf1Sessions, meeting);
        if (detail) return res.status(200).json(detail);
      }

      const race = await fetchJolpicaRace(year, meeting);
      if (!race) return res.status(404).json({ error: 'Meeting not found' });
      const detail = mapJolpicaRaceToMeeting(race, year);
      return res.status(200).json(detail);
    }

    const openf1Sessions = await fetchOpenF1Sessions(year);
    if (openf1Sessions && openf1Sessions.length) {
      return res.status(200).json(buildOpenF1Calendar(openf1Sessions, year));
    }

    const calendar = await buildJolpicaCalendar(year);
    return res.status(200).json(calendar);
  } catch (error) {
    console.error('F1 API error:', error);
    res.status(500).json({ error: 'Failed to fetch F1 data' });
  }
}
