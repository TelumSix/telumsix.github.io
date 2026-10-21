import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout });
for (const file of ['util', 'config', 'tech', 'reactions', 'balls', 'particles', 'game', 'renderer'])
  vm.runInContext(fs.readFileSync(new URL('../js/' + file + '.js', import.meta.url), 'utf8'), ctx);
const { CFG, BALL_TYPES, BallSystem, Game, Tech, Fx, Renderer, ballPrice, pixelReward, restoreLaunchCounts } =
  vm.runInContext('({ CFG, BALL_TYPES, BallSystem, Game, Tech, Fx, Renderer, ballPrice, pixelReward, restoreLaunchCounts })', ctx);

function fixture() {
  const n = 12;
  const world = { n, health: new Uint8Array(n * n), wall: new Uint8Array(n * n),
    maxHealth: new Uint8Array(n * n).fill(20), visible: new Uint8Array(n * n).fill(1),
    inBounds: (x, y) => x >= 0 && x < n && y >= 0 && y < n,
    cellAt: (x, y) => [Math.floor(x / CFG.PIXEL), Math.floor(y / CFG.PIXEL)],
    damageAt(x, y, damage) {
      const i = y * n + x;
      if (!this.inBounds(x, y) || !this.health[i] || this.wall[i]) return 0;
      this.health[i] = Math.max(0, this.health[i] - damage);
      return this.health[i] ? 1 : 2;
    } };
  const tech = new Tech();
  const game = { wallHits: 0, sfx: { bounce() {} }, onWallHit() { this.wallHits++; },
    ballStats: def => tech.ballStats(def), onImpactBlast() {}, onPulse() {} };
  const balls = new BallSystem(world, game);
  function spawn(pierce, x = 125) {
    return balls.spawnRaw({ id: 'test', x, y: 275, vx: 100, vy: 0,
      r: 5, damage: 3, color: '#fff', pierce, pierceCap: pierce });
  }
  return { world, tech, game, balls, spawn, at: x => 5 * n + x };
}

// The last charge must carry a round through an entire surviving pixel.
{
  const { world, balls, spawn, at } = fixture();
  world.health[at(3)] = world.health[at(5)] = 20;
  const ball = spawn(1);
  for (let i = 0; i < 100; i++) balls.update(0.01);
  assert.ok(ball.x > 210 && ball.vx > 0, 'final charge exits the whole first pixel');
  assert.equal(world.health[at(3)], 17, 'pierce deals one normal damage hit');
  assert.equal(ball.pierce, 0);
  assert.equal(ball.hitCells.size, 0, 'passed-cell memory clears after exiting');
  for (let i = 0; i < 30; i++) balls.update(0.01);
  assert.ok(ball.vx < 0, 'the next unpierced pixel reflects the ball');
  assert.equal(world.health[at(5)], 17);
  for (let i = 0; i < 60 && ball.bounces < 2; i++) balls.update(0.01);
  assert.equal(world.health[at(3)], 14, 'a later revisit hits the old pixel normally');
}
{
  const { world, game, balls, spawn, at } = fixture();
  world.health[at(3)] = world.health[at(5)] = 20;
  world.wall[at(7)] = 1;
  const ball = spawn(2);
  for (let i = 0; i < 400 && !game.wallHits; i++) {
    balls.update(0.01);
    assert.ok(ball.hitCells.size <= 4, 'pierce bookkeeping stays bounded');
  }
  assert.equal(world.health[at(3)], 17);
  assert.equal(world.health[at(5)], 17, 'two charges pass two pixels');
  assert.equal(game.wallHits, 1);
  assert.ok(ball.vx < 0, 'steel always reflects');
  ball.pierce = 1;
  for (let i = 0; i < 80 && world.health[at(5)] === 17; i++) balls.update(0.01);
  assert.equal(world.health[at(5)], 14, 'recharged pierce cannot permanently ignore old targets');
}
{
  const { world, game, balls, spawn, at } = fixture();
  world.wall[at(3)] = 1;
  const ball = spawn(2);
  for (let i = 0; i < 40 && !game.wallHits; i++) balls.update(0.01);
  assert.equal(ball.pierce, 2, 'steel does not consume pass-through charges');
}

// Returns diminish with toughness, while permanent costs outgrow linear fleets.
assert.equal(pixelReward(8), 5);
assert.equal(pixelReward(80), 11);
assert.ok(pixelReward(80) < BALL_TYPES[0].cost, 'one tough pixel cannot finance a new primary');
assert.ok(pixelReward(80, 1.45, 2) > pixelReward(80), 'economy upgrades retain value');
assert.ok(ballPrice(24, 1, 0, 100, 300) > ballPrice(24, 1, 0, 10, 30));
assert.ok(ballPrice(24, 1, 0, 1000, 1000) > 2 * ballPrice(24, 1, 0, 500, 500));
assert.ok(ballPrice(24, 0.8, 0, 100, 100) < ballPrice(24, 1, 0, 100, 100), 'discounts still matter');
assert.ok(ballPrice(24, 1, 0, 0, 0, 2) > ballPrice(24, 1, 0, 0, 0, 1), 'volley pays for its extra primary');
assert.deepEqual({ ...restoreLaunchCounts(null, 5) }, { arc: 2, maul: 2, drift: 1 });
assert.deepEqual({ ...restoreLaunchCounts({ arc: -1, maul: Infinity, drift: 3.4 }) }, { arc: 0, maul: 0, drift: 3 });

