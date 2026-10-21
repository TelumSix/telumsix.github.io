'use strict';

class Camera {
  constructor() {
    this.x = CFG.HALF;
    this.y = CFG.HALF;
    this.zoom = 1;
    this.w = 1;
    this.h = 1;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  worldToScreenX(wx) { return (wx - this.x) * this.zoom + this.w * 0.5 + this.shakeX; }
  worldToScreenY(wy) { return (wy - this.y) * this.zoom + this.h * 0.5 + this.shakeY; }
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom + this.w * 0.5 + this.shakeX,
      y: (wy - this.y) * this.zoom + this.h * 0.5 + this.shakeY,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.w * 0.5 - this.shakeX) / this.zoom + this.x,
      y: (sy - this.h * 0.5 - this.shakeY) / this.zoom + this.y,
    };
  }

  view() {
    const hw = this.w / (2 * this.zoom);
    const hh = this.h / (2 * this.zoom);
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}

/* ======================================================================== */

class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.cam = new Camera();
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.chunks = new Map();
    this.quality = 2;
    this.shake = 0;
    this.time = 0;
    this.lut = this.buildLut();
    this.color2d = this.buildColor2D();
    this.glow = this.buildGlow();
    this.ballSprites = new Map();
    this.bgGrad = null;
    this.vignette = null;

    this.mini = document.getElementById('minimap');
    this.miniCtx = this.mini ? this.mini.getContext('2d') : null;
    this.miniImg = this.miniCtx ? this.miniCtx.createImageData(CFG.MINI, CFG.MINI) : null;
    this.mini32 = this.miniImg ? new Uint32Array(this.miniImg.data.buffer) : null;
    this.miniReady = false;
    this.littleEndian = (() => {
      const b = new ArrayBuffer(4);
      new Uint32Array(b)[0] = 0x0a0b0c0d;
      return new Uint8Array(b)[0] === 0x0d;
    })();

    this.resize();
  }

  /* --------------------------------------------------------------- setup */

  buildLut() {
    const shades = 8;
    const stride = CFG.HEALTH_STRIDE;
    const health = new Uint8Array(stride * stride * shades * 3);
    for (let m = 1; m <= CFG.MAX_HEALTH; m++) {
      for (let h = 1; h <= m; h++) {
        const c = pixelColorRGB(m, h);
        for (let v = 0; v < shades; v++) {
          const f = 0.86 + (v / (shades - 1)) * 0.24;
          const o = (((m * stride + h) * shades) + v) * 3;
          health[o] = clamp(Math.round(c[0] * f), 0, 255);
          health[o + 1] = clamp(Math.round(c[1] * f), 0, 255);
          health[o + 2] = clamp(Math.round(c[2] * f), 0, 255);
        }
      }
    }

    const wall = new Uint8Array(shades * 3);
    for (let v = 0; v < shades; v++) {
      const f = 0.86 + (v / (shades - 1)) * 0.2;
      const o = v * 3;
      wall[o] = clamp(Math.round(WALL_RGB[0] * f), 0, 255);
      wall[o + 1] = clamp(Math.round(WALL_RGB[1] * f), 0, 255);
      wall[o + 2] = clamp(Math.round(WALL_RGB[2] * f), 0, 255);
    }

    const shard = new Uint8Array(shades * 3);
    for (let v = 0; v < shades; v++) {
      const f = 0.9 + (v / (shades - 1)) * 0.16;
      const o = v * 3;
      shard[o] = clamp(Math.round(SHARD_RGB[0] * f), 0, 255);
      shard[o + 1] = clamp(Math.round(SHARD_RGB[1] * f), 0, 255);
      shard[o + 2] = clamp(Math.round(SHARD_RGB[2] * f), 0, 255);
    }

    return { health, wall, shard };
  }

  buildColor2D() {
    const stride = CFG.HEALTH_STRIDE;
    const c2 = new Uint8Array(stride * stride * 3);
    for (let m = 1; m <= CFG.MAX_HEALTH; m++) {
      for (let h = 1; h <= m; h++) {
        const c = pixelColorRGB(m, h);
        const o = (m * stride + h) * 3;
        c2[o] = c[0];
        c2[o + 1] = c[1];
        c2[o + 2] = c[2];
      }
    }
    return c2;
  }

  buildGlow() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 246, 214, 0.95)');
    grad.addColorStop(0.2, 'rgba(255, 214, 120, 0.55)');
    grad.addColorStop(0.55, 'rgba(255, 190, 80, 0.16)');
    grad.addColorStop(1, 'rgba(255, 190, 80, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  ballSprite(color) {
    let c = this.ballSprites.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const g = c.getContext('2d');
      const [r, gr, b] = hexToRgb(color);
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, `rgba(${r},${gr},${b},1)`);
      grad.addColorStop(0.5, `rgba(${r},${gr},${b},1)`);
      grad.addColorStop(0.8, `rgba(${r},${gr},${b},0.75)`);
      grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(16, 16, 15.5, 0, TAU);
      g.fill();
      this.ballSprites.set(color, c);
    }
    return c;
  }

  resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.w = w;
    this.cam.h = h;

    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, w * 0.4, h);
    grad.addColorStop(0, '#070b14');
    grad.addColorStop(0.55, '#060910');
    grad.addColorStop(1, '#04060b');
    this.bgGrad = grad;

    const vig = ctx.createRadialGradient(
      w * 0.5, h * 0.5, Math.min(w, h) * 0.25,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.78
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    this.vignette = vig;
  }

  /* --------------------------------------------------------------- field */

  createChunk() {
    const c = document.createElement('canvas');
    c.width = CFG.CHUNK;
    c.height = CFG.CHUNK;
    const ctx = c.getContext('2d');
    return { canvas: c, ctx, img: ctx.createImageData(CFG.CHUNK, CFG.CHUNK) };
  }

  paintChunk(ch, cx, cy) {
    const w = this.world;
    const n = w.n;
    const CH = CFG.CHUNK;
    const data = ch.img.data;
    const health = w.health;
    const maxHealth = w.maxHealth;
    const wall = w.wall;
    const special = w.special;
    const visible = w.visible;
    const open = w.open;
    const lut = this.lut;
    const baseX = cx * CH;
    const baseY = cy * CH;
    let o = 0;

    // Cells that still sit next to unrevealed fog are shaded a little darker,
    // so the explored edge of the field reads as a soft falloff.
    const fogAt = (x, y) => {
      if (x < 0 || y < 0 || x >= n || y >= n) return true;
      const j = y * n + x;
      return visible[j] === 0 && open[j] === 0;
    };
    const nearFog = (x, y) => (
      fogAt(x - 1, y) || fogAt(x + 1, y) || fogAt(x, y - 1) || fogAt(x, y + 1) ||
      fogAt(x - 1, y - 1) || fogAt(x + 1, y - 1) || fogAt(x - 1, y + 1) || fogAt(x + 1, y + 1)
    );

    for (let y = 0; y < CH; y++) {
      const gy = baseY + y;
      const row = gy * n + baseX;
      for (let x = 0; x < CH; x++) {
        const gx = baseX + x;
        const i = row + x;
        const h = health[i];
        if (special[i] !== 0) {
          // shards are always visible
          const p = 7 * 3;
          data[o] = lut.shard[p];
          data[o + 1] = lut.shard[p + 1];
          data[o + 2] = lut.shard[p + 2];
          data[o + 3] = 255;
        } else if (wall[i] !== 0) {
          if (visible[i] === 0) {
            data[o] = 0;
            data[o + 1] = 0;
            data[o + 2] = 0;
            data[o + 3] = 255;
          } else {
            let v = (((gx + gy) & 3) * 2) + 1;
            if (nearFog(gx, gy)) v >>= 1;
            const p = v * 3;
            data[o] = lut.wall[p];
            data[o + 1] = lut.wall[p + 1];
            data[o + 2] = lut.wall[p + 2];
            data[o + 3] = 255;
          }
        } else if (h !== 0) {
          if (visible[i] === 0) {
            data[o] = 0;
            data[o + 1] = 0;
            data[o + 2] = 0;
            data[o + 3] = 255;
          } else {
            let v = (i ^ (i >>> 5) ^ (i >>> 11)) & 7;
            if (nearFog(gx, gy)) v >>= 1;
            const p = ((maxHealth[i] * CFG.HEALTH_STRIDE + h) * 8 + v) * 3;
            data[o] = lut.health[p];
            data[o + 1] = lut.health[p + 1];
            data[o + 2] = lut.health[p + 2];
            data[o + 3] = 255;
          }
        } else if (open[i] !== 0) {
          // cleared ground: a touch lighter than the black fog
          data[o] = 120;
          data[o + 1] = 156;
          data[o + 2] = 200;
          data[o + 3] = nearFog(gx, gy) ? 20 : 34;
        } else {
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
          data[o + 3] = 255;
        }
        o += 4;
      }
    }
    ch.ctx.putImageData(ch.img, 0, 0);
  }

  drawGrid(cam) {
    const step = CFG.PIXEL * cam.zoom;
    if (step < 22) return;
    const ctx = this.ctx;
    const v = cam.view();
    const x0 = Math.ceil(v.x0 / CFG.PIXEL) * CFG.PIXEL;
    const y0 = Math.ceil(v.y0 / CFG.PIXEL) * CFG.PIXEL;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 170, 240, 0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < v.x1; x += CFG.PIXEL) {
      const sx = Math.round(cam.worldToScreenX(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.h);
    }
    for (let y = y0; y < v.y1; y += CFG.PIXEL) {
      const sy = Math.round(cam.worldToScreenY(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.w, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawField(cam) {
    const ctx = this.ctx;
    const world = this.world;
    const CW = CFG.CHUNK_WORLD;
    const CH = CFG.CHUNKS;
    const v = cam.view();
    const x0 = clamp(Math.floor(v.x0 / CW), 0, CH - 1);
    const y0 = clamp(Math.floor(v.y0 / CW), 0, CH - 1);
    const x1 = clamp(Math.floor(v.x1 / CW), 0, CH - 1);
    const y1 = clamp(Math.floor(v.y1 / CW), 0, CH - 1);
    const size = CW * cam.zoom + 0.75;

    ctx.imageSmoothingEnabled = false;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cy * CH + cx;
        if (world.chunkSolid[key] === 0) continue;
        let ch = this.chunks.get(key);
        if (!ch) {
          ch = this.createChunk();
          this.chunks.set(key, ch);
        }
        if (world.dirty.has(key)) {
          this.paintChunk(ch, cx, cy);
          world.dirty.delete(key);
        }
        const sx = cam.worldToScreenX(cx * CW);
        const sy = cam.worldToScreenY(cy * CW);
        ctx.drawImage(ch.canvas, sx, sy, size, size);
      }
    }
  }

  drawShardGlow(cam) {
    const ctx = this.ctx;
    const world = this.world;
    const v = cam.view();
    const zoom = cam.zoom;
    const t = this.time;
    let count = 0;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < world.shards.length; k++) {
      const s = world.shards[k];
      if (world.special[s.i] === 0) continue;
      const wx = (s.x + 0.5) * CFG.PIXEL;
      const wy = (s.y + 0.5) * CFG.PIXEL;
      if (wx < v.x0 - 200 || wx > v.x1 + 200 || wy < v.y0 - 200 || wy > v.y1 + 200) continue;
      const sx = cam.worldToScreenX(wx);
      const sy = cam.worldToScreenY(wy);
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + s.i * 0.7);
      const size = Math.max(9, CFG.PIXEL * zoom * (1.6 + pulse * 0.55));
      ctx.globalAlpha = 0.32 + pulse * 0.35;
      ctx.drawImage(this.glow, sx - size * 0.5, sy - size * 0.5, size, size);

      // a tiny spinning gem so shards read at any zoom
      const gem = Math.max(3, CFG.PIXEL * zoom * 0.3);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.PI / 4 + t * 0.9);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#fff6d4';
      ctx.fillRect(-gem * 0.5, -gem * 0.5, gem, gem);
      ctx.restore();

      if (++count > 400) break;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* --------------------------------------------------------------- balls */

  drawBalls(list, cam) {
    const ctx = this.ctx;
    const zoom = cam.zoom;
    const quality = this.quality;
    const n = list.length;
    const simple = n > 2000 || quality === 0;
    const w = this.w;
    const h = this.h;

    if (!simple && quality >= 1 && n <= 700) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const b = list[i];
        const x = cam.worldToScreenX(b.x);
        const y = cam.worldToScreenY(b.y);
        if (x < -90 || x > w + 90 || y < -90 || y > h + 90) continue;
        const x2 = cam.worldToScreenX(b.x - b.vx * 0.032);
        const y2 = cam.worldToScreenY(b.y - b.vy * 0.032);
        const r = Math.max(1.1, b.r * zoom);
        ctx.globalAlpha = 0.32;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = r * 1.15;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    for (let i = 0; i < n; i++) {
      const b = list[i];
      const x = cam.worldToScreenX(b.x);
      const y = cam.worldToScreenY(b.y);
      if (x < -90 || x > w + 90 || y < -90 || y > h + 90) continue;
      const r = Math.max(1.1, b.r * zoom);
      ctx.fillStyle = b.color;
      if (simple) {
        // thousands of balls: a cached soft orb sprite beats per-ball paths
        const sp = this.ballSprite(b.color);
        const sr = r * 1.2;
        ctx.drawImage(sp, x - sr, y - sr, sr * 2, sr * 2);
      } else if (quality >= 1 && n <= 600) {
        // squashed along the direction of travel: a bouncy little blob
        const a = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.scale(1.14, 0.86);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        if (quality >= 2 && r > 2.4) {
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.beginPath();
          ctx.arc(-r * 0.28, -r * 0.3, r * 0.33, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        if (quality >= 2 && n < 1200 && r > 2.4) {
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.beginPath();
          ctx.arc(x - r * 0.28, y - r * 0.3, r * 0.33, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  /* ------------------------------------------------------------------ fx */

  drawParticles(fx, cam) {
    const ctx = this.ctx;
    const zoom = cam.zoom;
    const ps = fx.particles;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const x = cam.worldToScreenX(p.x);
      const y = cam.worldToScreenY(p.y);
      const a = clamp(p.life / p.maxLife, 0, 1);
      const s = Math.max(1, p.size * zoom);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawWaves(fx, cam) {
    const ctx = this.ctx;
    const zoom = cam.zoom;
    for (let i = 0; i < fx.waves.length; i++) {
      const w = fx.waves[i];
      const a = clamp(w.life / w.maxLife, 0, 1);
      const x = cam.worldToScreenX(w.x);
      const y = cam.worldToScreenY(w.y);
      const r = Math.max(2, w.r * zoom);
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = Math.max(1, 3.2 * a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(fx, cam) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < fx.texts.length; i++) {
      const t = fx.texts[i];
      const a = clamp(t.life / t.maxLife, 0, 1);
      const x = cam.worldToScreenX(t.x);
      const y = cam.worldToScreenY(t.y);
      ctx.globalAlpha = a * a;
      ctx.font = `600 ${t.size}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(t.text, x + 1, y + 2);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ aim */

  drawAim(game, cam) {
    const aim = game.aim;
    if (!aim) return;
    const ctx = this.ctx;
    const o = cam.worldToScreen(aim.wx, aim.wy);
    const px = aim.cx;
    const py = aim.cy;

    // slingshot: the shot flies opposite to the pull
    const sx = o.x - px;
    const sy = o.y - py;
    const len = Math.sqrt(sx * sx + sy * sy);

    const def = BALL_BY_ID[game.selected];
    const cd = game.ballCooldown(def);
    const left = game.cooldownLeft(def);
    const ready = left <= 0.0001;
    const afford = game.currency >= game.ballCost(def);
    const color = afford ? def.color : '#f87171';
    const alpha = ready ? 1 : 0.38;

    ctx.save();

    // pull band behind the ball
    ctx.globalAlpha = 0.3 * alpha;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);

    // crosshair at the pull point
    ctx.globalAlpha = 0.6 * alpha;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, TAU);
    ctx.moveTo(px - 13, py);
    ctx.lineTo(px - 5, py);
    ctx.moveTo(px + 5, py);
    ctx.lineTo(px + 13, py);
    ctx.moveTo(px, py - 13);
    ctx.lineTo(px, py - 5);
    ctx.moveTo(px, py + 5);
    ctx.lineTo(px, py + 13);
    ctx.stroke();

    if (len < 6) {
      // not pulled far enough yet: just the anchor
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 7, 0, TAU);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const ux = sx / len;
    const uy = sy / len;

    let reach = len;
    if (aim.hit && aim.hit.hit) {
      const hx = cam.worldToScreenX(aim.hit.x);
      const hy = cam.worldToScreenY(aim.hit.y);
      reach = Math.max(26, Math.sqrt((hx - o.x) ** 2 + (hy - o.y) ** 2));
    }

    // trajectory
    ctx.globalAlpha = 0.8 * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 8]);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.lineTo(o.x + ux * reach, o.y + uy * reach);
    ctx.stroke();
    ctx.setLineDash([]);

    // anchor ring, with a reload sweep
    const ringR = 13;
    ctx.globalAlpha = 0.95 * alpha;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(o.x, o.y, ringR, 0, TAU);
    ctx.stroke();
    if (!ready) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(o.x, o.y, ringR + 4, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - left / cd));
      ctx.stroke();
    }

    // arrow at the far end of the flight path
    const ax = o.x + ux * reach;
    const ay = o.y + uy * reach;
    ctx.globalAlpha = 0.95 * alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ax + ux * 10, ay + uy * 10);
    ctx.lineTo(ax - uy * 6.5, ay + ux * 6.5);
    ctx.lineTo(ax + uy * 6.5, ay - ux * 6.5);
    ctx.closePath();
    ctx.fill();

    // impact marker
    if (aim.hit && aim.hit.hit) {
      const hx = cam.worldToScreenX(aim.hit.x);
      const hy = cam.worldToScreenY(aim.hit.y);
      ctx.globalAlpha = 0.9 * alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(hx, hy, 9, 0, TAU);
      ctx.stroke();
      if (aim.hit.shard) {
        ctx.fillStyle = SHARD_CSS;
        ctx.beginPath();
        ctx.arc(hx, hy, 2.4, 0, TAU);
        ctx.fill();
      }
    } else if (aim.hit && aim.hit.unknown) {
      // the line simply stops at the edge of what is known
      ctx.globalAlpha = 0.22 * alpha;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(o.x + ux * reach, o.y + uy * reach, 3, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------- minimap */

  buildMiniTexel(tx, ty) {
    const w = this.world;
    const n = w.n;
    const T = CFG.MINI_TEXEL;
    const color2d = this.color2d;
    let r = 0;
    let g = 0;
    let b = 0;

    for (let y = 0; y < T; y++) {
      const row = (ty * T + y) * n + tx * T;
      for (let x = 0; x < T; x++) {
        const i = row + x;
        if (w.special[i] !== 0) {
          r += SHARD_RGB[0]; g += SHARD_RGB[1]; b += SHARD_RGB[2];
        } else if (w.visible[i] !== 0 && w.wall[i] !== 0) {
          r += WALL_RGB[0]; g += WALL_RGB[1]; b += WALL_RGB[2];
        } else if (w.visible[i] !== 0 && w.health[i] !== 0) {
          const o = (w.maxHealth[i] * CFG.HEALTH_STRIDE + w.health[i]) * 3;
          r += color2d[o]; g += color2d[o + 1]; b += color2d[o + 2];
        } else if (w.open[i] !== 0) {
          r += 17; g += 23; b += 33;
        } else {
          r += 7; g += 9; b += 16;
        }
      }
    }

    const k = 1 / (T * T);
    r = (r * k) | 0;
    g = (g * k) | 0;
    b = (b * k) | 0;
    const idx = ty * CFG.MINI + tx;
    this.mini32[idx] = this.littleEndian
      ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
  }

  updateMinimap() {
    const w = this.world;
    if (!this.miniImg) return;
    const S = CFG.MINI;
    if (w.miniAll || !this.miniReady) {
      for (let ty = 0; ty < S; ty++) {
        for (let tx = 0; tx < S; tx++) this.buildMiniTexel(tx, ty);
      }
      w.miniAll = false;
      w.miniDirty.clear();
    } else if (w.miniDirty.size > 0) {
      for (const idx of w.miniDirty) {
        this.buildMiniTexel(idx % S, (idx / S) | 0);
      }
      w.miniDirty.clear();
    } else {
      return;
    }
    this.miniCtx.putImageData(this.miniImg, 0, 0);
    this.miniReady = true;
  }

  drawMinimap() {
    if (!this.miniCtx || !this.miniReady) return;
    const ctx = this.miniCtx;
    const S = CFG.MINI;
    const w = this.world;
    const scale = S / CFG.WORLD;

    ctx.putImageData(this.miniImg, 0, 0);

    // live shards
    ctx.fillStyle = SHARD_CSS;
    for (let k = 0; k < w.shards.length; k++) {
      const s = w.shards[k];
      if (w.special[s.i] === 0) continue;
      const x = ((s.x + 0.5) * CFG.PIXEL) * scale;
      const y = ((s.y + 0.5) * CFG.PIXEL) * scale;
      ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }

    // viewport
    const v = this.cam.view();
    const vx = v.x0 * scale;
    const vy = v.y0 * scale;
    const vw = (v.x1 - v.x0) * scale;
    const vh = (v.y1 - v.y0) * scale;
    ctx.strokeStyle = 'rgba(205, 232, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx + 0.5, vy + 0.5, Math.max(2, vw), Math.max(2, vh));
  }

  /* ---------------------------------------------------------------- frame */

  draw(game, dt) {
    const ctx = this.ctx;
    const cam = this.cam;
    this.time += dt;

    if (this.shake > 0.15) {
      cam.shakeX = (Math.random() * 2 - 1) * this.shake;
      cam.shakeY = (Math.random() * 2 - 1) * this.shake;
      this.shake *= Math.pow(0.0025, dt);
    } else {
      this.shake = 0;
      cam.shakeX = 0;
      cam.shakeY = 0;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.bgGrad || '#060810';
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawGrid(cam);
    this.drawField(cam);
    this.drawWorldEdge(cam);
    this.drawShardGlow(cam);
    this.drawParticles(game.fx, cam);
    this.drawBalls(game.balls.list, cam);
    this.drawWaves(game.fx, cam);
    this.drawAim(game, cam);
    this.drawTexts(game.fx, cam);

    if (this.vignette) {
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  drawWorldEdge(cam) {
    const ctx = this.ctx;
    const x = cam.worldToScreenX(0);
    const y = cam.worldToScreenY(0);
    const size = CFG.WORLD * cam.zoom;
    if (x > this.w || y > this.h || x + size < 0 || y + size < 0) return;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, size, size);
  }
}
