// skyModel.js - owns the catalog, the observer, the clock and everything derived from them.
// SkyCanvas, ARView and the Dashboard all read from one SkyModel so they can never disagree.
import * as M from './celestialMath.js';

export const FEATURED_IDS = ['Cap', 'Sgr'];

export class SkyModel {
  constructor({ stars, cons, names, config, planets }) {
    this.config = config;
    this.names = names;
    this.observers = {
      her: { key: 'her', ...config.observers.her },
      him: { key: 'him', ...config.observers.him },
      gps: null,
    };
    this.obsKey = config.observers.default || 'her';
    this.timeOffsetMs = 0;
    this.declination = config.ar?.magneticDeclinationDeg ?? 0;

    // ---- stars (J2000 unit vectors) ----
    const n = stars.length;
    this.n = n;
    this.j2000 = new Float32Array(n * 3);
    this.enu = new Float32Array(n * 3);
    this.mag = new Float32Array(n);
    this.bv = new Float32Array(n);
    this.hip = new Int32Array(n);
    this.colorIdx = new Uint8Array(n);
    this.altCache = new Float32Array(n);
    stars.forEach((s, i) => {
      const v = M.raDecToVec(s[0], s[1]);
      this.j2000.set(v, i * 3);
      this.mag[i] = s[2]; this.bv[i] = s[3]; this.hip[i] = s[4];
      this.colorIdx[i] = Math.round(((M.clamp(s[3], -0.3, 1.9) + 0.3) / 2.2) * (SkyModel.COLOR_BUCKETS - 1));
    });

    // ---- constellations ----
    this.cons = {};
    for (const [id, c] of Object.entries(cons)) {
      const o = { id, name: c.name, en: c.en, centre: c.centre, featured: c.featured || null };
      o.centreVec = c.centre ? M.raDecToVec(c.centre[0], c.centre[1]) : null;
      o.lineVecs = (c.lines || []).map((pl) => pl.map(([ra, dec]) => M.raDecToVec(ra, dec)));
      o.boundVecs = c.bounds ? c.bounds.map(([ra, dec]) => M.raDecToVec(ra, dec)) : null;
      if (c.featured) {
        o.artVecs = c.featured.art.map((a) => ({
          kind: a.kind,
          vecs: a.kind === 'spline'
            ? M.splineToVectors(a.pts, 10)
            : a.pts.map(([ra, dec]) => M.raDecToVec(ra, dec)),
        }));
      }
      this.cons[id] = o;
    }
    this.consList = Object.values(this.cons);

    // ---- targets and the tether ----
    this.targets = {};
    for (const id of FEATURED_IDS) {
      const c = this.cons[id];
      this.targets[id] = { id, con: c, enu: [0, 0, 1], alt: 0, az: 0 };
    }
    const byName = {};
    for (const id of FEATURED_IDS) for (const s of this.cons[id].featured.stars) byName[s.name] = { ...s, con: id };
    const tf = byName[config.tether?.from] || byName['Kaus Australis'];
    const tt = byName[config.tether?.to] || byName['Deneb Algedi'];
    this.tether = {
      from: tf, to: tt,
      vFrom: M.raDecToVec(tf.ra, tf.dec), vTo: M.raDecToVec(tt.ra, tt.dec),
      enuFrom: [0, 0, 1], enuTo: [0, 0, 1], arc: M.greatCircle(M.raDecToVec(tf.ra, tf.dec), M.raDecToVec(tt.ra, tt.dec), 56),
    };
    this.tether.sepDeg = M.angSep(this.tether.vFrom, this.tether.vTo);
    this.centreSepDeg = M.angSep(this.cons.Cap.centreVec, this.cons.Sgr.centreVec);
    this.km = M.haversineKm(this.observers.her, this.observers.him);

    // glow anchors: all featured stars as J2000 vectors
    this.featuredStars = [];
    for (const id of FEATURED_IDS)
      for (const s of this.cons[id].featured.stars)
        this.featuredStars.push({ ...s, con: id, v: M.raDecToVec(s.ra, s.dec), enu: [0, 0, 1] });

    this.sun = { alt: 0, az: 0, enu: [0, 0, 1] };
    this.moon = { alt: 0, az: 0, enu: [0, 0, 1], fraction: 0.5, waxing: true };
    this.date = new Date();
    this._tmpE = [0, 0, 0];
    this._rst = {};

    // ---- planets: interpolate a precomputed daily ephemeris (tools/build_planets.mjs) ----
    this.planetTable = planets || null;
    const PCOL = { Mercury: [200, 200, 205], Venus: [255, 244, 214], Mars: [255, 150, 110], Jupiter: [255, 232, 196], Saturn: [244, 218, 160] };
    this.planets = planets ? Object.keys(planets.bodies).map((name) => ({ name, rgb: PCOL[name] || [255, 255, 255], v: [0, 0, 1], enu: [0, 0, 1], alt: -90, az: 0, mag: 0, ra: 0, dec: 0, kind: 'planet' })) : [];

    // ---- named stars (for search and tap-to-identify) ----
    this.namedStars = [];
    for (let i = 0; i < n; i++) if (names[this.hip[i]]) this.namedStars.push({ i, name: names[this.hip[i]], mag: this.mag[i] });
    this.update(Date.now());
  }

  get obs() { return this.observers[this.obsKey] || this.observers.her; }
  setObserver(key) { if (this.observers[key]) this.obsKey = key; }
  setGps(lat, lon) { this.observers.gps = { key: 'gps', name: 'Here', lat, lon }; }