{
  const { world, tech, balls } = fixture();
  const game = Object.create(Game.prototype);
  Object.assign(game, { world, balls, selected: 'arc', effects: tech.getEffects(), currency: 1000,
    launchCounts: restoreLaunchCounts({}), stats: { shots: 0 }, demand: {}, cooldowns: {},
    fx: { ring() {}, burst() {} }, sfx: { shoot() {} }, showHint() {}, canLaunchFrom: () => true });
  const price = game.ballCost(BALL_TYPES[0]);
  game.fire({ wx: 125, wy: 275, sx: 100, sy: 100, cx: 70, cy: 100 });
  assert.equal(game.currency, 1000 - price);
  assert.equal(game.launchCounts.arc, 1, 'actual firing increments the investment ledger');
  game.coolDemand(100);
  assert.ok(game.ballCost(BALL_TYPES[0]) > price, 'resting cannot erase permanent price growth');
  game.effects.volley = 2;
  game.cooldowns.arc = 0;
  game.fire({ wx: 125, wy: 275, sx: 100, sy: 100, cx: 70, cy: 100 });
  assert.equal(game.launchCounts.arc, 3, 'volley records both primaries');
  assert.equal(balls.count, 3);
}

// Save earned growth, spent pierce, and active pass-through cells; discard sparks.
{
  const { world, tech, game, balls } = fixture();
  tech.levels.drift_focus = 2;
  const ball = balls.fire(BALL_TYPES[2], 173, 275, 0.4);
  ball.damage += 2; ball.bounces = 24; ball.hits = 11; ball.pierce = 0;
  ball.hitCells.add(5 * world.n + 3);
  balls.spawnFrags(ball, 1);
  const saved = JSON.parse(JSON.stringify(balls.serializePrimary()));
  assert.equal(saved.length, 1);
  const resumed = new BallSystem(world, game);
  resumed.restorePrimary(saved);
  const restored = resumed.list[0];
  assert.equal(restored.damage, ball.damage);
  assert.equal(restored.bounces, 24);
  assert.equal(restored.hits, 11);
  assert.equal(restored.pierce, 0, 'restoring cannot refill spent charges');
  assert.ok(restored.hitCells.has(5 * world.n + 3));
  assert.ok(Math.abs(restored.x - ball.x) < 0.01);
  const before = resumed.count;
  resumed.restorePrimary([[null], ['drift', NaN], ['frag', 1, 1, 0, 0, 1, 1, 0, 0, 0]]);
  assert.equal(resumed.count, before, 'invalid snapshots are ignored');
}

// Impact emission and live objects are bounded independently of hit volume.
{
  const fx = new Fx();
  for (let frame = 0; frame < 100; frame++) {
    fx.update(0.001);
    for (let i = 0; i < 100; i++) {
      fx.statusImpact(0, 0, 'shatter');
      fx.chain(0, 0, 50, 50, '#fff');
    }
    assert.ok(fx.statusEmitted <= 12 && fx.impacts.length <= 64);
    assert.ok(fx.linksEmitted <= 8 && fx.links.length <= 32);
  }
  fx.update(1);
  assert.equal(fx.impacts.length, 0);
  assert.equal(fx.links.length, 0);
  assert.ok(fx.impactPool.length <= 64 && fx.linkPool.length <= 32);
  fx.quality = 0;
  for (let i = 0; i < 100; i++) fx.statusImpact(0, 0, 'frozen');
  assert.equal(fx.impacts.length, 2, 'low quality emits only two new impact accents per frame');
  fx.clear();
  assert.equal(fx.impacts.length, 0);
}

// Cache generation happens once; rendering thousands of coatings obeys LOD caps.
{
  let gradients = 0, draws = 0;
  const draw = new Proxy({}, { set: () => true, get: (_o, key) => {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => {
      gradients++; return { addColorStop() {} };
    };
    if (key === 'drawImage' || key === 'fillRect') return () => { draws++; };
    return () => {};
  } });
  ctx.document = { createElement: () => ({ getContext: () => draw }) };
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, { ctx: draw, quality: 2, w: 50000, h: 50000 });
  for (let mask = 1; mask <= 7; mask++) for (let v = 0; v < 4; v++) for (let p = 0; p < 2; p++) renderer.statusSprite(mask, v, p);
  assert.equal(renderer.statusSprites.size, 44);
  const generated = gradients;
  const world = { n: 100, health: new Uint8Array(10000).fill(20), visible: new Uint8Array(10000).fill(1) };
  const reactions = { world, time: 1, cells: new Map(Array.from({ length: 10000 }, (_, i) =>
    [i, { frozen: 10, fault: 10, charged: 10, frozenAt: 0, faultAt: 0, chargedAt: 0 }])) };
  draws = 0;
  const cam = { zoom: 1, worldToScreenX: x => x, worldToScreenY: y => y };
  renderer.drawCoatings(reactions, cam);
  assert.equal(gradients, generated, 'ordinary frames reuse cached textures');
  assert.equal(draws, 2200, 'dense scenes cap visible coating work');
  renderer.quality = 0; draws = 0;
  renderer.drawCoatings(reactions, cam);
  assert.equal(draws, 600, 'low quality uses a cheaper capped overlay');
  draws = 0;
  renderer.drawCoatings(reactions, { ...cam, worldToScreenX: () => -100000 });
  assert.equal(draws, 0, 'offscreen coatings cost no drawing commands');
}
console.log('OK — full-cell pierce, steel, price growth, payout, fleet persistence and bounded status FX');
