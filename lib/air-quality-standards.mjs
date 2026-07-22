const EUROPEAN_THRESHOLDS = {
  no2: [0, 40, 90, 120, 230, 340],
  o3: [0, 50, 100, 130, 240, 380],
  so2: [0, 100, 200, 350, 500, 750],
  pm25: [0, 10, 20, 25, 50, 75],
  pm10: [0, 20, 40, 50, 100, 150]
};

const GAS_UG_M3_PER_PPB = { no2: 1.88, o3: 1.96, so2: 2.62 };

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pollutantKey(code) {
  return code === 'pm2p5' ? 'pm25' : String(code || '').toLowerCase();
}

function concentrationInUgM3(item) {
  const key = pollutantKey(item?.code);
  const value = finite(item?.concentration?.value);
  if (value === null) return null;
  const unit = String(item?.concentration?.unit || '').toLowerCase().replaceAll('μ', 'u').replaceAll('µ', 'u');
  if (unit.includes('mg/m3')) return value * 1000;
  if (unit.includes('ppb') && GAS_UG_M3_PER_PPB[key]) return value * GAS_UG_M3_PER_PPB[key];
  if (unit.includes('ppm') && GAS_UG_M3_PER_PPB[key]) return value * GAS_UG_M3_PER_PPB[key] * 1000;
  return value;
}

function interpolateIndex(value, thresholds) {
  if (!Number.isFinite(value) || value < 0) return null;
  let segment = thresholds.length - 2;
  for (let index = 0; index < thresholds.length - 1; index += 1) {
    if (value <= thresholds[index + 1]) {
      segment = index;
      break;
    }
  }
  const low = thresholds[segment];
  const high = thresholds[segment + 1];
  const position = high === low ? segment : segment + (value - low) / (high - low);
  return Math.max(0, Math.round(position * 20));
}

function europeanCategory(aqi) {
  if (aqi <= 20) return '优';
  if (aqi <= 40) return '良好';
  if (aqi <= 60) return '一般';
  if (aqi <= 80) return '较差';
  if (aqi <= 100) return '差';
  return '极差';
}

function usCategory(aqi) {
  if (aqi <= 50) return '优';
  if (aqi <= 100) return '良';
  if (aqi <= 150) return '对敏感人群不健康';
  if (aqi <= 200) return '不健康';
  if (aqi <= 300) return '非常不健康';
  return '危险';
}

function advice(aqi, standard) {
  const limit = standard === 'european' ? [20, 40, 60, 80] : [50, 100, 150, 200];
  if (aqi <= limit[0]) return '空气状态比较干净，适合日常户外活动';
  if (aqi <= limit[1]) return '大多数人可以正常进行户外活动';
  if (aqi <= limit[2]) return '敏感人群长时间外出时可以稍微留意';
  if (aqi <= limit[3]) return '建议减少长时间高强度户外活动';
  return '尽量减少户外活动，外出注意防护';
}

function primaryName(code) {
  return ({ pm2p5: 'PM2.5', pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', o3: 'O₃', so2: 'SO₂', co: 'CO' })[code] || code || null;
}

export function buildAirQualityStandards(payload) {
  const indexes = Array.isArray(payload?.indexes) ? payload.indexes : [];
  const pollutants = Array.isArray(payload?.pollutants) ? payload.pollutants : [];
  const local = indexes.find(item => item.code !== 'qaqi') || indexes[0] || {};
  const usIndex = indexes.find(item => item.code === 'us-epa');
  const usSubIndexes = pollutants.map(item => ({
    code: pollutantKey(item.code),
    value: finite(item.subIndexes?.find(sub => sub.code === 'us-epa')?.aqi)
  })).filter(item => item.value !== null);
  const usPrimary = usSubIndexes.sort((a, b) => b.value - a.value)[0];
  const usAqi = finite(usIndex?.aqi) ?? usPrimary?.value ?? null;

  const europeanSubIndexes = pollutants.map(item => {
    const code = pollutantKey(item.code);
    const thresholds = EUROPEAN_THRESHOLDS[code];
    const concentration = concentrationInUgM3(item);
    return { code, value: thresholds ? interpolateIndex(concentration, thresholds) : null };
  }).filter(item => item.value !== null);
  const europeanPrimary = europeanSubIndexes.sort((a, b) => b.value - a.value)[0];
  const europeanAqi = europeanPrimary?.value ?? null;

  const localAqi = finite(local.aqi);
  return {
    local: {
      code: 'local',
      label: '本地标准',
      name: String(local.name || '').trim() || '本地空气质量标准',
      aqi: localAqi,
      category: String(local.category || '').trim() || '暂无评级',
      primaryPollutant: local.primaryPollutant?.name || null,
      healthAdvice: local.health?.advice?.generalPopulation || (localAqi === null ? null : advice(localAqi, 'local')),
      scaleMax: 300
    },
    us: {
      code: 'us',
      label: '美国 EPA',
      name: '美国 EPA AQI',
      aqi: usAqi,
      category: usAqi === null ? '暂无评级' : usCategory(usAqi),
      primaryPollutant: primaryName(usIndex?.primaryPollutant?.code || usPrimary?.code),
      healthAdvice: usAqi === null ? null : advice(usAqi, 'us'),
      scaleMax: 300
    },
    european: {
      code: 'european',
      label: '欧洲 AQI',
      name: '欧洲空气质量指数',
      aqi: europeanAqi,
      category: europeanAqi === null ? '暂无评级' : europeanCategory(europeanAqi),
      primaryPollutant: primaryName(europeanPrimary?.code),
      healthAdvice: europeanAqi === null ? null : advice(europeanAqi, 'european'),
      scaleMax: 100
    }
  };
}
