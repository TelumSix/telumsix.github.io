'use strict';

class Game {
  constructor(saveData) {
    this.saveData = saveData || {};
    this.seed = (this.saveData.seed >>> 0) || (((Math.random() * 0x7fffffff) | 0) || 7);

    this.world = new World(this.seed);
    this.tech = new Tech(this.saveData.levels);
    this.currency = Math.max(0, Math.floor(this.saveData.currency || 0));
    this.skill = Math.max(0, Math.floor(this.saveData.skill || 0));
    this.stats = Object.assign({ shots: 0, kills: 0, earned: 0, shards: 0 }, this.saveData.stats || {});
    this.effects = this.tech.getEffects();

    const unlocked = this.tech.unlockedBalls().map(b => b.id);
    this.selected = unlocked.indexOf(this.saveData.selected) >= 0 ? this.saveData.selected : 'spark';
    if (this.currency === 0 && !this.saveData.field && !this.saveData.seed) this.currency = 60;

    this.world.onDestroy = (cx, cy, maxH) => this.onPixelDestroyed(cx, cy, maxH);
    this.world.onShard = (cx, cy, value) => this.onShardCollected(cx, cy, value);

    this.canvas = document.getElementById('game');
    this.balls = new BallSystem(this.world, this);
    this.fx = new Fx();
    this.sfx = new Sfx();
    this.renderer = new Renderer(this.canvas, this.world);

    this.cam = this.renderer.cam;
    this.cam.zoom = clamp(Math.min(this.renderer.w, this.renderer.h) / 1000, 0.75, 1.35);

    this.aim = null;
    this.pan = null;
    this.keys = new Set();
    this.cooldowns = Object.create(null);
    this.launches = Object.assign({}, this.saveData.launches || {});
    this.last = 0;
    this.time = 0;
    this.won = false;
    this.startedAt = performance.now();

    this.uiTimer = 0;
    this.miniTimer = 0;
    this.autosaveTimer = 15;
    this.perfAcc = 0;
    this.perfFrames = 0;
    this.lastWallFx = 0;
    this.lastBlastFx = 0;
    this.lastPulseFx = 0;
    this.displayCurrency = this.currency;
    this._saving = false;
    this._saveAgain = false;

    this.dom = {
      currencyVal: document.getElementById('currencyVal'),
      skillVal: document.getElementById('skillVal'),
      pixelsLeft: document.getElementById('pixelsLeft'),
      ballCount: document.getElementById('ballCount'),
      ballLabel: document.getElementById('ballLabel'),
      progressFill: document.getElementById('progressFill'),
      progressPct: document.getElementById('progressPct'),
      ballList: document.getElementById('ballList'),
      toast: document.getElementById('toast'),
      hint: document.getElementById('hint'),
      techBtn: document.getElementById('btnTech'),
      soundBtn: document.getElementById('btnSound'),
      techSkill: document.getElementById('techSkill'),
      techCurrency: document.getElementById('techCurrency'),
      techOverlay: document.getElementById('techOverlay'),
      helpOverlay: document.getElementById('helpOverlay'),
      winOverlay: document.getElementById('winOverlay'),
      winStats: document.getElementById('winStats'),
      helpStats: document.getElementById('helpStats'),
      mmZoom: document.getElementById('mmZoom'),
      currencyChip: document.getElementById('currencyChip'),
      fatal: document.getElementById('fatal'),
    };

    this.techUI = new TechUI(this);
    this.bindUI();
    this.bindInput();
    this.buildLegend();
    this.buildDock();
    this.refreshHud();
    this.renderer.updateMinimap();

    this.showHint('Drag back to sling · release to fire', 6500);
    setTimeout(() => {
      if (this.stats.kills === 0 && this.skill === 0 && !this.techUI.isOpen) {
        this.showHint('Gold shards grant \u2726 skill points · press T to spend them', 6500);
      }
    }, 7300);
  }

  /* ---------------------------------------------------------------- boot */

  async init() {
    let restored = false;
    if (this.saveData.field) {
      try {
        const bytes = await inflateBytes(b64decode(this.saveData.field));
        restored = this.world.applyField(bytes);
      } catch (e) {
        console.warn('Could not restore field:', e);
      }
    }
    if (restored) {
      if (this.saveData.total) this.world.total = Math.max(1, this.saveData.total);
    } else {
      this.world.total = Math.max(1, this.world.total);
    }
    this.displayCurrency = this.currency;
    this.refreshHud();
    this.renderer.updateMinimap();
    this.updateZoomLabel();

    // frame the starting arena nicely
    this.cam.x = CFG.HALF;
    this.cam.y = CFG.HALF;
  }

