import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const context = vm.createContext({ console, Math, Date, Map, Set, Uint8Array, performance });
for (const file of ['js/util.js', 'js/config.js', 'js/tech.js', 'js/reactions.js', 'js/balls.js', 'js/game.js', 'js/renderer.js']) {
  vm.runInContext(fs.readFileSync(new URL(file, root), 'utf8'), context, { filename: fileURLToPath(new URL(file, root)) });
}
const { Tech, TechUI, PixelReactions, BallSystem, Game, Renderer, BALL_TYPES, TECH_NODES, TECH_BY_ID, migrateTechSave, TECH_VERSION } =
  vm.runInContext('({ Tech, TechUI, PixelReactions, BallSystem, Game, Renderer, BALL_TYPES, TECH_NODES, TECH_BY_ID, migrateTechSave, TECH_VERSION })', context);

function buy(tech, id, rank = 1) {
  const node = TECH_BY_ID[id];
  for (const req of node.req) if (tech.level(req.id) < req.lvl) buy(tech, req.id, req.lvl);
  assert.ok(tech.canBuy(node, Infinity) || tech.level(id) >= rank, id + ' must be reachable');
  tech.levels[id] = rank;
}

assert.equal(TECH_NODES.filter(n => n.cost).length, 81);
for (const node of TECH_NODES) {
  const tech = new Tech();
  if (node.cost) buy(tech, node.id, node.maxLevel);
  const restored = new Tech(JSON.parse(JSON.stringify(tech.levels)));
  assert.equal(restored.level(node.id), node.maxLevel, 'valid builds survive reload: ' + node.id);
  assert.equal(tech.level(node.id), node.maxLevel, 'every upgrade has a valid build: ' + node.id);
  assert.ok(!tech.canBuy(node, Infinity), 'maxed node cannot be repurchased');
  for (const rival of node.excludes || []) {
    assert.ok(TECH_BY_ID[rival].excludes.includes(node.id), 'exclusions are symmetric');
    assert.ok(!tech.canBuy(TECH_BY_ID[rival], Infinity), 'rival choice is blocked');
    for (const descendant of TECH_NODES.filter(n => n.req.some(r => r.id === rival))) {
      assert.ok(tech.blockedBy(descendant).length, 'rival descendants display sealed');
    }
  }
  for (const def of BALL_TYPES) {
    const s = tech.ballStats(def);
    assert.ok(s.damage > 0 && s.speed > 0 && s.radius > 0, 'valid stats');
    assert.ok(s.pierceCap >= s.pierce);
  }
}
for (const def of BALL_TYPES) {
  const s = new Tech().ballStats(def);
  assert.ok(s.damage <= 2, 'modest starting damage');
  assert.equal(s.streakDamage, 0, 'no unearned damage growth');
  assert.equal(s.splash, 0, 'no starting area damage');
  assert.equal(s.pierce, 0, 'pierce must be earned');
  assert.equal(s.charge, 0, 'speed growth must be earned');
}
const migrated = migrateTechSave({ skill: 5, currency: 120, seed: 88, field: 'retained',
  selected: 'maul', levels: { arc_dmg: 3, maul_blast: 2, discount: 3 } });
assert.equal(migrated.techRefund, 20);
assert.equal(migrated.skill, 25);
assert.equal(migrated.field, 'retained');
assert.equal(migrated.currency, 120);
assert.equal(migrateTechSave(migrated), migrated, 'migration is idempotent');
assert.equal(migrated.techVersion, TECH_VERSION);

function fixture() {
  const n = 13;
  const world = {
    n, health: new Uint8Array(n * n).fill(40), maxHealth: new Uint8Array(n * n).fill(40),
    wall: new Uint8Array(n * n), inBounds: (x, y) => x >= 0 && y >= 0 && x < n && y < n,
    damageAt(x, y, amount) {
      if (!this.inBounds(x, y)) return 0;
      const i = y * n + x;
      if (this.wall[i]) return 3;
      if (!this.health[i]) return 0;
      this.health[i] = Math.max(0, this.health[i] - Math.round(amount));
      return this.health[i] ? 1 : 2;
    },
  };
  const game = { currency: 0, stats: { earned: 0 }, sfx: { bounce() {} }, onImpactBlast() {}, onPulse() {} };
  const reactions = new PixelReactions(world, game);
  const ball = (id, rules = {}) => ({ id, rules, hits: 0, pierce: 0, pierceCap: rules.pierceCap || 0, x: 325, y: 325 });
  return { world, game, reactions, ball, i: 6 * n + 6 };
}

