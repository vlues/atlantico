// The moon, computed locally (no API): position and phase from low-precision lunar theory
// (Meeus / Astronomy Answers terms). Good to about a degree — plenty to place it over the bay.

const RAD = Math.PI / 180;
const E = 23.4397 * RAD; // obliquity of the ecliptic

const days = (date) => date.getTime() / 86400000 - 10957.5; // since J2000.0

function sunCoords(d) {
  const M = (357.5291 + 0.98560028 * d) * RAD;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const L = M + C + 102.9372 * RAD + Math.PI;
  return { dec: Math.asin(Math.sin(E) * Math.sin(L)), ra: Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L)) };
}

function moonCoords(d) {
  const L = (218.316 + 13.176396 * d) * RAD;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.22935 * d) * RAD;
  const l = L + 6.289 * RAD * Math.sin(M);
  const b = 5.128 * RAD * Math.sin(F);
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l)),
    dist: 385001 - 20905 * Math.cos(M),
  };
}

const PHASES = [
  [0.03, 'luna nueva', 'new moon'], [0.22, 'luna creciente', 'waxing crescent'], [0.28, 'cuarto creciente', 'first quarter'],
  [0.47, 'gibosa creciente', 'waxing gibbous'], [0.53, 'luna llena', 'full moon'], [0.72, 'gibosa menguante', 'waning gibbous'],
  [0.78, 'cuarto menguante', 'last quarter'], [0.97, 'luna menguante', 'waning crescent'], [1.01, 'luna nueva', 'new moon'],
];

/**
 * @returns {{altitude:number, azimuth:number, fraction:number, phase:number, waxing:boolean, name:string, nameEn:string}}
 *   degrees (azimuth from north, clockwise); fraction lit 0..1; phase 0 new → 0.5 full → 1 new
 */
export function moonPosition(date, lat, lon) {
  const d = days(date);
  const m = moonCoords(d);
  const H = (280.16 + 360.9856235 * d) * RAD + lon * RAD - m.ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(m.dec) * Math.cos(phi)) + Math.PI;

  const s = sunCoords(d);
  const sdist = 149598000;
  const el = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(el), m.dist - sdist * Math.cos(el));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  const [, name, nameEn] = PHASES.find(([p]) => phase < p);
  return {
    altitude: alt / RAD, azimuth: ((az / RAD) % 360 + 360) % 360,
    fraction: (1 + Math.cos(inc)) / 2, phase, waxing: phase < 0.5, name, nameEn,
  };
}
