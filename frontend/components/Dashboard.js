// Dashboard.js - glassmorphic HUD, layer rail, floating bottom deck, toasts and the intro screen.
import * as M from '../utils/celestialMath.js';
import { fetchWeather, cloudAt } from '../utils/weather.js';
import { esc, fmt, tokens } from '../utils/text.js';

const ICON = {
  lines: '<path d="M4 18l5-9 4 5 3-7 4 11"/><circle cx="4" cy="18" r="1.4"/><circle cx="9" cy="9" r="1.4"/><circle cx="13" cy="14" r="1.4"/><circle cx="16" cy="7" r="1.4"/>',
  art: '<path d="M4 15c3-9 8-9 10-4s4 3 6-3"/><path d="M4 15c1 3 5 4 8 2"/>',
  bounds: '<path d="M4 6h6l2 4h8M4 18h7l3-6" stroke-dasharray="2 2.4"/>',
  labels: '<path d="M5 18V6h4a3 3 0 010 6H5m5 0h1.5a3 3 0 010 6H5"/>',
  tether: '<circle cx="5" cy="17" r="1.8"/><circle cx="19" cy="7" r="1.8"/><path d="M6.5 15.8C10 13 14 11 17.5 8.2"/>',
  milkyWay: '<path d="M3 15c5-9 13-9 18-4M3 19c5-8 12-8 18-3" opacity=".8"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  sound: '<path d="M5 10v4h3l4 3V7l-4 3H5zM16 9c1.3 1.6 1.3 4.4 0 6M18.5 7c2.4 2.7 2.4 7.3 0 10"/>',
  pin: '<path d="M12 21s6-5.2 6-10a6 6 0 10-12 0c0 4.8 6 10 6 10z"/><circle cx="12" cy="11" r="2"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>',
  chevron: '<path d="M6 14l6-6 6 6"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5.5 5.5 0 0110.7 1.3A3.3 3.3 0 0117 18z"/>',
  planets: '<circle cx="12" cy="12" r="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3" transform="rotate(-22 12 12)"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>',
  layers: '<path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
  save: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 4l2.2 5.2 5.6.5-4.3 3.7 1.3 5.5L12 16l-4.8 2.9 1.3-5.5L4.2 9.7l5.6-.5L12 4z"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
};
const svg = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

const LAYERS = [
  ['lines', 'Lines'], ['art', 'Myth art'], ['bounds', 'Boundaries'],
  ['labels', 'Names'], ['tether', 'Tether'], ['milkyWay', 'Milky Way'], ['planets', 'Planets'],
];
const LAYER_ICON = { lines: 'lines', art: 'art', bounds: 'bounds', labels: 'labels', tether: 'tether', milkyWay: 'milkyWay', planets: 'planets' };
const NOTE_KEY = 'sky2.noteDay';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const istDay = (d) => Math.floor((d.getTime() + 330 * 60000) / 86400000);
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });

export class Dashboard {
  constructor({ model, sky, config, root, audio, embedded, fullscreenUrl }) {
    Object.assign(this, { model, sky, config, root, audio, embedded, fullscreenUrl });
    this.tk = tokens(model, config);
    this.weather = {};
    this.lastSlow = 0; this.lastFast = 0; this.statusCache = {};
    this.open = false;
    this.onLaunchAR = null; this.onObserverChange = null;
    this._build();
    this._wire();
    this._setupMarks();
    this._layoutSoon();
    if (config.features?.weather !== false) this._loadWeather();
  }