  start() {
    const loop = (ts) => {
      if (!this.last) this.last = ts;
      let dt = (ts - this.last) / 1000;
      this.last = ts;
      if (!(dt >= 0)) dt = 0;
      dt = Math.min(0.05, dt);
      this.update(dt);
      this.renderer.draw(this, dt);
      this.renderer.drawMinimap();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* -------------------------------------------------------------- update */

  update(dt) {
    this.time += dt;
    const cam = this.cam;
    const keys = this.keys;

    if (this.aim) this.updateAim();

    let mx = 0;
    let my = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    if (mx !== 0 || my !== 0) {
      const speed = 1200 / cam.zoom;
      const d = (mx !== 0 && my !== 0) ? 0.7071 : 1;
      cam.x = clamp(cam.x + mx * speed * dt * d, 0, CFG.WORLD);
      cam.y = clamp(cam.y + my * speed * dt * d, 0, CFG.WORLD);
    }

    this.balls.update(dt);
    this.fx.update(dt);
    this.fx.quality = this.renderer.quality;

    this.perfAcc += dt;
    this.perfFrames++;
    if (this.perfFrames >= 90) {
      const avg = this.perfAcc / this.perfFrames;
      if (avg > 0.027 && this.renderer.quality > 0) this.renderer.quality--;
      else if (avg < 0.0145 && this.renderer.quality < 2) this.renderer.quality++;
      this.perfAcc = 0;
      this.perfFrames = 0;
    }

    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.06;
      this.refreshHud();
      this.refreshDockAffordability();
    }

    this.miniTimer -= dt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.22;
      this.renderer.updateMinimap();
    }

    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 15;
      this.save();
    }