  /** Live clock plus the user's time-travel offset. */
  update(realNowMs) {
    const date = new Date(realNowMs + this.timeOffsetMs);
    this.date = date;
    const obs = this.obs;
    const m = M.skyMatrix(date, obs);
    this.sky = m;
    const j = this.j2000, e = this.enu;
    for (let i = 0, k = 0; i < this.n; i++, k += 3) {
      const x = j[k], y = j[k + 1], z = j[k + 2];
      e[k] = m[0] * x + m[1] * y + m[2] * z;
      e[k + 1] = m[3] * x + m[4] * y + m[5] * z;
      const u = m[6] * x + m[7] * y + m[8] * z;
      e[k + 2] = u;
    }
    for (const id of FEATURED_IDS) {
      const t = this.targets[id];
      t.enu = M.mvec(m, t.con.centreVec);
      const aa = M.enuToAltAz(t.enu);
      t.alt = aa.alt; t.az = aa.az;
    }
    this.tether.enuFrom = M.mvec(m, this.tether.vFrom);
    this.tether.enuTo = M.mvec(m, this.tether.vTo);
    for (const s of this.featuredStars) s.enu = M.mvec(m, s.v);

    this._updatePlanets(date.getTime(), m);
    const sa = M.sunAltAz(date, obs);
    this.sun = { alt: sa.alt, az: sa.az, enu: M.altAzToEnu(sa.alt, sa.az), ra: sa.ra, dec: sa.dec };
    const ma = M.moonAltAz(date, obs);
    const ph = M.moonPhase(date);
    this.moon = { alt: ma.alt, az: ma.az, enu: M.altAzToEnu(ma.alt, ma.az), fraction: ph.fraction, waxing: ph.waxing };
  }

  toEnu(v) { return M.mvec(this.sky, v); }
  /** Same as toEnu but writes into a reused array: the renderer calls this thousands of times a frame. */
  toEnuInto(v, out) {
    const m = this.sky, x = v[0], y = v[1], z = v[2];
    out[0] = m[0] * x + m[1] * y + m[2] * z; out[1] = m[3] * x + m[4] * y + m[5] * z; out[2] = m[6] * x + m[7] * y + m[8] * z;
    return out;
  }

  _updatePlanets(ms, m) {
    const T = this.planetTable;
    if (!T) return;
    let f = (ms - T.start) / 86400000 - 0.5;
    this.planetsInRange = f >= 0 && f <= T.n - 1;
    f = Math.max(0, Math.min(T.n - 1.0001, f));
    const i = Math.floor(f), u = f - i;
    for (const p of this.planets) {
      const b = T.bodies[p.name];
      let dr = b.ra[i + 1] - b.ra[i]; dr = ((dr + 540) % 360) - 180;
      p.ra = (b.ra[i] + dr * u + 360) % 360; p.dec = b.dec[i] + (b.dec[i + 1] - b.dec[i]) * u; p.mag = b.mag[i] + (b.mag[i + 1] - b.mag[i]) * u;
      p.v = M.raDecToVec(p.ra, p.dec); p.enu = M.mvec(m, p.v);
      const aa = M.enuToAltAz(p.enu); p.alt = aa.alt; p.az = aa.az;
    }
  }

  /** Position/visibility facts for a featured constellation from any observer, at the model's current time. */
  targetStatus(id, obs = this.obs) {
    const t = this.targets[id];
    const c = t.con.centre;
    const aa = M.altAzJ2000(c[0], c[1], this.date, obs);
    const key = `${id}|${obs.key}|${obs.lat.toFixed(3)}|${Math.floor(this.date.getTime() / 120000)}`;
    const r = this._rst[key] || (this._rst[key] = M.riseSetTransit(c[0], c[1], this.date, obs, 36));
    if (Object.keys(this._rst).length > 60) this._rst = { [key]: r };
    return { id, alt: aa.alt, az: aa.az, compass: M.compassPoint(aa.az), above: aa.alt > 0, rise: r.rise, set: r.set, transit: r.transit, maxAlt: r.maxAlt };
  }
  starStatus(star, obs = this.obs) {
    const aa = M.altAzJ2000(star.ra, star.dec, this.date, obs);
    return { alt: aa.alt, az: aa.az, compass: M.compassPoint(aa.az), above: aa.alt > 0 };
  }

  /** 0..100 stargazing score from darkness, cloud and moonlight; plus a plain label. */
  visibility(cloudPct) {
    const sa = this.sun.alt;
    let dark;
    if (sa <= -18) dark = 1; else if (sa <= -12) dark = 0.85 + 0.15 * ((-12 - sa) / 6);
    else if (sa <= -6) dark = 0.5 + 0.35 * ((-6 - sa) / 6); else if (sa <= 0) dark = 0.15 + 0.35 * ((0 - sa) / 6);
    else dark = 0.03;
    const cloud = cloudPct == null ? 0.8 : 1 - 0.92 * (cloudPct / 100);
    const moon = this.moon.alt > 0 ? 1 - 0.45 * this.moon.fraction * Math.min(1, this.moon.alt / 25) : 1;
    const score = Math.round(100 * dark * cloud * moon);
    let label = 'Poor';
    if (sa > -6) label = sa > 0 ? 'Daylight' : 'Twilight';
    else if (score >= 75) label = 'Excellent'; else if (score >= 50) label = 'Good'; else if (score >= 25) label = 'Fair';
    return { score, label, sunAlt: sa };
  }
}
SkyModel.COLOR_BUCKETS = 24;