{
  const { world, reactions, ball, i } = fixture();
  const rime = ball('arc', new Tech().ballStats(BALL_TYPES[0]));
  for (let k = 0; k < 3; k++) reactions.hit(rime, 6, 6, 1);
  assert.equal(reactions.state(i), undefined, 'base frost does not proc early');
  reactions.hit(rime, 6, 6, 1);
  assert.ok(reactions.state(i).frozen > 0);
  const tectonic = new Tech();
  buy(tectonic, 'maul_earthstrike');
  reactions.hit(ball('maul', tectonic.ballStats(BALL_TYPES[1])), 6, 6, 2);
  assert.equal(world.health[i], 0, 'Earth Strike instantly shatters a high-health frozen pixel');
  assert.equal(reactions.state(i), undefined, 'destroying a pixel clears its coatings');
}
{
  const { world, reactions, ball, i } = fixture();
  reactions.coat(6, 6, 'frozen', 2, 2);
  reactions.update(3);
  reactions.hit(ball('maul', { shatterLimit: 40 }), 6, 6, 2);
  assert.equal(world.health[i], 38, 'expired frost cannot shatter');
  reactions.coat(6, 6, 'fault', 5, 2);
  reactions.hit(ball('arc'), 6, 6, 1);
  assert.equal(world.health[i], 35, 'fault benefits another ball type');
  world.wall[i] = 1;
  const before = world.health[i];
  reactions.coat(6, 6, 'frozen', 9);
  reactions.hit(ball('maul', { shatterLimit: 40 }), 6, 6, 999);
  assert.equal(world.health[i], before, 'reactions cannot destroy steel');
}
{
  const { world, reactions, ball, i } = fixture();
  const storm = new Tech();
  buy(storm, 'drift_tempest');
  const volt = ball('drift', storm.ballStats(BALL_TYPES[2]));
  reactions.coat(6, 6, 'frozen', 10);
  reactions.hit(volt, 6, 6, 1);
  assert.ok(world.health[i - 1] < 40, 'ice conducts an immediate chain');
  assert.ok(reactions.state(i - 1).charged > 0, 'Forked Sky charges its chain targets');
  const cairn = ball('maul', { groundBurst: 3 });
  const target = i - 1;
  reactions.hit(cairn, 5, 6, 1);
  assert.equal(reactions.state(target).charged, 0, 'grounding consumes charge');
}
{
  const { reactions, ball, i } = fixture();
  const storm = new Tech();
  buy(storm, 'drift_thunder');
  const volt = ball('drift', storm.ballStats(BALL_TYPES[2]));
  reactions.hit(volt, 6, 6, 1);
  assert.ok(reactions.state(i).charged > 0, 'Storm primes a target');
  reactions.hit(volt, 6, 6, 1);
  assert.equal(reactions.state(i).charged, 0, 'Thunderclap cannot instantly reapply the charge it consumed');
}
{
  const { world, reactions, ball, i } = fixture();
  for (const kind of ['frozen', 'fault', 'charged']) reactions.coat(6, 6, kind, 5);
  reactions.hit(ball('arc', { lattice: 2, convergence: 6 }), 6, 6, 1);
  assert.equal(world.health[i], 31, 'all three statuses enable convergence');
  world.health[i] = 1;
  const killer = ball('arc', { reactionYield: 4 });
  reactions.hit(killer, 6, 6, 1);
  assert.equal(reactions.game.currency, 4, 'reaction salvage is paid once');
  reactions.hit(killer, 6, 6, 1);
  assert.equal(reactions.game.currency, 4, 'empty pixels cannot pay again');
}
{
  const { world, game } = fixture();
  const tech = new Tech();
  game.ballStats = def => tech.ballStats(def);
  const balls = new BallSystem(world, game);
  const live = balls.fire(BALL_TYPES[0], 325, 325, 0);
  buy(tech, 'arc_winter');
  balls.applyUpgrades();
  assert.equal(live.form, 'winter', 'live ball receives its evolved silhouette');
  assert.equal(live.rules.freezeEvery, 1, 'live ball receives frost mechanics');
  const count = balls.count;
  balls.spawnFrags(live, 1);
  assert.equal(balls.count, count + 1);
  assert.equal(balls.list.at(-1).life, 18, 'fragments have finite lifetimes');
  assert.equal(balls.list.at(-1).spawnEvery, 0, 'fragments never reproduce');
  const fragment = balls.list.at(-1);
  fragment.life = 0;
  balls.update(0);
  assert.equal(balls.count, count, 'expired fragments are removed');
  const unspent = live.damage;
  for (let k = 0; k < 120; k++) balls.bounce(live, 1, 0, 0, 6, 6);
  assert.equal(live.damage, unspent, 'a ball without streak upgrades does not gain free damage');
  const drift = balls.fire(BALL_TYPES[2], 325, 325, 0);
  buy(tech, 'drift_focus');
  balls.applyUpgrades();
  assert.equal(drift.pierce, 1, 'newly purchased starting pierce reaches live balls');
  drift.pierce = 0;
  balls.applyUpgrades();
  assert.equal(drift.pierce, 0, 'unrelated purchases do not refill spent pierce');
}

