// SkyCanvas.js - 2D-canvas sky renderer with a real 3D camera.
// Projections: 'stereo' (wide-angle dome view) and 'gnomonic' (matches a phone camera).
// Control: 'drag' (touch / mouse orbit with inertia + pinch) or 'external' (gyro basis from ARView).
import * as M from '../utils/celestialMath.js';

const { D2R, R2D, clamp, norm360 } = M;
const TAU = Math.PI * 2;
const ACCENT = {
  gold: { rgb: [255, 214, 140], css: '255,214,140' },
  ice: { rgb: [140, 210, 255], css: '140,210,255' },
};

// Emission nebulae (RA/Dec J2000 deg, angular size deg). Colours are H-alpha pink with a touch of O-III teal.
const NEBULAE = [
  { n: 'Lagoon', ra: 270.92, dec: -24.38, size: 1.6, a: 0.55, c: [236, 96, 140] },
  { n: 'Trifid', ra: 270.62, dec: -23.03, size: 0.9, a: 0.5, c: [226, 90, 150] },
  { n: 'Omega', ra: 275.2, dec: -16.18, size: 1.0, a: 0.5, c: [240, 110, 130] },
  { n: 'Eagle', ra: 274.7, dec: -13.81, size: 1.1, a: 0.45, c: [232, 100, 140] },
  { n: 'Orion', ra: 83.82, dec: -5.39, size: 2.2, a: 0.7, c: [235, 120, 150] },
  { n: 'Rosette', ra: 98.0, dec: 4.95, size: 2.0, a: 0.35, c: [225, 85, 120] },
  { n: 'Carina', ra: 161.26, dec: -59.87, size: 3.2, a: 0.5, c: [232, 105, 135] },
  { n: 'NGC 6559', ra: 270.1, dec: -24.1, size: 3.5, a: 0.18, c: [90, 190, 190] },
];

