import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ctx = vm.createContext({
  console, Math, Date, JSON, Intl,
  Uint8Array, Uint8ClampedArray, Uint32Array, Int32Array, Float32Array,
  Set, Map, Array, Object, Number, String, Boolean, Error,
  Blob, Response, CompressionStream, DecompressionStream, btoa, atob,
  performance, setTimeout, clearTimeout,
});

for (const f of ['js/util.js', 'js/config.js', 'js/world.js', 'js/reactions.js', 'js/balls.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}

const evalIn = (code) => vm.runInContext(code, ctx);

const CFG = evalIn('CFG');
const BALL_TYPES = evalIn('BALL_TYPES');
const BALL_BY_ID = evalIn('BALL_BY_ID');
const PRICING = evalIn('PRICING');
const ballPrice = evalIn('ballPrice');

/* --------------------------------------------------------------- pricing */

{
  assert.strictEqual(ballPrice(10, 1, 0), 10, 'base price without demand');
  assert.strictEqual(ballPrice(10, 1, 1), 13, 'one launch adds 30% demand');
  assert.strictEqual(ballPrice(10, 1, -5), 10, 'demand cannot go negative');
  const capped = ballPrice(10, 1, PRICING.cap);
  assert.strictEqual(capped, 28, 'temporary surcharge is capped at 2.8x');
  assert.strictEqual(ballPrice(10, 1, PRICING.cap * 10), capped, 'demand clamps to the cap');
  assert.strictEqual(ballPrice(10, 0.88, 0), 9, 'cost multiplier still applies');
  let demand = 0;
  for (let i = 0; i < 40; i++) demand = Math.min(PRICING.cap, demand + PRICING.gain);
  assert.strictEqual(ballPrice(700, 1, demand), 1960, 'demand alone never exceeds 2.8x');
}

/* ------------------------------------------------------- roster + trees */

{
  const TECH_NODES = evalIn('TECH_NODES');
  const FRESH_GREY = evalIn('FRESH_GREY');
  const pixelColorRGB = evalIn('pixelColorRGB');
  assert.strictEqual(pixelColorRGB(1, 1).join(','), FRESH_GREY.join(','), 'full health is grey');
  assert.strictEqual(pixelColorRGB(CFG.MAX_HEALTH, CFG.MAX_HEALTH).join(','), FRESH_GREY.join(','), 'all full-health cells share the grey');
  assert.notStrictEqual(pixelColorRGB(CFG.MAX_HEALTH, 20).join(','), FRESH_GREY.join(','), 'damaged cells take on a heat colour');
  assert.notStrictEqual(pixelColorRGB(CFG.MAX_HEALTH, 20).join(','), pixelColorRGB(CFG.MAX_HEALTH, 5).join(','), 'colour tracks remaining health');
  assert.strictEqual(pixelColorRGB(80, 19).join(','), pixelColorRGB(30, 19).join(','), 'damaged colour uses absolute HP');
  assert.notStrictEqual(pixelColorRGB(80, 80, 1).join(','), FRESH_GREY.join(','), 'untouched soil is brown');
  assert.strictEqual(pixelColorRGB(80, 79, 1).join(','), pixelColorRGB(80, 79, 0).join(','), 'first hit reveals HP regardless of material');
  assert.strictEqual(BALL_TYPES.length, 3, 'exactly three standard balls');
  assert.strictEqual(BALL_TYPES.map(b => b.id).join(','), 'arc,maul,drift');
  for (const ball of BALL_TYPES) {
    const tree = TECH_NODES.filter(n => n.tree === ball.id);
    assert.ok(tree.length >= 10, `${ball.name} needs an expansive tree`);
    assert.ok(tree.some(n => n.kind === 'ball' && n.ball === ball.id), `${ball.name} has a root node`);
  }
  const ids = new Set(TECH_NODES.map(n => n.id));
  assert.strictEqual(ids.size, TECH_NODES.length, 'tech node ids must be unique');
  for (const node of TECH_NODES) {
    assert.ok(!/_size$|_reload$/.test(node.id), `obsolete node ${node.id}`);
    for (const req of node.req) {
      assert.ok(ids.has(req.id), `${node.id} requires missing ${req.id}`);
    }
  }
}

/* ------------------------------------------------------------------ world */

const t0 = Date.now();
const world = evalIn('new World(12345)');
const genMs = Date.now() - t0;
console.log(`generated in ${genMs}ms`);

assert.strictEqual(world.w, 1_000_000, 'grid must hold a million cells');
assert.strictEqual(world.n, 1000);

let walls = 0;
let empty = 0;
for (let i = 0; i < world.w; i++) {
  if (world.wall[i]) walls++;
  else if (world.health[i] === 0) empty++;
}
let solids = 0;
for (let i = 0; i < world.w; i++) if (world.health[i] && !world.wall[i]) solids++;

console.log(`remaining=${world.remaining} total=${world.total} walls=${walls} empty=${empty} shards=${world.shards.length}`);
assert.ok(world.remaining > 850_000, `expected a dense field, got ${world.remaining}`);
assert.ok(world.remaining <= 1_000_000);
assert.strictEqual(world.remaining, solids, 'remaining must match solid breakable cells');
assert.strictEqual(world.total, world.remaining, 'total starts as remaining');
assert.strictEqual(world.remaining + walls + empty, 1_000_000, 'every cell is a pixel except the start arena');
assert.ok(empty < 2500, `start arena must stay small, got ${empty} empty cells`);
assert.ok(walls > 60_000, `expected a dense steel lattice, got ${walls}`);
assert.ok(walls < 150_000, `walls should not dominate, got ${walls}`);
assert.ok(world.shards.length > 700, `expected shards, got ${world.shards.length}`);

// start arena is open
const half = 500;
for (let y = half - CFG.FREE_R; y <= half + CFG.FREE_R; y++) {
  for (let x = half - CFG.FREE_R; x <= half + CFG.FREE_R; x++) {
    const d = Math.hypot(x - half, y - half);
    if (d > CFG.FREE_R) continue;
    const i = y * 1000 + x;
    assert.strictEqual(world.wall[i], 0, 'no steel in the starting arena');
    assert.strictEqual(world.health[i], 0, 'starting arena is empty');
  }
}

// launch sites: only cleared ground, never fog or a solid pixel
assert.strictEqual(world.isCleared(half, half), true, 'start arena is cleared ground');
assert.strictEqual(world.isCleared(512, half), false, 'solid pixels are not launch sites');
assert.strictEqual(world.isCleared(-1, 0), false, 'outside the field is not cleared');
assert.strictEqual(world.isCleared(CFG.GRID, 0), false, 'outside the field is not cleared');
{
  let hidden = null;
  for (let y = 100; y < 900 && !hidden; y += 13) {
    for (let x = 100; x < 900; x += 13) {
      const i = y * 1000 + x;
      if (world.health[i] !== 0 && world.wall[i] === 0 && world.visible[i] === 0) {
        hidden = { x, y };
        break;
      }
    }
  }
  assert.ok(hidden, 'expected hidden solid pixels');
  assert.strictEqual(world.isCleared(hidden.x, hidden.y), false, 'fog is not a launch site');
}

// health bounds + shard cells
assert.strictEqual(CFG.MAX_HEALTH, 80, 'pixels now reach 80 health');
for (let i = 0; i < world.w; i++) {
  const h = world.health[i];
  if (h !== 0) assert.ok(h >= 1 && h <= CFG.MAX_HEALTH, `bad health ${h}`);
  if (world.special[i]) {
    assert.strictEqual(h, 2, 'shards are tougher too');
    assert.strictEqual(world.maxHealth[i], 2);
  }
}
assert.strictEqual(new Set(world.shards.map(s => s.i)).size, world.shards.length, 'shards unique');
{
  let brown = 0, adjacent = 0;
  for (let i = 0; i < world.w; i++) {
    if (world.material[i]) {
      brown++;
      if (i % world.n > 0 && world.material[i - 1]) adjacent++;
    }
    if (world.maxHealth[i] && !world.special[i]) assert.ok(world.maxHealth[i] >= 4, 'ordinary pixels are tougher');
  }
  assert.ok(brown > 20000 && brown < world.w * 0.2, 'soil appears in scattered patches');
  assert.ok(adjacent / brown > 0.7, 'brown cells cluster rather than forming random confetti');
}

// health rises towards the edges of the field
{
  let coreSum = 0;
  let coreN = 0;
  let edgeSum = 0;
  let edgeN = 0;
  for (let y = 0; y < 1000; y += 9) {
    for (let x = 0; x < 1000; x += 9) {
      const i = y * 1000 + x;
      if (world.health[i] === 0 || world.wall[i]) continue;
      const d = Math.hypot(x - half, y - half);
      if (d < 120) { coreSum += world.health[i]; coreN++; }
      else if (d > 430) { edgeSum += world.health[i]; edgeN++; }
    }
  }
  assert.ok(coreN > 0 && edgeN > 0, 'sampled both core and edge pixels');
  assert.ok(edgeSum / edgeN > coreSum / coreN + 6, 'edge pixels are much tougher than core pixels');
}

// connectivity: every breakable cell reachable from the centre
{
  const n = world.n;
  const seen = new Uint8Array(world.w);
  const q = new Int32Array(world.w);
  let head = 0;
  let tail = 0;
  const start = half * n + half;
  seen[start] = 1;
  q[tail++] = start;
  while (head < tail) {
    const i = q[head++];
    const x = i % n;
    const y = (i / n) | 0;
    if (x > 0) { const j = i - 1; if (!seen[j] && !world.wall[j]) { seen[j] = 1; q[tail++] = j; } }
    if (x < n - 1) { const j = i + 1; if (!seen[j] && !world.wall[j]) { seen[j] = 1; q[tail++] = j; } }
    if (y > 0) { const j = i - n; if (!seen[j] && !world.wall[j]) { seen[j] = 1; q[tail++] = j; } }
    if (y < n - 1) { const j = i + n; if (!seen[j] && !world.wall[j]) { seen[j] = 1; q[tail++] = j; } }
  }
  let orphans = 0;
  for (let i = 0; i < world.w; i++) {
    if (!seen[i] && !world.wall[i]) orphans++;
  }
  assert.strictEqual(orphans, 0, `steel sealed off ${orphans} pixels`);
}

// the steel web must never enclose a region, regardless of seed
for (const seed of [7, 987654]) {
  const w = evalIn(`new World(${seed})`);
  const n = w.n;
  const seen = new Uint8Array(w.w);
  const q = new Int32Array(w.w);
  let head = 0;
  let tail = 0;
  const start = (n >> 1) * n + (n >> 1);
  seen[start] = 1;
  q[tail++] = start;
  while (head < tail) {
    const i = q[head++];
    const x = i % n;
    const y = (i / n) | 0;
    if (x > 0) { const j = i - 1; if (!seen[j] && !w.wall[j]) { seen[j] = 1; q[tail++] = j; } }
    if (x < n - 1) { const j = i + 1; if (!seen[j] && !w.wall[j]) { seen[j] = 1; q[tail++] = j; } }
    if (y > 0) { const j = i - n; if (!seen[j] && !w.wall[j]) { seen[j] = 1; q[tail++] = j; } }
    if (y < n - 1) { const j = i + n; if (!seen[j] && !w.wall[j]) { seen[j] = 1; q[tail++] = j; } }
  }
  let orphans = 0;
  for (let i = 0; i < w.w; i++) {
    if (!seen[i] && !w.wall[i]) orphans++;
  }
  assert.strictEqual(orphans, 0, `seed ${seed}: steel sealed off ${orphans} pixels`);
}

/* -------------------------------------------------------- fog of war (3) */

function anyEmptyWithin3(x, y) {
  const n = world.n;
  for (let dy = -CFG.REVEAL; dy <= CFG.REVEAL; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= n) continue;
    for (let dx = -CFG.REVEAL; dx <= CFG.REVEAL; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= n) continue;
      const i = yy * n + xx;
      if (!world.health[i] && !world.wall[i]) return true;
    }
  }
  return false;
}

