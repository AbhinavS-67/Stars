// ARView.js - camera passthrough + gyro-driven sky + targeting reticle + lock-on card.
// Fallback ladder: camera+sensors -> camera + drag-to-look -> sensors + dark sky -> plain dome.
import * as M from '../utils/celestialMath.js';
import { OrientationTracker } from '../utils/orientation.js';
import { esc, fmt, tokens } from '../utils/text.js';

const ACC = { Cap: 'ice', Sgr: 'gold' };

export class ARView {
  constructor({ model, sky, config, root, video, notify }) {
    this.model = model; this.sky = sky; this.config = config;
    this.root = root; this.video = video; this.notify = notify || (() => {});
    this.tracker = new OrientationTracker({ declination: model.declination });
    this.active = false; this.mode = null; this.stream = null;
    this.target = 'Cap'; this.locked = null; this.dwell = 0;
    this.found = new Set(); this.aligning = false;
    this.lockRadius = config.ar?.lockRadiusDeg ?? 11;
    this._statusT = 0; this._status = {};
    this._buildDOM();
  }

  // ------------------------------------------------------------ DOM
  _buildDOM() {
    this.root.innerHTML = `
      <div class="ar-veil"></div>
      <div class="ar-top glass">
        <button class="ar-exit" data-act="exit" aria-label="Close AR"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="ar-chips" role="tablist">
          <button class="chip chip-ice" data-target="Cap"><span>♑︎</span> Capricornus</button>
          <button class="chip chip-gold" data-target="Sgr"><span>♐︎</span> Sagittarius</button>
        </div>
      </div>
      <div class="ar-reticle" aria-hidden="true"><div class="ring"></div><div class="dot"></div><i></i><i></i><i></i><i></i></div>
      <div class="ar-arrow" aria-hidden="true"><svg viewBox="0 0 40 52"><path d="M20 2 L36 30 L24 25 L24 50 L16 50 L16 25 L4 30 Z"/></svg></div>
      <div class="ar-marker marker-Cap"><b>♑︎</b><span>Capricornus</span></div>
      <div class="ar-marker marker-Sgr"><b>♐︎</b><span>Sagittarius</span></div>
      <div class="ar-align glass" hidden><span>Drag sideways until N / E / S / W match the real horizon</span><button class="chip small" data-act="align">Done</button></div>
      <div class="ar-hint glass"><div class="ar-hint-main"></div><div class="ar-hint-sub"></div></div>
      <div class="ar-tools glass">
        <label>Zoom match<input type="range" min="38" max="88" step="1" class="ar-fov"></label>
        <button class="chip small" data-act="align">Align north</button>
      </div>
      <div class="lock-card glass" hidden></div>
      <div class="reveal" hidden><p></p></div>`;
    this.$ = (s) => this.root.querySelector(s);
    this.$$ = (s) => [...this.root.querySelectorAll(s)];
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-target]'); if (t) { this.setTarget(t.dataset.target); return; }
      const a = e.target.closest('[data-act]');
      if (a?.dataset.act === 'exit') this.onExit?.();
      if (a?.dataset.act === 'align') this.setAligning(!this.aligning);
      if (a?.dataset.act === 'closeLock') { this.dismissed = this.locked; this.hideLock(); }
      if (a?.dataset.act === 'next') this.setTarget(a.dataset.to);
    });
    this.$('.ar-fov').addEventListener('input', (e) => { this.sky.fov = +e.target.value; });
    // align-by-dragging: slide the virtual sky until its N/E/S/W marks sit on the real horizon
    const cv = this.sky.canvas; let last = null;
    cv.addEventListener('pointerdown', (e) => { if (this.active && this.aligning && this.mode !== 'camera-only') last = e.clientX; });
    cv.addEventListener('pointermove', (e) => {
      if (last == null) return;
      const dx = e.clientX - last; last = e.clientX;
      this.tracker.nudgeBy(-dx / this.sky.pxPerDeg);
    });
    const end = () => { last = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }

  setAligning(on) {
    this.aligning = on;
    this.$$('[data-act="align"]').forEach((b) => b.classList.toggle('on', on));
    this.$('.ar-align').hidden = !on;
    this.root.classList.toggle('aligning', on);
  }
  setTarget(id) {
    this.target = id;
    this.dismissed = null;
    this.$$('[data-target]').forEach((b) => b.classList.toggle('on', b.dataset.target === id));
    this.root.dataset.target = id;
  }

  // ------------------------------------------------------------ lifecycle
  async _openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'insecure' };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', ''); this.video.muted = true;
      await this.video.play().catch(() => {});
      return { ok: true };
    } catch (e) { return { ok: false, reason: e?.name || 'error' }; }
  }

  /** Call straight from a tap so the iOS motion prompt is allowed. Returns the chosen mode or null. */
  async start() {
    const sensorReq = OrientationTracker.supported ? this.tracker.requestPermission() : Promise.resolve(false);
    const camReq = this._openCamera();
    const [sensorOk, cam] = await Promise.all([sensorReq, camReq]);

    let sensors = false;
    if (sensorOk) {
      this.tracker.start();
      sensors = await this.tracker.waitForData(1800);
      if (!sensors) this.tracker.stop();
    }
    if (!cam.ok && !sensors) {
      this.notify(this._explain(cam.reason, false), 'warn');
      return null;
    }
    this.mode = cam.ok && sensors ? 'ar' : cam.ok ? 'camera-only' : 'gyro-sky';
    if (!cam.ok) this.notify(this._explain(cam.reason, true), 'info');
    else if (!sensors) this.notify(sensorOk ? 'No motion sensor data. Drag to look around instead.' : 'Motion access was declined. Drag to look around instead.', 'info');

    const withVideo = cam.ok;
    this.root.classList.toggle('no-video', !withVideo);
    this.video.classList.toggle('on', withVideo);
    this.sky.setMode({ projection: 'gnomonic', control: sensors ? 'external' : 'drag', transparent: withVideo, ground: !withVideo, centerFrac: 0.5, centerX: 0.5 });
    if (!sensors) { // start looking at the target
      const t = this.model.targets[this.target];
      this.sky.cam.az = t.az; this.sky.cam.alt = Math.max(5, Math.min(70, t.alt));
    }
    this.$('.ar-fov').value = this.sky.arFov;
    this.active = true; this.dwell = 0; this.locked = null;
    this.root.hidden = false; this.setTarget(this.target);
    this.setAligning(sensors && !this.tracker.absolute);
    try { await screen.orientation?.lock?.('portrait'); } catch { /* not supported / not fullscreen */ }
    return this.mode;
  }

  _explain(reason, sensorsOk) {
    if (!sensorsOk && reason === 'NotFoundError') return 'No camera or motion sensors found on this device. Using the normal sky view.';
    if (reason === 'insecure') return 'Camera needs a secure (https) page. Showing the sky without it.';
    if (reason === 'NotAllowedError') return 'Camera permission was declined. Showing the live sky without the camera.';
    if (reason === 'NotFoundError') return 'No camera found. Showing the live sky without it.';
    return sensorsOk ? 'Camera unavailable. Showing the live sky without it.' : 'Camera and motion sensors are unavailable here. Using the normal sky view.';
  }

  stop() {
    this.active = false;
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    this.video.srcObject = null; this.video.classList.remove('on');
    this.tracker.stop();
    this.hideLock(); this.root.hidden = true;
    try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ per frame
  beforeFrame(dt) {
    if (!this.active) return;
    if (this.sky.mode.control === 'external') { this.tracker.update(dt); this.sky.setBasis(this.tracker.f, this.tracker.u); }
  }

  afterFrame(dt, now) {
    if (!this.active) return;
    const sky = this.sky, m = this.model, W = sky.W, H = sky.H;
    const fwd = sky.cameraForward, cam = M.enuToAltAz(fwd);
    const t = m.targets[this.target];

    // lock zone ring follows the real angular radius
    const ringPx = M.clamp(this.lockRadius * sky.pxPerDeg * 2, 70, Math.min(W, H) * 0.62);
    this.$('.ar-reticle .ring').style.width = this.$('.ar-reticle .ring').style.height = ringPx + 'px';

    // markers for both signs
    for (const id of ['Cap', 'Sgr']) {
      const tt = m.targets[id], el = this.$('.marker-' + id);
      const p = sky.projectEnu(tt.enu);
      const show = p.visible && tt.alt > -2 && p.x > -40 && p.x < W + 40 && p.y > -40 && p.y < H + 40;
      el.style.display = show ? '' : 'none';
      if (show) el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
      el.classList.toggle('locked', this.locked === id);
    }

    // arrow + hint toward the selected sign
    const d = M.angSep(fwd, t.enu);
    const c = sky.cameraComponents(t.enu);
    const ang = Math.atan2(c.cy, Math.abs(c.cx) < 1e-6 && Math.abs(c.cy) < 1e-6 ? 1 : c.cx);
    const R = Math.min(W, H) * 0.36;
    const arrow = this.$('.ar-arrow');
    const far = d > this.lockRadius * 1.3;
    arrow.style.opacity = far ? '1' : '0';
    arrow.style.transform = `translate(${W / 2 + Math.cos(ang) * R}px,${H / 2 - Math.sin(ang) * R}px) translate(-50%,-50%) rotate(${90 - ang * M.R2D}deg)`;

    if (now - this._statusT > 800) { this._statusT = now; this._status = m.targetStatus(this.target); this._updateLockLive(); }
    this._hintFor(t, cam, d);

    // lock-on with dwell + hysteresis
    let best = null, bd = 1e9;
    for (const id of ['Cap', 'Sgr']) {
      const tt = m.targets[id], dd = M.angSep(fwd, tt.enu);
      if (tt.alt > 0 && dd < this.lockRadius && dd < bd) { best = id; bd = dd; }
    }
    if (best && best !== this.dismissed) {
      this.dwell += dt;
      if (this.dwell > 0.6 && this.locked !== best) this.showLock(best);
    } else {
      this.dwell = 0;
      if (this.locked) {
        const dd = M.angSep(fwd, m.targets[this.locked].enu);
        if (dd > this.lockRadius + 6 || m.targets[this.locked].alt <= 0) this.hideLock();
      }
      if (this.dismissed && M.angSep(fwd, m.targets[this.dismissed].enu) > this.lockRadius + 6) this.dismissed = null;
    }
    this.root.classList.toggle('is-locked', !!this.locked);
  }

  _setHint(main, sub = '') {
    this.$('.ar-hint-main').textContent = main || '';
    this.$('.ar-hint-sub').textContent = sub;
    this.$('.ar-hint').style.opacity = main ? '1' : '0';
  }

  _hintFor(t, cam, d) {
    const name = t.con.featured.title;
    if (t.alt <= 0) {
      const st = this._status;
      const when = st?.rise ? `rises at ${M.fmtTimeRel(st.rise, this.model.date)} toward ${M.compassPoint(t.az)}` : 'not rising soon';
      this._setHint(`${name} is below the horizon`, when);
      return;
    }
    if (d <= this.lockRadius) { this._setHint(this.locked ? '' : `Hold steady on ${name}`, ''); return; }
    const yaw = M.norm180(t.az - cam.az), pitch = t.alt - cam.alt;
    const parts = [];
    if (Math.abs(yaw) > 3) parts.push(`Turn ${yaw > 0 ? 'right' : 'left'} ${Math.round(Math.abs(yaw))}°`);
    if (Math.abs(pitch) > 3) parts.push(`${pitch > 0 ? 'Pitch up' : 'Pitch down'} ${Math.round(Math.abs(pitch))}°`);
    this._setHint(parts.join('  ·  ') || `Almost on ${name}`, `${name} is ${Math.round(d)}° away`);
  }

  // ------------------------------------------------------------ lock-on card
  showLock(id) {
    this.locked = id;
    const m = this.model, c = m.cons[id], f = c.featured, tk = tokens(m, this.config);
    const acc = ACC[id], other = id === 'Cap' ? 'Sgr' : 'Cap', of = m.cons[other].featured;
    const dists = f.stars.map((s) => s.distLy), lo = Math.min(...dists), hi = Math.max(...dists);
    const personal = fmt(this.config.lockOn?.[id.toLowerCase()] || '', tk);
    const card = this.$('.lock-card');
    card.className = `lock-card glass acc-${acc}`;
    card.innerHTML = `
      <div class="lock-head"><span class="glyph">${f.glyph}</span>
        <div><h3>${esc(f.title)}</h3><p>${esc(f.epithet)}</p></div>
        <button class="x" data-act="closeLock" aria-label="Close">×</button></div>
      <div class="lock-grid">
        <div><label>Astrological dates</label><b>${esc(f.tropicalDates)}</b></div>
        <div><label>From ${esc(m.obs.name)} now</label><b class="live-vis">…</b><small class="live-sub"></small></div>
      </div>
      ${personal ? `<p class="personal">${esc(personal)}</p>` : ''}
      <button class="chip next" data-act="next" data-to="${other}"><span>${of.glyph}</span> Now find ${esc(of.title)}</button>
      <label class="lbl">Notable stars <em>${lo}\u2013${hi} light-years away</em></label>
      <ul class="star-list">${f.stars.map((s) => `<li><b>${esc(s.name)}</b><span>${esc(s.designation)} \u00b7 mag ${s.mag.toFixed(1)}</span><em>${s.distLy} ly</em></li>`).join('')}</ul>
      <p class="sunpass">${esc(f.sunPasses)}.</p>
      <p class="myth">${esc(f.myth)}</p>`;
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('in'));
    this._updateLockLive();
    if (!this.found.has(id)) { this.found.add(id); this._reveal(id, tk); }
  }
  hideLock() { const card = this.$('.lock-card'); card.classList.remove('in'); card.hidden = true; this.locked = null; }

  _updateLockLive() {
    if (!this.locked) return;
    const st = this.model.targetStatus(this.locked);
    const v = this.$('.live-vis'), s = this.$('.live-sub');
    if (!v) return;
    v.textContent = st.above ? `Above horizon · ${Math.round(st.alt)}° ${st.compass}` : 'Below horizon';
    s.textContent = st.above ? `peaks ${Math.round(st.maxAlt)}° at ${M.fmtTimeRel(st.transit, this.model.date)}` : (st.rise ? `rises ${M.fmtTimeRel(st.rise, this.model.date)}` : '');
  }

  _reveal(id, tk) {
    const msgs = [fmt(this.config.reveal?.[id.toLowerCase()] || '', tk)];
    if (this.found.size === 2 && this.config.reveal?.both) msgs.push(fmt(this.config.reveal.both, tk));
    const el = this.$('.reveal'), p = el.querySelector('p');
    const secs = (this.config.reveal?.seconds || 7) * 1000;
    let i = 0;
    const next = () => {
      if (i >= msgs.length || !this.active) { el.classList.remove('in'); setTimeout(() => { el.hidden = true; }, 700); return; }
      if (!msgs[i]) { i++; next(); return; }
      p.textContent = msgs[i++]; el.hidden = false; el.dataset.acc = ACC[id];
      requestAnimationFrame(() => el.classList.add('in'));
      setTimeout(() => { el.classList.remove('in'); setTimeout(next, 700); }, secs);
    };
    setTimeout(next, 900);
  }
}