function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// galactic (l,b deg) -> equatorial J2000 unit vector
function galToVec(l, b) {
  const lr = l * D2R, br = b * D2R;
  const x = Math.cos(br) * Math.cos(lr), y = Math.cos(br) * Math.sin(lr), z = Math.sin(br);
  return [
    -0.0548755604 * x + 0.4941094279 * y - 0.8676661490 * z,
    -0.8734370902 * x - 0.4448296300 * y - 0.1980763734 * z,
    -0.4838350155 * x + 0.7469822445 * y + 0.4559837762 * z,
  ];
}

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class SkyCanvas {
  constructor(canvas, model, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.model = model;
    this.config = config;
    this.layers = { lines: true, art: true, bounds: false, labels: true, tether: true, milkyWay: true, planets: true, ...(config.features?.defaultLayers || {}) };
    this.mode = { projection: 'stereo', control: 'drag', transparent: false, ground: true, centerFrac: 0.4, centerX: 0.5 };
    this.cam = { az: 180, alt: 30 };
    this.domeFov = 84;
    this.arFov = config.ar?.defaultFovDeg ?? 62;
    this.ext = { f: [0, 1, 0], u: [0, 0, 1] };
    this.vel = { az: 0, alt: 0, fov: 0 };
    this.fly = null;
    this.pointers = new Map();
    this.W = 0; this.H = 0; this.dpr = 1;
    this._tmp = { x: 0, y: 0, cz: 0 };
    this.onInteract = null;
    this.onTap = null;
    this.time = 0;
    this._e = [0, 0, 0];                 // scratch ENU vector (no per-star allocations)
    this.fx = 2;                         // quality tier: 2 full, 1 lighter, 0 lightest (adapts to the device)
    this.ms = 5; this._slowN = 0; this._fastN = 0;
    this._lastDraw = 0; this._kickUntil = 0;
    this._wcache = new Map();            // text widths
    this.meteors = []; this._nextMeteor = 4000; this.lastMeteorAt = -1e9;
    this.highlight = null;
    this.marks = [];                     // personal 'our stars' hearts: [{ i, title, note }]
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 2);
    this._buildSprites();
    this._buildMilkyWay();
    this._bindEvents();
    this.resize();
  }

  // ---------------------------------------------------------------- setup
  _buildSprites() {
    const B = this.model.constructor.COLOR_BUCKETS;
    this.starSprites = []; this.starCss = [];
    for (let i = 0; i < B; i++) {
      const bv = -0.3 + (i / (B - 1)) * 2.2;
      const [r, g, b] = M.bvToRgb(bv);
      this.starCss.push(`rgb(${r},${g},${b})`);
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.1, 'rgba(255,255,255,0.96)');
      grd.addColorStop(0.2, `rgba(${r},${g},${b},0.85)`);
      grd.addColorStop(0.45, `rgba(${r},${g},${b},0.2)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
      this.starSprites.push(c);
    }
    const blob = (col, size = 128) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, `rgba(${col},1)`); g.addColorStop(0.4, `rgba(${col},0.45)`); g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g; x.fillRect(0, 0, size, size); return c;
    };
    this.mwSprites = [blob('165,185,245'), blob('255,226,176'), blob('220,170,200')];
    this.dustSprite = blob('4,5,9');
    this.nebSprites = NEBULAE.map((n) => blob(n.c.join(',')));
    this.glowSprite = blob('255,255,255', 96);
  }

  _buildMilkyWay() {
    const rnd = mulberry(7);
    this.mw = []; this.dust = [];
    for (let l = 0; l < 360; l += 2) {
      const lw = ((l + 180) % 360) - 180; // -180..180 about the galactic centre
      const bulge = Math.exp(-(lw * lw) / (2 * 38 * 38));
      for (const [b0, w] of [[-7, 0.3], [-3, 0.75], [0, 1], [3, 0.75], [7, 0.3]]) {
        if (rnd() < 0.28) continue;
        const b = b0 + (rnd() - 0.5) * 3;
        const v = galToVec(l + (rnd() - 0.5) * 2, b);
        const strength = (0.35 + 1.35 * bulge) * w * (0.7 + rnd() * 0.6);
        this.mw.push({ v, size: 5 + rnd() * 5 + bulge * 3, a: 0.014 * strength, tint: bulge > 0.55 ? (rnd() < 0.55 ? 1 : 0) : (rnd() < 0.12 ? 2 : 0) });
      }
      // Great Rift: dark lanes toward the centre
      if (Math.abs(lw) < 55 && rnd() < 0.55) {
        const v = galToVec(l, (rnd() - 0.5) * 4);
        this.dust.push({ v, size: 3.5 + rnd() * 4, a: 0.1 + 0.16 * bulge * rnd() });
      }
    }
    this.nebV = NEBULAE.map((n) => M.raDecToVec(n.ra, n.dec));
  }

  _bindEvents() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const down = (e) => {
      if (this.mode.control !== 'drag') return;
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._down = { x: e.clientX, y: e.clientY, t: performance.now(), n: this.pointers.size };
      this.fly = null; this.vel.az = this.vel.alt = 0;
      if (this.pointers.size === 2) this._pinch0 = { d: this._pinchDist(), fov: this.fov };
      this.onInteract?.();
    };
    const move = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p || this.mode.control !== 'drag') return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) {
        const dpp = 1 / (this.F * D2R);
        const dAz = -dx * dpp, dAlt = dy * dpp;
        this._applyDrag(dAz, dAlt);
        const now = performance.now(), dt = Math.max(0.008, (now - (this._lastMoveT || now)) / 1000);
        this._lastMoveT = now;
        this.vel.az = lerp(this.vel.az, dAz / dt, 0.4);
        this.vel.alt = lerp(this.vel.alt, dAlt / dt, 0.4);
      } else if (this.pointers.size === 2 && this._pinch0) {
        const d = this._pinchDist();
        if (d > 0) this.fov = this._pinch0.fov * (this._pinch0.d / d);
      }
    };
    const up = (e) => {
      const d = this._down;
      if (d && e.type === 'pointerup' && d.n === 1 && this.pointers.size === 1 && performance.now() - d.t < 400 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) {
        const r = this.canvas.getBoundingClientRect();
        this.onTap?.(e.clientX - r.left, e.clientY - r.top);
      }
      this._down = null;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this._pinch0 = null;
      if (this.pointers.size === 0) {
        const t = performance.now() - (this._lastMoveT || 0);
        if (t > 90) this.vel.az = this.vel.alt = 0; // finger rested: no fling
      }
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { if (this.mode.control !== 'drag') return; e.preventDefault(); this.fov *= Math.exp(e.deltaY * 0.0012); this.kick(); }, { passive: false });
    c.addEventListener('dblclick', () => this.resetView());
    // iOS Safari: block page pinch-zoom / rubber-banding behind the canvas
    ['gesturestart', 'gesturechange'].forEach((n) => c.addEventListener(n, (e) => e.preventDefault()));
  }
  _pinchDist() {
    const pts = [...this.pointers.values()];
    return pts.length < 2 ? 0 : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
  _applyDrag(dAz, dAlt) {
    this.cam.az = norm360(this.cam.az + dAz);
    this.cam.alt = clamp(this.cam.alt + dAlt, -12, 89.5);
  }

  get fov() { return this.mode.projection === 'stereo' ? this.domeFov : this.arFov; }
  set fov(v) {
    if (this.mode.projection === 'stereo') this.domeFov = clamp(v, 22, 130);
    else this.arFov = clamp(v, 30, 95);
  }

  // ---------------------------------------------------------------- public API
  setMode(partial) { Object.assign(this.mode, partial); this._setupProjection(); this.kick(); }
  setBasis(f, u) { this.ext.f = f; this.ext.u = u; }
  setLayer(name, on) { this.layers[name] = on; this.kick(); }
  /** Keep drawing at full rate for a moment (after a UI change). */
  kick(ms = 700) { this._kickUntil = performance.now() + ms; }
  get busy() {
    return this.pointers.size > 0 || !!this.fly || this.mode.control === 'external' || Math.abs(this.vel.az) > 0.4 || Math.abs(this.vel.alt) > 0.4
      || performance.now() < this._kickUntil || this.meteors.length > 0 || !!this.highlight;
  }
  /** The loop asks before doing any work: a still sky only needs ~30 fps. */
  wantsFrame(now) {
    const gap = this.busy ? 0 : (this.fx >= 2 ? 32 : 48);
    return now - this._lastDraw >= gap - 2;
  }
  setFx(level) {
    level = Math.max(0, Math.min(2, level));
    if (level === this.fx) return;
    this.fx = level;
    document.body.dataset.fx = String(level);
    this.resize();
  }
  /** Fly to and ring an object. `get` returns its current ENU vector. */
  highlightObj(get, label = '') { this.highlight = { get, label, t0: performance.now(), ms: 6500 }; this.kick(); }
  clearHighlight() { this.highlight = null; this.kick(); }

  resize() {
    // clientWidth/Height ignore CSS transforms (the AR card-flip animates rotateY on a parent)
    this.dpr = Math.min(window.devicePixelRatio || 1, this.fx >= 2 ? 2 : this.fx === 1 ? 1.5 : 1);
    this.W = Math.max(1, Math.round(this.canvas.clientWidth)); this.H = Math.max(1, Math.round(this.canvas.clientHeight));
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._buildBackground();
    this._setupProjection();
    // The Milky Way is soft, so it is rendered at a fraction of the resolution and scaled up: 6-10x fewer pixels to fill.
    this.mwQ = this.fx >= 2 ? 0.4 : 0.28;
    if (!this.mwCanvas) this.mwCanvas = document.createElement('canvas');
    this.mwCanvas.width = Math.max(1, Math.ceil(this.W * this.mwQ)); this.mwCanvas.height = Math.max(1, Math.ceil(this.H * this.mwQ));
    this.mwCtx = this.mwCanvas.getContext('2d');
    this._mwKey = '';
    this.kick(900);
  }
  _buildBackground() {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#04050a'); g.addColorStop(0.55, '#060913'); g.addColorStop(1, '#0a1124');
    this.bg = g;
  }
  _setupProjection() {
    const fov = this.fov * D2R;
    if (this.mode.projection === 'stereo') this.F = (Math.min(this.W, this.H) / 2) / (2 * Math.tan(fov / 4));
    else this.F = (this.H / 2) / Math.tan(fov / 2);
  }

  resetView() {
    const t = this.model.targets;
    // face the middle of the two signs, or the southern sky if they are both low
    const mid = M.vnorm(M.vadd(t.Cap.enu, t.Sgr.enu));
    const aa = M.enuToAltAz(mid);
    this.flyTo(aa.az, clamp(Math.max(aa.alt, 22) + 6, 18, 55), 84, 1100);
  }
  flyTo(az, alt, fov, ms = 900) {
    this.fly = { t0: performance.now(), ms, az0: this.cam.az, alt0: this.cam.alt, fov0: this.domeFov, az1: az, alt1: alt, fov1: fov ?? this.domeFov };
  }

  /** Project an ENU vector with the camera of the current frame. Returns {x,y,cz,visible}. */
  projectEnu(v) {
    const ok = this._p(v[0], v[1], v[2]);
    return { x: this._tmp.x, y: this._tmp.y, cz: this._tmp.cz, visible: ok };
  }
  /** Camera comps of an ENU vector (also valid when behind the camera). */
  cameraComponents(v) {
    const b = this._b;
    return { cx: v[0] * b.r[0] + v[1] * b.r[1] + v[2] * b.r[2], cy: v[0] * b.u[0] + v[1] * b.u[1] + v[2] * b.u[2], cz: v[0] * b.f[0] + v[1] * b.f[1] + v[2] * b.f[2] };
  }
  get cameraForward() { return this._b ? this._b.f : [0, 1, 0]; }
  get cameraAltAz() { return M.enuToAltAz(this.cameraForward); }
  get pxPerDeg() { return this.F * D2R; }

  // ---------------------------------------------------------------- frame
  frame(nowMs, dt) {
    const t0 = performance.now();
    this._lastDraw = nowMs;
    this.time = nowMs;
    this._stepControls(nowMs, dt);
    this._setupProjection();
    const external = this.mode.control === 'external';
    let f, u;
    if (external) { f = this.ext.f; u = this.ext.u; }
    else { f = M.altAzToEnu(this.cam.alt, this.cam.az); u = M.altAzToEnu(this.cam.alt + 90, this.cam.az); }
    const r = M.cross(f, u);
    this._b = { f, u, r };
    this._draw();
    this._adapt(performance.now() - t0);
  }

  /** Watches how long drawing takes and steps the quality tier down (or back up) on a sustained trend. */
  _adapt(cost) {
    this.ms = this.ms * 0.92 + cost * 0.08;
    if (this.ms > 9) { this._fastN = 0; if (++this._slowN > 45) { this._slowN = 0; this.ms = 6; this.setFx(this.fx - 1); } }
    else if (this.ms < 3.2 && this.fx < 2) { this._slowN = 0; if (++this._fastN > 900) { this._fastN = 0; this.setFx(this.fx + 1); } }
    else { this._slowN = Math.max(0, this._slowN - 1); }
  }

  _stepControls(now, dt) {
    if (this.mode.control !== 'drag') return;
    if (this.fly) {
      const k = clamp((now - this.fly.t0) / this.fly.ms, 0, 1), e = ease(k), fl = this.fly;
      let d = ((fl.az1 - fl.az0 + 540) % 360) - 180;
      this.cam.az = norm360(fl.az0 + d * e); this.cam.alt = lerp(fl.alt0, fl.alt1, e);
      if (this.mode.projection === 'stereo') this.domeFov = lerp(fl.fov0, fl.fov1, e);
      if (k >= 1) this.fly = null;
      return;
    }
    if (this.pointers.size === 0 && (Math.abs(this.vel.az) > 0.4 || Math.abs(this.vel.alt) > 0.4)) {
      this._applyDrag(this.vel.az * dt, this.vel.alt * dt);
      const damp = Math.exp(-dt * 3.4);
      this.vel.az *= damp; this.vel.alt *= damp;
    }
  }

  // ---------------------------------------------------------------- projection core
  _p(x, y, z) {
    const b = this._b, F = this.F, t = this._tmp;
    const cx = x * b.r[0] + y * b.r[1] + z * b.r[2];
    const cy = x * b.u[0] + y * b.u[1] + z * b.u[2];
    const cz = x * b.f[0] + y * b.f[1] + z * b.f[2];
    t.cz = cz;
    if (this.mode.projection === 'stereo') {
      if (cz <= -0.9) return false;
      const k = (2 * F) / (1 + cz);
      t.x = this.W * this.mode.centerX + cx * k; t.y = this.H * this.mode.centerFrac - cy * k; return true;
    }
    if (cz <= 0.04) return false;
    const k = F / cz;
    t.x = this.W * this.mode.centerX + cx * k; t.y = this.H * this.mode.centerFrac - cy * k; return true;
  }
  _ppd(cz) { // local pixels per degree
    return this.mode.projection === 'stereo' ? (this.F * D2R * 2) / (1 + cz) : (this.F * D2R) / (cz * cz);
  }
  _onScreen(m = 0) { const t = this._tmp; return t.x > -m && t.x < this.W + m && t.y > -m && t.y < this.H + m; }

  // ---------------------------------------------------------------- drawing
  _draw() {
    const ctx = this.ctx, W = this.W, H = this.H, m = this.model;
    const transparent = this.mode.transparent;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    if (!transparent) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, W, H); this._twilightTint(); }

    if (this.layers.milkyWay && this.fx > 0) this._drawMilkyWay(transparent ? 0.55 : 1);
    this._drawNebulae(transparent ? 0.7 : 1);
    if (this.layers.bounds) this._drawBounds();
    if (this.layers.art) this._drawArt();
    if (this.layers.lines) this._drawLines();
    if (this.layers.tether) this._drawTether();
    this._drawStars(transparent);
    if (this.layers.planets) this._drawPlanets();
    this._drawMarks();
    this._drawSun();
    this._drawMoon();
    if (this.mode.ground && !transparent) this._drawGround();
    this._drawHorizon(transparent);
    if (this.layers.labels) this._drawLabels();
    else { this._lab = []; this._drawFeaturedLabels(false); this._drawTetherCaption(); }
    if (this.fx > 0) this._drawMeteors();
    this._drawHighlight();
  }

  _twilightTint() {
    const sa = this.model.sun.alt;
    if (sa < -14) return;
    const k = clamp((sa + 14) / 14, 0, 1); // 0 deep twilight .. 1 sun at horizon or above
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    const a = 0.4 * k;
    g.addColorStop(0, `rgba(18,28,64,${a * 0.7})`); g.addColorStop(1, `rgba(70,46,72,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
  }

  _drawMilkyWay(scale) {
    const main = this.ctx;
    // The band only changes when the view does. Reuse the last render until the camera has moved ~0.1 degree.
    const b = this._b, sm = this.model.sky, qz = (v) => Math.round(v * 500);
    const key = `${this.W}|${this.H}|${this.mwQ}|${this.mode.projection}|${this.mode.centerFrac.toFixed(3)}|${this.mode.centerX.toFixed(3)}|${scale}|${this.fov.toFixed(1)}|${qz(b.f[0])},${qz(b.f[1])},${qz(b.f[2])},${qz(b.u[0])},${qz(b.u[1])},${qz(b.u[2])}|${qz(sm[0])},${qz(sm[1])},${qz(sm[2])},${qz(sm[3])},${qz(sm[4])},${qz(sm[5])},${qz(sm[6])},${qz(sm[7])},${qz(sm[8])}`;
    if (key !== this._mwKey) {
      // while the view is moving, refresh the (soft, slow-looking) band every other frame
      if (this.busy && (this._mwFlip = !this._mwFlip)) { /* reuse last frame's band */ } else { this._mwKey = key; this._renderMilkyWay(scale); }
    }
    main.globalCompositeOperation = 'source-over'; main.globalAlpha = 1; main.imageSmoothingEnabled = true;
    main.drawImage(this.mwCanvas, 0, 0, this.W, this.H);
  }
  _renderMilkyWay(scale) {
    const ctx = this.mwCtx, m = this.model, e = this._e, q = this.mwQ;
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.globalCompositeOperation = 'lighter';
    const fovK = 0.65 + 0.35 * clamp(Math.sqrt(60 / this.fov), 0.5, 1.4);
    for (const b of this.mw) {
      m.toEnuInto(b.v, e);
      if (!this._p(e[0], e[1], e[2])) continue;
      const s = b.size * this._ppd(this._tmp.cz);
      if (!this._onScreen(s)) continue;
      ctx.globalAlpha = b.a * scale * fovK;
      ctx.drawImage(this.mwSprites[b.tint], this._tmp.x - s, this._tmp.y - s, s * 2, s * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const d of this.dust) {
      m.toEnuInto(d.v, e);
      if (!this._p(e[0], e[1], e[2])) continue;
      const s = d.size * this._ppd(this._tmp.cz);
      if (!this._onScreen(s)) continue;
      ctx.globalAlpha = d.a * scale;
      ctx.drawImage(this.dustSprite, this._tmp.x - s, this._tmp.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  _drawNebulae(scale) {
    const ctx = this.ctx, m = this.model, e = this._e;
    ctx.globalCompositeOperation = 'lighter';
    NEBULAE.forEach((n, i) => {
      m.toEnuInto(this.nebV[i], e);
      if (!this._p(e[0], e[1], e[2])) return;
      const s = Math.max(n.size * this._ppd(this._tmp.cz) * 2.4, 12);
      if (!this._onScreen(s)) return;
      ctx.globalAlpha = n.a * 0.34 * scale;
      ctx.drawImage(this.nebSprites[i], this._tmp.x - s, this._tmp.y - s, s * 2, s * 2);
    });
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  _polyline(vecs, closed = false) {
    const ctx = this.ctx, m = this.model, e = this._e;
    let pen = false, any = false;
    for (let i = 0; i < vecs.length; i++) {
      m.toEnuInto(vecs[i], e);
      if (this._p(e[0], e[1], e[2])) {
        if (!pen) ctx.moveTo(this._tmp.x, this._tmp.y); else ctx.lineTo(this._tmp.x, this._tmp.y);
        pen = true; any = true;
      } else pen = false;
    }
    return any;
  }

  _drawBounds() {
    const ctx = this.ctx;
    ctx.lineWidth = 0.8; ctx.setLineDash([2, 6]);
    ctx.strokeStyle = 'rgba(150,172,214,0.12)';
    ctx.beginPath();
    for (const c of this.model.consList) if (c.boundVecs && !c.featured) this._polyline(c.boundVecs.concat([c.boundVecs[0]]));
    ctx.stroke();
    for (const id of ['Cap', 'Sgr']) {
      const c = this.model.cons[id], acc = ACCENT[c.featured.accent];
      ctx.strokeStyle = `rgba(${acc.css},0.4)`; ctx.lineWidth = 1.1; ctx.setLineDash([5, 5]);
      ctx.beginPath(); this._polyline(c.boundVecs.concat([c.boundVecs[0]])); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  _drawLines() {
    const ctx = this.ctx;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(128,150,196,0.20)';
    ctx.beginPath();
    for (const c of this.model.consList) if (!c.featured) for (const pl of c.lineVecs) this._polyline(pl);
    ctx.stroke();
    for (const id of ['Cap', 'Sgr']) {
      const c = this.model.cons[id], acc = ACCENT[c.featured.accent];
      ctx.beginPath(); for (const pl of c.lineVecs) this._polyline(pl);
      if (this.fx > 0) { ctx.lineWidth = 6; ctx.strokeStyle = `rgba(${acc.css},0.07)`; ctx.stroke(); }
      ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(${acc.css},0.62)`; ctx.stroke();
    }
  }

  _drawArt() {
    const ctx = this.ctx;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const id of ['Cap', 'Sgr']) {
      const c = this.model.cons[id], acc = ACCENT[c.featured.accent];
      for (const a of c.artVecs) {
        ctx.beginPath();
        if (!this._polyline(a.vecs)) continue;
        if (a.kind === 'dash') { ctx.setLineDash([3, 7]); ctx.lineWidth = 0.9; ctx.strokeStyle = `rgba(${acc.css},0.28)`; ctx.stroke(); ctx.setLineDash([]); continue; }
        if (this.fx > 0) { ctx.lineWidth = 5; ctx.strokeStyle = `rgba(${acc.css},0.05)`; ctx.stroke(); }
        ctx.lineWidth = 1.05; ctx.strokeStyle = `rgba(${acc.css},0.42)`; ctx.stroke();
      }
    }
  }

  _drawTether() {
    const ctx = this.ctx, m = this.model, tt = m.tether;
    const fromGold = tt.from.con === 'Sgr';
    const colAt = (s, a) => { // s=0 at 'from'
      const sg = fromGold ? s : 1 - s;
      const [r1, g1, b1] = ACCENT.gold.rgb, [r2, g2, b2] = ACCENT.ice.rgb;
      return `rgba(${Math.round(lerp(r1, r2, sg))},${Math.round(lerp(g1, g2, sg))},${Math.round(lerp(b1, b2, sg))},${a})`;
    };
    const pts = this._tpts || (this._tpts = tt.arc.map(() => [0, 0, 0]));
    tt.arc.forEach((v, i) => m.toEnuInto(v, pts[i]));
    const n = pts.length - 1;
    // build visible runs
    const runs = []; let cur = null;
    pts.forEach((e, i) => {
      if (this._p(e[0], e[1], e[2])) { (cur ||= []).push({ x: this._tmp.x, y: this._tmp.y, s: i / n }); }
      else if (cur) { runs.push(cur); cur = null; }
    });
    if (cur) runs.push(cur);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const run of runs) {
      if (run.length < 2) continue;
      const a = run[0], b = run[run.length - 1];
      const mk = (al) => { const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); g.addColorStop(0, colAt(a.s, al)); g.addColorStop(1, colAt(b.s, al)); return g; };
      ctx.beginPath(); run.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineWidth = 9; ctx.strokeStyle = mk(0.08); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = mk(0.2); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.strokeStyle = mk(0.9); ctx.stroke();
    }
    // travelling pulse + comet trail
    const t = ((this.time * 0.00006) % 1);
    for (let k = 0; k < 7; k++) {
      const s = (t - k * 0.012 + 1) % 1, idx = s * n, i0 = Math.floor(idx), f = idx - i0;
      const e0 = pts[i0], e1 = pts[Math.min(n, i0 + 1)];
      const e = [lerp(e0[0], e1[0], f), lerp(e0[1], e1[1], f), lerp(e0[2], e1[2], f)];
      if (!this._p(e[0], e[1], e[2])) continue;
      const R = k === 0 ? 11 : 6 - k * 0.6;
      const g = ctx.createRadialGradient(this._tmp.x, this._tmp.y, 0, this._tmp.x, this._tmp.y, R);
      g.addColorStop(0, colAt(s, k === 0 ? 1 : 0.7 - k * 0.09)); g.addColorStop(1, colAt(s, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this._tmp.x, this._tmp.y, R, 0, TAU); ctx.fill();
    }
    // anchor halos
    for (const [e, st] of [[tt.enuFrom, tt.from], [tt.enuTo, tt.to]]) {
      if (!this._p(e[0], e[1], e[2])) continue;
      const acc = st.con === 'Sgr' ? ACCENT.gold : ACCENT.ice;
      ctx.strokeStyle = `rgba(${acc.css},0.55)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(this._tmp.x, this._tmp.y, 10 + 1.5 * Math.sin(this.time / 600), 0, TAU); ctx.stroke();
    }
    this._tetherPts = pts;
  }

  _drawStars(transparent) {
    const ctx = this.ctx, m = this.model, e = m.enu, n = m.n;
    const zoom = clamp(0.75 + 0.5 * Math.log2(100 / Math.max(this.fov, 22)), 0.8, 1.8) * (transparent ? 1.12 : 1);
    const t = this.time / 1000;
    const hideBelow = this.mode.ground || transparent, tw = this.fx >= 2;
    for (let i = n - 1; i >= 0; i--) { // faint first, bright on top
      const k = i * 3, x = e[k], y = e[k + 1], z = e[k + 2];
      if (hideBelow && z < -0.012) continue;
      if (!this._p(x, y, z)) continue;
      const px = this._tmp.x, py = this._tmp.y;
      if (px < -20 || px > this.W + 20 || py < -20 || py > this.H + 20) continue;
      const mag = m.mag[i];
      const s = 6.3 - mag;
      let r = (0.55 + 0.5 * Math.pow(s, 1.42)) * zoom;
      let a = clamp(0.35 + s * 0.17, 0.3, 1);
      if (tw && mag < 3.6) a *= 0.93 + 0.07 * Math.sin(t * 2.3 + i * 1.7);
      const ci = m.colorIdx[i];
      if (r < 1.5) {
        ctx.globalAlpha = a * (transparent ? 1 : 0.9); ctx.fillStyle = this.starCss[ci];
        const q = Math.max(0.7, r);
        ctx.fillRect(px - q * 0.5, py - q * 0.5, q, q);
      } else {
        const R = r * 2.3;
        ctx.globalAlpha = a; ctx.drawImage(this.starSprites[ci], px - R, py - R, R * 2, R * 2);
        if (mag < 1.7 && this.fx > 0) {
          ctx.globalAlpha = 0.28 * a; ctx.strokeStyle = this.starCss[ci]; ctx.lineWidth = 0.7;
          const L = r * 4.2; ctx.beginPath();
          ctx.moveTo(px - L, py); ctx.lineTo(px + L, py); ctx.moveTo(px, py - L); ctx.lineTo(px, py + L); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawSun() {
    const s = this.model.sun;
    if (s.alt < -4 || !this._p(s.enu[0], s.enu[1], s.enu[2])) return;
    const ctx = this.ctx, x = this._tmp.x, y = this._tmp.y;
    const k = clamp((s.alt + 4) / 8, 0, 1);
    ctx.globalCompositeOperation = 'lighter';
    const R = 120 * clamp(this.fov / 80, 0.7, 1.5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(255,236,190,${0.8 * k})`); g.addColorStop(0.12, `rgba(255,200,120,${0.4 * k})`);
    g.addColorStop(0.5, `rgba(255,140,80,${0.08 * k})`); g.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(255,246,222,${k})`; ctx.beginPath(); ctx.arc(x, y, Math.max(6, this._ppd(this._tmp.cz) * 0.28), 0, TAU); ctx.fill();
  }

  _drawMoon() {
    const mo = this.model.moon;
    if (mo.alt < -3 || !this._p(mo.enu[0], mo.enu[1], mo.enu[2])) return;
    const ctx = this.ctx, x = this._tmp.x, y = this._tmp.y;
    const R = Math.max(9, this._ppd(this._tmp.cz) * 0.52);
    // direction toward the Sun on screen
    const sv = this.model.sun.enu, mv = mo.enu;
    const d = M.vnorm([sv[0] - mv[0] * M.dot(mv, sv), sv[1] - mv[1] * M.dot(mv, sv), sv[2] - mv[2] * M.dot(mv, sv)]);
    const probe = M.vnorm([mv[0] + d[0] * 0.02, mv[1] + d[1] * 0.02, mv[2] + d[2] * 0.02]);
    let ang = 0;
    if (this._p(probe[0], probe[1], probe[2])) ang = Math.atan2(this._tmp.y - y, this._tmp.x - x);
    const k = 2 * mo.fraction - 1;
    // halo
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(x, y, R * 0.8, x, y, R * 5);
    hg.addColorStop(0, `rgba(190,205,240,${0.16 * (0.3 + mo.fraction)})`); hg.addColorStop(1, 'rgba(190,205,240,0)');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, R * 5, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(46,54,78,0.9)'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); // earthshine disc
    ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
    const rx = Math.max(0.01, R * Math.abs(k));
    if (k >= 0) ctx.ellipse(0, 0, rx, R, 0, Math.PI / 2, Math.PI * 1.5, false);
    else ctx.ellipse(0, 0, rx, R, 0, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
    const lg = ctx.createRadialGradient(-R * 0.2, -R * 0.2, R * 0.1, 0, 0, R);
    lg.addColorStop(0, '#fff7e0'); lg.addColorStop(1, '#d9d4c4');
    ctx.fillStyle = lg; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(120,118,112,0.28)';
    [[-0.3, -0.25, 0.28], [0.15, -0.4, 0.2], [0.25, 0.15, 0.3], [-0.2, 0.35, 0.2]].forEach(([ax, ay, ar]) => { ctx.beginPath(); ctx.arc(ax * R, ay * R, ar * R, 0, TAU); ctx.fill(); });
    ctx.restore(); ctx.restore();
  }

  _drawGround() {
    const b = this._b, H2 = Math.hypot(this.W, this.H) / 2;
    const maxTheta = this.mode.projection === 'stereo' ? 2 * Math.atan(H2 / (2 * this.F)) : Math.atan(H2 / this.F);
    const camAlt = Math.asin(clamp(b.f[2], -1, 1));
    if (camAlt - maxTheta > 0.02) return; // horizon not in view
    const ctx = this.ctx;
    if (!this._gq) { // the ground is fixed in the local (alt/az) frame, so its geometry is built once
      const edges = [0, -3, -7, -13, -22, -35, -55, -90], cols = ['#0b111d', '#090e19', '#070b14', '#05080f', '#04060b', '#030509', '#020407'], STEP = 6;
      this._gq = [];
      for (let bi = 0; bi < edges.length - 1; bi++) {
        const top = edges[bi], bot = bi + 2 < edges.length ? edges[bi + 1] - 1.5 : edges[bi + 1], segs = [];
        for (let az = 0; az < 360; az += STEP) segs.push([[az, top], [az + STEP + 0.6, top], [az + STEP + 0.6, bot], [az, bot]].map(([a, l]) => M.altAzToEnu(l, a)));
        this._gq.push({ segs, col: cols[bi] });
      }
    }
    for (const band of this._gq) {
      ctx.beginPath();
      for (const pts of band.segs) {
        let ok = true; const sc = this._sc || (this._sc = [0, 0, 0, 0, 0, 0, 0, 0]);
        for (let j = 0; j < 4; j++) { const p = pts[j]; if (!this._p(p[0], p[1], p[2]) || this._tmp.cz < -0.8) { ok = false; break; } sc[j * 2] = this._tmp.x; sc[j * 2 + 1] = this._tmp.y; }
        if (!ok) continue;
        ctx.moveTo(sc[0], sc[1]); ctx.lineTo(sc[2], sc[3]); ctx.lineTo(sc[4], sc[5]); ctx.lineTo(sc[6], sc[7]); ctx.closePath();
      }
      ctx.fillStyle = band.col; ctx.fill();
    }
  }

  _drawHorizon(transparent) {
    const ctx = this.ctx;
    const pts = this._hzPts || (this._hzPts = Array.from({ length: 121 }, (_, i) => M.altAzToEnu(0, i * 3)));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (w, col) => {
      ctx.beginPath(); let pen = false;
      for (const p of pts) {
        if (this._p(p[0], p[1], p[2])) { if (!pen) ctx.moveTo(this._tmp.x, this._tmp.y); else ctx.lineTo(this._tmp.x, this._tmp.y); pen = true; } else pen = false;
      }
      ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
    };
    if (!transparent) { stroke(16, 'rgba(110,150,255,0.035)'); stroke(7, 'rgba(130,170,255,0.07)'); }
    stroke(1, transparent ? 'rgba(160,200,255,0.4)' : 'rgba(150,190,255,0.5)');
    // compass marks
    const names = [['N', 0, 1], ['NE', 45, 0], ['E', 90, 1], ['SE', 135, 0], ['S', 180, 1], ['SW', 225, 0], ['W', 270, 1], ['NW', 315, 0]];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [name, az, major] of names) {
      const p = M.altAzToEnu(major ? 2.2 : 1.8, az);
      if (!this._p(p[0], p[1], p[2]) || !this._onScreen(-10)) continue;
      ctx.font = `${major ? 600 : 500} ${major ? 13 : 10}px "Space Grotesk", system-ui, sans-serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = major ? '2px' : '1px';
      ctx.fillStyle = major ? 'rgba(235,242,255,0.9)' : 'rgba(190,205,235,0.55)';
      ctx.fillText(name, this._tmp.x, this._tmp.y);
    }
    if (transparent) { // degree scale for aligning with the real horizon
      ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
      for (let az = 0; az < 360; az += 15) {
        if (az % 45 === 0) continue;
        const p = M.altAzToEnu(1.5, az);
        if (!this._p(p[0], p[1], p[2]) || !this._onScreen(-10)) continue;
        ctx.fillStyle = 'rgba(190,210,245,0.5)'; ctx.fillText(String(az), this._tmp.x, this._tmp.y);
      }
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.textBaseline = 'alphabetic';
  }

  // ---- labels: greedy placement so names never pile on top of each other ----
  _tw(text) { // cached text width for the current font (measureText is slow on phones)
    const k = this.ctx.font + '|' + (this.ctx.letterSpacing || '') + '|' + text;
    let w = this._wcache.get(k);
    if (w === undefined) { if (this._wcache.size > 700) this._wcache.clear(); w = this.ctx.measureText(text).width; this._wcache.set(k, w); }
    return w;
  }
  _overlaps(r) {
    for (const o of this._lab) if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return true;
    return false;
  }
  _halo(text, x, y) {
    const ctx = this.ctx;
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(4,5,10,0.85)';
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  }
  /** Draws `text` next to (x,y) at the first free offset. Returns false if there was no room. */
  _label(text, x, y, offsets = [[8, -5], [8, 12], [-8, -5], [-8, 12], [8, -18], [-8, 22]]) {
    const ctx = this.ctx, w = this._tw(text), h = 13;
    for (const [dx, dy] of offsets) {
      const left = dx < 0 ? x + dx - w : x + dx, top = y + dy - h + 3;
      const r = { x: left - 3, y: top - 1, w: w + 6, h: h + 2 };
      if (left < 2 || left + w > this.W - 2 || top < 2 || top + h > this.H - 2) continue;
      if (this._overlaps(r)) continue;
      this._lab.push(r);
      ctx.textAlign = 'left'; this._halo(text, left, y + dy);
      return true;
    }
    return false;
  }

  _drawFeaturedLabels(withStars) {
    const ctx = this.ctx, m = this.model;
    ctx.textAlign = 'center';
    for (const id of ['Cap', 'Sgr']) {
      const t = m.targets[id], f = t.con.featured, acc = ACCENT[f.accent];
      if (t.alt < -2 && this.mode.ground) continue;
      if (!this._p(t.enu[0], t.enu[1], t.enu[2]) || !this._onScreen(-30)) continue;
      const x = this._tmp.x, y = this._tmp.y;
      this._lab.push({ x: x - 82, y: y - 44, w: 164, h: 74 });
      // soft glow behind the glyph: a small radial gradient is far cheaper than shadowBlur
      const g = ctx.createRadialGradient(x, y - 22, 0, x, y - 22, 26);
      g.addColorStop(0, `rgba(${acc.css},0.28)`); g.addColorStop(1, `rgba(${acc.css},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - 26, y - 48, 52, 52);
      ctx.fillStyle = `rgba(${acc.css},0.95)`;
      ctx.font = '600 24px "Space Grotesk", system-ui, sans-serif';
      ctx.fillText(f.glyph, x, y - 14);
      ctx.font = '600 12px "Space Grotesk", system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
      ctx.fillText(f.title.toUpperCase(), x, y + 6);
      ctx.font = '400 10.5px "Inter", system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.5px';
      ctx.fillStyle = `rgba(${acc.css},0.6)`;
      ctx.fillText(f.epithet, x, y + 21);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
    if (withStars) this._drawFeaturedStarLabels();
  }
  _drawFeaturedStarLabels() {
    const ctx = this.ctx, m = this.model;
    ctx.font = '500 11px "Inter", system-ui, sans-serif';
    const order = this._fsOrder || (this._fsOrder = [...m.featuredStars].sort((a, b) => a.mag - b.mag)); // brightest first
    for (const s of order) {
      const e = s.enu;
      if (e[2] < -0.01 && this.mode.ground) continue;
      if (!this._p(e[0], e[1], e[2]) || !this._onScreen(-10)) continue;
      const acc = ACCENT[s.con === 'Sgr' ? 'gold' : 'ice'];
      ctx.fillStyle = `rgba(${acc.css},0.92)`;
      this._label(s.name, this._tmp.x, this._tmp.y);
    }
  }

  /** "RANCHI <-> MANIPAL  48.8 deg" on one line, placed where it collides with nothing (tries spots along and beside the arc). */
  _drawTetherCaption() {
    const pts = this._tetherPts, tt = this.model.tether;
    if (!this.layers.tether || !pts) return;
    const ctx = this.ctx, n = pts.length - 1;
    const text = `${(this.config.tether?.label || '').toUpperCase()}  \u00b7  ${tt.sepDeg.toFixed(1)}\u00b0`;
    ctx.save(); ctx.textAlign = 'center';
    ctx.font = '500 9.5px "Space Grotesk", system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
    const w = this._tw(text);
    for (const f of [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8]) {
      const p = pts[Math.round(n * f)];
      if (!this._p(p[0], p[1], p[2])) continue;
      const bx = this._tmp.x, by = this._tmp.y;
      for (const dy of [-16, 20, -30, 34, 0]) for (const dx of [0, w / 2 + 12, -(w / 2 + 12)]) {
        const x = bx + dx, y = by + dy;
        if (x - w / 2 < 6 || x + w / 2 > this.W - 6 || y < 70 || y > this.H - 6) continue;
        const r = { x: x - w / 2 - 3, y: y - 11, w: w + 6, h: 15 };
        if (this._overlaps(r)) continue;
        this._lab.push(r);
        ctx.fillStyle = 'rgba(235,240,255,0.82)';
        this._halo(text, x, y);
        ctx.restore();
        return;
      }
    }
    ctx.restore();
  }

  _drawLabels() {
    const ctx = this.ctx, m = this.model, e = this._e;
    this._lab = [];
    this._drawFeaturedLabels(false);   // big sign names reserve their space first
    this._drawTetherCaption();
    this._drawFeaturedStarLabels();
    // planets
    if (this.layers.planets && m.planetsInRange) {
      ctx.font = '600 11px "Inter", system-ui, sans-serif'; ctx.textAlign = 'left';
      for (const p of m.planets) {
        if (p.alt < -1 && this.mode.ground) continue;
        if (!this._p(p.enu[0], p.enu[1], p.enu[2]) || !this._onScreen(-10)) continue;
        ctx.fillStyle = `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},0.95)`;
        this._label(p.name, this._tmp.x, this._tmp.y, [[10, -6], [10, 13], [-10, -6], [-10, 13]]);
      }
    }
    ctx.font = '400 10.5px "Inter", system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(205,218,245,0.62)';
    const featuredHips = this._fHips || (this._fHips = new Set(m.featuredStars.map((s) => s.hip)));
    const lim = this.fx > 0 ? 2.4 : 1.8;
    for (let i = 0; i < m.n; i++) {
      if (m.mag[i] > lim) break;
      const name = m.names[m.hip[i]];
      if (!name || featuredHips.has(m.hip[i])) continue;
      const k = i * 3, z = m.enu[k + 2];
      if (z < -0.01) continue;
      if (!this._p(m.enu[k], m.enu[k + 1], z) || !this._onScreen(-10)) continue;
      this._label(name, this._tmp.x, this._tmp.y);
    }
    if (this.fov < 125) {
      ctx.textAlign = 'center'; ctx.font = '500 9px "Space Grotesk", system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
      ctx.fillStyle = 'rgba(150,170,214,0.4)';
      for (const c of m.consList) {
        if (c.featured || !c.centreVec) continue;
        m.toEnuInto(c.centreVec, e);
        if (e[2] < -0.05) continue;
        if (!this._p(e[0], e[1], e[2]) || !this._onScreen(-10)) continue;
        const name = c.name.toUpperCase(), w = this._tw(name), r = { x: this._tmp.x - w / 2 - 2, y: this._tmp.y - 10, w: w + 4, h: 13 };
        if (r.x < 2 || r.x + w > this.W - 2 || this._overlaps(r)) continue;
        this._lab.push(r);
        ctx.fillText(name, this._tmp.x, this._tmp.y);
      }
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
  }

  // ---------------------------------------------------------------- planets, hearts, shooting stars, highlight
  _drawPlanets() {
    const m = this.model;
    if (!m.planetsInRange) return;
    const ctx = this.ctx, zoom = clamp(0.85 + 0.35 * Math.log2(100 / Math.max(this.fov, 22)), 0.9, 1.6);
    for (const p of m.planets) {
      if (p.mag > 4.5) continue;
      if (this.mode.ground && p.alt < -1) continue;
      if (!this._p(p.enu[0], p.enu[1], p.enu[2]) || !this._onScreen(30)) continue;
      const x = this._tmp.x, y = this._tmp.y;
      const r = clamp(2.1 + (1.6 - p.mag) * 0.62, 2.1, 6.2) * zoom, [R, G, B] = p.rgb;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5; ctx.drawImage(this.glowSprite, x - r * 4, y - r * 4, r * 8, r * 8);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${R},${G},${B})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, TAU); ctx.fill();
      if (p.name === 'Saturn') { ctx.strokeStyle = `rgba(${R},${G},${B},0.7)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y, r * 2.1, r * 0.7, -0.35, 0, TAU); ctx.stroke(); }
    }
  }

  _drawMarks() {
    if (!this.marks.length) return;
    const ctx = this.ctx, m = this.model;
    ctx.textAlign = 'center'; ctx.font = '12px "Inter", system-ui, sans-serif';
    for (const mk of this.marks) {
      const k = mk.i * 3;
      if (this.mode.ground && m.enu[k + 2] < -0.01) continue;
      if (!this._p(m.enu[k], m.enu[k + 1], m.enu[k + 2]) || !this._onScreen(-8)) continue;
      const beat = 1 + 0.12 * Math.sin(this.time / 420);
      ctx.fillStyle = 'rgba(255,150,180,0.95)';
      ctx.save(); ctx.translate(this._tmp.x, this._tmp.y - 15); ctx.scale(beat, beat); ctx.fillText('♥', 0, 0); ctx.restore();
    }
  }

  _drawMeteors() {
    const now = this.time, ctx = this.ctx;
    if (now > this._nextMeteor && this.meteors.length < 2 && this.W > 10) {
      const ang = (Math.random() < 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.7) + Math.PI / 2; // mostly downward
      const len = 110 + Math.random() * 120;
      this.meteors.push({ x: this.W * (0.1 + Math.random() * 0.8), y: this.H * (0.08 + Math.random() * 0.32), dx: Math.cos(ang), dy: Math.sin(ang), len, t0: now, ms: 650 + Math.random() * 300 });
      this._nextMeteor = now + 9000 + Math.random() * 14000;
    }
    if (!this.meteors.length) return;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    this.meteors = this.meteors.filter((mt) => {
      const k = (now - mt.t0) / mt.ms;
      if (k >= 1) return false;
      this.lastMeteorAt = now;
      const head = Math.min(1, k * 1.6) * mt.len, tail = Math.max(0, k * 1.6 - 0.55) * mt.len;
      const hx = mt.x + mt.dx * head, hy = mt.y + mt.dy * head, tx = mt.x + mt.dx * tail, ty = mt.y + mt.dy * tail;
      const g = ctx.createLinearGradient(tx, ty, hx, hy), a = 1 - k * k;
      g.addColorStop(0, 'rgba(180,210,255,0)'); g.addColorStop(1, `rgba(255,250,240,${0.9 * a})`);
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.8 * a})`; ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, TAU); ctx.fill();
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';
  }
  /** True for a moment after a shooting star, so a tap can become a wish. */
  get meteorRecent() { return this.time - this.lastMeteorAt < 1800; }

  _drawHighlight() {
    const h = this.highlight;
    if (!h) return;
    const age = performance.now() - h.t0;
    if (age > h.ms) { this.highlight = null; return; }
    const e = h.get();
    if (!e || !this._p(e[0], e[1], e[2])) return;
    const ctx = this.ctx, x = this._tmp.x, y = this._tmp.y, fade = age > h.ms - 900 ? (h.ms - age) / 900 : 1, ph = (age % 1400) / 1400;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * fade})`; ctx.beginPath(); ctx.arc(x, y, 15 + 2 * Math.sin(age / 180), 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ph) * fade})`; ctx.beginPath(); ctx.arc(x, y, 15 + ph * 34, 0, TAU); ctx.stroke();
    if (h.label) {
      ctx.font = '600 12px "Space Grotesk", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = `rgba(255,255,255,${fade})`;
      this._halo(h.label, x, y - 24);
    }
  }

  // ---------------------------------------------------------------- picking (tap to identify)
  /** Nearest object to a canvas point: planets, Sun, Moon, named stars. Returns null when nothing is close. */
  pick(px, py, reach = 28) {
    const m = this.model, e = this._e;
    if (!this._b) return null;
    let best = null, bd = reach * reach;
    const test = (x, y, bonus, obj) => { const d = (x - px) * (x - px) + (y - py) * (y - py) - bonus; if (d < bd) { bd = d; best = obj; } };
    for (const p of m.planets) {
      if (this.mode.ground && p.alt < -1) continue;
      if (this._p(p.enu[0], p.enu[1], p.enu[2])) test(this._tmp.x, this._tmp.y, 160, { kind: 'planet', ref: p, name: p.name });
    }
    const sun = m.sun, moon = m.moon;
    if (sun.alt > -4 && this._p(sun.enu[0], sun.enu[1], sun.enu[2])) test(this._tmp.x, this._tmp.y, 200, { kind: 'sun', name: 'Sun' });
    if (moon.alt > -3 && this._p(moon.enu[0], moon.enu[1], moon.enu[2])) test(this._tmp.x, this._tmp.y, 200, { kind: 'moon', name: 'Moon' });
    for (const ns of m.namedStars) {
      if (ns.mag > 4.3) continue;
      const k = ns.i * 3;
      if (this.mode.ground && m.enu[k + 2] < -0.01) continue;
      if (this._p(m.enu[k], m.enu[k + 1], m.enu[k + 2])) test(this._tmp.x, this._tmp.y, (4.3 - ns.mag) * 40, { kind: 'star', i: ns.i, name: ns.name, mag: ns.mag });
    }
    return best;
  }
}