{
  let checked = 0;
  for (let y = 0; y < 1000 && checked < 4000; y += 3) {
    for (let x = 0; x < 1000 && checked < 4000; x += 3) {
      const i = y * 1000 + x;
      if (!world.health[i] && !world.wall[i]) continue;
      checked++;
      assert.strictEqual(
        world.visible[i], anyEmptyWithin3(x, y) ? 1 : 0,
        `visibility mismatch at ${x},${y}`
      );
    }
  }
}

// destroying a pixel reveals 3 cells deep
{
  const n = world.n;
  // find a hidden, solid, breakable cell with only solid neighbours for 4+ cells
  let found = -1;
  let fx = 0;
  let fy = 0;
  outer:
  for (let y = 150; y < 1000 - 150; y += 7) {
    for (let x = 150; x < 1000 - 150; x += 7) {
      const i = y * n + x;
      if (world.health[i] === 0 || world.wall[i] || world.visible[i]) continue;
      let ok = true;
      for (let dy = -CFG.REVEAL; dy <= CFG.REVEAL && ok; dy++) {
        for (let dx = -CFG.REVEAL; dx <= CFG.REVEAL; dx++) {
          const j = (y + dy) * n + (x + dx);
          if (world.health[j] === 0 && world.wall[j] === 0) { ok = false; break; }
        }
      }
      if (ok) { found = i; fx = x; fy = y; break outer; }
    }
  }
  assert.ok(found >= 0, 'expected hidden interior pixels');
  const before = world.remaining;
  const r = world.damageAt(fx, fy, 99);
  assert.ok(r === 2 || r === 4);
  assert.strictEqual(world.remaining, before - 1);
  assert.strictEqual(world.isCleared(fx, fy), true, 'a destroyed pixel becomes cleared ground');
  // every solid within 3 must now be visible
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const j = (fy + dy) * n + (fx + dx);
      if (world.health[j] || world.wall[j]) {
        assert.strictEqual(world.visible[j], 1, `neighbour ${dx},${dy} not revealed`);
      }
    }
  }
}

