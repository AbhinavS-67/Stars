// celestialMath.js - small, dependency-free celestial sphere toolkit.
// RA/Dec (J2000) -> precession -> Local Sidereal Time -> Alt/Az, plus Sun, Moon,
// rise/set/transit search, great-circle helpers and star colours.
// Angles are degrees unless a name says otherwise. Horizontal vectors are ENU:
// x = East, y = North, z = Up. Azimuth is measured from North through East.

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const norm360 = (a) => ((a % 360) + 360) % 360;
export const norm180 = (a) => ((a + 180) % 360 + 360) % 360 - 180;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---- time -------------------------------------------------------------------
export const julianDate = (date) => date.getTime() / 86400000 + 2440587.5;
export const centuriesJ2000 = (date) => (julianDate(date) - 2451545.0) / 36525;

/** Greenwich Mean Sidereal Time in degrees. */
export function gmstDeg(date) {
  const jd = julianDate(date);
  const T = (jd - 2451545.0) / 36525;
  return norm360(
    280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000
  );
}
export const lstDeg = (date, lonDeg) => norm360(gmstDeg(date) + lonDeg);

// ---- 3x3 matrices (row-major arrays of 9) -----------------------------------
export const mmul = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
export const mvec = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const rotYp = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ---- spherical <-> cartesian -------------------------------------------------
export function raDecToVec(raDeg, decDeg) {
  const r = raDeg * D2R, d = decDeg * D2R, cd = Math.cos(d);
  return [cd * Math.cos(r), cd * Math.sin(r), Math.sin(d)];
}
export function vecToRaDec(v) {
  return { ra: norm360(Math.atan2(v[1], v[0]) * R2D), dec: Math.asin(clamp(v[2] / vlen(v), -1, 1)) * R2D };
}
export function altAzToEnu(altDeg, azDeg) {
  const a = altDeg * D2R, z = azDeg * D2R, ca = Math.cos(a);
  return [ca * Math.sin(z), ca * Math.cos(z), Math.sin(a)];
}
export function enuToAltAz(v) {
  const l = vlen(v) || 1;
  return { alt: Math.asin(clamp(v[2] / l, -1, 1)) * R2D, az: norm360(Math.atan2(v[0], v[1]) * R2D) };
}

// ---- precession J2000 -> mean equator of date (IAU 1976) --------------------
export function precessionMatrix(date) {
  const T = centuriesJ2000(date);
  const as = D2R / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  return mmul(rotZ(z), mmul(rotYp(theta), rotZ(zeta)));
}

/** Matrix taking an equatorial-of-date vector to the observer's ENU frame. */
export function horizonMatrix(lstDegrees, latDeg) {
  const L = lstDegrees * D2R, p = latDeg * D2R;
  const cl = Math.cos(L), sl = Math.sin(L), cp = Math.cos(p), sp = Math.sin(p);
  // Xm = x cosL + y sinL ; Ym = x sinL - y cosL (toward the west) ; Zm = z
  // East = -Ym ; North = Zm cp - Xm sp ; Up = Zm sp + Xm cp
  return [
    -sl, cl, 0,
    -sp * cl, -sp * sl, cp,
    cp * cl, cp * sl, sp,
  ];
}

/** Full J2000 -> ENU matrix for a given instant and observer. */
export function skyMatrix(date, obs) {
  return mmul(horizonMatrix(lstDeg(date, obs.lon), obs.lat), precessionMatrix(date));
}

/** Alt/Az of a J2000 RA/Dec point. */
export function altAzJ2000(raDeg, decDeg, date, obs) {
  return enuToAltAz(mvec(skyMatrix(date, obs), raDecToVec(raDeg, decDeg)));
}
/** Alt/Az of an of-date RA/Dec point (Sun, Moon). */
export function altAzOfDate(raDeg, decDeg, date, obs) {
  return enuToAltAz(mvec(horizonMatrix(lstDeg(date, obs.lon), obs.lat), raDecToVec(raDeg, decDeg)));
}

// ---- Sun & Moon (low precision, plenty for a sky view) ----------------------
function eclipticToEquatorial(lonDeg, latDeg, epsDeg) {
  const l = lonDeg * D2R, b = latDeg * D2R, e = epsDeg * D2R;
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(b) * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e);
  const z = Math.cos(b) * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e);
  return vecToRaDec([x, y, z]);
}

