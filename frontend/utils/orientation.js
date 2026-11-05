// orientation.js - turns DeviceOrientation events into a camera basis in the ENU frame.
// Handles: iOS permission flow, iOS webkitCompassHeading, Android absolute orientation,
// screen rotation, smoothing and a manual heading nudge.
import { D2R, R2D, norm360, norm180, vnorm, dot } from './celestialMath.js';

const rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const mm = (a, b) => {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

export function screenAngle() {
  let a = 0;
  if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
  else if (typeof window.orientation === 'number') a = window.orientation; // older iOS
  return ((a % 360) + 360) % 360;
}

/**
 * W3C DeviceOrientation (Z-X'-Y'') angles -> camera forward/up vectors in the
 * Earth frame (x east, y north, z up). The back camera looks along -Z of the device.
 */
export function deviceBasis(alphaDeg, betaDeg, gammaDeg, screenDeg = 0) {
  const R = mm(rz(alphaDeg * D2R), mm(rx(betaDeg * D2R), ry(gammaDeg * D2R)));
  const th = screenDeg * D2R;
  return { f: mv(R, [0, 0, -1]), u: mv(R, [Math.sin(th), Math.cos(th), 0]) };
}

const yawRotate = (v, deg) => { // rotate about the vertical axis; +deg turns the heading clockwise
  const p = -deg * D2R, c = Math.cos(p), s = Math.sin(p);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};

export class OrientationTracker {
  constructor({ declination = 0 } = {}) {
    this.declination = declination;
    this.nudge = 0;           // manual heading correction (deg)
    this.iosOffset = 0;       // compass correction derived from webkitCompassHeading
    this._iosInit = false;
    this.hasData = false;
    this.absolute = false;    // true when heading is referenced to magnetic north
    this.f = [0, 1, 0]; this.u = [0, 0, 1];     // smoothed output
    this._tf = [0, 1, 0]; this._tu = [0, 0, 1]; // latest raw target
    this._sawAbs = false;
    this._running = false;
    this._onAbs = (e) => this._handle(e, true);
    this._onRel = (e) => this._handle(e, false);
  }

  static get supported() { return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window; }
  static get needsPermission() {
    return OrientationTracker.supported && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** Must be called from a user gesture on iOS. */
  async requestPermission() {
    if (!OrientationTracker.supported) return false;
    if (OrientationTracker.needsPermission) {
      try { return (await DeviceOrientationEvent.requestPermission()) === 'granted'; } catch { return false; }
    }
    return true;
  }

  start() {
    if (this._running || !OrientationTracker.supported) return;
    this._running = true;
    window.addEventListener('deviceorientationabsolute', this._onAbs, true);
    window.addEventListener('deviceorientation', this._onRel, true);
  }
  stop() {
    this._running = false; this.hasData = false; this._sawAbs = false; this._iosInit = false;
    window.removeEventListener('deviceorientationabsolute', this._onAbs, true);
    window.removeEventListener('deviceorientation', this._onRel, true);
  }

  /** Resolves true as soon as a real reading arrives, false after the timeout (e.g. desktop). */
  waitForData(ms = 1600) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (this.hasData) return resolve(true);
        if (performance.now() - t0 > ms) return resolve(false);
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  _handle(e, isAbsEvent) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    if (isAbsEvent) this._sawAbs = true; else if (this._sawAbs) return; // prefer the absolute stream
    const sa = screenAngle();
    let { f, u } = deviceBasis(e.alpha, e.beta, e.gamma, sa);

    const ios = typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading);
    if (ios) {
      this.absolute = true;
      // Compass heading is trustworthy while the camera is roughly level and the UI is portrait.
      if (sa === 0 && Math.abs(f[2]) < 0.55) {
        const mine = norm360(Math.atan2(f[0], f[1]) * R2D);
        const delta = norm180(e.webkitCompassHeading - mine);
        if (!this._iosInit) { this.iosOffset = delta; this._iosInit = true; }
        else this.iosOffset = norm180(this.iosOffset + 0.08 * norm180(delta - this.iosOffset));
      }
    } else {
      this.absolute = isAbsEvent || e.absolute === true;
    }

    const total = (ios ? this.iosOffset : 0) + this.declination + this.nudge;
    this._tf = yawRotate(f, total);
    this._tu = yawRotate(u, total);
    if (!this.hasData) { this.f = this._tf; this.u = this._tu; }
    this.hasData = true;
  }

  /** Call every frame; eases toward the latest reading to remove sensor jitter. */
  update(dt) {
    if (!this.hasData) return;
    // re-apply the nudge live so dragging feels instant even between sensor events
    const k = 1 - Math.exp(-dt * 16);
    const f = vnorm([this.f[0] + (this._tf[0] - this.f[0]) * k, this.f[1] + (this._tf[1] - this.f[1]) * k, this.f[2] + (this._tf[2] - this.f[2]) * k]);
    let u = [this.u[0] + (this._tu[0] - this.u[0]) * k, this.u[1] + (this._tu[1] - this.u[1]) * k, this.u[2] + (this._tu[2] - this.u[2]) * k];
    const d = dot(u, f);
    u = vnorm([u[0] - f[0] * d, u[1] - f[1] * d, u[2] - f[2] * d]);
    this.f = f; this.u = u;
  }

  /** Shift the heading by `deg` (used by the manual north-alignment drag). */
  nudgeBy(deg) {
    this.nudge = norm180(this.nudge + deg);
    this._tf = yawRotate(this._tf, deg); this._tu = yawRotate(this._tu, deg);
    this.f = yawRotate(this.f, deg); this.u = yawRotate(this.u, deg);
  }
}