// Exercise the actual purchase entrypoint, including lock and currency guards.
{
  const tech = new Tech();
  buy(tech, 'arc_glacier');
  let messages = [];
  const game = { tech, skill: 999, toast: m => messages.push(m), sfx: { error() {} } };
  Game.prototype.buyNode.call(game, TECH_BY_ID.arc_hail);
  assert.equal(tech.level('arc_hail'), 0);
  assert.equal(game.skill, 999);
  assert.match(messages[0], /Sealed/);
}
{
  const tech = new Tech();
  const game = { tech, skill: 8, toast() {}, sfx: { error() {}, buy() {} },
    balls: { applyUpgrades() { this.applied = true; } }, refreshHud() {}, buildDock() {},
    updateDockSelection() {}, refreshDockAffordability() {}, techUI: { isOpen: false }, save() {} };
  Game.prototype.buyNode.call(game, TECH_BY_ID.arc_dmg);
  assert.equal(tech.level('arc_dmg'), 1);
  assert.equal(game.skill, 7, 'actual purchases spend skill points');
  assert.ok(game.balls.applied, 'actual purchases refresh balls in flight');
}

// Canvas and inspector paths execute against a minimal drawing surface.
{
  const draw = new Proxy({}, { get: (_o, key) => key === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true });
  const tech = new Tech();
  buy(tech, 'arc_winter');
  const ui = Object.create(TechUI.prototype);
  Object.assign(ui, { game: { tech, skill: 999, selected: 'arc' }, tree: 'arc', hover: null,
    info: {}, canvas: { width: 1640, height: 760 }, ctx: draw, scaleX: 1, scaleY: 1 });
  for (const tree of ['arc', 'maul', 'drift', 'field']) {
    ui.tree = tree;
    ui.draw();
    for (const node of ui.nodes()) {
      ui.setInfo(node);
      assert.ok(ui.info.innerHTML.includes(node.name));
    }
  }
  const renderer = Object.create(Renderer.prototype);
  Object.assign(renderer, { ctx: draw, w: 1000, h: 800, quality: 2 });
  const list = TECH_NODES.filter(n => n.form).map(n => ({ x: 100, y: 100, vx: 1, vy: 0, r: 8, form: n.form, color: '#abcdef' }));
  renderer.drawBalls(list, { zoom: 1, worldToScreenX: x => x, worldToScreenY: y => y });
}
console.log('OK — progression, exclusions, reactions, migration, live upgrades and canvas paths');