/* ------------------------------------------------------------- shards */

{
  const shard = world.shards.find(s => world.special[s.i] === 1);
  assert.ok(shard, 'a live shard exists');
  let got = 0;
  world.onShard = (x, y, v) => { got = v; };
  let destroyed = 0;
  world.onDestroy = () => { destroyed++; };
  const r = world.damageAt(shard.x, shard.y, 2);
  assert.strictEqual(r, 2);
  assert.strictEqual(got, shard.value);
  assert.strictEqual(world.special[shard.i], 0);
  assert.strictEqual(destroyed, 1);
  assert.strictEqual(world.health[shard.i], 0);
  world.onShard = null;
  world.onDestroy = null;
}

/* --------------------------------------------------------------- raycast */

{
  const ray = world.raycast(CFG.HALF, CFG.HALF, 1, 0, 4000);
  assert.ok(ray.hit, 'ray from the arena should hit the visible ring');
  assert.ok(ray.x > CFG.HALF);
  const wallRay = world.raycast(CFG.HALF, CFG.HALF, -1, 0, 4000);
  assert.ok(wallRay.hit || wallRay.unknown);
  assert.ok(!world.raycast(CFG.HALF, CFG.HALF, 1, 0, 10).hit, 'short ray hits nothing');
}

/* --------------------------------------------------------------- damage */

