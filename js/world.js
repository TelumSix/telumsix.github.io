'use strict';

/**
 * The field: 1000 x 1000 cells, 1,000,000 of them.
 *
 * Stored as flat typed arrays so a million pixels stay cheap:
 *   health    0 = empty, 1..10 = breakable pixel health
 *   maxHealth initial health (drives colour + payout)
 *   wall      1 = unbreakable steel structure
 *   special   1 = shard (always visible, grants skill points)
 *   visible   1 = revealed by the fog-of-war (3 cells deep)
 *   open      1 = revealed empty cell (cleared ground, drawn lighter than fog)
 */
class World {
  constructor(seed) {
    this.n = CFG.GRID;
    this.w = this.n * this.n;
    this.health = new Uint8Array(this.w);
    this.maxHealth = new Uint8Array(this.w);
    this.wall = new Uint8Array(this.w);
    this.special = new Uint8Array(this.w);
    this.visible = new Uint8Array(this.w);
    this.open = new Uint8Array(this.w);

    this.chunkSolid = new Uint32Array(CFG.CHUNKS * CFG.CHUNKS);
    this.dirty = new Set();
    this.miniDirty = new Set();
    this.miniAll = true;

    this.remaining = 0;
    this.total = 0;
    this.shards = [];
    this.shardValues = new Map();

    this.seed = (seed >>> 0) || 1;
    this.onDestroy = null;
    this.onShard = null;

    this.generate();
  }

  /* ------------------------------------------------------------ geometry */

  cellAt(worldX, worldY) {
    return [(worldX / CFG.PIXEL) | 0, (worldY / CFG.PIXEL) | 0];
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.n && y < this.n;
  }

  solidAt(x, y) {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.n + x;
    return this.wall[i] !== 0 || this.health[i] !== 0;
  }

  /* ---------------------------------------------------------- generation */

  generate() {
    const n = this.n;
    const rnd = mulberry32(this.seed);
    this.rng = rnd;

    this.buildHealthField(rnd);
    this.carveOpenSpace(rnd);
    this.buildWalls(rnd);
    this.fixConnectivity();
    this.placeShards(rnd);
    this.finalizeField();

    this.recomputeVisibility();
    this.miniAll = true;
  }

  makeNoise(size, rnd) {
    const a = new Float32Array(size * size);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return a;
  }