  // ------------------------------------------------------------ build
  _build() {
    const m = this.model, cfg = this.config;
    this.root.innerHTML = `
    <header class="hud">
      <div class="hud-row">
        <div class="seg glass" role="tablist" aria-label="Observer">
          <button data-obs="her" role="tab"><b>${esc(m.observers.her.name)}</b></button>
          <button data-obs="him" role="tab"><b>${esc(m.observers.him.name)}</b></button>
          ${cfg.features?.gpsButton === false ? '' : `<button data-obs="gps" role="tab" class="gps" title="Use my location" aria-label="Use my location">${svg('pin')}</button>`}
        </div>
        <div class="chipbar">
          <div class="pill glass wx" title="Cloud cover">${svg('cloud')}<span data-k="cloud">--</span></div>
          <div class="pill glass vis" title="Stargazing visibility index"><i class="dot"></i><span data-k="vis">--</span></div>
        </div>
      </div>
      <div class="hud-clock glass" data-act="clock" role="button" tabindex="0" aria-expanded="false" title="Tap for more">
        <div class="clk-main">
          <span class="clk-t"><label>IST</label><b data-k="ist">--:--:--</b></span>
          <span class="clk-t"><label>LST</label><b data-k="lst">--:--:--</b></span>
          <span class="clk-chev">${svg('chevron')}</span>
        </div>
        <div class="clk-more">
          <div class="clk"><label>Date</label><b data-k="date"></b></div>
          <div class="clk"><label>GMST</label><b data-k="gmst">--:--:--</b></div>
          <div class="coords"><b data-k="coords"></b><small data-k="place"></small></div>
        </div>
        <button class="now-btn" data-act="now" hidden>\u25B6 Preview time \u00b7 tap for live</button>
      </div>
      <div class="hud-note glass" data-k="note" hidden></div>
    </header>

    <nav class="rail">
      ${this.embedded && this.fullscreenUrl ? `<a class="rbtn glass" href="${esc(this.fullscreenUrl)}" target="_blank" rel="noopener" title="Open full screen (best for camera and motion sensors)" aria-label="Open full screen">${svg('expand')}</a>` : ''}
      <button class="rbtn glass" data-act="find" title="Find a star, planet or sign" aria-label="Find">${svg('search')}</button>
      <button class="rbtn glass" data-act="layers" title="Layers" aria-label="Layers" aria-expanded="false">${svg('layers')}</button>
      <button class="rbtn glass" data-act="save" title="Save this sky as a picture" aria-label="Save picture">${svg('save')}</button>
      ${cfg.audio?.enabled === false ? '' : `<button class="rbtn glass" data-act="audio" title="Ambient sound" aria-label="Ambient sound">${svg('sound')}</button>`}
    </nav>
    <div class="layers glass" hidden>
      ${LAYERS.map(([k, t]) => `<button class="chip small ${this.sky.layers[k] ? 'on' : ''}" data-layer="${k}" aria-pressed="${!!this.sky.layers[k]}">${svg(LAYER_ICON[k])}<span>${t}</span></button>`).join('')}
    </div>

    <div class="finder" hidden>
      <div class="finder-card glass">
        <div class="finder-bar">${svg('search')}<input type="search" data-k="q" placeholder="Find a star, planet or sign" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search the sky"><button class="x" data-act="find-close" aria-label="Close">${svg('close')}</button></div>
        <ul class="finder-list" data-k="results"></ul>
      </div>
    </div>

    <aside class="pop glass" hidden aria-live="polite"></aside>

    <section class="deck glass">
      <button class="grab" data-act="deck" aria-label="Expand panel"><i></i></button>
      <div class="deck-head">
        <div class="cards">
          ${['Cap', 'Sgr'].map((id) => this._cardShell(id)).join('')}
        </div>
        <div class="bridge-strip"><span>${svg('tether')} The bridge</span><b data-k="bridge"></b></div>
        <button class="ar-launch" data-act="ar">${svg('camera')}<span>Launch AR sky finder</span></button>
      </div>

      <div class="deck-body">
        <div class="sec" data-k="notesec" hidden>
          <div class="sec-h"><h4>Note of the night</h4></div>
          <p class="note-of-night" data-k="nightnote"></p>
        </div>
        <div class="sec">
          <div class="sec-h"><h4>Time</h4><b class="mono" data-k="tlabel"></b></div>
          <input type="range" class="slider" min="-360" max="1800" step="5" value="0" data-k="tslider" aria-label="Time offset in minutes">
          <div class="btnrow"><button class="chip small" data-act="now">Now</button><button class="chip small" data-act="best">Best time for both</button><button class="chip small" data-act="hour">+1 h</button></div>
          <p class="fine">AR always uses the live sky.</p>
        </div>
        <div class="sec" data-k="tonight"></div>
        <div class="sec" data-k="planetlist"></div>
        <div class="sec">
          <div class="sec-h"><h4>${esc(cfg.bridge?.title || 'The bridge')}</h4></div>
          <p class="body">${esc(fmt(cfg.bridge?.text || '', this.tk))}</p>
          <div class="stats">
            <div><label>Signs, centre to centre</label><b class="mono">${m.centreSepDeg.toFixed(1)}°</b></div>
            <div><label>Tether stars</label><b class="mono">${m.tether.sepDeg.toFixed(1)}°</b></div>
            <div><label>On the ground</label><b class="mono">${Math.round(m.km).toLocaleString('en-IN')} km</b></div>
          </div>
          <p class="body moonline" data-k="moon" hidden></p>
        </div>
        <p class="footer">${esc(fmt(cfg.footer || '', this.tk))}</p>
        <p class="fine credits">Stars: Hipparcos catalogue via d3-celestial (BSD-3). Planets: astronomy-engine. Weather: Open-Meteo. Positions are computed on your device.</p>
      </div>
    </section>
    <div class="toasts" aria-live="polite"></div>`;
    this.$ = (s) => this.root.querySelector(s);
    this.$$ = (s) => [...this.root.querySelectorAll(s)];
    this.k = (n) => this.root.querySelector(`[data-k="${n}"]`);
  }

  _cardShell(id) {
    const f = this.model.cons[id].featured;
    return `<article class="card acc-${f.accent}" data-card="${id}" data-act="goto" data-id="${id}" role="button" tabindex="0" title="Show in the sky">
      <div class="c-top"><span class="glyph">${f.glyph}</span><div><h3>${esc(f.title)}</h3><p>${id === 'Cap' ? 'Her sign' : 'His sign'}</p></div></div>
      <div class="c-nums"><span class="state" data-s="state" aria-label="visibility"></span><b class="mono" data-s="alt">--</b><span class="sep">\u00b7</span><b class="mono" data-s="az">--</b></div>
      <div class="c-foot" data-s="foot"></div></article>`;
  }