{
  const n = world.n;
  // find a 2+ health cell to verify partial damage
  let target = -1;
  for (let i = 0; i < world.w; i++) {
    if (world.health[i] >= 2 && !world.wall[i] && !world.special[i]) { target = i; break; }
  }
  assert.ok(target >= 0);
  const x = target % n;
  const y = (target / n) | 0;
  const h = world.health[target];
  const before = world.remaining;
  const res = world.damageAt(x, y, 1);
  assert.strictEqual(res, 1);
  assert.strictEqual(world.health[target], h - 1);
  assert.strictEqual(world.remaining, before);
  assert.ok(world.dirty.size > 0, 'chunk marked dirty');
}

// explosions
{
  const before = world.remaining;
  const hits = world.explode(CFG.HALF + 900, CFG.HALF, CFG.PIXEL * 4, 99);
  assert.ok(hits > 0, 'explosion hits pixels');
  assert.ok(world.remaining < before, 'explosion destroys pixels');
}

/* ------------------------------------------------------------- ball physics */

{
  const stub = {
    effects: {
      damageBonus: 0, speedMult: 1, radiusMult: 1, costMult: 1,
      volley: 1, cooldownMult: 1, yieldMult: 1, bounty: 0, pierceBonus: 0,
    },
    wallHits: 0,
    explosions: 0,
    blasts: 0,
    sfx: { bounce() {} },
    ballStats(def) {
      return {
        damage: def.damage,
        speed: def.speed,
        radius: def.radius,
        pierce: def.pierce || 0,
        explode: (def.explode || 0) * CFG.PIXEL,
        explodeDmg: def.explodeDmg || 0,
        ramp: def.ramp || 0,
        rampSize: def.rampSize || 0,
        split: def.split || 0,
        impactR: 0,
        impactDmg: 1,
      };
    },
    onWallHit() { this.wallHits++; },
    onExplosion() { this.explosions++; },
    onImpactBlast() { this.blasts++; },
  };
  const balls = new (evalIn('BallSystem'))(world, stub);
  const def = BALL_BY_ID.arc;

  // first solid pixel east of the arena
  const ray = world.raycast(CFG.HALF, CFG.HALF, 1, 0, 4000);
  assert.ok(ray.hit || ray.unknown);
  const before = world.remaining;
  balls.fire(def, CFG.HALF, CFG.HALF, 0);
  assert.strictEqual(balls.count, 1);
  assert.strictEqual(balls.list[0].baseSpeed, def.speed, 'every launch uses the ball\'s fixed speed');
  balls.list[0].damage = 99;
  for (let i = 0; i < 600; i++) balls.update(1 / 60);
  assert.strictEqual(balls.count, 1, 'ball ricochets forever');
  assert.ok(world.remaining < before, 'ball destroyed at least one pixel');
  const live = balls.list[0];
  assert.ok(live.x > 0 && live.x < CFG.WORLD, 'ball stays inside the world');
  assert.ok(live.y > 0 && live.y < CFG.WORLD, 'ball stays inside the world');
  assert.ok(Math.abs(Math.sqrt(live.vx * live.vx + live.vy * live.vy) - live.baseSpeed) < 1e-6, 'speed is conserved');

  // a wall reflects a ball without damaging it, forever
  const n = world.n;
  let wallHit = null;
  for (let y = 20; y < 980 && !wallHit; y += 3) {
    for (let x = 20; x < 980; x += 3) {
      const i = y * n + x;
      if (!world.wall[i]) continue;
      // find an adjacent non-steel cell to fire from
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const j = (y + dy) * n + (x + dx);
        if (world.wall[j] === 0) { wallHit = { x, y, dx, dy }; break; }
      }
      if (wallHit) break;
    }
  }
  assert.ok(wallHit, 'found a wall with an adjacent open cell');
  const bx = (wallHit.x + 0.5 - wallHit.dx * 0.05) * CFG.PIXEL;
  const by = (wallHit.y + 0.5 - wallHit.dy * 0.05) * CFG.PIXEL;
  balls.spawnRaw({
    id: 'test', x: bx, y: by,
    vx: wallHit.dx * 700, vy: wallHit.dy * 700,
    r: 5, damage: 99, color: '#fff',
  });
  for (let i = 0; i < 300; i++) balls.update(1 / 60);
  assert.ok(world.wall[wallHit.y * n + wallHit.x] === 1, 'wall is unbreakable');
  assert.strictEqual(balls.count, 2, 'balls keep bouncing off steel forever');

  // Bouncer powers up on steel
  balls.list.length = 0;
  balls.spawnRaw({
    id: 'bouncer', x: bx, y: by,
    vx: wallHit.dx * 900, vy: wallHit.dy * 900,
    r: 5, damage: 1, damageCap: 11, ramp: 1, rampSize: 0.12, color: '#4ade80',
  });
  for (let i = 0; i < 240; i++) balls.update(1 / 60);
  const rampBall = balls.list.find(b => b.id === 'bouncer');
  assert.ok(rampBall, 'bouncer still alive');
  assert.ok(rampBall.damage > 1, 'bouncer gains damage on steel');
  assert.ok(rampBall.r > 5, 'bouncer grows on steel');

  // Splitter splits once, the pieces keep bouncing
  balls.list.length = 0;
  balls.spawnRaw({
    id: 'splitter', x: CFG.HALF, y: CFG.HALF,
    vx: 1050, vy: 0, r: 6, damage: 1, color: '#22d3ee', split: 3,
  });
  for (let i = 0; i < 400; i++) balls.update(1 / 60);
  assert.strictEqual(balls.count, 4, 'splitter makes three fragments once');
  const parent = balls.list.find(b => b.id === 'splitter');
  assert.ok(parent && parent.hasSplit, 'parent remembers it split');

  // Mortar detonates exactly once
  stub.explosions = 0;
  balls.list.length = 0;
  balls.spawnRaw({
    id: 'mortar', x: CFG.HALF, y: CFG.HALF,
    vx: 760, vy: 0, r: 7, damage: 2, color: '#f43f5e',
    explode: CFG.PIXEL * 3.4, explodeDmg: 2,
  });
  for (let i = 0; i < 500; i++) balls.update(1 / 60);
  assert.strictEqual(stub.explosions, 1, 'mortar detonates exactly once');
  assert.strictEqual(balls.count, 1, 'mortar keeps ricocheting after detonating');

  // Upgrades rebase a live ball without erasing its in-flight growth.
  balls.list.length = 0;
  const liveBall = balls.fire(BALL_BY_ID.arc, CFG.HALF, CFG.HALF, 0);
  liveBall.damage = 3;
  liveBall.baseDamage = 1;
  liveBall.r = 6;
  liveBall.baseRadius = 5;
  liveBall.baseSpeed = 396;
  liveBall.speed0 = 330;
  balls.applyStats(liveBall, {
    damage: 2, speed: 360, radius: 5,
    pierce: 2, pierceEvery: 2, pierceCap: 5,
    explode: 0, explodeDmg: 0, split: 0, ramp: 0, rampSize: 0,
    charge: 0, chargeCap: 1, streakEvery: 10, streakDamage: 1,
    splash: 0, splashCap: 0, splashGrow: 0, splashDiag: false,
    impactR: 0, impactDmg: 1, pulseEvery: 0, pulseR: 0, pulseDmg: 0,
    spawnEvery: 0, spawnCount: 0, pulseSpawn: 0, harvestEvery: 0,
    fragBonus: 0, streakPierce: 0, crushBlast: 0, crushBlastDmg: 1,
    chargeOnSteel: 0, pierceCharge: 0,
  });
  assert.strictEqual(liveBall.damage, 4, 'live ball keeps earned damage on upgrade');
  assert.strictEqual(liveBall.r, 6, 'live ball keeps earned radius on upgrade');
  assert.ok(Math.abs(liveBall.baseSpeed - 432) < 1e-9, 'speed upgrade reaches a live ball');
  assert.strictEqual(liveBall.pierceCap, 5, 'pierce cap upgrade reaches a live ball');
}