export function sunEquatorial(date) {
  const T = centuriesJ2000(date);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * D2R;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega);
  const eps = 23.439291 - 0.0130042 * T + 0.00256 * Math.cos(omega);
  return { ...eclipticToEquatorial(lambda, 0, eps), lambda: norm360(lambda) };
}

export function moonEquatorial(date) {
  const T = centuriesJ2000(date);
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = (297.8501921 + 445267.1114034 * T) * D2R;
  const M = (357.5291092 + 35999.0502909 * T) * D2R;
  const Mp = (134.9633964 + 477198.8675055 * T) * D2R;
  const F = (93.272095 + 483202.0175233 * T) * D2R;
  const s = Math.sin, c = Math.cos;
  const lon = Lp +
    6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) -
    0.185116 * s(M) - 0.114332 * s(2 * F) + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp) +
    0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M) - 0.040923 * s(M - Mp) - 0.03472 * s(D) -
    0.030383 * s(M + Mp);
  const lat =
    5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F) +
    0.055413 * s(2 * D - Mp + F) + 0.046271 * s(2 * D - Mp - F) + 0.032573 * s(2 * D + F);
  const distKm =
    385000.56 - 20905.355 * c(Mp) - 3699.111 * c(2 * D - Mp) - 2955.968 * c(2 * D) - 569.925 * c(2 * Mp);
  const eps = 23.439291 - 0.0130042 * T;
  return { ...eclipticToEquatorial(lon, lat, eps), lambda: norm360(lon), beta: lat, distKm };
}

/** Illuminated fraction (0..1), waxing flag and age-ish phase angle for the Moon. */
export function moonPhase(date) {
  const sun = sunEquatorial(date), moon = moonEquatorial(date);
  const cosPsi = Math.cos(moon.beta * D2R) * Math.cos((moon.lambda - sun.lambda) * D2R);
  const fraction = (1 - cosPsi) / 2;
  const waxing = norm180(moon.lambda - sun.lambda) > 0;
  return { fraction, waxing, elongation: Math.acos(clamp(cosPsi, -1, 1)) * R2D };
}

/** Topocentric-ish altitude/azimuth of the Moon (parallax applied to altitude). */
export function moonAltAz(date, obs) {
  const m = moonEquatorial(date);
  const aa = altAzOfDate(m.ra, m.dec, date, obs);
  const par = Math.asin(6378.14 / m.distKm) * R2D;
  return { alt: aa.alt - par * Math.cos(aa.alt * D2R), az: aa.az, ra: m.ra, dec: m.dec };
}
export function sunAltAz(date, obs) {
  const s = sunEquatorial(date);
  return { ...altAzOfDate(s.ra, s.dec, date, obs), ra: s.ra, dec: s.dec };
}

// ---- geometry ---------------------------------------------------------------
export const angSep = (v1, v2) => Math.acos(clamp(dot(vnorm(v1), vnorm(v2)), -1, 1)) * R2D;

/** Points along the great circle between two unit vectors (inclusive). */
export function greatCircle(v1, v2, n = 48) {
  const a = vnorm(v1), b = vnorm(v2);
  const om = Math.acos(clamp(dot(a, b), -1, 1));
  const so = Math.sin(om) || 1e-9;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so;
    out.push([a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2]);
  }
  return out;
}