  // ------------------------------------------------------------ events
  _wire() {
    const m = this.model;
    this.root.addEventListener('click', (e) => {
      if (e.target.classList?.contains('finder')) return this.closeFinder();
      const o = e.target.closest('[data-obs]');
      if (o) return this._setObserver(o.dataset.obs);
      const l = e.target.closest('[data-layer]');
      if (l) { const k = l.dataset.layer, on = !this.sky.layers[k]; this.sky.setLayer(k, on); l.classList.toggle('on', on); l.setAttribute('aria-pressed', on); return; }
      const r = e.target.closest('[data-pick]');
      if (r) return this._chooseResult(r.dataset.pick);
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'deck') this.toggleDeck();
      else if (act === 'ar') this.onLaunchAR?.();
      else if (act === 'now') { e.stopPropagation(); this._setOffset(0); }
      else if (act === 'hour') { this._setOffset(m.timeOffsetMs / 60000 + 60); }
      else if (act === 'best') this._bestTime();
      else if (act === 'audio') this._toggleAudio(a);
      else if (act === 'clock') this._toggleClock(a);
      else if (act === 'layers') this._toggleLayers(a);
      else if (act === 'find') this.openFinder();
      else if (act === 'find-close') this.closeFinder();
      else if (act === 'save') this.saveImage();
      else if (act === 'goto') this._goto(a.dataset.id);
      else if (act === 'pop-close') this.hidePop();
    });
    this.root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
      if (e.key === 'Escape') { this.closeFinder(); this.hidePop(); this._toggleLayers(null, false); }
    });
    this.k('tslider').addEventListener('input', (e) => this._setOffset(+e.target.value, true));
    this.k('q').addEventListener('input', () => this._renderResults());
    // swipe the deck
    const grab = this.$('.grab'); let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    window.addEventListener('pointerup', (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; if (Math.abs(dy) > 28) this.toggleDeck(dy < 0); });
    // tapping the sky identifies what is under the finger; tapping empty sky closes popovers
    this.sky.onTap = (x, y) => this._onSkyTap(x, y);
    this.sky.onInteract = () => { this._toggleLayers(null, false); };
    // keep the sky centred between the HUD and the deck, and the rail/toasts clear of both
    const ro = new ResizeObserver(() => this._layoutSoon());
    ro.observe(this.$('.hud')); ro.observe(this.$('.deck'));
    window.addEventListener('resize', () => this._layoutSoon());
    this._markObserver();
  }

  _layoutSoon() { cancelAnimationFrame(this._lr); this._lr = requestAnimationFrame(() => this._layout()); }
  _layout() {
    const hud = this.$('.hud'), deck = this.$('.deck');
    if (!hud || !deck || document.body.classList.contains('ar')) return;
    const H = this.sky.H || window.innerHeight, hb = hud.getBoundingClientRect().bottom, dt = deck.getBoundingClientRect().top;
    this.root.style.setProperty('--hud-h', `${Math.round(hb)}px`);
    this.root.style.setProperty('--deck-h', `${Math.round(Math.max(0, H - dt))}px`);
    const W = this.sky.W || window.innerWidth;
    let cf, cx = 0.5;
    if (window.matchMedia('(max-height: 480px) and (orientation: landscape)').matches) {
      // landscape phone: the deck sits at the right, so centre the sky in the free area to its left
      const left = this.$('.rail').getBoundingClientRect().right;
      cx = Math.max(0.25, Math.min(0.5, (left + deck.getBoundingClientRect().left) / 2 / W));
      cf = 0.55;
    } else cf = Math.max(0.3, Math.min(0.56, (hb + Math.min(dt, H)) / 2 / H));
    const m = this.sky.mode;
    if (Math.abs(cf - m.centerFrac) > 0.002 || Math.abs(cx - m.centerX) > 0.002) { m.centerFrac = cf; m.centerX = cx; this.sky.kick(); }
  }

  _toggleClock(el) { const on = !el.classList.contains('open'); el.classList.toggle('open', on); el.setAttribute('aria-expanded', on); }
  _toggleLayers(btn, force) {
    const box = this.$('.layers'), on = force ?? box.hidden;
    box.hidden = !on;
    this.$('[data-act="layers"]')?.classList.toggle('on', on);
    this.$('[data-act="layers"]')?.setAttribute('aria-expanded', on);
    if (on) { this.closeFinder(); this.hidePop(); }
  }

  toggleDeck(force) {
    this.open = force ?? !this.open;
    const deck = this.$('.deck');
    deck.classList.toggle('open', this.open);
    deck.classList.remove('pulse'); void deck.offsetWidth; deck.classList.add('pulse');
    if (this.open) { this._renderTonight(); this.hidePop(); }
    this._layoutSoon(); this.sky.kick(500);
  }

  // ------------------------------------------------------------ find
  _items() {
    const m = this.model, out = [];
    for (const id of ['Cap', 'Sgr']) { const f = m.cons[id].featured; out.push({ key: `con:${id}`, name: f.title, sub: id === 'Cap' ? 'Her sign' : 'His sign', glyph: f.glyph, rank: -9 }); }
    out.push({ key: 'moon', name: 'Moon', sub: 'Moon', rank: -8 }, { key: 'sun', name: 'Sun', sub: 'Sun', rank: 9 });
    if (m.planetsInRange) for (const p of m.planets) out.push({ key: `pl:${p.name}`, name: p.name, sub: 'Planet', rank: -5 + p.mag * 0.1 });
    for (const ns of m.namedStars) out.push({ key: `st:${ns.i}`, name: ns.name, sub: 'Star', rank: ns.mag });
    return out;
  }
  _locate(key) {
    const m = this.model, obs = m.obs;
    let enu, name, ra, dec, get;
    if (key.startsWith('con:')) { const t = m.targets[key.slice(4)]; enu = t.enu; name = t.con.featured.title; get = () => t.enu; ra = t.con.centre[0]; dec = t.con.centre[1]; }
    else if (key === 'moon') { enu = m.moon.enu; name = 'Moon'; get = () => m.moon.enu; }
    else if (key === 'sun') { enu = m.sun.enu; name = 'Sun'; get = () => m.sun.enu; }
    else if (key.startsWith('pl:')) { const p = m.planets.find((q) => q.name === key.slice(3)); enu = p.enu; name = p.name; get = () => p.enu; ra = p.ra; dec = p.dec; }
    else { const i = +key.slice(3), k = i * 3; name = m.names[m.hip[i]]; get = () => m.enu.subarray(k, k + 3); enu = get(); const v = m.j2000.subarray(k, k + 3); ra = ((Math.atan2(v[1], v[0]) * M.R2D) + 360) % 360; dec = Math.asin(v[2]) * M.R2D; }
    const aa = M.enuToAltAz(enu);
    let rise = null;
    if (aa.alt < 0 && ra != null) { try { rise = M.riseSetTransit(ra, dec, m.date, obs, 30).rise; } catch { /* ignore */ } }
    return { name, alt: aa.alt, az: aa.az, rise, get };
  }
  openFinder() {
    this._toggleLayers(null, false); this.hidePop();
    this.$('.finder').hidden = false;
    const q = this.k('q'); q.value = ''; this._renderResults();
    setTimeout(() => q.focus({ preventScroll: true }), 60);
  }
  closeFinder() { const f = this.$('.finder'); if (f && !f.hidden) { f.hidden = true; this.k('q').blur(); } }
  _renderResults() {
    const q = this.k('q').value.trim().toLowerCase(), m = this.model;
    let list = this._items();
    if (q) list = list.filter((x) => x.name.toLowerCase().includes(q)).sort((a, b) => (a.name.toLowerCase().startsWith(q) ? -1 : 1) - (b.name.toLowerCase().startsWith(q) ? -1 : 1) || a.rank - b.rank);
    else list = list.filter((x) => x.rank < 1.2 || x.rank === -9).sort((a, b) => a.rank - b.rank);
    list = list.slice(0, 9);
    this.k('results').innerHTML = list.length ? list.map((x) => {
      const L = this._locate(x.key), up = L.alt > 0;
      const where = up ? `${Math.round(L.alt)}° up · ${M.compassPoint(L.az)}` : (L.rise ? `rises ${M.fmtTimeRel(L.rise, m.date)}` : 'below the horizon');
      return `<li><button data-pick="${x.key}" class="${up ? 'up' : ''}"><span class="fi">${x.glyph || (x.sub === 'Planet' ? svg('planets') : x.sub === 'Moon' ? svg('moon') : x.sub === 'Sun' ? svg('sun') : svg('star'))}</span><span class="fn"><b>${esc(x.name)}</b><small>${esc(x.sub)}</small></span><span class="fw">${esc(where)}</span></button></li>`;
    }).join('') : '<li class="none">Nothing by that name. Try Sirius, Jupiter or Vega.</li>';
  }
  _chooseResult(key) {
    const L = this._locate(key);
    this.closeFinder();
    if (this.root.classList.contains('ar-on')) return;
    const alt = Math.max(8, Math.min(70, L.alt + 12));
    this.sky.flyTo(L.az, L.alt > 0 ? alt : 14, 70, 1100);
    this.sky.highlightObj(L.get, L.name);
    if (L.alt <= 0) this.toast(`${L.name} is below the horizon right now${L.rise ? `, rising ${M.fmtTimeRel(L.rise, this.model.date)}` : ''}. Try the time slider.`, 'info');
    if (this.open) this.toggleDeck(false);
  }
  _goto(id) {
    const t = this.model.targets[id];
    this.sky.flyTo(t.az, Math.max(t.alt, 20) + 4, 66, 1000);
    this.sky.highlightObj(() => t.enu, t.con.featured.title);
    if (this.open) this.toggleDeck(false);
    if (t.alt <= 0) this.toast(`${t.con.featured.title} is below the horizon right now. Use "Best time for both".`, 'info');
  }

  // ------------------------------------------------------------ tap to identify + personal stars
  _setupMarks() {
    const m = this.model, list = this.config.ourStars || [];
    this.ourNotes = {};
    const marks = [];
    for (const o of list) {
      const hit = m.namedStars.find((n) => n.name.toLowerCase() === String(o.star || '').toLowerCase());
      if (!hit) continue;
      this.ourNotes[hit.name] = o;
      marks.push({ i: hit.i, title: o.title, note: o.note });
    }
    this.sky.marks = marks;
  }

  _onSkyTap(x, y) {
    if (this.root.classList.contains('ar-on')) return;
    this._toggleLayers(null, false);
    if (this.sky.meteorRecent) { this.toast(this.config.wish?.text || 'Shooting star! Make a wish.', 'info'); return; }
    const hit = this.sky.pick(x, y, 30);
    if (!hit) { this.hidePop(); if (this.open) this.toggleDeck(false); return; }
    this.showPop(hit);
  }

  _info(hit) {
    const m = this.model, obs = m.obs, d = m.date;
    const rst = (ra, dec) => { try { return M.riseSetTransit(ra, dec, d, obs, 30); } catch { return {}; } };
    const t = (x) => (x ? M.fmtTime(x) + (istDay(x) > istDay(d) ? ' +1' : '') : '--');
    let name = hit.name, sub = '', alt = 0, az = 0, rise, set, note = '', icon = 'star', acc = '';
    if (hit.kind === 'star') {
      const i = hit.i, k = i * 3, v = m.j2000.subarray(k, k + 3);
      const ra = ((Math.atan2(v[1], v[0]) * M.R2D) + 360) % 360, dec = Math.asin(v[2]) * M.R2D;
      const aa = M.enuToAltAz([m.enu[k], m.enu[k + 1], m.enu[k + 2]]); alt = aa.alt; az = aa.az;
      const r = rst(ra, dec); rise = r.rise; set = r.set;
      const bv = m.bv[i], T = Math.round((4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))) / 10) * 10;
      const tint = bv < 0 ? 'blue-white' : bv < 0.35 ? 'white' : bv < 0.8 ? 'yellow-white' : bv < 1.25 ? 'orange' : 'red-orange';
      const feat = m.featuredStars.find((f) => f.hip === m.hip[i]);
      sub = `Star · mag ${m.mag[i].toFixed(1)} · ${tint} · ~${T.toLocaleString('en-IN')} K${feat?.distLy ? ` · ${feat.distLy} ly` : ''}`;
      if (feat) acc = feat.con === 'Sgr' ? 'gold' : 'ice';
      const mine = this.ourNotes?.[name];
      note = mine ? `${mine.title ? mine.title + '. ' : ''}${mine.note || ''}` : (feat?.note || '');
      icon = mine ? 'heart' : 'star';
    } else if (hit.kind === 'planet') {
      const p = hit.ref; alt = p.alt; az = p.az; const r = rst(p.ra, p.dec); rise = r.rise; set = r.set;
      sub = `Planet · mag ${p.mag.toFixed(1)}`; icon = 'planets';
    } else if (hit.kind === 'moon') {
      alt = m.moon.alt; az = m.moon.az; icon = 'moon'; sub = `Moon · ${Math.round(m.moon.fraction * 100)}% lit · ${m.moon.waxing ? 'waxing' : 'waning'}`;
      if (this.config.bridge?.sharedMoon && M.moonAltAz(d, m.observers.her).alt > 0 && M.moonAltAz(d, m.observers.him).alt > 0) note = fmt(this.config.bridge.sharedMoon, this.tk);
    } else {
      alt = m.sun.alt; az = m.sun.az; icon = 'sun'; sub = 'Sun';
      try { rise = M.findSunCrossing(d, obs, -0.83, true); set = M.findSunCrossing(d, obs, -0.83, false); } catch { /* ignore */ }
    }
    return { name, sub, alt, az, rise, set, note, icon, acc, t };
  }

  showPop(hit) {
    const I = this._info(hit), el = this.$('.pop');
    el.className = `pop glass ${I.acc ? 'acc-' + I.acc : ''}`;
    const up = I.alt > 0;
    el.innerHTML = `<button class="x" data-act="pop-close" aria-label="Close">${svg('close')}</button>
      <div class="pop-h"><span class="pop-ic">${svg(I.icon)}</span><div><h3>${esc(I.name)}</h3><p>${esc(I.sub)}</p></div></div>
      <div class="pop-grid">
        <div><label>Altitude</label><b class="mono">${I.alt.toFixed(1)}°</b><small>${up ? 'above horizon' : 'below horizon'}</small></div>
        <div><label>Azimuth</label><b class="mono">${Math.round(I.az)}° ${M.compassPoint(I.az)}</b></div>
        <div><label>Rises</label><b class="mono">${I.t(I.rise)}</b></div>
        <div><label>Sets</label><b class="mono">${I.t(I.set)}</b></div>
      </div>${I.note ? `<p class="pop-note">${esc(I.note)}</p>` : ''}`;
    el.hidden = false;
    clearTimeout(this._popT); this._popT = setTimeout(() => this.hidePop(), 14000);
    this.sky.highlightObj(this._getter(hit), '');
    this._layoutSoon();
  }
  hidePop() { const el = this.$('.pop'); if (el && !el.hidden) { el.hidden = true; clearTimeout(this._popT); this.sky.clearHighlight(); } }
  _getter(hit) {
    const m = this.model;
    if (hit.kind === 'planet') return () => hit.ref.enu;
    if (hit.kind === 'moon') return () => m.moon.enu;
    if (hit.kind === 'sun') return () => m.sun.enu;
    const k = hit.i * 3; return () => m.enu.subarray(k, k + 3);
  }

  // ------------------------------------------------------------ note of the night + save
  /** One short personal note per day (config.dailyNotes). Shows as a toast the first time each day, and in the panel. */
  showNote(first = true) {
    const notes = this.config.dailyNotes || [];
    if (!notes.length) return;
    const day = istDay(new Date()), text = fmt(notes[((day % notes.length) + notes.length) % notes.length], this.tk);
    this.k('nightnote').textContent = text; this.k('notesec').hidden = false;
    if (first && lsGet(NOTE_KEY) !== String(day)) { lsSet(NOTE_KEY, String(day)); setTimeout(() => this.toast(text, 'note', null, 8200), 1400); }
  }

  async saveImage() {
    const sky = this.sky, m = this.model, cfg = this.config;
    try {
      this.hidePop(); this._toggleLayers(null, false);
      sky.frame(performance.now(), 0.016);                // make sure the canvas holds a fresh frame
      const src = sky.canvas, W = src.width, H = src.height, k = W / sky.W;
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const x = out.getContext('2d');
      x.drawImage(src, 0, 0);
      const g = x.createLinearGradient(0, H - 150 * k, 0, H); g.addColorStop(0, 'rgba(4,5,10,0)'); g.addColorStop(1, 'rgba(4,5,10,0.85)');
      x.fillStyle = g; x.fillRect(0, H - 150 * k, W, 150 * k);
      x.textAlign = 'left'; x.fillStyle = 'rgba(255,236,200,0.95)';
      x.font = `600 ${20 * k}px "Space Grotesk", system-ui, sans-serif`;
      x.fillText(cfg.save?.title ? fmt(cfg.save.title, this.tk) : 'A sky for two', 22 * k, H - 62 * k);
      x.fillStyle = 'rgba(200,215,245,0.8)'; x.font = `400 ${12.5 * k}px "Inter", system-ui, sans-serif`;
      x.fillText(`${m.obs.place || m.obs.name}  ·  ${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(m.date)} IST`, 22 * k, H - 38 * k);
      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      if (!blob) throw new Error('no image');
      const file = new File([blob], 'our-sky.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Our sky' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'our-sky.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.toast('Saved your sky as a picture.', 'info');
    } catch { this.toast('Could not save the picture on this device.', 'warn'); }
  }

  async _setObserver(key) {
    const m = this.model;
    if (key === 'gps') {
      if (!navigator.geolocation) return this.toast('Location is not available on this device.', 'warn');
      this.toast('Finding your location…');
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 }));
        m.setGps(pos.coords.latitude, pos.coords.longitude);
      } catch { return this.toast('Could not get your location. Check the permission and try again.', 'warn'); }
    }
    m.setObserver(key);
    this._markObserver();
    this._loadWeather(true);
    this.statusCache = {}; this.lastSlow = 0; this._tonightHtml = ''; this._planetHtml = ''; this.sky.kick();
    this.onObserverChange?.(key);
  }
  _markObserver() {
    this.$$('[data-obs]').forEach((b) => b.classList.toggle('on', b.dataset.obs === this.model.obsKey));
  }

  _setOffset(min, fromSlider = false) {
    const m = this.model;
    m.timeOffsetMs = Math.round(min) * 60000;
    const s = this.k('tslider'); if (!fromSlider || +s.value !== min) s.value = Math.max(+s.min, Math.min(+s.max, Math.round(min)));
    this.lastSlow = 0; this.sky.kick(); this._renderTonight();
  }
  /** Looks ahead for the dark-sky moment when the *lower* of the two signs is highest. */
  _bestTime() {
    const m = this.model, obs = m.obs, now = Date.now();
    const cc = m.cons.Cap.centre, sc = m.cons.Sgr.centre;
    let best = null, bs = -90;
    for (let t = now; t < now + 30 * 3600e3; t += 10 * 60e3) {
      const d = new Date(t);
      if (M.sunAltAz(d, obs).alt > -12) continue;
      const a = Math.min(M.altAzJ2000(cc[0], cc[1], d, obs).alt, M.altAzJ2000(sc[0], sc[1], d, obs).alt);
      if (a > bs) { bs = a; best = t; }
    }
    if (best == null || bs < 8) {
      this.toast(`From ${obs.name}, the two signs are not up together after dark soon. Sagittarius is best placed on summer evenings.`, 'info');
      return;
    }
    this._setOffset((best - now) / 60000);
    const when = istDay(new Date(best)) > istDay(new Date(now)) ? 'tomorrow at ' : '';
    this.toast(`Best moment from ${obs.name}: ${when}${M.fmtTime(new Date(best))}, both signs at least ${Math.round(bs)}\u00b0 up in a dark sky.`, 'info');
  }
  setTimeLocked(locked) { this.k('tslider').disabled = locked; }

  async _toggleAudio(btn) {
    const on = await this.audio.toggle();
    btn.classList.toggle('on', on);
    if (!on && this.audio.ctx == null) this.toast('Sound is not supported in this browser.', 'warn');
  }

  // ------------------------------------------------------------ weather
  async _loadWeather(force = false) {
    const m = this.model, key = m.obsKey, obs = m.obs;
    const need = force || !this.weather[key] || Date.now() - (this.weather[key].at || 0) > 20 * 60000;
    if (!need) return;
    const w = await fetchWeather(obs); w.at = Date.now();
    this.weather[key] = w;
    if (!this._wxTimer) this._wxTimer = setInterval(() => this._loadWeather(), 5 * 60000);
  }

  // ------------------------------------------------------------ per frame
  tick(now) {
    if (now - this.lastFast > 250) { this.lastFast = now; this._fast(); }
    if (now - this.lastSlow > 1000) { this.lastSlow = now; this._slow(); }
  }

  _fast() {
    const m = this.model, d = m.date, obs = m.obs;
    this.k('ist').textContent = M.fmtTime(d, 'Asia/Kolkata', true);
    this.k('date').textContent = dateFmt.format(d);
    this.k('gmst').textContent = M.fmtSidereal(M.gmstDeg(d));
    this.k('lst').textContent = M.fmtSidereal(M.lstDeg(d, obs.lon));
    this.k('coords').textContent = `${Math.abs(obs.lat).toFixed(4)}°${obs.lat >= 0 ? 'N' : 'S'}  ${Math.abs(obs.lon).toFixed(4)}°${obs.lon >= 0 ? 'E' : 'W'}`;
    this.k('place').textContent = obs.place || obs.name;
    const shifted = m.timeOffsetMs !== 0;
    this.$('.now-btn').hidden = !shifted;
    const off = m.timeOffsetMs / 60000;
    this.k('tlabel').textContent = shifted ? `${off > 0 ? '+' : '−'}${Math.floor(Math.abs(off) / 60)}h ${String(Math.round(Math.abs(off) % 60)).padStart(2, '0')}m · ${M.fmtTime(d)}` : 'Live';
  }

  _slow() {
    const m = this.model, obs = m.obs;
    // cards
    for (const id of ['Cap', 'Sgr']) {
      const st = m.targetStatus(id), t = m.targets[id], card = this.$(`[data-card="${id}"]`);
      this.statusCache[id] = st;
      card.querySelector('[data-s="alt"]').textContent = `${st.alt.toFixed(1)}°`;
      card.querySelector('[data-s="az"]').textContent = `${Math.round(st.az)}° ${st.compass}`;
      const state = card.querySelector('[data-s="state"]');
      state.textContent = ''; state.title = st.above ? 'Above the horizon' : 'Below the horizon';
      state.classList.toggle('up', st.above);
      card.classList.toggle('active', st.above);
      card.querySelector('[data-s="foot"]').textContent = st.above
        ? `Above horizon · peaks ${Math.round(st.maxAlt)}° ${M.fmtTimeRel(st.transit, m.date)}`
        : (st.rise ? `Below horizon · rises at ${M.fmtTimeRel(st.rise, m.date)} · ${M.compassPoint(this._riseAz(id, st.rise))}` : 'Below horizon · does not rise soon');
    }
    this.k('bridge').textContent = `${m.centreSepDeg.toFixed(1)}° apart · ${Math.round(m.km).toLocaleString('en-IN')} km`;

    // weather + visibility
    const w = this.weather[m.obsKey];
    const cloud = cloudAt(w, m.date.getTime());
    this.k('cloud').textContent = cloud == null ? '--' : `${Math.round(cloud)}%${w && !w.live ? '*' : ''}`;
    this.$('.wx').title = w && !w.live ? 'Cloud cover (estimate, weather service unreachable)' : 'Cloud cover (Open-Meteo)';
    const v = m.visibility(cloud);
    const vis = this.$('.vis'); vis.dataset.level = v.label.toLowerCase();
    this.k('vis').textContent = v.label;
    vis.title = `Stargazing visibility index: ${v.score}/100`;
    const note = this.k('note');
    if (v.sunAlt > -6) {
      const dusk = M.findSunCrossing(m.date, obs, -12, false);
      const html = `<span>${v.sunAlt > 0 ? 'Daylight' : 'Twilight'} preview \u00b7 dark enough ${dusk ? 'after ' + M.fmtTime(dusk) : 'later'}</span><button class="chip small" data-act="best">Jump to best time</button>`;
      if (this._noteHtml !== html) { this._noteHtml = html; note.innerHTML = html; }
      note.hidden = false;
    } else { note.hidden = true; this._noteHtml = ''; }

    // shared moon line
    const hm = M.moonAltAz(m.date, m.observers.her).alt, mm = M.moonAltAz(m.date, m.observers.him).alt;
    const moonEl = this.k('moon');
    if (hm > 0 && mm > 0 && this.config.bridge?.sharedMoon) { moonEl.hidden = false; moonEl.textContent = `${fmt(this.config.bridge.sharedMoon, this.tk)} (${Math.round(m.moon.fraction * 100)}% lit)`; }
    else moonEl.hidden = true;
    if (this.open) this._renderTonight();
  }

  _riseAz(id, riseDate) {
    const c = this.model.targets[id].con.centre;
    return M.altAzJ2000(c[0], c[1], riseDate, this.model.obs).az;
  }

  _renderTonight() {
    if (!this.open) return;
    const m = this.model, el = this.k('tonight');
    const day = (d) => (d && istDay(d) > istDay(m.date) ? ' <small>+1</small>' : '');
    const row = (id, obs) => {
      const st = m.targetStatus(id, obs), f = m.cons[id].featured;
      return `<tr><td><span class="gl acc-${f.accent}">${f.glyph}</span> ${esc(f.title)}<br><small>${st.above ? 'up now' : 'below horizon'}</small></td>
        <td>${st.rise ? M.fmtTime(st.rise) + day(st.rise) : '--'}</td>
        <td>${st.set ? M.fmtTime(st.set) + day(st.set) : '--'}</td>
        <td>${Math.round(st.maxAlt)}° <small>${M.fmtTime(st.transit)}${day(st.transit)}</small></td></tr>`;
    };
    const html = ['her', 'him'].map((k) => {
      const o = m.observers[k];
      return `<div class="sec-h"><h4>From ${esc(o.name)}</h4></div>
      <table class="tbl"><thead><tr><th></th><th>Next rise</th><th>Next set</th><th>Next peak</th></tr></thead><tbody>${row('Cap', o)}${row('Sgr', o)}</tbody></table>`;
    }).join('');
    if (html !== this._tonightHtml) { this._tonightHtml = html; el.innerHTML = html; }

    // planets above the horizon right now, brightest first
    const pl = this.k('planetlist');
    let ph = '';
    if (m.planetsInRange) {
      const up = m.planets.filter((p) => p.alt > 3).sort((a, b) => a.mag - b.mag);
      ph = `<div class="sec-h"><h4>Planets up now from ${esc(m.obs.name)}</h4></div>` + (up.length
        ? `<div class="plist">${up.map((p) => `<button class="pchip" data-pick="pl:${p.name}"><i style="background:rgb(${p.rgb.join(',')})"></i><b>${p.name}</b><span>${Math.round(p.alt)}\u00b0 ${M.compassPoint(p.az)}</span></button>`).join('')}</div>`
        : '<p class="fine">No bright planets above the horizon at this time.</p>');
    }
    if (ph !== this._planetHtml) { this._planetHtml = ph; pl.innerHTML = ph; }
  }

  // ------------------------------------------------------------ mode switches
  setMode(mode) { this.root.classList.toggle('ar-on', mode === 'ar'); this.setTimeLocked(mode === 'ar'); }

  toast(msg, kind = 'info', action = null, ms = 0) {
    const box = this.$('.toasts');
    const el = document.createElement('div');
    el.className = `toast glass ${kind}`;
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<a href="${esc(action.href)}" target="_blank" rel="noopener">${esc(action.label)}</a>` : ''}`;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, ms || (action ? 9000 : 5200));
  }
}

