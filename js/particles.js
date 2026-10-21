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
    this.impacts = [];
    this.impactPool = [];
    this.statusEmitted = 0;
    this.links = [];
    this.linkPool = [];
    this.linksEmitted = 0;
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

  statusImpact(x, y, kind) {
    const budget = this.quality >= 2 ? 12 : this.quality === 1 ? 6 : 2;
    if (this.statusEmitted >= budget || this.impacts.length >= 64) return;
    this.statusEmitted++;
    const effect = this.impactPool.pop() || {};
    Object.assign(effect, { x, y, kind, life: kind === 'shatter' ? 0.42 : 0.28,
      maxLife: kind === 'shatter' ? 0.42 : 0.28 });
    this.impacts.push(effect);
    if (this.quality >= 1 && this.particles.length < this.maxParticles * 0.8) {
      const color = kind === 'frozen' || kind === 'shatter' ? '#c9f7ff' :
        kind === 'fault' ? '#ffd697' : kind === 'pierce' ? '#e4faff' : '#e5c8ff';
      this.burst(x, y, color, kind === 'shatter' ? 6 : 2, kind === 'shatter' ? 150 : 60, 0.32, 3);
    }
  }

  chain(ax, ay, bx, by, color) {
    const budget = this.quality >= 2 ? 8 : this.quality === 1 ? 4 : 0;
    if (this.linksEmitted >= budget || this.links.length >= 32) return;
    this.linksEmitted++;
    const link = this.linkPool.pop() || {};
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const offset = CFG.PIXEL * 0.14;
    Object.assign(link, { ax, ay, bx, by, color, life: 0.16, maxLife: 0.16,
      mx: (ax + bx) / 2 - (by - ay) / length * offset,
      my: (ay + by) / 2 + (bx - ax) / length * offset });
    this.links.push(link);
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
    this.statusEmitted = 0;
    this.linksEmitted = 0;
    for (let i = this.links.length - 1; i >= 0; i--) {
      const link = this.links[i];
      link.life -= dt;
      if (link.life <= 0) {
        const last = this.links.pop();
        if (i < this.links.length) this.links[i] = last;
        this.linkPool.push(link);
      }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const effect = this.impacts[i];
      effect.life -= dt;
      if (effect.life <= 0) {
        const last = this.impacts.pop();
        if (i < this.impacts.length) this.impacts[i] = last;
        this.impactPool.push(effect);
      }
    }
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
    this.impactPool.push(...this.impacts);
    this.impacts.length = 0;
    this.statusEmitted = 0;
    this.linkPool.push(...this.links);
    this.links.length = 0;
    this.linksEmitted = 0;
    this.particles.length = 0;
    this.waves.length = 0;
    this.texts.length = 0;
  }
}
