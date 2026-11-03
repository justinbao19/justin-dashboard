// Hand-drawn, deliberately coarse geographic context for offline use. These
// outlines are schematic, not administrative boundaries or a navigation chart.
// Kept as a module so the fallback needs no tile, font, or GeoJSON download.
const outlines = [
  ['Eurasia', [[-10,36],[-9,43],[-2,44],[5,48],[8,54],[5,58],[10,63],[20,70],[30,71],[40,67],[55,69],[70,72],[90,77],[110,73],[130,70],[150,71],[170,66],[180,66],[180,60],[165,60],[160,55],[156,51],[151,59],[141,59],[140,51],[134,45],[130,42],[129,36],[126,34],[125,39],[121,40],[122,37],[120,36],[121,31],[122,30],[120,27],[118,24],[114,22],[110,21],[108,21],[107,18],[109,16],[109,12],[106,9],[104,10],[103,14],[101,13],[100,7],[104,1],[102,1],[98,8],[98,16],[94,19],[92,22],[88,22],[85,19],[80,15],[78,8],[76,9],[73,16],[72,21],[67,24],[60,25],[56,26],[53,24],[56,22],[52,16],[44,12],[40,18],[35,29],[32,31],[36,36],[28,36],[25,40],[23,37],[20,40],[18,40],[16,38],[12,43],[7,43],[3,41],[-1,38],[-10,36]]],
  ['Africa', [[-17,15],[-17,21],[-10,30],[-6,36],[10,37],[22,32],[32,31],[35,23],[43,12],[51,12],[47,4],[42,-1],[40,-11],[35,-20],[33,-27],[27,-34],[18,-35],[12,-18],[9,-2],[2,5],[-5,5],[-15,10],[-17,15]]],
  ['North America', [[-168,66],[-160,71],[-140,70],[-130,71],[-110,73],[-95,75],[-80,70],[-64,60],[-55,52],[-66,47],[-70,43],[-74,40],[-76,35],[-80,32],[-81,25],[-83,29],[-90,29],[-97,26],[-97,20],[-90,18],[-87,21],[-86,16],[-83,15],[-82,9],[-77,8],[-80,7],[-85,10],[-93,16],[-105,20],[-110,24],[-115,28],[-117,33],[-124,41],[-125,49],[-135,58],[-150,60],[-163,55],[-165,60],[-168,66]]],
  ['South America', [[-81,12],[-72,12],[-62,10],[-52,4],[-35,-5],[-39,-18],[-48,-28],[-54,-35],[-65,-42],[-67,-55],[-74,-50],[-75,-35],[-71,-18],[-81,-5],[-77,1],[-81,12]]],
  ['Australia', [[113,-22],[114,-34],[122,-34],[131,-32],[138,-35],[146,-39],[153,-28],[146,-18],[142,-11],[136,-13],[130,-12],[123,-17],[113,-22]]],
  ['Greenland', [[-60,60],[-48,60],[-20,70],[-24,82],[-45,84],[-62,79],[-60,60]]],
  ['Japan', [[130,31],[132,32],[135,34],[139,35],[141,39],[140,41],[141,45],[145,44],[145,42],[142,41],[142,37],[140,35],[136,33],[132,33],[131,31],[130,31]]],
  ['Taiwan', [[120,22],[120,24],[121.5,25.3],[122,25],[121.5,23],[120.8,21.9],[120,22]]],
  ['Hainan', [[108.6,18.2],[108.7,19.7],[110.6,20.1],[111,19.5],[110.3,18.2],[108.6,18.2]]],
  ['Luzon', [[120,14],[119.8,16],[120.5,18.6],[122,18.5],[122.3,16],[121.5,14.3],[124,13],[123.5,12.5],[121,13.5],[120,14]]],
  ['Visayas', [[122,10],[122,12],[125,12.5],[126,10.5],[124,9.5],[122,10]]],
  ['Mindanao', [[122,7],[123,8.7],[125.5,9.8],[126.5,7.5],[125,5.5],[123.5,7.5],[122,7]]],
  ['Palawan', [[117,8],[119,10],[120,11.5],[119.5,9.5],[117,8]]],
  ['Borneo', [[109,-1],[109,3],[117,7],[119,5],[118,1],[116,-4],[111,-3],[109,-1]]],
  ['Sumatra', [[95,6],[98,4],[106,-5],[104,-6],[100,-2],[95,6]]],
  ['Java', [[105,-6],[114,-7],[115,-9],[108,-8],[105,-6]]],
  ['Sulawesi', [[119,-5],[120,1],[124,2],[125,1],[121,0],[124,-3],[122,-5],[121,-3],[119,-5]]],
  ['New Guinea', [[131,-1],[138,-2],[145,-5],[151,-10],[147,-10],[141,-8],[136,-5],[132,-4],[131,-1]]],
  ['New Zealand', [[173,-41],[175,-37],[178,-37],[176,-41],[173,-41]]],
  ['South Island', [[166,-46],[170,-43],[173,-41],[174,-42],[169,-47],[166,-46]]],
  ['Madagascar', [[44,-25],[44,-19],[49,-12],[50,-16],[47,-25],[44,-25]]],
  ['Britain', [[-6,50],[-5,55],[-6,59],[-3,59],[0,53],[1,51],[-6,50]]],
  ['Sri Lanka', [[80,6],[80,10],[82,8],[81,6],[80,6]]]
];

export const simplifiedLand = {
  type: 'FeatureCollection',
  features: outlines.map(([name, ring]) => ({
    type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [ring] }
  }))
};

// Also usable without MapLibre/WebGL: fit the bundled outlines and storm points
// in the same unobscured viewport as the interactive map (Mercator projection).
export function createOutlineProjection({ width = 1200, height = 800, padding = {}, positions = [] } = {}) {
  const mercator = ([lon, lat]) => [Number(lon), -180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + Math.max(-84, Math.min(84, Number(lat))) * Math.PI / 360))];
  const points = positions.filter(point => point.every(value => value !== null && value !== '' && Number.isFinite(Number(value)))).map(mercator);
  if (!points.length) points.push(mercator([115, 10]), mercator([140, 35]));
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const { top = 0, right = 0, bottom = 0, left = 0 } = padding;
  const availableWidth = Math.max(100, width - left - right), availableHeight = Math.max(100, height - top - bottom);
  const scale = Math.min(availableWidth / Math.max(12, Math.max(...xs) - Math.min(...xs) + 4), availableHeight / Math.max(12, Math.max(...ys) - Math.min(...ys) + 4));
  const project = coordinate => {
    const [x, y] = mercator(coordinate);
    return [left + availableWidth / 2 + (x - center[0]) * scale, top + availableHeight / 2 + (y - center[1]) * scale];
  };
  const path = coordinates => coordinates.map((coordinate, index) => `${index ? 'L' : 'M'}${project(coordinate).map(value => value.toFixed(2)).join(',')}`).join(' ');
  return { project, path, landPaths: simplifiedLand.features.map(feature => `${path(feature.geometry.coordinates[0])}Z`) };
}
