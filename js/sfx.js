'use strict';

/**
 * Small synth. Everything is generated, no assets.
 * Three volume buses: master, effects (shots / explosions) and chimes
 * (pixel hits, shards, UI). A soft feedback delay sits on the chime bus.
 */
class Sfx {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem(CFG.MUTE_KEY) !== '1'; } catch (e) { /* ignore */ }

    this.volumes = { master: 0.7, fx: 0.8, chime: 0.9 };
    try {
      const raw = localStorage.getItem(CFG.VOLUME_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const k of ['master', 'fx', 'chime']) {
            const v = Number(parsed[k]);
            if (isFinite(v)) this.volumes[k] = clamp(v, 0, 1);
          }
        }
      }
    } catch (e) { /* ignore */ }

    this.ctx = null;
    this.master = null;
    this.fxBus = null;
    this.chimeBus = null;
    this.delay = null;
    this.noiseBuf = null;
    this.lastHit = 0;
    this.lastComboTime = 0;
    this.combo = 0;
    this.lastShard = 0;
    this.lastBounce = 0;
  }

  saveVolumes() {
    try { localStorage.setItem(CFG.VOLUME_KEY, JSON.stringify(this.volumes)); } catch (e) { /* ignore */ }
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch (e) {
        return null;
      }
      const ctx = this.ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? this.volumes.master : 0;
      this.master.connect(ctx.destination);

      this.fxBus = ctx.createGain();
      this.fxBus.gain.value = this.volumes.fx;
      this.fxBus.connect(this.master);

      this.chimeBus = ctx.createGain();
      this.chimeBus.gain.value = this.volumes.chime;
      this.chimeBus.connect(this.master);

      // delay bus fed by chimes
      const delay = ctx.createDelay(0.6);
      delay.delayTime.value = 0.185;
      const send = ctx.createGain();
      send.gain.value = 0.3;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 2600;
      const fb = ctx.createGain();
      fb.gain.value = 0.26;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      this.chimeBus.connect(send);
      send.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(wet);
      wet.connect(this.master);
      this.delay = delay;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(name, value) {
    this.volumes[name] = clamp(value, 0, 1);
    this.saveVolumes();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (name === 'master') {
      this.master.gain.setTargetAtTime(this.enabled ? this.volumes.master : 0, t, 0.03);
    } else if (name === 'fx') {
      this.fxBus.gain.setTargetAtTime(this.volumes.fx, t, 0.03);
    } else if (name === 'chime') {
      this.chimeBus.gain.setTargetAtTime(this.volumes.chime, t, 0.03);
    }
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(CFG.MUTE_KEY, on ? '0' : '1'); } catch (e) { /* ignore */ }
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? this.volumes.master : 0.0001, t, 0.03);
    }
    if (on) this.ensure();
  }

  tone(freq, dur, type, vol, slideTo, bus) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) {
      o.frequency.exponentialRampToValueAtTime(Math.max(24, slideTo), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus === 'fx' ? this.fxBus : this.chimeBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  noise(dur, vol, cutoff, sweepTo) {
    const ctx = this.ensure();
    if (!ctx) return;
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const t = ctx.currentTime + 0.001;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.fxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  shoot(def) {
    if (!this.enabled) return;
    const base = def.id === 'maul' ? 180 : def.id === 'drift' ? 760 : 520;
    this.tone(base, 0.09, 'triangle', 0.045, base * 0.4, 'fx');
    this.noise(0.05, 0.02, 2400, 700);
  }

  /** Pentatonic chime that climbs while you sustain destruction. */
  hit() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastHit < 48) return;
    this.lastHit = now;
    if (now - this.lastComboTime > 520) this.combo = 0;
    else this.combo = Math.min(18, this.combo + 1);
    this.lastComboTime = now;

    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const step = scale[this.combo % scale.length] + 12 * Math.floor(this.combo / scale.length);
    const freq = 392 * Math.pow(2, step / 12);
    const vol = 0.035 + Math.min(0.02, this.combo * 0.0012);
    this.tone(freq, 0.16, 'sine', vol, null, 'chime');
    this.tone(freq * 2, 0.07, 'triangle', vol * 0.35, null, 'chime');
  }

  wall() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastHit < 60) return;
    this.lastHit = now;
    this.tone(1500 + Math.random() * 600, 0.045, 'square', 0.018, 900, 'fx');
  }

  /** Soft elastic tick; only heard occasionally even with thousands of balls. */
  bounce(streak) {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastBounce < 95) return;
    this.lastBounce = now;
    const pitch = 240 + Math.min(500, (streak || 0) * 8);
    this.tone(pitch, 0.055, 'sine', 0.026, pitch * 1.35, 'fx');
  }

  explode(big) {
    if (!this.enabled) return;
    this.noise(big ? 0.55 : 0.3, big ? 0.3 : 0.16, 1400, 120);
    this.tone(90, big ? 0.42 : 0.24, 'sine', big ? 0.22 : 0.12, 40, 'fx');
  }

  shard() {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastShard < 90) return;
    this.lastShard = now;
    this.tone(880, 0.5, 'sine', 0.1, 1320, 'chime');
    this.tone(1320, 0.65, 'sine', 0.06, null, 'chime');
    this.tone(1760, 0.3, 'triangle', 0.035, null, 'chime');
  }

  buy() {
    if (!this.enabled) return;
    this.tone(523.25, 0.12, 'triangle', 0.06, null, 'chime');
    setTimeout(() => this.tone(659.25, 0.14, 'triangle', 0.06, null, 'chime'), 80);
    setTimeout(() => this.tone(783.99, 0.22, 'triangle', 0.055, null, 'chime'), 160);
  }

  click() {
    if (!this.enabled) return;
    this.tone(700, 0.04, 'sine', 0.025, 500, 'chime');
  }

  error() {
    if (!this.enabled) return;
    this.tone(190, 0.14, 'square', 0.035, 120, 'chime');
  }

  win() {
    if (!this.enabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'triangle', 0.06, null, 'chime'), i * 110));
  }
}
