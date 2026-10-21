// Reproducible, headless gameplay probe. No rendering or simulated user upgrades.
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout });
for (const file of ['util', 'config', 'world', 'tech', 'reactions', 'balls', 'game'])
  vm.runInContext(fs.readFileSync(new URL('../js/' + file + '.js', import.meta.url), 'utf8'), ctx);
const api = vm.runInContext('({ CFG, PRICING, BALL_TYPES, TECH_BY_ID, Tech, World, BallSystem, Game, ballPrice })', ctx);
const legacy = process.argv.includes('--legacy');
const seconds = Math.min(600, Math.max(60, Number(process.argv.find(a => a.startsWith('--seconds='))?.split('=')[1]) || 120));
function unlock(tech, id, rank = 1) {
  const node = api.TECH_BY_ID[id];
  for (const r of node.req) if (tech.level(r.id) < r.lvl) unlock(tech, r.id, r.lvl);
  tech.levels[id] = rank;
}
for (const [label, seed, profile] of [
  ['opening', 12345, []], ['opening', 7, []],
  ['specialized', 12345, ['arc_winter', 'maul_worldbreaker', 'drift_tempest', 'yield', 'discount', 'salvage']],
]) {
  const game = Object.create(api.Game.prototype);
  const world = new api.World(seed), tech = new api.Tech();
  profile.forEach(id => unlock(tech, id));
  Object.assign(game, { world, tech, effects: tech.getEffects(), currency: legacy ? 60 : (vm.runInContext('typeof ECONOMY === "undefined" ? 60 : ECONOMY.startingCurrency', ctx)),
    stats: { earned: 0, kills: 0, shots: 0, shards: 0 }, skill: 0, demand: {}, launchCounts: { arc: 0, maul: 0, drift: 0 }, time: 0,
    fx: { particles: [], burst() {}, text() {}, ring() {}, particle() {} }, renderer: { quality: 0 }, sfx: { hit() {}, bounce() {} } });
  game.onWallHit = game.onExplosion = game.onImpactBlast = game.onPulse = game.onChain = game.onReaction =
    game.onStatusApplied = game.onElementHit = game.onPierce = () => {};
  world.onDestroy = (x, y, hp) => {
    if (legacy) {
      const gain = Math.max(1, Math.round((2 + hp * 2) * game.effects.yieldMult) + game.effects.bounty);
      game.currency += gain; game.stats.earned += gain; game.stats.kills++;
    } else game.onPixelDestroyed(x, y, hp);
  };
  world.onShard = (_x, _y, value) => { game.skill += value; };
  if (legacy) game.ballCost = def => Math.max(1, Math.round(
    ({ arc: 12, maul: 28, drift: 18 }[def.id]) * game.effects.costMult * (1 + Math.min(8, game.demand[def.id] || 0) * 0.2)));
  if (legacy) game.coolDemand = dt => {
    for (const id of Object.keys(game.demand)) game.demand[id] = Math.max(0, game.demand[id] - 0.6 * game.effects.demandCooling * dt);
  };
  game.balls = new api.BallSystem(world, game);
  let spent = 0;
  const checkpoints = [];
  for (let frame = 0; frame < seconds * 60; frame++) {
    game.time = frame / 60;
    game.coolDemand(1 / 60);
    if (frame % 60 === 0 && game.stats.shots < 2000) {
      const offset = game.stats.shots % 3;
      const roster = [0, 1, 2].map(i => api.BALL_TYPES[(i + offset) % 3]);
      const def = roster.find(d => game.currency >= game.ballCost(d));
      if (def) {
        const cost = game.ballCost(def);
        spent += cost; game.currency -= cost;
        const angle = game.stats.shots * 2.39996323;
        game.balls.fire(def, api.CFG.HALF, api.CFG.HALF, angle);
        game.demand[def.id] = Math.min(legacy ? 8 : api.PRICING.cap, (game.demand[def.id] || 0) + 1);
        game.launchCounts[def.id] += game.effects.volley;
        game.stats.shots++;
      }
    }
    game.balls.update(1 / 60);
    if (frame === 60 * 60 - 1) checkpoints.push(game.stats.shots);
  }
  console.log(JSON.stringify({ economy: legacy ? 'previous' : 'current', label, seed,
    launchesAt60s: checkpoints[0], seconds, launches: game.stats.shots,
    kills: game.stats.kills, earned: game.stats.earned, spent, bank: game.currency,
    prices: api.BALL_TYPES.map(def => game.ballCost(def)), live: game.balls.count }));
}