/** Full-screen welcome. Resolves when she taps the button. */
export function showIntro({ root, model, config }) {
  const tk = tokens(model, config), c = config.intro || {};
  const her = (config.names?.her || '').trim();
  const title = her ? fmt(c.title || 'For {her}', tk) : (c.titleFallback || 'For you');
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'intro';
    el.innerHTML = `
      <div class="intro-card">
        <p class="eyebrow">${esc(c.eyebrow || 'A sky for two')}</p>
        <svg class="tether-art" viewBox="0 0 320 90" aria-hidden="true">
          <defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#ffd68c"/><stop offset="1" stop-color="#8fd3ff"/></linearGradient></defs>
          <path d="M44 62 C 110 12, 210 12, 276 40" fill="none" stroke="url(#tg)" stroke-opacity=".25" stroke-width="7" stroke-linecap="round"/>
          <path class="flow" d="M44 62 C 110 12, 210 12, 276 40" fill="none" stroke="url(#tg)" stroke-width="1.6" stroke-linecap="round"/>
          <text x="44" y="82" text-anchor="middle" class="g gold">♐︎</text><text x="276" y="62" text-anchor="middle" class="g ice">♑︎</text>
        </svg>
        <h1>${esc(title)}</h1>
        <p class="sub">${esc(fmt(c.subtitle || '', tk))}</p>
        <button class="begin">${esc(c.button || 'Open the sky')}</button>
      </div>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    el.querySelector('.begin').addEventListener('click', () => {
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(() => el.remove(), 900);
      resolve();
    }, { once: true });
  });
}