export function haversineKm(a, b) {
  const R = 6371.0088;
  const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- rise / set / transit ---------------------------------------------------
/**
 * For a fixed J2000 direction: current altitude, the next rise and set within
 * `hours`, the next upper transit, and the culmination altitude.
 */
export function riseSetTransit(raDeg, decDeg, date, obs, hours = 36, stepMin = 3) {
  const P = precessionMatrix(date);
  const { ra, dec } = vecToRaDec(mvec(P, raDecToVec(raDeg, decDeg)));
  const sinP = Math.sin(obs.lat * D2R), cosP = Math.cos(obs.lat * D2R);
  const sinD = Math.sin(dec * D2R), cosD = Math.cos(dec * D2R);
  const altAt = (t) => {
    const H = (lstDeg(new Date(t), obs.lon) - ra) * D2R;
    return Math.asin(clamp(sinP * sinD + cosP * cosD * Math.cos(H), -1, 1)) * R2D;
  };
  const t0 = date.getTime();
  const alt0 = altAt(t0);
  let rise = null, set = null, prev = alt0, prevT = t0;
  const end = t0 + hours * 3600000, step = stepMin * 60000;
  for (let t = t0 + step; t <= end && (!rise || !set); t += step) {
    const a = altAt(t);
    if (prev <= 0 && a > 0 && !rise) rise = new Date(prevT + ((0 - prev) / (a - prev)) * step);
    if (prev > 0 && a <= 0 && !set) set = new Date(prevT + ((prev - 0) / (prev - a)) * step);
    prev = a; prevT = t;
  }
  const lst0 = lstDeg(date, obs.lon);
  const dtDays = norm360(ra - lst0) / 360.98564736629;
  const transit = new Date(t0 + dtDays * 86400000);
  return {
    alt: alt0,
    above: alt0 > 0,
    rise, set, transit,
    maxAlt: 90 - Math.abs(obs.lat - dec),
    neverRises: 90 - Math.abs(obs.lat - dec) <= 0,
  };
}

// ---- observer geometry for a direction in the sky ---------------------------
export function compassPoint(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(norm360(az) / 22.5) % 16];
}

// ---- star colour ------------------------------------------------------------
/** B-V colour index -> [r,g,b] 0..255 (blackbody approximation, slightly desaturated). */
export function bvToRgb(bv) {
  const b = clamp(bv, -0.4, 2.0);
  const T = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const t = T / 100;
  let r, g, bl;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) bl = 255; else if (t <= 19) bl = 0; else bl = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const mix = 0.18; // pull toward white so faint stars don't look neon
  const f = (c) => Math.round(clamp(c, 0, 255) * (1 - mix) + 255 * mix);
  return [f(r), f(g), f(bl)];
}

// ---- formatting -------------------------------------------------------------
const fmtCache = new Map();
export function fmtTime(date, tz = 'Asia/Kolkata', withSeconds = false) {
  const key = tz + withSeconds;
  if (!fmtCache.has(key))
    fmtCache.set(key, new Intl.DateTimeFormat('en-IN', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: true,
    }));
  return fmtCache.get(key).format(date).replace(/\s?(am|pm)/i, (m) => ' ' + m.trim().toUpperCase());
}
/** Like fmtTime, but adds 'tomorrow' / '+Nd' when `date` falls on a later IST day than `ref`. */
export function fmtTimeRel(date, ref) {
  const day = (d) => Math.floor((d.getTime() + 330 * 60000) / 86400000);
  const n = day(date) - day(ref), t = fmtTime(date);
  return n <= 0 ? t : n === 1 ? `${t} tomorrow` : `${t} +${n}d`;
}
export function fmtSidereal(deg) {
  const h = norm360(deg) / 15;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(((h - hh) * 60 - mm) * 60);
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

// ---- Sun events -------------------------------------------------------------
/**
 * Next time the Sun crosses `altDeg` going up (rising=true) or down (rising=false),
 * searching `hours` ahead. Useful for sunset (0), civil dusk (-6), dark sky (-18).
 */
export function findSunCrossing(date, obs, altDeg, rising, hours = 30, stepMin = 5) {
  const t0 = date.getTime(), step = stepMin * 60000;
  let prev = sunAltAz(date, obs).alt, prevT = t0;
  for (let t = t0 + step; t <= t0 + hours * 3600000; t += step) {
    const a = sunAltAz(new Date(t), obs).alt;
    const crossed = rising ? prev < altDeg && a >= altDeg : prev > altDeg && a <= altDeg;
    if (crossed) return new Date(prevT + ((altDeg - prev) / (a - prev)) * step);
    prev = a; prevT = t;
  }
  return null;
}

/** Catmull-Rom spline through [[ra,dec],...] sampled to unit J2000 vectors. */
export function splineToVectors(points, perSeg = 10) {
  const p = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const c = (j) => 0.5 * (2 * p[i][j] + (-p[i - 1][j] + p[i + 1][j]) * t +
        (2 * p[i - 1][j] - 5 * p[i][j] + 4 * p[i + 1][j] - p[i + 2][j]) * t2 +
        (-p[i - 1][j] + 3 * p[i][j] - 3 * p[i + 1][j] + p[i + 2][j]) * t3);
      out.push(raDecToVec(c(0), c(1)));
    }
  }
  const last = points[points.length - 1];
  out.push(raDecToVec(last[0], last[1]));
  return out;
}
