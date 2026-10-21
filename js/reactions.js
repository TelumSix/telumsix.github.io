'use strict';

// Sparse, timed coatings: no full-field scans, no recursive reaction cascades.
class PixelReactions {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.time = 0;
    this.cells = new Map();
    this.offsets = [];
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        if (x || y) this.offsets.push({ x, y, d: x * x + y * y });
      }
    }
    this.offsets.sort((a, b) => a.d - b.d);
  }

  update(dt) {
    this.time += dt;
    for (const [i, s] of this.cells) {
      if (!this.world.health[i] || (s.frozen <= this.time && s.fault <= this.time && s.charged <= this.time))
        this.cells.delete(i);
    }
  }

  state(i) {
    return this.cells.get(i);
  }

  coat(x, y, kind, duration, power = 0) {
    const w = this.world;
    if (!w.inBounds(x, y)) return;
    const i = y * w.n + x;
    if (!w.health[i] || w.wall[i]) return;
    let s = this.cells.get(i);
    if (!s) {
      // Bound memory and overlay work even in a fully developed field.
      if (this.cells.size >= 10000) this.cells.delete(this.cells.keys().next().value);
      s = { frozen: 0, fault: 0, charged: 0, brittle: 0, faultPower: 0 };
      this.cells.set(i, s);
    }
    if (kind === 'frozen') s.brittle = Math.max(s.frozen > this.time ? s.brittle : 0, power);
    if (kind === 'fault') s.faultPower = Math.max(s.fault > this.time ? s.faultPower : 0, power);
    s[kind] = Math.max(s[kind], this.time + duration);
  }

  spread(x, y, count, duration, power = 0, kind = 'frozen') {
    let used = 0;
    for (const o of this.offsets) {
      if (o.d > 2 || used >= count) break;
      const nx = x + o.x, ny = y + o.y;
      if (!this.world.inBounds(nx, ny)) continue;
      const i = ny * this.world.n + nx;
      if (!this.world.health[i] || this.world.wall[i]) continue;
      this.coat(nx, ny, kind, duration, power);
      used++;
    }
  }

  hit(b, x, y, amount, area = false, chargeArea = false) {
    const w = this.world;
    if (!w.inBounds(x, y)) return 0;
    const i = y * w.n + x;
    if (!w.health[i] || w.wall[i]) return w.wall[i] ? 3 : 0;
    const r = b.rules || {};
    const s = this.cells.get(i);
    const frozen = !!s && s.frozen > this.time;
    const fault = !!s && s.fault > this.time;
    const charged = !!s && s.charged > this.time;
    const consumesCharge = !area && charged && !!(r.chargeConsume || r.groundBurst);
    let damage = amount;
    if (!area) {
      b.hits = (b.hits || 0) + 1;
      if (frozen) damage += (s.brittle || 0) + (r.frozenBonus || 0);
      if (fault) damage += (s.faultPower || 0) + (r.faultBonus || 0);
      if (charged) damage += (r.chargedBonus || 0) + (r.chargeConsume || 0) + (r.supercool ? 3 : 0);
      if (w.material && w.material[i]) damage += r.soilBonus || 0;
      if (w.health[i] < w.maxHealth[i] * 0.5) damage += r.woundedBonus || 0;
      const coatings = Number(frozen) + Number(fault) + Number(charged);
      if (coatings >= 2) damage += r.lattice || 0;
      if (coatings === 3) damage += r.convergence || 0;
      if (frozen && r.frozenMult) damage *= 1 + r.frozenMult;
      if (frozen && r.shatterLimit && w.health[i] <= r.shatterLimit) damage = w.health[i];
      if (r.execute && w.health[i] <= w.maxHealth[i] * r.execute) damage = w.health[i];
      if (consumesCharge) s.charged = 0;
    } else {
      if (frozen) damage += r.areaFrozenBonus || 0;
      if (fault) damage += r.areaFaultBonus || 0;
    }
    const result = w.damageAt(x, y, Math.max(1, Math.round(damage)));
    if (result === 2) this.cells.delete(i);
    if (area) {
      if (result === 1 && r.frostPulse) this.coat(x, y, 'frozen', r.freezeDuration, r.brittle);
      if (result === 1 && r.areaFault && r.faultPower) this.coat(x, y, 'fault', r.faultDuration, r.faultPower);
      if (result === 1 && chargeArea) this.coat(x, y, 'charged', r.chargeDuration);
      return result;
    }
    if (result === 1) {
      if (frozen && r.refreshFreeze) this.coat(x, y, 'frozen', r.freezeDuration, s.brittle);
      const freeze = (r.freezeEvery && b.hits % r.freezeEvery === 0) || (charged && r.supercool);
      if (freeze) {
        this.coat(x, y, 'frozen', r.freezeDuration, r.brittle);
        if (r.freezeSpread) this.spread(x, y, r.freezeSpread, r.freezeDuration, r.brittle);
      }
      if (r.faultPower && b.hits % 3 === 0) {
        this.coat(x, y, 'fault', r.faultDuration, r.faultPower);
        if (r.faultSpread) this.spread(x, y, r.faultSpread, r.faultDuration, r.faultPower, 'fault');
      }
      if (fault && r.refreshFault) this.coat(x, y, 'fault', r.faultDuration, s.faultPower);
      if (r.staticEnabled && !consumesCharge && b.hits % r.staticEvery === 0)
        this.coat(x, y, 'charged', r.chargeDuration);
    }
    if ((frozen && r.icePierce) || (fault && r.faultPierce))
      b.pierce = Math.min(b.pierceCap, b.pierce + 1);
    if (result === 2 && frozen) {
      if (r.frostBloom) this.spread(x, y, r.frostBloom, r.freezeDuration, r.brittle);
      if (r.avalanche) this.spread(x, y, r.avalanche, 5);
      if (r.thawBurst) this.burst(b, (x + 0.5) * CFG.PIXEL, (y + 0.5) * CFG.PIXEL, CFG.PIXEL * 1.2, r.thawBurst);
    }
    if (result === 2 && r.onKillPierce) b.pierce = Math.min(b.pierceCap, b.pierce + r.onKillPierce);
    if (r.echoStrikeEvery && b.hits % r.echoStrikeEvery === 0) {
      this.burst(b, (x + 0.5) * CFG.PIXEL, (y + 0.5) * CFG.PIXEL, CFG.PIXEL * 1.2, r.echoStrikeDmg);
      this.game.onImpactBlast(b.x, b.y, CFG.PIXEL * 1.2, b.color);
    }
    if (charged && r.groundBurst) {
      this.burst(b, (x + 0.5) * CFG.PIXEL, (y + 0.5) * CFG.PIXEL, CFG.PIXEL * 1.5, r.groundBurst);
      this.game.onImpactBlast(b.x, b.y, CFG.PIXEL * 1.5, '#fbbf24');
    }
    if (r.chainCount && (b.hits % r.chainEvery === 0 || frozen && r.iceChain)) {
      let jumps = 0;
      const reach = 2 + (r.chainRadius || 0);
      for (const o of this.offsets) {
        if (o.d > reach * reach || jumps >= r.chainCount) break;
        const nx = x + o.x, ny = y + o.y;
        if (!w.inBounds(nx, ny) || !w.health[ny * w.n + nx] || w.wall[ny * w.n + nx]) continue;
        this.hit(b, nx, ny, r.chainDamage, true, r.chainCharge);
        if (this.game.onChain) this.game.onChain(x, y, nx, ny, b.color);
        jumps++;
      }
    }
    if (result === 2 && (frozen || fault || charged) && r.reactionYield) {
      this.game.currency += r.reactionYield;
      this.game.stats.earned += r.reactionYield;
    }
    if (result === 2 && frozen && this.game.onReaction) this.game.onReaction(x, y, 'SHATTER', '#a5f3fc');
    return result;
  }

  burst(b, wx, wy, radius, damage) {
    const P = CFG.PIXEL, w = this.world;
    const cx = wx / P, cy = wy / P, rp = radius / P;
    let hits = 0;
    for (let y = Math.max(0, Math.floor(cy - rp)); y <= Math.min(w.n - 1, Math.ceil(cy + rp)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rp)); x <= Math.min(w.n - 1, Math.ceil(cx + rp)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > rp * rp) continue;
        const result = this.hit(b, x, y, damage, true);
        if (result === 1 || result === 2) hits++;
      }
    }
    return hits;
  }
}