    if (!this.won && this.world.total > 0 && this.world.remaining === 0) {
      this.win();
    }
  }

  /* -------------------------------------------------------------- pixels */

  onPixelDestroyed(cx, cy, maxH) {
    const gain = Math.max(1, Math.round((2 + maxH * 2) * this.effects.yieldMult) + this.effects.bounty);
    this.currency += gain;
    this.stats.earned += gain;
    this.stats.kills++;

    const wx = (cx + 0.5) * CFG.PIXEL;
    const wy = (cy + 0.5) * CFG.PIXEL;
    const color = pixelCss(maxH, 1);
    if (this.fx.particles.length < CFG.MAX_PARTICLES * 0.7) {
      this.fx.burst(wx, wy, color, this.renderer.quality >= 1 ? 2 : 1, 70, 0.42, 3);
    }
    this.sfx.hit();
    this.dirtySave = true;
  }

  onShardCollected(cx, cy, value) {
    this.skill += value;
    this.stats.shards++;
    const wx = (cx + 0.5) * CFG.PIXEL;
    const wy = (cy + 0.5) * CFG.PIXEL;
    this.fx.ring(wx, wy, SHARD_CSS, CFG.PIXEL * 1.5);
    this.fx.burst(wx, wy, SHARD_CSS, 20, 210, 0.85, 4);
    this.fx.text(wx, wy - 12, `+${value} \u2726`, SHARD_CSS, 16);
    this.sfx.shard();
    if (this.stats.shards <= 3) this.showHint('Skill points unlock the tech tree · press T', 3400);
    this.saveSoon();
  }

  onWallHit(wx, wy) {
    this.sfx.wall();
    const now = performance.now();
    if (now - this.lastWallFx > 35 && this.renderer.quality >= 1) {
      this.lastWallFx = now;
      for (let i = 0; i < 2; i++) {
        this.fx.particle(
          wx, wy,
          (Math.random() - 0.5) * 180,
          (Math.random() - 0.5) * 180,
          0.22, '#cfe3ff', 2, 0.8, 0
        );
      }
    }
  }

  onExplosion(wx, wy, radius, hits) {
    this.fx.ring(wx, wy, '#fda4af', radius * 1.15);
    if (this.renderer.quality >= 1) {
      this.fx.burst(wx, wy, '#fb7185', 14, 260, 0.5, 4);
    }
    this.sfx.explode(radius > 220);
    this.renderer.shake = Math.min(15, this.renderer.shake + radius / 42);
  }

  /* ------------------------------------------------------------- shooting */

  ballCost(def) {
    // Every launch of a given ball makes the next one 1.5x pricier, so a swarm
    // keeps paying for itself instead of snowballing for free.
    const fired = this.launches[def.id] || 0;
    const raw = def.cost * this.effects.costMult * Math.pow(1.5, fired);
    return Math.max(1, Math.round(Math.min(raw, 1e18)));
  }

  ballCooldown(def) {
    const reload = 1 - 0.15 * this.tech.level(def.id + '_reload');
    return Math.max(0.06, (def.cooldown || 0.3) * this.effects.cooldownMult * reload);
  }

  cooldownLeft(def, now) {
    const ready = this.cooldowns[def.id] || 0;
    return Math.max(0, ready - (now === undefined ? performance.now() / 1000 : now));
  }

  /** Final stats for a ball after global and per-ball tech. */
  ballStats(def) {
    const tech = this.tech;
    const eff = this.effects;
    const P = CFG.PIXEL;
    const lv = k => tech.level(def.id + '_' + k);
    const sig = BALL_SIG[def.id];
    const sigLv = tech.level(def.id + '_' + sig.stat);

    const s = {
      damage: def.damage + eff.damageBonus + lv('dmg'),
      speed: def.speed * eff.speedMult * (1 + 0.20 * lv('spd')),
      radius: def.radius * eff.radiusMult * (1 + 0.12 * lv('size')),
      pierce: def.pierce || 0,
      explode: (def.explode || 0) * P,
      explodeDmg: def.explodeDmg || 0,
      split: def.split || 0,
      ramp: def.ramp || 0,
      rampSize: def.rampSize || 0,
      charge: def.charge || 0,
      chargeCap: def.chargeCap || 1,
      streakEvery: Math.max(4, (def.streakEvery || 16) - eff.streakBonus),
      splash: def.splash || 0,
      impactR: def.impact ? def.impact.r * P : 0,
      impactDmg: def.impact ? def.impact.dmg : 1,
      pulseEvery: def.pulse ? def.pulse.every : 0,
      pulseR: def.pulse ? def.pulse.r * P : 0,
      pulseDmg: def.pulse ? def.pulse.dmg : 0,
      spawnEvery: def.spawn ? def.spawn.every : 0,
      spawnCount: def.spawn ? def.spawn.count : 0,
      pierceEvery: def.pierceGrow ? def.pierceGrow.every : 0,
      pierceCap: def.pierceGrow ? def.pierceGrow.cap : 0,
      streakDamage: 1 + eff.streakDmg,
      splashDiag: false,
      chargeOnSteel: 0,
      pulseSpawn: 0,
      harvestEvery: eff.harvestEvery,
      reloadMult: 1 - 0.15 * lv('reload'),
    };

    if (sig.stat === 'streak') {
      s.streakEvery = Math.max(4, s.streakEvery - sig.step * sigLv);
    } else if (sig.stat === 'charge') {
      s.charge += sig.step * sigLv;
      s.chargeCap += 0.2 * sigLv;
    } else if (sig.stat === 'splash') {
      s.splash += sigLv;
    } else if (sig.stat === 'ramp') {
      s.ramp += sig.step * sigLv;
      s.rampSize += 0.06 * sigLv;
    } else if (sig.stat === 'impact') {
      if (sigLv > 0) {
        s.impactR = (0.9 + 0.5 * sigLv) * P;
        s.impactDmg = 1 + (sigLv > 1 ? 1 : 0);
      }
    } else if (sig.stat === 'pierce') {
      s.pierceCap += sig.step * sigLv;
    } else if (sig.stat === 'pulse') {
      s.pulseR += sig.step * sigLv * P;
    } else if (sig.stat === 'frags') {
      s.spawnCount += sig.step * sigLv;
    }

    // Shared "elastic field" winds every ball up a little on each bounce.
    if (eff.elastic > 0) {
      s.charge += eff.elastic;
      s.chargeCap += eff.elasticCap;
    }

    const extra = BALL_EXTRA[def.id];
    const exLv = tech.level(def.id + '_' + extra.stat);
    if (exLv > 0) {
      if (extra.stat === 'chain') {
        s.spawnEvery = Math.max(4, 14 - 3 * exLv);
        s.spawnCount = Math.max(1, s.spawnCount);
      } else if (extra.stat === 'overwind') {
        s.chargeCap += 0.4 * exLv;
      } else if (extra.stat === 'fracture') {
        s.splashDiag = true;
        s.splash += exLv > 1 ? 1 : 0;
      } else if (extra.stat === 'kick') {
        s.chargeOnSteel = 0.03 * exLv;
        s.chargeCap = Math.max(s.chargeCap, 1.6);
      } else if (extra.stat === 'amplify') {
        s.impactR += 0.6 * exLv * P;
        s.impactDmg += exLv > 1 ? 1 : 0;
      } else if (extra.stat === 'needle') {
        s.pierceEvery = 1;
      } else if (extra.stat === 'feedback') {
        s.pulseDmg += exLv;
        s.pulseEvery = Math.max(2, s.pulseEvery - exLv);
      } else if (extra.stat === 'budding') {
        s.spawnEvery = Math.max(3, s.spawnEvery - 2 * exLv);
      } else if (extra.stat === 'pulsefrags') {
        s.pulseSpawn = exLv;
      }
    }

    // Shared field powers: only balls without their own pulse/spawner get them.
    if (s.pulseEvery === 0 && eff.resonanceEvery > 0) {
      s.pulseEvery = eff.resonanceEvery;
      s.pulseR = P * 1.1;
      s.pulseDmg = 1;
    }
    if (s.spawnEvery === 0 && eff.mitosisEvery > 0) {
      s.spawnEvery = eff.mitosisEvery;
      s.spawnCount = 1;
    }

    return s;
  }

  ballPreview(def) {
    const s = this.ballStats(def);
    const parts = [`${s.damage} dmg`, `${Math.round(s.speed)} spd`, `r${s.radius.toFixed(1)}`];
    if (s.pierce > 0) parts.push(`${s.pierce} pierce`);
    if (s.charge > 0) parts.push(`+${Math.round(s.charge * 100)}%/bounce`);
    if (s.splash > 0) parts.push(`${s.splash} crush`);
    if (s.impactR > 0) parts.push('shockwave');
    if (s.ramp > 0) parts.push('steel ramp');
    if (s.pulseEvery > 0) parts.push(`pulse / ${s.pulseEvery}`);
    if (s.spawnEvery > 0) parts.push(`split / ${s.spawnEvery}`);
    if (s.pierceEvery > 0) parts.push('pierce grows');
    if (s.reloadMult < 1) parts.push(`${Math.round((1 - s.reloadMult) * 100)}% reload`);
    return parts.join(' · ');
  }

  onImpactBlast(wx, wy, radius, color) {
    const now = performance.now();
    if (now - this.lastBlastFx < 90) return;
    this.lastBlastFx = now;
    this.fx.ring(wx, wy, color || '#fda4af', radius * 1.35);
  }

  onPulse(wx, wy, radius, color) {
    const now = performance.now();
    if (now - this.lastPulseFx < 110) return;
    this.lastPulseFx = now;
    const c = color || '#fda4af';
    this.fx.ring(wx, wy, c, radius * 1.2);
    if (this.renderer.quality >= 1) this.fx.burst(wx, wy, c, 6, 220, 0.4, 3);
    this.sfx.explode(radius > 220);
  }

  onBounceHarvest() {
    this.currency += 1;
    this.stats.earned += 1;
  }

  fire(aim) {
    const now = performance.now() / 1000;
    const def = BALL_BY_ID[this.selected];

    if (now < (this.cooldowns[def.id] || 0)) {
      this.sfx.error();
      return;
    }

    // slingshot: the ball leaves in the direction opposite the drag
    const dx = aim.sx - aim.cx;
    const dy = aim.sy - aim.cy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 8) return;
    const cost = this.ballCost(def);

    if (this.currency < cost) {
      this.toast(`Need \u25c6${formatCompact(cost)} — destroy pixels to earn more`, 'bad');
      this.sfx.error();
      this.bumpCurrency();
      return;
    }

    this.currency -= cost;
    this.cooldowns[def.id] = now + this.ballCooldown(def);
    this.launches[def.id] = (this.launches[def.id] || 0) + 1;
    this.stats.shots++;

    const angle = Math.atan2(dy, dx);
    const power = clamp(len / 260, 0.65, 1.2);
    const volley = this.effects.volley;
    const spread = 0.055;
    const ox = clamp(aim.wx, 1, CFG.WORLD - 1);
    const oy = clamp(aim.wy, 1, CFG.WORLD - 1);

    for (let i = 0; i < volley; i++) {
      const a = angle + (i - (volley - 1) * 0.5) * spread;
      this.balls.fire(def, ox, oy, a, power);
    }

    this.fx.ring(ox, oy, def.color, 46);
    this.fx.burst(ox, oy, def.color, 5, 95, 0.24, 2.6);
    this.sfx.shoot(def);
    this.showHint(null);
    this.dirtySave = true;
  }

  updateAim() {
    const aim = this.aim;
    if (!aim) return;
    const o = this.cam.worldToScreen(aim.wx, aim.wy);
    aim.sx = o.x;
    aim.sy = o.y;
    // slingshot: aim is opposite to the pull
    const dx = o.x - aim.cx;
    const dy = o.y - aim.cy;
    aim.len = Math.sqrt(dx * dx + dy * dy);
    aim.power = clamp(aim.len / 260, 0.65, 1.2);
    if (aim.len > 3) {
      const ux = dx / aim.len;
      const uy = dy / aim.len;
      const [ocx, ocy] = this.world.cellAt(aim.wx, aim.wy);
      if (this.world.solidAt(ocx, ocy)) {
        aim.hit = null;
      } else {
        aim.hit = this.world.raycast(aim.wx, aim.wy, ux, uy, 3600);
      }
    } else {
      aim.hit = null;
    }
  }

  /* ---------------------------------------------------------------- input */

  localPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  bindInput() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (e) => {
      if (this.techUI.isOpen || !this.dom.helpOverlay.classList.contains('hidden')) return;
      const p = this.localPoint(e);

      if (e.button === 2 || e.button === 1 || this.keys.has('Space')) {
        if (this.aim) return;
        this.pan = { sx: p.x, sy: p.y, camX: this.cam.x, camY: this.cam.y };
        this.renderer.canvas.style.cursor = 'grabbing';
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;
      if (this.pan) return;
      this.sfx.ensure();
      const w = this.cam.screenToWorld(p.x, p.y);
      this.aim = {
        sx: p.x, sy: p.y, cx: p.x, cy: p.y,
        wx: clamp(w.x, 0, CFG.WORLD),
        wy: clamp(w.y, 0, CFG.WORLD),
        power: 1, len: 0, hit: null,
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.updateAim();
      this.showHint(null);
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.pan) {
        const p = this.localPoint(e);
        this.cam.x = clamp(this.pan.camX - (p.x - this.pan.sx) / this.cam.zoom, 0, CFG.WORLD);
        this.cam.y = clamp(this.pan.camY - (p.y - this.pan.sy) / this.cam.zoom, 0, CFG.WORLD);
        return;
      }
      if (!this.aim) return;
      const p = this.localPoint(e);
      this.aim.cx = p.x;
      this.aim.cy = p.y;
      this.updateAim();
    });

    const endPointer = (e, cancel) => {
      if (this.pan) {
        this.pan = null;
        this.renderer.canvas.style.cursor = 'crosshair';
        return;
      }
      if (!this.aim) return;
      const aim = this.aim;
      this.aim = null;
      if (cancel) return;
      const p = this.localPoint(e);
      aim.cx = p.x;
      aim.cy = p.y;
      this.updateAimFor(aim);
      this.fire(aim);
    };

    canvas.addEventListener('pointerup', (e) => endPointer(e, false));
    canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.techUI.isOpen) {
        this.techUI.resize();
        this.techUI.draw();
      }
      this.updateZoomLabel();
    });

    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown' ||
          code === 'ArrowLeft' || code === 'ArrowRight') {
        e.preventDefault();
      }
      if (!e.repeat) this.onKeyDown(code, e);
      this.keys.add(code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.getElementById('btnZoomIn').addEventListener('click', () => this.zoomAtCenter(1.35));
    document.getElementById('btnZoomOut').addEventListener('click', () => this.zoomAtCenter(1 / 1.35));

    const mini = document.getElementById('minimap');
    if (mini) {
      mini.addEventListener('pointerdown', (e) => {
        const r = mini.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        this.cam.x = clamp(fx * CFG.WORLD, 0, CFG.WORLD);
        this.cam.y = clamp(fy * CFG.WORLD, 0, CFG.WORLD);
        this.sfx.click();
      });
    }

    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
  }

  updateAimFor(aim) {
    const o = this.cam.worldToScreen(aim.wx, aim.wy);
    aim.sx = o.x;
    aim.sy = o.y;
    aim.len = Math.sqrt((aim.cx - o.x) ** 2 + (aim.cy - o.y) ** 2);
    aim.power = clamp(aim.len / 260, 0.65, 1.2);
  }

  onKeyDown(code, e) {
    if (code === 'Escape') {
      if (this.techUI.isOpen) { this.techUI.close(); return; }
      if (!this.dom.helpOverlay.classList.contains('hidden')) { this.closeHelp(); return; }
      if (this.audioPanel && !this.audioPanel.classList.contains('hidden')) { this.closeAudioPanel(); return; }
      if (this.aim) this.aim = null;
      return;
    }
    if (code === 'KeyT') {
      this.closeAudioPanel();
      if (this.techUI.isOpen) this.techUI.close();
      else { this.closeHelp(); this.techUI.open(); this.refreshTechHeader(); }
      return;
    }
    if (code === 'KeyH' || (code === 'Slash' && e.shiftKey)) {
      this.closeAudioPanel();
      if (!this.dom.helpOverlay.classList.contains('hidden')) this.closeHelp();
      else this.openHelp();
      return;
    }
    if (code === 'KeyM') {
      this.toggleSound();
      return;
    }
    if (code === 'Equal' || code === 'NumpadAdd') { this.zoomAtCenter(1.25); return; }
    if (code === 'Minus' || code === 'NumpadSubtract') { this.zoomAtCenter(1 / 1.25); return; }

    const m = /^Digit([1-9])$/.exec(code);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      const list = this.tech.unlockedBalls();
      if (idx < list.length) this.selectBall(list[idx].id);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.localPoint(e);
    const before = this.cam.screenToWorld(p.x, p.y);
    const factor = Math.exp(-e.deltaY * 0.0016);
    this.cam.zoom = clamp(this.cam.zoom * factor, CFG.MIN_ZOOM, CFG.MAX_ZOOM);
    const after = this.cam.screenToWorld(p.x, p.y);
    this.cam.x = clamp(this.cam.x + (before.x - after.x), 0, CFG.WORLD);
    this.cam.y = clamp(this.cam.y + (before.y - after.y), 0, CFG.WORLD);
    this.updateZoomLabel();
  }

  zoomAtCenter(factor) {
    const p = { x: this.renderer.w * 0.5, y: this.renderer.h * 0.5 };
    const before = this.cam.screenToWorld(p.x, p.y);
    this.cam.zoom = clamp(this.cam.zoom * factor, CFG.MIN_ZOOM, CFG.MAX_ZOOM);
    const after = this.cam.screenToWorld(p.x, p.y);
    this.cam.x = clamp(this.cam.x + (before.x - after.x), 0, CFG.WORLD);
    this.cam.y = clamp(this.cam.y + (before.y - after.y), 0, CFG.WORLD);
    this.updateZoomLabel();
  }

  updateZoomLabel() {
    if (this.dom.mmZoom) this.dom.mmZoom.textContent = Math.round(this.cam.zoom * 100) + '%';
  }

  /* ------------------------------------------------------------------ UI */

  bindUI() {
    const d = this.dom;
    d.techBtn.addEventListener('click', () => {
      this.closeAudioPanel();
      if (this.techUI.isOpen) this.techUI.close();
      else { this.closeHelp(); this.techUI.open(); this.refreshTechHeader(); }
    });
    document.getElementById('btnHelp').addEventListener('click', () => {
      this.closeAudioPanel();
      if (this.dom.helpOverlay.classList.contains('hidden')) this.openHelp();
      else this.closeHelp();
    });
    document.getElementById('btnCloseHelp').addEventListener('click', () => this.closeHelp());
    d.helpOverlay.addEventListener('pointerdown', (e) => {
      if (e.target === d.helpOverlay) this.closeHelp();
    });
    d.winOverlay.addEventListener('pointerdown', (e) => {
      if (e.target === d.winOverlay) this.newField();
    });
    d.soundBtn.addEventListener('click', () => this.toggleAudioPanel());
    document.getElementById('btnNewField').addEventListener('click', () => this.newField());
    document.getElementById('btnNewFieldWin').addEventListener('click', () => this.newField());
    document.getElementById('btnWipe').addEventListener('click', () => this.wipeProgress());

    this.audioPanel = document.getElementById('audioPanel');
    this.audioSliders = [
      ['master', 'volMaster', 'valMaster'],
      ['fx', 'volFx', 'valFx'],
      ['chime', 'volChime', 'valChime'],
    ];
    for (const [key, inputId, valId] of this.audioSliders) {
      const input = document.getElementById(inputId);
      const val = document.getElementById(valId);
      input.value = String(Math.round(this.sfx.volumes[key] * 100));
      val.textContent = input.value + '%';
      input.addEventListener('input', () => {
        this.sfx.setVolume(key, Number(input.value) / 100);
        val.textContent = input.value + '%';
      });
    }
    document.getElementById('btnMutePanel').addEventListener('click', () => this.toggleSound());
    document.addEventListener('pointerdown', (e) => {
      if (!this.audioPanel || this.audioPanel.classList.contains('hidden')) return;
      if (this.audioPanel.contains(e.target) || d.soundBtn.contains(e.target)) return;
      this.closeAudioPanel();
    }, true);

    this.applySoundButton();
  }

  toggleAudioPanel() {
    if (!this.audioPanel) return;
    if (this.audioPanel.classList.contains('hidden')) {
      this.refreshAudioUI();
      this.audioPanel.classList.remove('hidden');
      this.sfx.click();
    } else {
      this.closeAudioPanel();
    }
  }

  closeAudioPanel() {
    if (this.audioPanel) this.audioPanel.classList.add('hidden');
  }

  refreshAudioUI() {
    if (!this.audioSliders) return;
    for (const [key, inputId, valId] of this.audioSliders) {
      const input = document.getElementById(inputId);
      const val = document.getElementById(valId);
      const pct = Math.round(this.sfx.volumes[key] * 100);
      input.value = String(pct);
      val.textContent = pct + '%';
    }
    const mute = document.getElementById('btnMutePanel');
    if (mute) mute.textContent = this.sfx.enabled ? 'Mute' : 'Unmute';
  }

  openHelp() {
    this.dom.helpOverlay.classList.remove('hidden');
    this.dom.helpStats.textContent =
      `${plural(this.stats.kills, 'pixel')} broken · ${plural(this.stats.shots, 'ball')} launched · ${plural(this.stats.shards, 'shard')} found`;
    this.sfx.click();
  }

  closeHelp() {
    this.dom.helpOverlay.classList.add('hidden');
    this.sfx.click();
  }

  toggleSound() {
    this.sfx.setEnabled(!this.sfx.enabled);
    this.applySoundButton();
    if (this.sfx.enabled) this.sfx.click();
  }

  applySoundButton() {
    const b = this.dom.soundBtn;
    b.classList.toggle('sound-off', !this.sfx.enabled);
    b.textContent = '\u266a';
    b.style.opacity = this.sfx.enabled ? '1' : '0.4';
    b.title = 'Sound settings — M mutes';
    const mute = document.getElementById('btnMutePanel');
    if (mute) mute.textContent = this.sfx.enabled ? 'Mute' : 'Unmute';
  }

  buildLegend() {
    const el = document.getElementById('legend');
    if (!el) return;
    el.innerHTML = '';
    const rows = [
      ['fresh', pixelCss(1, 1)],
      ['hurt', pixelCss(6, 3)],
      ['critical', pixelCss(10, 1)],
      ['steel', `rgb(${WALL_RGB[0]},${WALL_RGB[1]},${WALL_RGB[2]})`],
      ['shard \u2726', SHARD_CSS],
    ];
    for (const [label, color] of rows) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.background = color;
      sw.style.color = color;
      item.appendChild(sw);
      const lab = document.createElement('span');
      lab.textContent = label;
      item.appendChild(lab);
      el.appendChild(item);
    }
  }

  refreshTechHeader() {
    this.dom.techSkill.textContent = formatNum(this.skill);
    this.dom.techCurrency.textContent = formatNum(this.currency);
  }

  toast(msg, kind) {
    const el = this.dom.toast;
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.className = 'toast' + (kind ? ' ' + kind : '');
    }, 1900);
  }

  showHint(msg, ms) {
    const el = this.dom.hint;
    if (!msg) {
      el.classList.remove('show');
      clearTimeout(this._hintTimer);
      return;
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._hintTimer);
    if (ms) {
      this._hintTimer = setTimeout(() => el.classList.remove('show'), ms);
    }
  }

  bumpCurrency() {
    const el = this.dom.currencyChip;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  refreshHud() {
    const d = this.dom;
    if (Math.abs(this.displayCurrency - this.currency) > 0.6) {
      this.displayCurrency += (this.currency - this.displayCurrency) * 0.35;
    } else {
      this.displayCurrency = this.currency;
    }
    d.currencyVal.textContent = formatNum(this.displayCurrency);
    d.skillVal.textContent = formatNum(this.skill);

    d.pixelsLeft.textContent = formatCompact(this.world.remaining);
    d.ballCount.textContent = formatCompact(this.balls.count);
    if (d.ballLabel) d.ballLabel.textContent = this.balls.count === 1 ? 'ball' : 'balls';
    const total = Math.max(1, this.world.total);
    const pct = clamp((1 - this.world.remaining / total) * 100, 0, 100);
    d.progressFill.style.width = pct.toFixed(2) + '%';
    d.progressPct.textContent = pct.toFixed(1) + '%';

    if (this.techUI.isOpen) this.refreshTechHeader();

    let affordable = false;
    if (this.skill > 0) {
      for (const node of TECH_NODES) {
        if (this.tech.canBuy(node, this.skill)) { affordable = true; break; }
      }
    }
    d.techBtn.classList.toggle('has-points', affordable);

    if (this._cards) {
      const now = performance.now() / 1000;
      for (const card of this._cards) {
        const def = BALL_BY_ID[card.dataset.id];
        if (!def) continue;
        const cd = this.ballCooldown(def);
        const left = this.cooldownLeft(def, now);
        card.classList.toggle('cooling', left > 0.001);
        if (card._cdFill) card._cdFill.style.width = (clamp(left / cd, 0, 1) * 100).toFixed(1) + '%';
        if (card._costEl) {
          const txt = '\u25c6 ' + formatCompact(this.ballCost(def));
          if (card._costEl.textContent !== txt) card._costEl.textContent = txt;
        }
      }
    }
  }

  /* ---------------------------------------------------------------- dock */

  buildDock() {
    const list = this.dom.ballList;
    const unlocked = this.tech.unlockedBalls();
    const sig = unlocked.map(b => b.id).join(',') + '|' + this.selected;
    if (sig === this._dockSig) return;
    this._dockSig = sig;

    list.innerHTML = '';
    this._cards = [];
    unlocked.forEach((def, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ball-card';
      btn.style.setProperty('--bc', def.color);
      btn.dataset.id = def.id;
      btn.innerHTML =
        `<span class="bc-dot" style="--c:${def.color}"></span>` +
        `<span class="bc-text"><span class="bc-name">${def.name}</span><span class="bc-sub">${def.short}</span></span>` +
        `<span class="bc-cost">\u25c6 ${this.ballCost(def)}</span>` +
        `<span class="bc-key">${i + 1}</span>` +
        `<span class="bc-cd"><i></i></span>`;
      btn.title = `${def.desc}  ·  ${this.ballCooldown(def).toFixed(2)}s reload · each launch makes this ball 1.5x pricier`;
      btn._cdFill = btn.querySelector('.bc-cd > i');
      btn._costEl = btn.querySelector('.bc-cost');
      btn.addEventListener('click', () => this.selectBall(def.id));
      list.appendChild(btn);
      this._cards.push(btn);
    });
    this.updateDockSelection();
  }

  updateDockSelection() {
    if (!this._cards) return;
    for (const card of this._cards) {
      card.classList.toggle('selected', card.dataset.id === this.selected);
      const def = BALL_BY_ID[card.dataset.id];
      const costEl = card.querySelector('.bc-cost');
      if (costEl && def) costEl.textContent = '\u25c6 ' + this.ballCost(def);
    }
  }

  refreshDockAffordability() {
    if (!this._cards) return;
    for (const card of this._cards) {
      const def = BALL_BY_ID[card.dataset.id];
      if (!def) continue;
      card.classList.toggle('poor', this.currency < this.ballCost(def));
    }
  }

  selectBall(id) {
    if (!this.tech.unlockedBalls().some(b => b.id === id)) return;
    if (this.selected === id) return;
    this.selected = id;
    this._dockSig = null;
    this.buildDock();
    this.sfx.click();
    this.saveSoon();
  }

  /* ---------------------------------------------------------------- tech */

  buyNode(node) {
    if (this.tech.maxed(node)) {
      this.toast('Already at max level.', 'bad');
      this.sfx.error();
      return;
    }
    if (!this.tech.reqsMet(node)) {
      this.toast('Requirements not met — unlock the linked node first.', 'bad');
      this.sfx.error();
      return;
    }
    const cost = this.tech.nodeCost(node);
    if (this.skill < cost) {
      this.toast(`Need \u2726${cost} — break glowing shards to earn skill points`, 'bad');
      this.sfx.error();
      return;
    }

    this.skill -= cost;
    this.tech.levels[node.id] = this.tech.level(node.id) + 1;
    this.effects = this.tech.getEffects();

    if (node.kind === 'ball') {
      this.selected = node.ball;
      this.toast(`${node.name} unlocked and equipped!`, 'gold');
    } else {
      this.toast(`${node.name} upgraded to Lv ${this.tech.level(node.id)}.`, 'gold');
    }

    this.sfx.buy();
    this.refreshHud();
    this.buildDock();
    this.updateDockSelection();
    this.refreshDockAffordability();
    if (this.techUI.isOpen) {
      this.refreshTechHeader();
      this.techUI.refresh();
    }
    this.save();
  }

  /* ---------------------------------------------------------------- save */

  saveSoon() {
    clearTimeout(this._saveSoonTimer);
    this._saveSoonTimer = setTimeout(() => this.save(), 900);
  }

  save() {
    if (this._saving) {
      this._saveAgain = true;
      return;
    }
    this._saving = true;

    const meta = {
      v: 5,
      seed: this.seed,
      currency: Math.floor(this.currency),
      skill: Math.floor(this.skill),
      levels: this.tech.levels,
      selected: this.selected,
      launches: this.launches,
      stats: this.stats,
      total: this.world.total,
      field: null,
    };

    const finish = (field) => {
      meta.field = field;
      try {
        localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(meta));
      } catch (e) {
        meta.field = null;
        try { localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(meta)); } catch (e2) { /* ignore */ }
      }
      this._saving = false;
      this.dirtySave = false;
      if (this._saveAgain) {
        this._saveAgain = false;
        this.save();
      }
    };

    deflateBytes(this.world.health)
      .then(bytes => finish(b64encode(bytes)))
      .catch(() => finish(null));
  }

  /* --------------------------------------------------------------- misc */

  newField() {
    if (!window.confirm('Generate a new field? Progress on this field is lost. Tech and currency are kept.')) return;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const meta = {
      v: 5,
      seed,
      currency: Math.floor(this.currency),
      skill: Math.floor(this.skill),
      levels: this.tech.levels,
      selected: this.selected,
      launches: {},
      stats: { shots: 0, kills: 0, earned: 0, shards: 0 },
      total: 0,
      field: null,
    };
    try { localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  wipeProgress() {
    if (!window.confirm('Wipe ALL progress, tech and currency? This cannot be undone.')) return;
    try { localStorage.removeItem(CFG.SAVE_KEY); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  win() {
    this.won = true;
    const secs = Math.round((performance.now() - this.startedAt) / 1000);
    const mins = Math.floor(secs / 60);
    this.dom.winStats.innerHTML =
      `<div class="win-stat"><b>${formatNum(this.stats.kills)}</b><span>pixels broken</span></div>` +
      `<div class="win-stat"><b>${formatNum(this.stats.shots)}</b><span>balls launched</span></div>` +
      `<div class="win-stat"><b>${mins}m ${secs % 60}s</b><span>time</span></div>`;
    this.dom.winOverlay.classList.remove('hidden');
    this.sfx.win();
    this.save();
  }
}
