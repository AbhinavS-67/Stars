// main.js - boots the data, the model, the renderer and the UI, and runs the single animation loop.
import { SkyModel } from './utils/skyModel.js';
import { SkyCanvas } from './components/SkyCanvas.js';
import { ARView } from './components/ARView.js';
import { Dashboard, showIntro } from './components/Dashboard.js';
import { AmbientAudio } from './utils/audio.js';
import { initBridge, isEmbedded, standaloneUrl } from './utils/bridge.js';
import { enuToAltAz, vnorm, vadd } from './utils/celestialMath.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// iOS Safari: 100vh lies while the toolbar moves. Track the visual viewport instead.
function setVh() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--vh', `${h * 0.01}px`);
}

async function getJSON(url) {
  const inline = window.__SKY_DATA__ && window.__SKY_DATA__[url];   // single-file build (Streamlit): data is embedded
  if (inline) return inline;
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url} (${r.status})`);
  return r.json();
}

async function boot() {
  initBridge();
  setVh();
  const params = new URLSearchParams(location.search);

  let config, stars, cons, names, planets = null;
  try {
    [config, stars, cons, names, planets] = await Promise.all([
      getJSON('config.json'), getJSON('data/stars.json'), getJSON('data/constellations.json'), getJSON('data/starnames.json'),
      getJSON('data/planets.json').catch(() => null),   // optional: the sky still works without planets
    ]);
  } catch (e) {
    $('loader').innerHTML = `<p class="err">Could not load the sky data.<br><small>${String(e.message)}</small></p>`;
    return;
  }

  const model = new SkyModel({ stars, cons, names, config, planets });
  const canvas = $('sky');
  const sky = new SkyCanvas(canvas, model, config);
  const audio = new AmbientAudio();
  const ui = new Dashboard({ model, sky, config, root: $('ui'), audio, embedded: isEmbedded, fullscreenUrl: standaloneUrl() });
  const fsUrl = standaloneUrl();
  const fsAction = isEmbedded && fsUrl ? { label: 'Open full screen', href: standaloneUrl() } : null;
  const ar = new ARView({
    model, sky, config, root: $('ar-layer'), video: $('cam'),
    notify: (msg, kind) => ui.toast(msg, kind, kind === 'warn' ? fsAction : null),
  });

  // ---- optional URL switches (handy for previews and testing) ----
  if (params.get('at')) model.timeOffsetMs = new Date(params.get('at')).getTime() - Date.now();
  if (params.get('obs')) { model.setObserver(params.get('obs')); ui._markObserver(); }
  for (const k of ['lines', 'art', 'bounds', 'labels', 'tether', 'milkyWay', 'planets']) {
    if (params.has(k)) { const on = params.get(k) !== '0'; sky.setLayer(k, on); }
  }
  model.update(Date.now());

  // initial camera: face the middle of the two signs
  {
    const mid = enuToAltAz(vnorm(vadd(model.targets.Cap.enu, model.targets.Sgr.enu)));
    sky.cam.az = params.has('az') ? +params.get('az') : mid.az;
    sky.cam.alt = params.has('alt') ? +params.get('alt') : Math.min(55, Math.max(mid.alt + 8, 26));
    if (params.has('fov')) sky.domeFov = +params.get('fov');
  }

  // ---- AR launch / exit with a camera-flip transition ----
  const flip = $('flip');
  const flipOut = async () => { if (reduced) return; flip.classList.add('flip-out'); await sleep(260); };
  const flipIn = async () => {
    flip.classList.remove('flip-out'); flip.classList.add('flip-pre'); void flip.offsetWidth; flip.classList.remove('flip-pre');
    if (!reduced) await sleep(320);
  };
  let busy = false, savedOffset = 0;

  async function launchAR() {
    if (busy || ar.active) return;
    busy = true;
    savedOffset = model.timeOffsetMs; model.timeOffsetMs = 0;
    const started = ar.start();           // first awaits inside start() are the permission prompts: keep it in the tap
    await flipOut();
    const mode = await started;
    if (!mode) { model.timeOffsetMs = savedOffset; await flipIn(); busy = false; return; }
    ui.toggleDeck(false); ui.setMode('ar'); document.body.classList.add('ar');
    sky.resize();
    await flipIn(); busy = false;
  }
  async function exitAR() {
    if (busy || !ar.active) return;
    busy = true;
    await flipOut();
    ar.stop();
    sky.setMode({ projection: 'stereo', control: 'drag', transparent: false, ground: true, centerFrac: 0.4, centerX: 0.5 });
    model.timeOffsetMs = savedOffset;
    ui.setMode('dome'); document.body.classList.remove('ar');
    sky.resize(); sky.resetView(); ui._layoutSoon();
    await flipIn(); busy = false;
  }
  ui.onLaunchAR = launchAR;
  ar.onExit = exitAR;
  ui.onObserverChange = () => { sky.resetView(); };

  // ---- layout ----
  const relayout = () => { setVh(); sky.resize(); };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => { setTimeout(relayout, 120); setTimeout(relayout, 450); }); // WebKit reports stale sizes at first
  window.visualViewport?.addEventListener('resize', relayout);
  new ResizeObserver(() => sky.resize()).observe(canvas);

  $('loader').classList.add('done'); setTimeout(() => $('loader').remove(), 700);
  // ---- loop ----
  let last = performance.now();
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    if (!sky.wantsFrame(now)) { ui.tick(now); return; }   // a still sky is redrawn at ~30 fps, not 60
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    model.update(Date.now());
    ar.beforeFrame(dt);
    sky.frame(now, dt);
    ar.afterFrame(dt, now);
    ui.tick(now);
  };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => sky.kick(800));
  window.__sky = { model, sky, ar, ui }; // for debugging in the console

  // ---- intro ----
  if (config.intro?.show !== false && !params.has('skip')) {
    await showIntro({ root: $('app'), model, config });
    if (config.audio?.startOnBegin) { audio.toggle(true).then((on) => on && document.querySelector('[data-act="audio"]')?.classList.add('on')); }
    sky.resetView();
  }
  ui.showNote(!params.has('skip'));
}

boot();
