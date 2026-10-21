'use strict';

/**
 * Pooled visual FX: sparks, shockwave rings and floating text.
 * Data only — the renderer draws it.
 */
class Fx {
  constructor() {
    this.particles = [];
    this.waves = [];
    this.texts = [];
    this.maxParticles = CFG.MAX_PARTICLES;
    this.pCursor = 0;
    this.wCursor = 0;
    this.tCursor = 0;
    this.quality = 2;
  }

  particle(x, y, vx, vy, life, color, size, drag, gravity) {
    let p;
    if (this.particles.length < this.maxParticles) {
      p = { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, color: '#fff', size: 2, drag: 0.9, gravity: 0 };
      this.particles.push(p);
    } else {
      p = this.particles[this.pCursor];
      this.pCursor = (this.pCursor + 1) % this.maxParticles;
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.color = color;
    p.size = size;
    p.drag = drag;
    p.gravity = gravity || 0;
  }

  burst(x, y, color, count, speed, life, size) {
    const n = this.quality <= 0 ? Math.ceil(count * 0.4) : count;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.particle(
        x, y,
        Math.cos(a) * s, Math.sin(a) * s,
        life * (0.55 + Math.random() * 0.8),
        color,
        size * (0.6 + Math.random() * 0.9),
        0.82,
        0
      );
    }
  }

  ring(x, y, color, radius) {
    let w;
    if (this.waves.length < 40) {
      w = { x: 0, y: 0, r: 0, life: 0, maxLife: 1, color: '#fff', radius: 100 };
      this.waves.push(w);
    } else {
      w = this.waves[this.wCursor];
      this.wCursor = (this.wCursor + 1) % 40;
    }
    w.x = x;
    w.y = y;
    w.r = radius * 0.15;
    w.radius = radius;
    w.life = 0.5;
    w.maxLife = 0.5;
    w.color = color;
  }

  text(x, y, str, color, size) {
    let t;
    if (this.texts.length < 48) {
      t = { x: 0, y: 0, text: '', color: '#fff', life: 0, maxLife: 1, size: 14 };
      this.texts.push(t);
    } else {
      t = this.texts[this.tCursor];
      this.tCursor = (this.tCursor + 1) % 48;
    }
    t.x = x;
    t.y = y;
    t.text = str;
    t.color = color;
    t.life = 1.25;
    t.maxLife = 1.25;
    t.size = size || 14;
  }

  update(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        const last = ps.pop();
        if (i < ps.length) ps[i] = last;
        continue;
      }
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dt;
      const t = 1 - w.life / w.maxLife;
      w.r = w.radius * (0.12 + t * 1.05);
      if (w.life <= 0) {
        const last = this.waves.pop();
        if (i < this.waves.length) this.waves[i] = last;
      }
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= 26 * dt;
      if (t.life <= 0) {
        const last = this.texts.pop();
        if (i < this.texts.length) this.texts[i] = last;
      }
    }
  }

  clear() {
    this.particles.length = 0;
    this.waves.length = 0;
    this.texts.length = 0;
  }
}