  static bilinear(arr, size, fx, fy) {
    let x0 = fx | 0;
    let y0 = fy | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x0 > size - 2) x0 = size - 2;
    if (y0 > size - 2) y0 = size - 2;
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    let tx = fx - x0;
    let ty = fy - y0;
    if (tx < 0) tx = 0; else if (tx > 1) tx = 1;
    if (ty < 0) ty = 0; else if (ty > 1) ty = 1;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const a = arr[y0 * size + x0];
    const b = arr[y0 * size + x1];
    const c = arr[y1 * size + x0];
    const d = arr[y1 * size + x1];
    const top = a + (b - a) * tx;
    const bot = c + (d - c) * tx;
    return top + (bot - top) * ty;
  }

  buildHealthField(rnd) {
    const n = this.n;
    const STEP = 4;
    const CN = (n / STEP) + 1;
    const noiseA = this.makeNoise(64, rnd);
    const noiseB = this.makeNoise(17, rnd);
    const coarse = new Float32Array(CN * CN);
    const half = n * 0.5;

    for (let gy = 0; gy < CN; gy++) {
      const y = gy * STEP;
      const ny = (y / n) * 63;
      for (let gx = 0; gx < CN; gx++) {
        const x = gx * STEP;
        const dx = x - half;
        const dy = y - half;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = Math.min(1, dist / 620);
        const na = World.bilinear(noiseA, 64, (x / n) * 63, ny);
        const nb = World.bilinear(noiseB, 17, (x / n) * 16, (y / n) * 16);
        const nv = na * 0.62 + nb * 0.38;
        coarse[gy * CN + gx] = 1 + Math.pow(t, 1.22) * 8.6 + (nv - 0.5) * 2.9;
      }
    }

    const h = this.health;
    for (let y = 0; y < n; y++) {
      const gy = (y / STEP) | 0;
      const fy = (y - gy * STEP) / STEP;
      const r0 = gy * CN;
      const r1 = Math.min(gy + 1, CN - 1) * CN;
      const row = y * n;
      for (let x = 0; x < n; x++) {
        const gx = (x / STEP) | 0;
        const fx = (x - gx * STEP) / STEP;
        const gx1 = gx + 1 < CN ? gx + 1 : gx;
        const a = coarse[r0 + gx];
        const b = coarse[r0 + gx1];
        const c = coarse[r1 + gx];
        const d = coarse[r1 + gx1];
        const top = a + (b - a) * fx;
        const bot = c + (d - c) * fx;
        let v = Math.round(top + (bot - top) * fy);
        if (v < 1) v = 1; else if (v > CFG.MAX_HEALTH) v = CFG.MAX_HEALTH;
        h[row + x] = v;
      }
    }

    // mineral clusters
    for (let k = 0; k < 58; k++) {
      const a = rnd() * TAU;
      const d = 25 + rnd() * 430;
      const ox = half + Math.cos(a) * d;
      const oy = half + Math.sin(a) * d;
      const rad = 5 + rnd() * 13;
      const str = 2 + rnd() * 4;
      const x0 = Math.max(0, Math.floor(ox - rad));
      const x1 = Math.min(n - 1, Math.ceil(ox + rad));
      const y0 = Math.max(0, Math.floor(oy - rad));
      const y1 = Math.min(n - 1, Math.ceil(oy + rad));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - oy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - ox;
          const dd = Math.sqrt(dx * dx + dy * dy);
          if (dd > rad) continue;
          const add = Math.round(str * (1 - dd / rad));
          const i = y * n + x;
          const v = h[i] + add;
          h[i] = v > CFG.MAX_HEALTH ? CFG.MAX_HEALTH : v;
        }
      }
    }
  }

  carveDisc(cx, cy, r) {
    const n = this.n;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(n - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(n - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * n + x;
        this.health[i] = 0;
        this.wall[i] = 0;
      }
    }
  }

  carveOpenSpace(rnd) {
    const n = this.n;
    const half = n * 0.5;

    // The only empty space in the whole field: a small starting arena.
    // Every other cell is a pixel — breakable, steel, or a shard.
    this.carveDisc(half, half, CFG.FREE_R + 1.5);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + rnd() * 0.25;
      const radius = CFG.FREE_R + 1.2 + rnd() * 1.6;
      this.carveDisc(
        half + Math.cos(a) * radius,
        half + Math.sin(a) * radius,
        0.8 + rnd() * 1.1
      );
    }
  }

  /* --------------------------------------------------------------- walls */

  stampWallDisc(cx, cy, r) {
    const n = this.n;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(n - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(n - 1, Math.ceil(cy + r));
    const r2 = r * r;
    const keepOut = (CFG.FREE_R + 6) * (CFG.FREE_R + 6);
    const half = n * 0.5;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const gy = y - half;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const gx = x - half;
        if (gx * gx + gy * gy < keepOut) continue;
        const i = y * n + x;
        // Keep the underlying pixel health so a connectivity corridor can
        // restore it to a breakable pixel instead of leaving a hole.
        this.wall[i] = 1;
      }
    }
  }

  stampWallLine(x0, y0, x1, y1, r) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.0001) {
      this.stampWallDisc(x0, y0, r);
      return;
    }
    const steps = Math.max(1, Math.ceil(len / 0.55));
    const ix = dx / steps;
    const iy = dy / steps;
    let x = x0;
    let y = y0;
    for (let s = 0; s <= steps; s++) {
      this.stampWallDisc(x, y, r);
      x += ix;
      y += iy;
    }
  }

  stampWallArc(cx, cy, rad, a0, a1, r) {
    const arcLen = Math.abs(a1 - a0) * rad;
    const steps = Math.max(2, Math.ceil(arcLen / 0.6));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + (a1 - a0) * (s / steps);
      this.stampWallDisc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, r);
    }
  }

  /** A dashed run of steel: segments with gaps so nothing is ever sealed. */
  stampBrokenLine(ax, ay, bx, by, r, rnd) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return;
    let t = 0;
    while (t < len) {
      const seg = 5 + rnd() * 11;
      const t1 = Math.min(len, t + seg);
      this.stampWallLine(
        ax + (dx * t) / len, ay + (dy * t) / len,
        ax + (dx * t1) / len, ay + (dy * t1) / len, r
      );
      t = t1 + 2.5 + rnd() * 5;
    }
  }

  /** A small steel shape — the local texture of the lattice. */
  stampMotif(ox, oy, rnd) {
    const kind = rnd();
    const thick = 0.55 + rnd() * 0.2;
    if (kind < 0.24) {
      // open arc
      const rad = 2 + rnd() * 4;
      const a0 = rnd() * TAU;
      const span = (0.5 + rnd() * 0.85) * Math.PI;
      this.stampWallArc(ox, oy, rad, a0, a0 + span, thick);
    } else if (kind < 0.4) {
      // single segment
      const a = rnd() * TAU;
      const len = 3 + rnd() * 6;
      this.stampWallLine(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len, thick);
    } else if (kind < 0.52) {
      // elbow / hook
      const a = rnd() * TAU;
      const a2 = a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.9);
      const l1 = 2 + rnd() * 4;
      const l2 = 2 + rnd() * 4;
      const bx = ox + Math.cos(a) * l1;
      const by = oy + Math.sin(a) * l1;
      this.stampWallLine(ox, oy, bx, by, thick);
      this.stampWallLine(bx, by, bx + Math.cos(a2) * l2, by + Math.sin(a2) * l2, thick);
    } else if (kind < 0.62) {
      // small ring with a gap
      const rad = 1.4 + rnd() * 2.2;
      const a0 = rnd() * TAU;
      this.stampWallArc(ox, oy, rad, a0, a0 + TAU * (0.6 + rnd() * 0.3), 0.6);
    } else if (kind < 0.71) {
      // cross / plus
      const a = rnd() * TAU;
      const l = 2 + rnd() * 3.5;
      this.stampWallLine(
        ox - Math.cos(a) * l, oy - Math.sin(a) * l,
        ox + Math.cos(a) * l, oy + Math.sin(a) * l, 0.55
      );
      const b = a + Math.PI / 2;
      const l2 = l * (0.6 + rnd() * 0.5);
      this.stampWallLine(
        ox - Math.cos(b) * l2, oy - Math.sin(b) * l2,
        ox + Math.cos(b) * l2, oy + Math.sin(b) * l2, 0.55
      );
    } else if (kind < 0.79) {
      // zigzag
      let a = rnd() * TAU;
      let x = ox;
      let y = oy;
      const segs = 2 + (rnd() * 2 | 0);
      for (let s = 0; s < segs; s++) {
        const l = 2 + rnd() * 3;
        const nx = x + Math.cos(a) * l;
        const ny = y + Math.sin(a) * l;
        this.stampWallLine(x, y, nx, ny, thick);
        x = nx;
        y = ny;
        a += (rnd() < 0.5 ? 1 : -1) * (0.8 + rnd() * 0.6);
      }
    } else if (kind < 0.87) {
      // dashed pair — two short collinear runs with a gap
      const a = rnd() * TAU;
      const l = 1.5 + rnd() * 2;
      const gap = 1.2 + rnd() * 1.4;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      this.stampWallLine(ox, oy, ox + ux * l, oy + uy * l, thick);
      const sx = ox + ux * (l + gap);
      const sy = oy + uy * (l + gap);
      this.stampWallLine(sx, sy, sx + ux * l, sy + uy * l, thick);
    } else {
      // mini wheel: gapped ring with two spokes
      const rad = 2 + rnd() * 2.4;
      const a0 = rnd() * TAU;
      const gapA = 0.7 + rnd() * 0.5;
      this.stampWallArc(ox, oy, rad, a0 + gapA, a0 + TAU, 0.5);
      for (let s = 0; s < 2; s++) {
        const a = rnd() * TAU;
        this.stampWallLine(ox, oy, ox + Math.cos(a) * rad, oy + Math.sin(a) * rad, 0.5);
      }
    }
  }

  buildWalls(rnd) {
    const n = this.n;
    const half = n * 0.5;

    // Large-scale character: layered shells with wide gaps.
    for (let rad = 74; rad < 690; rad += 42 + rnd() * 24) {
      const a0 = rnd() * TAU;
      const span = (0.3 + rnd() * 0.4) * TAU;
      this.stampWallArc(half, half, rad, a0, a0 + span, 0.72 + rnd() * 0.5);
    }

    // Radial spokes.
    for (let k = 0; k < 16; k++) {
      const a = rnd() * TAU;
      const r0 = 60 + rnd() * 120;
      const len = 110 + rnd() * 300;
      this.stampWallLine(
        half + Math.cos(a) * r0, half + Math.sin(a) * r0,
        half + Math.cos(a) * (r0 + len), half + Math.sin(a) * (r0 + len),
        0.68 + rnd() * 0.42
      );
    }

    // Wandering veins that weave between the shells.
    for (let k = 0; k < 26; k++) {
      let ang = rnd() * TAU;
      const d = 55 + Math.sqrt(rnd()) * 600;
      let x = half + Math.cos(ang) * d;
      let y = half + Math.sin(ang) * d;
      const len = 70 + rnd() * 240;
      const turn = (rnd() - 0.5) * 0.35;
      for (let s = 0; s < len; s += 0.8) {
        ang += (rnd() - 0.5) * 0.28 + turn * 0.02;
        x += Math.cos(ang) * 0.8;
        y += Math.sin(ang) * 0.8;
        this.stampWallDisc(x, y, 0.72 + rnd() * 0.35);
      }
    }

    // Open polygons: one side is always missing.
    for (let k = 0; k < 16; k++) {
      const sides = 3 + (rnd() * 4 | 0);
      const rad = 18 + rnd() * 62;
      const a0 = rnd() * TAU;
      const ox = half + (rnd() - 0.5) * 940;
      const oy = half + (rnd() - 0.5) * 940;
      const verts = [];
      for (let s = 0; s < sides; s++) {
        const a = a0 + (s / sides) * TAU;
        verts.push([ox + Math.cos(a) * rad, oy + Math.sin(a) * rad]);
      }
      for (let s = 1; s < sides; s++) {
        const p = verts[s];
        const q = verts[(s + 1) % sides];
        this.stampWallLine(p[0], p[1], q[0], q[1], 0.75 + rnd() * 0.4);
      }
    }

    // Combs / teeth — decorative walls with many ways around them.
    for (let k = 0; k < 18; k++) {
      const a = rnd() * TAU;
      const d = 90 + rnd() * 470;
      const ox = half + Math.cos(a) * d;
      const oy = half + Math.sin(a) * d;
      const len = 18 + rnd() * 55;
      const teeth = 3 + (rnd() * 4 | 0);
      this.stampWallLine(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len, 0.7);
      const px = -Math.sin(a);
      const py = Math.cos(a);
      for (let t = 0; t < teeth; t++) {
        const f = (t + 0.5) / teeth;
        const bx = ox + Math.cos(a) * len * f;
        const by = oy + Math.sin(a) * len * f;
        const tl = 5 + rnd() * 12;
        this.stampWallLine(bx, by, bx + px * tl, by + py * tl, 0.65);
      }
    }

    // Ladders: two parallel rails with rungs, open at both ends.
    for (let k = 0; k < 14; k++) {
      const a = rnd() * TAU;
      const d = 70 + rnd() * 420;
      const ox = half + Math.cos(a) * d;
      const oy = half + Math.sin(a) * d;
      const len = 16 + rnd() * 46;
      const gap = 5 + rnd() * 8;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const px = -uy;
      const py = ux;
      const ax = ox + px * gap * 0.5;
      const ay = oy + py * gap * 0.5;
      const bx = ox - px * gap * 0.5;
      const by = oy - py * gap * 0.5;
      this.stampWallLine(ax, ay, ax + ux * len, ay + uy * len, 0.6);
      this.stampWallLine(bx, by, bx + ux * len, by + uy * len, 0.6);
      const rungs = 2 + (rnd() * 3 | 0);
      for (let r = 1; r <= rungs; r++) {
        const f = r / (rungs + 1);
        this.stampWallLine(
          ax + ux * len * f, ay + uy * len * f,
          bx + ux * len * f, by + uy * len * f, 0.55
        );
      }
    }

    // Spoked wheels: a gapped rim with a few spokes.
    for (let k = 0; k < 12; k++) {
      const a = rnd() * TAU;
      const d = 70 + rnd() * 430;
      const ox = half + Math.cos(a) * d;
      const oy = half + Math.sin(a) * d;
      const rad = 10 + rnd() * 22;
      const gapA = 0.8 + rnd() * 0.6;
      const a0 = rnd() * TAU;
      this.stampWallArc(ox, oy, rad, a0 + gapA, a0 + TAU, 0.62);
      const spokes = 3 + (rnd() * 4 | 0);
      for (let s = 0; s < spokes; s++) {
        const sa = a0 + gapA + (s + 0.5) * ((TAU - gapA) / spokes);
        this.stampWallLine(ox, oy, ox + Math.cos(sa) * rad, oy + Math.sin(sa) * rad, 0.5);
      }
    }

    // Nested arcs: two or three concentric open shells.
    for (let k = 0; k < 16; k++) {
      const a = rnd() * TAU;
      const d = 60 + rnd() * 430;
      const ox = half + Math.cos(a) * d;
      const oy = half + Math.sin(a) * d;
      const base = 12 + rnd() * 22;
      const a0 = rnd() * TAU;
      const span = (0.4 + rnd() * 0.35) * TAU;
      const rings = 2 + (rnd() * 2 | 0);
      for (let r = 0; r < rings; r++) {
        this.stampWallArc(ox, oy, base + r * (4 + rnd() * 3), a0, a0 + span, 0.55 + rnd() * 0.25);
      }
    }

    // Zigzag chains: long sawtooth runs.
    for (let k = 0; k < 14; k++) {
      const a = rnd() * TAU;
      const d = 60 + rnd() * 440;
      let x = half + Math.cos(a) * d;
      let y = half + Math.sin(a) * d;
      let dir = rnd() * TAU;
      const segs = 4 + (rnd() * 5 | 0);
      const segLen = 4 + rnd() * 7;
      for (let s = 0; s < segs; s++) {
        const nx = x + Math.cos(dir) * segLen;
        const ny = y + Math.sin(dir) * segLen;
        this.stampWallLine(x, y, nx, ny, 0.58 + rnd() * 0.15);
        x = nx;
        y = ny;
        dir += (s % 2 === 0 ? 1 : -1) * (0.7 + rnd() * 0.5);
      }
    }

    // Gates: two short parallel walls with a doorway between them.
    for (let k = 0; k < 10; k++) {
      const a = rnd() * TAU;
      const d = 70 + rnd() * 420;
      const ox = half + Math.cos(a) * d;
      const oy = half + Math.sin(a) * d;
      const len = 10 + rnd() * 20;
      const gap = 8 + rnd() * 12;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const px = -uy;
      const py = ux;
      this.stampWallLine(ox, oy, ox + ux * len, oy + uy * len, 0.62);
      this.stampWallLine(
        ox + px * gap, oy + py * gap,
        ox + px * gap + ux * len, oy + py * gap + uy * len, 0.62
      );
    }

    // Steel skeleton: a jittered grid of knots joined by dashed arteries.
    // The dashes keep every region reachable while the steel reads as one
    // connected structure across the whole field.
    const GAP = 44;
    const cols = Math.floor(n / GAP);
    const rowsCount = Math.floor(n / GAP);
    const knots = [];
    for (let gy = 0; gy < rowsCount; gy++) {
      const line = [];
      for (let gx = 0; gx < cols; gx++) {
        line.push({
          x: GAP * (gx + 0.5) + (rnd() - 0.5) * GAP * 0.62,
          y: GAP * (gy + 0.5) + (rnd() - 0.5) * GAP * 0.62,
        });
      }
      knots.push(line);
    }
    for (let gy = 0; gy < rowsCount; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const a = knots[gy][gx];
        const right = gx + 1 < cols ? knots[gy][gx + 1] : null;
        const down = gy + 1 < rowsCount ? knots[gy + 1][gx] : null;
        if (right && rnd() < 0.74) {
          this.stampBrokenLine(a.x, a.y, right.x, right.y, 0.85 + rnd() * 0.45, rnd);
        }
        if (down && rnd() < 0.74) {
          this.stampBrokenLine(a.x, a.y, down.x, down.y, 0.85 + rnd() * 0.45, rnd);
        }
        if (down && right && rnd() < 0.14) {
          this.stampBrokenLine(a.x, a.y, right.x, down.y, 0.7, rnd);
        }
      }
    }
    // Chunkier knots where the arteries meet.
    for (let gy = 0; gy < rowsCount; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const a = knots[gy][gx];
        const k = rnd();
        if (k < 0.22) {
          this.stampWallDisc(a.x, a.y, 1.6 + rnd() * 1.8);
        } else if (k < 0.42) {
          const rad = 3 + rnd() * 5;
          const a0 = rnd() * TAU;
          this.stampWallArc(a.x, a.y, rad, a0, a0 + (0.6 + rnd() * 0.9) * Math.PI, 0.85);
        } else if (k < 0.56) {
          const spokes = 3 + (rnd() * 3 | 0);
          const rad = 4 + rnd() * 5;
          for (let s = 0; s < spokes; s++) {
            const ang = rnd() * TAU;
            this.stampWallLine(a.x, a.y, a.x + Math.cos(ang) * rad, a.y + Math.sin(ang) * rad, 0.8);
          }
        }
      }
    }

    // Local lattice: a jittered grid of small motifs over the whole field so
    // no area is left as a wide steel-free gap.
    const STEP = 19;
    for (let gy = 0; gy * STEP < n; gy++) {
      for (let gx = 0; gx * STEP < n; gx++) {
        const jx = (rnd() - 0.5) * STEP * 0.75;
        const jy = (rnd() - 0.5) * STEP * 0.75;
        const ox = gx * STEP + STEP * 0.5 + jx;
        const oy = gy * STEP + STEP * 0.5 + jy;
        if (ox < 2 || oy < 2 || ox > n - 2 || oy > n - 2) continue;
        if (rnd() < 0.4) continue;
        this.stampMotif(ox, oy, rnd);
      }
    }
  }

  /* -------------------------------------------------------- connectivity */

  markComponent(start, visited, queue) {
    const n = this.n;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % n;
      const y = (i / n) | 0;
      if (x > 0) {
        const j = i - 1;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (x < n - 1) {
        const j = i + 1;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (y > 0) {
        const j = i - n;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (y < n - 1) {
        const j = i + n;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
    }
  }

  /**
   * Carves the shortest exit from an unreachable pocket to the main field.
   * Only the few steel cells in the way are removed, so the lattice keeps its
   * shape instead of being sliced by long corridors.
   */
  carveExit(start, visited) {
    const n = this.n;
    const w = this.w;
    if (!this._bfsSeen) {
      this._bfsSeen = new Int32Array(w);
      this._bfsPrev = new Int32Array(w);
      this._bfsQueue = new Int32Array(w);
      this._bfsGen = 0;
    }
    const seen = this._bfsSeen;
    const prev = this._bfsPrev;
    const q = this._bfsQueue;
    const gen = (this._bfsGen += 1);
    let head = 0;
    let tail = 0;
    q[tail++] = start;
    seen[start] = gen;
    prev[start] = -1;

    let found = -1;
    while (head < tail) {
      const i = q[head++];
      if (i !== start && this.wall[i] === 0 && visited[i]) { found = i; break; }
      const x = i % n;
      const y = (i / n) | 0;
      const push = (j) => {
        if (seen[j] === gen) return;
        seen[j] = gen;
        prev[j] = i;
        q[tail++] = j;
      };
      if (x > 0) push(i - 1);
      if (x < n - 1) push(i + 1);
      if (y > 0) push(i - n);
      if (y < n - 1) push(i + n);
    }
    if (found < 0) return false;

    let i = found;
    while (i >= 0) {
      if (this.wall[i] !== 0) this.wall[i] = 0;
      visited[i] = 1;
      i = prev[i];
    }
    return true;
  }

  /**
   * Walls are generated as open shapes, but guarantee it: flood fill the
   * breakable field and open a gap into anything unreachable.
   */
  fixConnectivity() {
    const n = this.n;
    const w = this.w;
    const visited = new Uint8Array(w);
    const queue = new Int32Array(w);
    const start = (n >> 1) * n + (n >> 1);

    visited[start] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % n;
      const y = (i / n) | 0;
      if (x > 0) {
        const j = i - 1;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (x < n - 1) {
        const j = i + 1;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (y > 0) {
        const j = i - n;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
      if (y < n - 1) {
        const j = i + n;
        if (!visited[j] && !this.wall[j]) { visited[j] = 1; queue[tail++] = j; }
      }
    }

    let scan = 0;
    let guard = 0;
    while (guard++ < 100000) {
      while (scan < w && (visited[scan] || this.wall[scan])) scan++;
      if (scan >= w) break;
      const orphan = scan;
      if (!this.carveExit(orphan, visited)) break;
      this.markComponent(orphan, visited, queue);
    }
  }

  /* -------------------------------------------------------------- shards */

  placeShards(rnd) {
    const n = this.n;
    const half = n * 0.5;
    let placed = 0;

    const tryPlace = (d) => {
      const a = rnd() * TAU;
      const x = Math.round(half + Math.cos(a) * d);
      const y = Math.round(half + Math.sin(a) * d);
      if (!this.inBounds(x, y)) return false;
      const i = y * n + x;
      if (this.wall[i] || this.health[i] === 0 || this.special[i]) return false;
      this.special[i] = 1;
      this.health[i] = 1;
      const value = 1 + (d > 300 ? 1 : 0) + (d > 430 ? 1 : 0);
      this.shards.push({ i, x, y, value });
      this.shardValues.set(i, value);
      return true;
    };

    // A handful within reach of the starting arena so the tree can begin.
    for (let k = 0; k < 14 && placed < 14; k++) {
      for (let tries = 0; tries < 80; tries++) {
        if (tryPlace(9 + rnd() * 20)) { placed++; break; }
      }
    }

    const target = CFG.SHARD_COUNT;
    for (let k = placed; k < target; k++) {
      for (let tries = 0; tries < 24; tries++) {
        const d = 28 + Math.sqrt(rnd()) * 465;
        if (tryPlace(d)) break;
      }
    }
  }

  finalizeField() {
    const n = this.n;
    let rem = 0;
    for (let i = 0; i < this.w; i++) {
      const v = this.health[i];
      this.maxHealth[i] = v;
      if (v !== 0 && this.wall[i] === 0) rem++;
    }
    this.remaining = rem;
    this.total = rem;
    this.recountChunks();
  }

  /* ---------------------------------------------------------- visibility */

  revealArea(cx, cy) {
    const n = this.n;
    const R = CFG.REVEAL;
    let seen = 0;
    for (let dy = -R; dy <= R; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= n) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= n) continue;
        const i = y * n + x;
        if (this.wall[i] === 0 && this.health[i] === 0) {
          if (this.open[i] === 0) this.floodOpen(i);
          continue;
        }
        if (this.visible[i]) continue;
        this.visible[i] = 1;
        this.markDirtyXY(x, y);
        seen++;
      }
    }
    return seen;
  }

  /**
   * A solid cell is visible when an empty cell sits within Chebyshev
   * distance 3. Computed as a separable box dilation (fast on 1M cells).
   */
  recomputeVisibility() {
    const n = this.n;
    const w = this.w;
    if (!this._visTmp) this._visTmp = new Uint8Array(w);
    const tmp = this._visTmp;
    const h = this.health;
    const wall = this.wall;
    const R = CFG.REVEAL;

    for (let y = 0; y < n; y++) {
      const row = y * n;
      let cnt = 0;
      for (let x = 0; x <= R && x < n; x++) {
        const i = row + x;
        if (h[i] === 0 && wall[i] === 0) cnt++;
      }
      for (let x = 0; x < n; x++) {
        tmp[row + x] = cnt > 0 ? 1 : 0;
        const rem = x - R;
        if (rem >= 0) {
          const i = row + rem;
          if (h[i] === 0 && wall[i] === 0) cnt--;
        }
        const add = x + R + 1;
        if (add < n) {
          const i = row + add;
          if (h[i] === 0 && wall[i] === 0) cnt++;
        }
      }
    }

    const vis = this.visible;
    vis.fill(0);
    for (let x = 0; x < n; x++) {
      let cnt = 0;
      for (let y = 0; y <= R && y < n; y++) {
        if (tmp[y * n + x]) cnt++;
      }
      for (let y = 0; y < n; y++) {
        const i = y * n + x;
        if (cnt > 0 && (h[i] !== 0 || wall[i] !== 0)) vis[i] = 1;
        const rem = y - R;
        if (rem >= 0) {
          if (tmp[rem * n + x]) cnt--;
        }
        const add = y + R + 1;
        if (add < n) {
          if (tmp[add * n + x]) cnt++;
        }
      }
    }

    // Cleared ground: an empty cell within reach of a revealed solid is lit,
    // everything else stays fog-black.
    const open = this.open;
    open.fill(0);
    for (let y = 0; y < n; y++) {
      const row = y * n;
      let cnt = 0;
      for (let x = 0; x <= R && x < n; x++) if (vis[row + x]) cnt++;
      for (let x = 0; x < n; x++) {
        tmp[row + x] = cnt > 0 ? 1 : 0;
        const rem = x - R;
        if (rem >= 0 && vis[row + rem]) cnt--;
        const add = x + R + 1;
        if (add < n && vis[row + add]) cnt++;
      }
    }
    for (let x = 0; x < n; x++) {
      let cnt = 0;
      for (let y = 0; y <= R && y < n; y++) if (tmp[y * n + x]) cnt++;
      for (let y = 0; y < n; y++) {
        const i = y * n + x;
        if (cnt > 0 && h[i] === 0 && wall[i] === 0) open[i] = 1;
        const rem = y - R;
        if (rem >= 0 && tmp[rem * n + x]) cnt--;
        const add = y + R + 1;
        if (add < n && tmp[add * n + x]) cnt++;
      }
    }

    // Cleared ground is contiguous: grow the lit area through open cells.
    this.spreadOpen();
  }

  /** Expands the lit (open) mask through every connected empty cell. */
  spreadOpen() {
    const n = this.n;
    const w = this.w;
    const h = this.health;
    const wall = this.wall;
    const open = this.open;
    const q = this._openQueue || (this._openQueue = new Int32Array(w));
    let head = 0;
    let tail = 0;
    for (let i = 0; i < w; i++) if (open[i] !== 0) q[tail++] = i;
    while (head < tail) {
      const i = q[head++];
      const x = i % n;
      const y = (i / n) | 0;
      if (x > 0) {
        const j = i - 1;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) { open[j] = 1; q[tail++] = j; }
      }
      if (x < n - 1) {
        const j = i + 1;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) { open[j] = 1; q[tail++] = j; }
      }
      if (y > 0) {
        const j = i - n;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) { open[j] = 1; q[tail++] = j; }
      }
      if (y < n - 1) {
        const j = i + n;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) { open[j] = 1; q[tail++] = j; }
      }
    }
  }

  /** Lights a newly cleared cell and everything contiguous with it. */
  floodOpen(start) {
    const n = this.n;
    const w = this.w;
    const h = this.health;
    const wall = this.wall;
    const open = this.open;
    const q = this._openQueue || (this._openQueue = new Int32Array(w));
    let head = 0;
    let tail = 0;
    open[start] = 1;
    q[tail++] = start;
    this.markDirtyXY(start % n, (start / n) | 0);
    while (head < tail) {
      const i = q[head++];
      const x = i % n;
      const y = (i / n) | 0;
      if (x > 0) {
        const j = i - 1;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) {
          open[j] = 1; q[tail++] = j; this.markDirtyXY(x - 1, y);
        }
      }
      if (x < n - 1) {
        const j = i + 1;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) {
          open[j] = 1; q[tail++] = j; this.markDirtyXY(x + 1, y);
        }
      }
      if (y > 0) {
        const j = i - n;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) {
          open[j] = 1; q[tail++] = j; this.markDirtyXY(x, y - 1);
        }
      }
      if (y < n - 1) {
        const j = i + n;
        if (open[j] === 0 && h[j] === 0 && wall[j] === 0) {
          open[j] = 1; q[tail++] = j; this.markDirtyXY(x, y + 1);
        }
      }
    }
  }

  /* --------------------------------------------------------------- dirty */

  markDirtyXY(x, y) {
    const ci = ((y / CFG.CHUNK) | 0) * CFG.CHUNKS + ((x / CFG.CHUNK) | 0);
    this.dirty.add(ci);
    const mi = ((y / CFG.MINI_TEXEL) | 0) * CFG.MINI + ((x / CFG.MINI_TEXEL) | 0);
    this.miniDirty.add(mi);
    if (this.miniDirty.size > 8000) {
      this.miniAll = true;
      this.miniDirty.clear();
    }
  }

  recountChunks() {
    const CH = CFG.CHUNKS;
    const C = CFG.CHUNK;
    const n = this.n;
    this.chunkSolid.fill(0);
    for (let cy = 0; cy < CH; cy++) {
      for (let cx = 0; cx < CH; cx++) {
        let c = 0;
        for (let y = 0; y < C; y++) {
          const row = (cy * C + y) * n + cx * C;
          for (let x = 0; x < C; x++) {
            if (this.health[row + x] !== 0 || this.wall[row + x] !== 0) c++;
          }
        }
        this.chunkSolid[cy * CH + cx] = c;
      }
    }
    this.dirty.clear();
    for (let i = 0; i < this.chunkSolid.length; i++) {
      if (this.chunkSolid[i] > 0) this.dirty.add(i);
    }
  }

  /* -------------------------------------------------------------- damage */

  /**
   * 0 = nothing, 1 = damaged, 2 = destroyed, 3 = unbreakable.
   */
  damageAt(cx, cy, amount) {
    const n = this.n;
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return 0;
    const i = cy * n + cx;
    if (this.wall[i] !== 0) return 3;
    const h = this.health[i];
    if (h === 0) return 0;

    if (h > amount) {
      this.health[i] = h - amount;
      this.markDirtyXY(cx, cy);
      return 1;
    }

    const maxH = this.maxHealth[i];
    const wasShard = this.special[i] !== 0;
    this.health[i] = 0;
    this.remaining--;

    const ci = ((cy / CFG.CHUNK) | 0) * CFG.CHUNKS + ((cx / CFG.CHUNK) | 0);
    if (this.chunkSolid[ci] > 0) this.chunkSolid[ci]--;

    this.markDirtyXY(cx, cy);
    this.revealArea(cx, cy);

    if (wasShard) {
      this.special[i] = 0;
      const value = this.shardValues.get(i) || 1;
      this.shardValues.delete(i);
      if (this.onShard) this.onShard(cx, cy, value);
    }
    if (this.onDestroy) this.onDestroy(cx, cy, maxH);
    return 2;
  }

  explode(wx, wy, radius, damage) {
    const P = CFG.PIXEL;
    const n = this.n;
    const cx = wx / P;
    const cy = wy / P;
    const rp = radius / P;
    const r2 = rp * rp;
    const x0 = Math.max(0, Math.floor(cx - rp));
    const x1 = Math.min(n - 1, Math.ceil(cx + rp));
    const y0 = Math.max(0, Math.floor(cy - rp));
    const y1 = Math.min(n - 1, Math.ceil(cy + rp));
    let hits = 0;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * n + x;
        if (this.wall[i] !== 0 || this.health[i] === 0) continue;
        this.damageAt(x, y, damage);
        hits++;
      }
    }
    return hits;
  }

  /* ------------------------------------------------------------- raycast */

  /**
   * Marches along a ray until it hits something. Hidden cells stop the
   * preview (the player does not know what is in the dark).
   */
  raycast(wx, wy, dx, dy, maxDist) {
    const P = CFG.PIXEL;
    const n = this.n;
    const step = P * 0.22;
    let t = 0;
    while (t <= maxDist) {
      const px = wx + dx * t;
      const py = wy + dy * t;
      if (px < 0 || py < 0 || px >= CFG.WORLD || py >= CFG.WORLD) {
        return { hit: false, x: px, y: py, out: true };
      }
      const cx = (px / P) | 0;
      const cy = (py / P) | 0;
      const i = cy * n + cx;
      if (this.wall[i] !== 0 || this.health[i] !== 0) {
        if (this.visible[i] || this.special[i]) {
          return { hit: true, x: px, y: py, cx, cy, wall: this.wall[i] !== 0, shard: this.special[i] !== 0 };
        }
        return { hit: false, unknown: true, x: px, y: py };
      }
      t += step;
    }
    return { hit: false, x: wx + dx * maxDist, y: wy + dy * maxDist };
  }

  /* ------------------------------------------------------------ restore */

  applyField(bytes) {
    if (!bytes || bytes.length !== this.w) return false;
    this.health.set(bytes);
    let rem = 0;
    for (let i = 0; i < this.w; i++) {
      if (this.health[i] !== 0 && this.wall[i] === 0) rem++;
    }
    this.remaining = rem;
    for (const s of this.shards) {
      if (this.health[s.i] === 0) {
        this.special[s.i] = 0;
        this.shardValues.delete(s.i);
      }
    }
    this.recomputeVisibility();
    this.recountChunks();
    this.miniAll = true;
    this.miniDirty.clear();
    return true;
  }
}
