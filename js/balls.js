'use strict';

/**
 * Ball physics. Every ball ricochets forever and keeps damaging pixels on
 * contact; special abilities fire once. Balls are projectiles (no ball-ball
 * collision) and are sub-stepped so fast rounds cannot tunnel.
 */
class BallSystem {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.list = [];
    this.pool = [];
    this.P = CFG.PIXEL;
    this.updating = false;
    this.recycleCursor = 0;
  }

  get count() {
    return this.list.length;
  }

  spawnRaw(o) {
    if (this.list.length >= CFG.MAX_BALLS) {
      // The field is full of ricocheting rounds: recycle one to make room.
      // Never recycle while iterating, that could hand the same object out.
      if (this.updating) return null;
      this.recycleCursor = (this.recycleCursor + 1) % this.list.length;
      this.remove(this.recycleCursor);
    }

    const b = this.pool.pop() || { hitCells: new Set() };
    b.id = o.id || 'ball';
    b.x = o.x;
    b.y = o.y;
    b.vx = o.vx;
    b.vy = o.vy;
    b.r = o.r;
    b.baseRadius = o.r;
    b.radiusCap = o.radiusCap || o.r * 1.5;
    b.damage = o.damage;
    b.baseDamage = o.damage;
    b.damageCap = o.damageCap == null ? Infinity : o.damageCap;
    b.ramp = o.ramp || 0;
    b.rampSize = o.rampSize || 0;
    b.color = o.color;
    b.pierce = o.pierce || 0;
    b.explode = o.explode || 0;
    b.explodeDmg = o.explodeDmg || 0;
    b.split = o.split || 0;
    b.impactR = o.impactR || 0;
    b.impactDmg = o.impactDmg || 1;
    b.charge = o.charge || 0;
    b.chargeCap = o.chargeCap || 1;
    b.streakEvery = o.streakEvery || 16;
    b.splash = o.splash || 0;
    b.baseSplash = o.splash || 0;
    b.splashCap = o.splashCap == null ? (o.splash || 0) : o.splashCap;
    b.splashGrow = o.splashGrow || 0;
    b.crushBlast = o.crushBlast || 0;
    b.crushBlastDmg = o.crushBlastDmg || 1;
    b.pulseEvery = o.pulseEvery || 0;
    b.pulseR = o.pulseR || 0;
    b.pulseDmg = o.pulseDmg || 0;
    b.spawnEvery = o.spawnEvery || 0;
    b.spawnCount = o.spawnCount || 0;
    b.pierceEvery = o.pierceEvery || 0;
    b.pierceCap = o.pierceCap || 0;
    b.streakDamage = o.streakDamage || 1;
    b.splashDiag = !!o.splashDiag;
    b.streakPierce = o.streakPierce || 0;
    b.fragBonus = o.fragBonus || 0;
    b.pierceCharge = o.pierceCharge || 0;
    b.chargeOnSteel = o.chargeOnSteel || 0;
    b.pulseSpawn = o.pulseSpawn || 0;
    b.harvestEvery = o.harvestEvery || 0;
    b.bounces = 0;
    b.hasExploded = false;
    b.hasSplit = false;
    b.baseSpeed = Math.sqrt(o.vx * o.vx + o.vy * o.vy) || 1;
    b.speed0 = b.baseSpeed;
    b.hitCells.clear();

    const n = this.world.n;
    b.ignoreCell = ((o.y / this.P) | 0) * n + ((o.x / this.P) | 0);

    this.list.push(b);
    return b;
  }

  radiusCapFor(s) {
    return s.radius * (s.ramp > 0 ? 1.9 : 1.5);
  }

  damageCapFor(s) {
    return s.damage + 8 + (s.ramp > 0 ? 10 : 0);
  }

  fire(def, x, y, angle) {
    const s = this.game.ballStats(def);
    const speed = s.speed;
    return this.spawnRaw({
      id: def.id,
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: s.radius,
      radiusCap: this.radiusCapFor(s),
      damage: s.damage,
      damageCap: this.damageCapFor(s),
      ramp: s.ramp,
      rampSize: s.rampSize,
      color: def.color,
      pierce: s.pierce,
      pierceEvery: s.pierceEvery,
      pierceCap: s.pierceCap,
      explode: s.explode,
      explodeDmg: s.explodeDmg,
      split: s.split,
      impactR: s.impactR,
      impactDmg: s.impactDmg,
      charge: s.charge,
      chargeCap: s.chargeCap,
      streakEvery: s.streakEvery,
      splash: s.splash,
      splashCap: s.splashCap,
      splashGrow: s.splashGrow,
      crushBlast: s.crushBlast,
      crushBlastDmg: s.crushBlastDmg,
      pulseEvery: s.pulseEvery,
      pulseR: s.pulseR,
      pulseDmg: s.pulseDmg,
      spawnEvery: s.spawnEvery,
      spawnCount: s.spawnCount,
      streakDamage: s.streakDamage,
      splashDiag: s.splashDiag,
      streakPierce: s.streakPierce,
      fragBonus: s.fragBonus,
      pierceCharge: s.pierceCharge,
      chargeOnSteel: s.chargeOnSteel,
      pulseSpawn: s.pulseSpawn,
      harvestEvery: s.harvestEvery,
    });
  }

  /** Re-applies the current tech to every ball already in flight. */
  applyUpgrades() {
    for (const b of this.list) {
      const def = BALL_BY_ID[b.id];
      if (!def) continue;
      this.applyStats(b, this.game.ballStats(def));
    }
  }

  /**
   * Rebase a live ball onto new stats without losing what it earned in flight:
   * streak/ramp damage and radius growth are kept, and speed is scaled by the
   * same ratio the ball had already wound itself up to.
   */
  applyStats(b, s) {
    const damageGrowth = b.baseDamage == null ? 0 : Math.max(0, b.damage - b.baseDamage);
    b.baseDamage = s.damage;
    b.damageCap = this.damageCapFor(s);
    b.damage = Math.min(b.damageCap, s.damage + damageGrowth);
    b.ramp = s.ramp;
    b.rampSize = s.rampSize;

    const radiusRatio = b.baseRadius > 0 ? b.r / b.baseRadius : 1;
    b.baseRadius = s.radius;
    b.radiusCap = this.radiusCapFor(s);
    b.r = Math.min(b.radiusCap, s.radius * radiusRatio);

    const speedRatio = b.speed0 > 0 ? b.baseSpeed / b.speed0 : 1;
    const oldBase = b.baseSpeed;
    b.speed0 = s.speed;
    b.baseSpeed = s.speed * speedRatio;
    if (oldBase > 0) {
      const k = b.baseSpeed / oldBase;
      b.vx *= k;
      b.vy *= k;
    }

    b.charge = s.charge;
    b.chargeCap = s.chargeCap;
    b.chargeOnSteel = s.chargeOnSteel;
    b.pierceEvery = s.pierceEvery;
    b.pierceCap = s.pierceCap;
    b.pierce = Math.min(b.pierce, b.pierceCap);
    b.pierceCharge = s.pierceCharge;
    b.explode = s.explode;
    b.explodeDmg = s.explodeDmg;
    b.split = s.split;
    b.impactR = s.impactR;
    b.impactDmg = s.impactDmg;
    b.streakEvery = s.streakEvery;
    b.streakPierce = s.streakPierce;

    const splashGrowth = Math.max(0, b.splash - (b.baseSplash == null ? b.splash : b.baseSplash));
    b.baseSplash = s.splash;
    b.splashGrow = s.splashGrow;
    b.splashCap = s.splashCap;
    b.splash = Math.min(b.splashCap, s.splash + splashGrowth);
    b.crushBlast = s.crushBlast;
    b.crushBlastDmg = s.crushBlastDmg;
    b.splashDiag = s.splashDiag;

    b.pulseEvery = s.pulseEvery;
    b.pulseR = s.pulseR;
    b.pulseDmg = s.pulseDmg;
    b.spawnEvery = s.spawnEvery;
    b.spawnCount = s.spawnCount;
    b.streakDamage = s.streakDamage;
    b.fragBonus = s.fragBonus;
    b.pulseSpawn = s.pulseSpawn;
    b.harvestEvery = s.harvestEvery;
  }

  remove(i) {
    const list = this.list;
    const b = list[i];
    const last = list.pop();
    if (i < list.length) list[i] = last;
    if (this.pool.length < 2048) this.pool.push(b);
  }

  update(dt) {
    const list = this.list;
    this.updating = true;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const maxStep = Math.max(2.5, b.r * 0.9);
      let steps = Math.ceil((b.baseSpeed * dt) / maxStep);
      if (steps < 1) steps = 1;
      else if (steps > 8) steps = 8;
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) this.step(b, sdt);
      if (!isFinite(b.x) || !isFinite(b.y)) this.remove(i);
    }
    this.updating = false;
  }

  step(b, sdt) {
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;

    const P = this.P;
    const n = this.world.n;
    const r = b.r;
    const W = CFG.WORLD;

    // Balls live forever, so the world boundary is a perfect mirror.
    if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); }
    else if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx); }
    if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy); }
    else if (b.y > W - r) { b.y = W - r; b.vy = -Math.abs(b.vy); }

    const minX = Math.floor((b.x - r) / P);
    const maxX = Math.floor((b.x + r) / P);
    const minY = Math.floor((b.y - r) / P);
    const maxY = Math.floor((b.y + r) / P);

    if (b.ignoreCell >= 0) {
      const cur = ((b.y / P) | 0) * n + ((b.x / P) | 0);
      if (cur !== b.ignoreCell) b.ignoreCell = -1;
    }

    const health = this.world.health;
    const wall = this.world.wall;
    const piercing = b.pierce > 0;

    for (let cy = minY; cy <= maxY; cy++) {
      if (cy < 0 || cy >= n) continue;
      const row = cy * n;
      const py = cy * P;
      for (let cx = minX; cx <= maxX; cx++) {
        if (cx < 0 || cx >= n) continue;
        const idx = row + cx;
        if (idx === b.ignoreCell) continue;
        const h = health[idx];
        const isWall = wall[idx];
        if (h === 0 && isWall === 0) continue;
        if (piercing && b.hitCells.has(idx)) continue;

        const px = cx * P;
        const qx = b.x < px ? px : (b.x > px + P ? px + P : b.x);
        const qy = b.y < py ? py : (b.y > py + P ? py + P : b.y);
        const dx = b.x - qx;
        const dy = b.y - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;

        let nx;
        let ny;
        let pen;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          pen = r - d;
        } else {
          const l = b.x - px;
          const rr = px + P - b.x;
          const t = b.y - py;
          const bb = py + P - b.y;
          const m = Math.min(l, rr, t, bb);
          if (m === l) { nx = -1; ny = 0; pen = r + l; }
          else if (m === rr) { nx = 1; ny = 0; pen = r + rr; }
          else if (m === t) { nx = 0; ny = -1; pen = r + t; }
          else { nx = 0; ny = 1; pen = r + bb; }
        }

        if (isWall !== 0) {
          this.game.onWallHit(cx * P + P * 0.5, cy * P + P * 0.5);
          if (b.ramp > 0 && b.damage < b.damageCap) {
            b.damage = Math.min(b.damageCap, b.damage + b.ramp);
            b.r = Math.min(b.radiusCap, b.r + b.baseRadius * b.rampSize);
          }
          if (b.chargeOnSteel > 0 && b.baseSpeed < b.speed0 * b.chargeCap) {
            b.baseSpeed = Math.min(b.speed0 * b.chargeCap, b.baseSpeed * (1 + b.chargeOnSteel));
          }
          if (b.explode > 0 && !b.hasExploded) {
            b.hasExploded = true;
            this.detonate(b);
          }
          if (b.impactR > 0) this.impactBlast(b);
          this.bounce(b, nx, ny, pen, cx, cy);
          return;
        }

        this.world.damageAt(cx, cy, b.damage);
        if (b.impactR > 0) this.impactBlast(b);

        if (b.pierce > 0) {
          b.pierce--;
          b.hitCells.add(idx);
          if (b.pierceCharge > 0 && b.baseSpeed < b.speed0 * b.chargeCap) {
            const next = Math.min(b.speed0 * b.chargeCap, b.baseSpeed * (1 + b.pierceCharge));
            const k = next / b.baseSpeed;
            b.baseSpeed = next;
            b.vx *= k;
            b.vy *= k;
          }
          return;
        }

        if (b.explode > 0 && !b.hasExploded) {
          b.hasExploded = true;
          this.detonate(b);
        }
        if (b.split > 0 && !b.hasSplit) {
          b.hasSplit = true;
          this.splitBall(b);
        }

        this.bounce(b, nx, ny, pen, cx, cy);
        return;
      }
    }
  }

  /** Perfectly elastic bounce with a tiny jitter so balls never settle. */
  bounce(b, nx, ny, pen, cx, cy) {
    b.x += nx * (pen + 0.6);
    b.y += ny * (pen + 0.6);

    // Elasticity: every ricochet winds the ball up a little tighter.
    if (b.charge > 0 && b.baseSpeed < b.speed0 * b.chargeCap) {
      b.baseSpeed = Math.min(b.speed0 * b.chargeCap, b.baseSpeed * (1 + b.charge));
    }

    const dot = b.vx * nx + b.vy * ny;
    const vx = b.vx - 2 * dot * nx;
    const vy = b.vy - 2 * dot * ny;
    const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 0.05;
    b.vx = Math.cos(angle) * b.baseSpeed;
    b.vy = Math.sin(angle) * b.baseSpeed;

    b.bounces++;

    // Heavy rounds crush the pixels around the one they hit; Aftershock makes
    // that crush grow with every bounce.
    if (b.splashGrow > 0 && b.splash < b.splashCap) b.splash += b.splashGrow;
    if (b.splash > 0) {
      this.crush(cx, cy, b.splash, b.splashDiag);
      if (b.crushBlast > 0) {
        const hits = this.world.explode(b.x, b.y, b.crushBlast, b.crushBlastDmg);
        if (hits > 0) this.game.onImpactBlast(b.x, b.y, b.crushBlast, b.color);
      }
    }

    // Pierce growth: bounce counters teach the ball to pierce.
    if (b.pierceEvery > 0 && b.bounces % b.pierceEvery === 0 && b.pierce < b.pierceCap) {
      b.pierce = Math.min(b.pierceCap, b.pierce + 1);
    }

    // Pulse: a shockwave every few bounces.
    if (b.pulseEvery > 0 && b.bounces % b.pulseEvery === 0) {
      this.pulse(b);
      if (b.pulseSpawn > 0) this.spawnFrags(b, b.pulseSpawn);
    }

    // Spawner: sheds bouncing sparks.
    if (b.spawnEvery > 0 && b.bounces % b.spawnEvery === 0) this.spawnFrags(b, b.spawnCount);

    // Bounce streak: long-lived ricochets grow stronger and slightly bigger.
    if (b.bounces % b.streakEvery === 0) {
      if (b.damage < b.damageCap) b.damage = Math.min(b.damageCap, b.damage + b.streakDamage);
      b.r = Math.min(b.radiusCap, b.r + b.baseRadius * 0.02);
      if (b.streakPierce > 0 && b.pierce < b.pierceCap) {
        b.pierce = Math.min(b.pierceCap, b.pierce + b.streakPierce);
      }
      this.game.sfx.bounce(b.bounces);
    }

    if (b.harvestEvery > 0 && b.bounces % b.harvestEvery === 0) this.game.onBounceHarvest();
  }

  crush(cx, cy, amount, diag) {
    const w = this.world;
    w.damageAt(cx + 1, cy, amount);
    w.damageAt(cx - 1, cy, amount);
    w.damageAt(cx, cy + 1, amount);
    w.damageAt(cx, cy - 1, amount);
    if (diag) {
      w.damageAt(cx + 1, cy + 1, amount);
      w.damageAt(cx - 1, cy - 1, amount);
      w.damageAt(cx + 1, cy - 1, amount);
      w.damageAt(cx - 1, cy + 1, amount);
    }
  }

  pulse(b) {
    const hits = this.world.explode(b.x, b.y, b.pulseR, b.pulseDmg);
    if (hits > 0) this.game.onPulse(b.x, b.y, b.pulseR, b.color);
  }

  impactBlast(b) {
    this.world.explode(b.x, b.y, b.impactR, b.impactDmg);
    this.game.onImpactBlast(b.x, b.y, b.impactR, b.color);
  }

  detonate(b) {
    const hits = this.world.explode(b.x, b.y, b.explode, b.explodeDmg);
    this.game.onExplosion(b.x, b.y, b.explode, hits);
  }

  spawnFrags(b, count) {
    const speed = b.baseSpeed * 0.92;
    const base = Math.atan2(b.vy, b.vx);
    const r = Math.max(2.2, b.baseRadius * 0.55);
    const dmg = Math.max(1, Math.round(b.damage * 0.5 + b.fragBonus));
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) / 2) * 0.5 + (Math.random() - 0.5) * 0.24;
      this.spawnRaw({
        id: 'frag',
        x: b.x,
        y: b.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r,
        radiusCap: r * 1.5,
        damage: dmg,
        damageCap: dmg + 8,
        color: b.color,
        streakEvery: b.streakEvery,
      });
    }
  }

  splitBall(b) {
    this.spawnFrags(b, b.split);
  }
}
