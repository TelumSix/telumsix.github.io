'use strict';

// A small, bounded ensemble: one shared C-major palette, soft attacks,
// density-aware gains and a musical clock that coalesces busy impacts.
class Sfx {
  constructor() {
    this.enabled = true;
    this.volumes = { master: 0.55, fx: 0.65, chime: 0.5 };
    try {
      this.enabled = localStorage.getItem(CFG.MUTE_KEY) !== '1';
      const saved = JSON.parse(localStorage.getItem(CFG.VOLUME_KEY) || '{}');
      for (const key of Object.keys(this.volumes)) {
        if (saved[key] != null && Number.isFinite(Number(saved[key])))
          this.volumes[key] = clamp(Number(saved[key]), 0, 1);
      }
    } catch (_) { /* Storage is optional. */ }
    this.ctx = null;
    this.voices = new Set();
    this.pending = { hits: 0, walls: 0, bounces: 0 };
    this.last = Object.create(null);
    this.nextBeat = 0;
    this.noteIndex = 0;
    this.notes = [261.6256, 329.6276, 391.9954, 523.2511];
    this.pattern = [0, 2, 1, 3, 1, 2, 0, 1];
  }

  saveVolumes() {
    try { localStorage.setItem(CFG.VOLUME_KEY, JSON.stringify(this.volumes)); } catch (_) { /* optional */ }
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch (_) { return null; }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volumes.master;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 2400;
      this.filter.Q.value = 0.5;
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -22;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.015;
      this.compressor.release.value = 0.22;
      this.filter.connect(this.compressor);
      this.compressor.connect(this.master);
      this.master.connect(ctx.destination);
      this.fxBus = ctx.createGain();
      this.fxBus.gain.value = this.volumes.fx;
      this.fxBus.connect(this.filter);
      this.chimeBus = ctx.createGain();
      this.chimeBus.gain.value = this.volumes.chime;
      this.chimeBus.connect(this.filter);
      // One quiet, damped repeat; no feedback loop that can accumulate.
      this.delay = ctx.createDelay(0.5);
      this.delay.delayTime.value = 0.27;
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.09;
      this.chimeBus.connect(this.delay);
      this.delay.connect(this.wet);
      this.wet.connect(this.filter);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(name, value) {
    if (!(name in this.volumes)) return;
    this.volumes[name] = clamp(value, 0, 1);
    this.saveVolumes();
    if (!this.ctx) return;
    const node = name === 'master' ? this.master : name === 'fx' ? this.fxBus : this.chimeBus;
    node.gain.setTargetAtTime(name === 'master' && !this.enabled ? 0 : this.volumes[name], this.ctx.currentTime, 0.04);
  }

  setEnabled(on) {
    this.enabled = !!on;
    try { localStorage.setItem(CFG.MUTE_KEY, on ? '0' : '1'); } catch (_) { /* optional */ }
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(on ? this.volumes.master : 0, this.ctx.currentTime, 0.03);
    }
    if (!on) {
      this.pending = { hits: 0, walls: 0, bounces: 0 };
      for (const voice of [...this.voices]) {
        voice.osc.stop();
        voice.clean();
      }
    } else this.ensure();
  }

  allow(kind, interval) {
    if (!this.enabled) return false;
    const now = performance.now() / 1000;
    if (now - (this.last[kind] ?? -Infinity) < interval) return false;
    this.last[kind] = now;
    return true;
  }

  tone(freq, duration, type = 'sine', volume = 0.025, slideTo = null, bus = 'chime', offset = 0, priority = false) {
    const ctx = this.ensure();
    if (!ctx || (!priority && this.voices.size >= 8)) return;
    if (this.voices.size >= 12) {
      const old = [...this.voices].find(v => !v.priority);
      if (!old) return;
      old.osc.stop();
      old.clean();
    }
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    const start = ctx.currentTime + 0.006 + offset;
    const peak = Math.max(0.0002, volume / Math.sqrt(1 + this.voices.size * 0.4));
    osc.type = type === 'square' || type === 'sawtooth' ? 'sine' : type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(32, slideTo), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.025, duration * 0.22));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(bus === 'fx' ? this.fxBus : this.chimeBus);
    const voice = { osc, priority, clean: () => {
      if (!this.voices.delete(voice)) return;
      osc.disconnect();
      gain.disconnect();
    } };
    this.voices.add(voice);
    osc.onended = voice.clean;
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  hit() { if (this.enabled) this.pending.hits = Math.min(4096, this.pending.hits + 1); }
  wall() { if (this.enabled) this.pending.walls = Math.min(4096, this.pending.walls + 1); }
  bounce() { if (this.enabled) this.pending.bounces = Math.min(4096, this.pending.bounces + 1); }

  update() {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') {
      this.pending = { hits: 0, walls: 0, bounces: 0 };
      return;
    }
    const now = this.ctx.currentTime;
    if (now < this.nextBeat) return;
    this.nextBeat = now + 0.18;
    const p = this.pending;
    this.pending = { hits: 0, walls: 0, bounces: 0 };
    if (p.hits) {
      const pitch = this.notes[this.pattern[this.noteIndex++ % this.pattern.length]];
      const volume = 0.028 / (1 + Math.log2(1 + p.hits) * 0.18);
      this.tone(pitch, 0.34, 'sine', volume);
    } else if (p.walls && this.allow('wall', 0.54)) {
      this.tone(130.8128, 0.16, 'sine', 0.014, null, 'fx');
    } else if (p.bounces && this.allow('bounce', 0.54)) {
      this.tone(195.9977, 0.2, 'sine', 0.016, null, 'fx');
    }
  }

  shoot(def) {
    if (!this.allow('shoot', 0.1)) return;
    const pitch = def.id === 'maul' ? 130.8128 : def.id === 'drift' ? 391.9954 : 261.6256;
    this.tone(pitch, 0.18, 'sine', 0.026, null, 'fx');
  }
  explode(big) {
    if (!this.allow('explode', 0.36)) return;
    this.tone(65.4064, big ? 0.65 : 0.4, 'sine', big ? 0.06 : 0.04, null, 'fx');
    this.tone(130.8128, 0.28, 'triangle', 0.018, null, 'fx');
  }
  shard() {
    if (!this.allow('shard', 0.4)) return;
    this.tone(523.2511, 0.55, 'sine', 0.045, null, 'chime', 0, true);
    this.tone(659.2551, 0.5, 'sine', 0.026, null, 'chime', 0.09, true);
  }
  buy() {
    if (!this.allow('buy', 0.2)) return;
    [261.6256, 329.6276, 391.9954].forEach((f, i) => this.tone(f, 0.38, 'sine', 0.035, null, 'chime', i * 0.09, true));
  }
  click() {
    if (this.allow('click', 0.1)) this.tone(329.6276, 0.1, 'sine', 0.018, null, 'chime', 0, true);
  }
  error() {
    if (this.allow('error', 0.3)) this.tone(164.8138, 0.18, 'sine', 0.025, null, 'chime', 0, true);
  }
  win() {
    if (!this.allow('win', 1)) return;
    [261.6256, 329.6276, 391.9954, 523.2511, 659.2551].forEach((f, i) =>
      this.tone(f, 0.7, 'sine', 0.04, null, 'chime', i * 0.18, true));
  }
}
