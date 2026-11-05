// audio.js - a quiet generative pad (WebAudio, no files). Off by default; starts only after a tap.
export class AmbientAudio {
  constructor() { this.ctx = null; this.master = null; this.on = false; this.nodes = []; }
  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = 0;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    const delay = this.ctx.createDelay(1.5); delay.delayTime.value = 0.62;
    const fb = this.ctx.createGain(); fb.gain.value = 0.42;
    const wet = this.ctx.createGain(); wet.gain.value = 0.5;
    lp.connect(this.master); lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(this.master);
    this.master.connect(this.ctx.destination);
    // D minor 9-ish drone with slow beating between detuned partials
    const freqs = [73.42, 110.0, 146.83, 220.0, 261.63, 329.63];
    freqs.forEach((f, i) => {
      for (const det of [-3, 3]) {
        const o = this.ctx.createOscillator(); o.type = i < 2 ? 'sine' : 'triangle';
        o.frequency.value = f; o.detune.value = det;
        const g = this.ctx.createGain(); g.gain.value = 0.045 / (1 + i * 0.35);
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.09;
        const lg = this.ctx.createGain(); lg.gain.value = g.gain.value * 0.6;
        lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(lp); o.start(); lfo.start();
        this.nodes.push(o, lfo);
      }
    });
    return true;
  }
  async toggle(force) {
    const want = force ?? !this.on;
    if (want) {
      if (!this.ctx && !this._build()) return false;
      try { await this.ctx.resume(); } catch { /* ignore */ }
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0.9, this.ctx.currentTime + 3);
      this.on = true;
    } else if (this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.2);
      this.on = false;
    }
    return this.on;
  }
}
