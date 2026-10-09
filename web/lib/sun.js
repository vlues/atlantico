// Sun position, computed locally (no API). Low-precision solar ephemeris
// (Astronomical Almanac / NOAA style), good to ~0.1° — plenty for art and lights.

const RAD = Math.PI / 180;

/** @returns {{altitude:number, azimuth:number}} degrees; azimuth from north, clockwise */
export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = ((357.529 + 0.98560028 * d) % 360) * RAD;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;
  const la = lat * RAD;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { altitude: alt / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

/** Sunrise / sunset for the local day containing `date` (scan at 2-minute steps). */
export function sunTimes(date, lat, lon) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  let rise = null, set = null;
  let prev = sunPosition(start, lat, lon).altitude;
  for (let m = 2; m <= 1440; m += 2) {
    const t = new Date(start.getTime() + m * 60000);
    const a = sunPosition(t, lat, lon).altitude;
    if (prev < -0.833 && a >= -0.833 && !rise) rise = t;
    if (prev >= -0.833 && a < -0.833) set = t;
    prev = a;
  }
  return { sunrise: rise, sunset: set };
}