/* --------------------------------------------------------------- restore */

{
  const copy = new Uint8Array(world.health);
  const w2 = evalIn('new World(12345)');
  assert.ok(w2.applyField(copy));
  assert.deepStrictEqual(w2.material, world.material, 'soil patches are stable across saves');
  assert.strictEqual(w2.remaining, world.remaining);
  // visibility must be reconstructed
  let checked = 0;
  for (let y = 0; y < 1000 && checked < 1500; y += 11) {
    for (let x = 0; x < 1000 && checked < 1500; x += 11) {
      const i = y * 1000 + x;
      if (!w2.health[i] && !w2.wall[i]) continue;
      checked++;
      assert.strictEqual(w2.visible[i], world.visible[i], `restored visibility ${x},${y}`);
    }
  }
  const legacy = Uint8Array.from(copy, h => Math.ceil(h / 2));
  assert.ok(w2.applyField(legacy, 1));
  assert.strictEqual(w2.remaining, world.remaining, 'legacy migration keeps cleared pixels cleared');
  for (let i = 0; i < world.w; i += 997) {
    assert.strictEqual(w2.health[i], Math.min(w2.maxHealth[i], legacy[i] * 2), 'legacy remaining HP scales once');
  }
  const current = new Uint8Array(w2.health);
  w2.applyField(current, CFG.FIELD_VERSION);
  assert.deepStrictEqual(w2.health, current, 'current saves are not scaled again');
}

/* ----------------------------------------------------------- compression */

const { deflateBytes, inflateBytes, b64encode, b64decode } = evalIn(
  '({ deflateBytes, inflateBytes, b64encode, b64decode })'
);
{
  const bytes = new Uint8Array(world.health);
  const t = Date.now();
  const packed = await deflateBytes(bytes);
  const b64 = b64encode(packed);
  const back = await inflateBytes(b64decode(b64));
  console.log(`compressed 1MB -> ${packed.length} bytes (${b64.length} b64) in ${Date.now() - t}ms`);
  assert.strictEqual(back.length, bytes.length);
  for (let i = 0; i < bytes.length; i += 997) assert.strictEqual(back[i], bytes[i]);
}

console.log('OK — all world/ball checks passed');
