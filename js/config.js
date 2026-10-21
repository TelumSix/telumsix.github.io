'use strict';

const CFG = {
  BALL_R: 5,
  PIXEL: 50,
  GRID: 1000,
  CHUNK: 40,
  CHUNKS: 25,
  MINI: 200,
  MINI_TEXEL: 5,
  WORLD: 50000,
  HALF: 25000,
  MAX_BALLS: 7000,
  MAX_PARTICLES: 1400,
  MIN_ZOOM: 0.042,
  MAX_ZOOM: 2.6,
  FREE_R: 7,
  REVEAL: 3,
  MAX_HEALTH: 40,
  SAVE_KEY: 'pixelfield.save.v4',
  MUTE_KEY: 'pixelfield.muted',
  VOLUME_KEY: 'pixelfield.volumes',
  SHARD_COUNT: 900,
};

CFG.CELLS = CFG.GRID * CFG.GRID;
CFG.CHUNK_WORLD = CFG.CHUNK * CFG.PIXEL;
CFG.MINI_CELLS = CFG.MINI * CFG.MINI;
CFG.HEALTH_STRIDE = CFG.MAX_HEALTH + 1;

/**
 * Launch pricing is a demand surcharge rather than a runaway multiplier.
 * Every launch adds one unit of demand; demand cools while that ball rests,
 * so rapid fire gets expensive but the price always settles back to base.
 * At the cap the ball costs 1 + cap * perUnit times its base price.
 */
const PRICING = {
  gain: 1,
  coolPerSec: 0.6,
  cap: 8,
  perUnit: 0.2,
};

/**
 * Every undamaged pixel is the same neutral grey. Damage tints it through
 * yellow -> orange -> red according to the health it has left.
 */
const FRESH_GREY = [138, 150, 168];

const DAMAGE_YELLOW = [255, 214, 102];
const DAMAGE_ORANGE = [249, 115, 22];
const DAMAGE_RED = [239, 68, 68];

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function pixelColorRGB(maxH, h) {
  const m = clamp(maxH | 0, 1, CFG.MAX_HEALTH);
  const cur = clamp(h | 0, 1, m);
  if (m <= 1 || cur >= m) return FRESH_GREY;
  // How hurt the pixel is, so its colour tracks the health it has left.
  const hurt = 1 - (cur - 1) / (m - 1);
  const heatT = Math.pow(hurt, 0.65);
  const heat = heatT < 0.5
    ? mixRgb(DAMAGE_YELLOW, DAMAGE_ORANGE, heatT * 2)
    : mixRgb(DAMAGE_ORANGE, DAMAGE_RED, (heatT - 0.5) * 2);
  // Even the first hit shows; the tint deepens as health drains away.
  const tint = Math.min(1, 0.22 + heatT * 0.95);
  return mixRgb(FRESH_GREY, heat, tint);
}

function pixelCss(maxH, h) {
  const c = pixelColorRGB(maxH, h);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const WALL_RGB = [242, 247, 252];
const SHARD_RGB = [255, 209, 102];
const SHARD_CSS = '#ffd166';

// Three standard rounds, all available from the first launch.
const BALL_TYPES = [
  {
    id: 'arc', name: 'Arc', cost: 12, cooldown: 0.30, damage: 1, speed: 330, radius: 5, color: '#38bdf8',
    short: 'chain lightning',
    desc: 'A balanced energy round. Bounce streaks sharpen it, chain sparks spread the damage and pulses shake loose nearby pixels.',
  },
  {
    id: 'maul', name: 'Maul', cost: 60, cooldown: 0.70, damage: 3, speed: 235, radius: 8, color: '#fb923c',
    splash: 1, short: 'heavy crush',
    desc: 'A slow, heavy round. Every impact crushes the surrounding pixels; steel makes it heavier and its first hit can detonate.',
  },
  {
    id: 'drift', name: 'Drift', cost: 34, cooldown: 0.42, damage: 1, speed: 460, radius: 3.5, color: '#c084fc',
    pierceGrow: { every: 2, cap: 3 }, short: 'fast pierce',
    desc: 'A fast, slim round. Every bounce winds it up, every second bounce teaches it to pierce, and later it sheds sparks.',
  },
];

const BALL_BY_ID = {};
for (const b of BALL_TYPES) BALL_BY_ID[b.id] = b;

const TECH_NODES = [
  // --------------------------------------------------------------- Field
  {
    id: 'core', tree: 'field', kind: 'core', name: 'Field Core',
    cost: 0, maxLevel: 1, req: [], x: 92, y: 260,
    desc: 'The shared core. Every field upgrade branches from here.',
  },
  {
    id: 'damage', tree: 'field', kind: 'upgrade', name: 'Overcharge',
    cost: 1, maxLevel: 3, req: [{ id: 'core', lvl: 1 }], x: 292, y: 92,
    desc: '+1 damage on every ball.',
  },
  {
    id: 'yield', tree: 'field', kind: 'upgrade', name: 'Refinery',
    cost: 1, maxLevel: 4, req: [{ id: 'core', lvl: 1 }], x: 292, y: 260,
    desc: '+25% currency from every pixel destroyed.',
  },
  {
    id: 'discount', tree: 'field', kind: 'upgrade', name: 'Fabricator',
    cost: 2, maxLevel: 3, req: [{ id: 'core', lvl: 1 }], x: 292, y: 428,
    desc: 'Ball launch cost reduced by 12% per level.',
  },
  {
    id: 'volley', tree: 'field', kind: 'upgrade', name: 'Volley',
    cost: 2, maxLevel: 2, req: [{ id: 'damage', lvl: 1 }], x: 512, y: 92,
    desc: '+1 ball per shot, fanned out.',
  },
  {
    id: 'momentum', tree: 'field', kind: 'upgrade', name: 'Momentum',
    cost: 2, maxLevel: 2, req: [{ id: 'yield', lvl: 1 }], x: 512, y: 260,
    desc: 'Bounce streaks arrive 2 bounces sooner for every ball.',
  },
  {
    id: 'bounty', tree: 'field', kind: 'upgrade', name: 'Bounty',
    cost: 2, maxLevel: 3, req: [{ id: 'discount', lvl: 1 }], x: 512, y: 428,
    desc: '+1 currency for every pixel destroyed.',
  },
  {
    id: 'harvest', tree: 'field', kind: 'upgrade', name: 'Kinetic Harvest',
    cost: 2, maxLevel: 2, req: [{ id: 'momentum', lvl: 1 }], x: 752, y: 260,
    desc: 'Every ball earns +1 currency every 24 bounces (-12 per level).',
  },
  {
    id: 'resonance', tree: 'field', kind: 'upgrade', name: 'Resonance Field',
    cost: 2, maxLevel: 2, req: [{ id: 'volley', lvl: 1 }], x: 752, y: 92,
    desc: 'Balls without a pulse release a shockwave every 12 bounces (-4 per level).',
  },
  {
    id: 'mitosis', tree: 'field', kind: 'upgrade', name: 'Mitosis',
    cost: 3, maxLevel: 2, req: [{ id: 'resonance', lvl: 1 }], x: 980, y: 92,
    desc: 'Balls without a spawner shed a spark every 16 bounces (-5 per level).',
  },

  // ----------------------------------------------------------------- Arc
  {
    id: 'arc', tree: 'arc', kind: 'ball', ball: 'arc', name: 'Arc',
    cost: 0, maxLevel: 1, req: [], x: 92, y: 260,
    desc: 'Balanced chain round. Click to equip.',
  },
  {
    id: 'arc_dmg', tree: 'arc', kind: 'upgrade', name: 'Overcharge',
    cost: 1, maxLevel: 3, req: [{ id: 'arc', lvl: 1 }], x: 292, y: 92,
    desc: '+1 damage per level.',
  },
  {
    id: 'arc_spd', tree: 'arc', kind: 'upgrade', name: 'Ion Drive',
    cost: 1, maxLevel: 2, req: [{ id: 'arc', lvl: 1 }], x: 292, y: 260,
    desc: '+12% launch and bounce speed per level.',
  },
  {
    id: 'arc_streak', tree: 'arc', kind: 'upgrade', name: 'Momentum',
    cost: 1, maxLevel: 2, req: [{ id: 'arc', lvl: 1 }], x: 292, y: 428,
    desc: 'Streak damage arrives 3 bounces sooner per level.',
  },
  {
    id: 'arc_pulse', tree: 'arc', kind: 'upgrade', name: 'Resonance',
    cost: 2, maxLevel: 2, req: [{ id: 'arc_dmg', lvl: 1 }], x: 512, y: 92,
    desc: 'Release a shockwave every 10 bounces (-2 per level).',
  },
  {
    id: 'arc_pierce', tree: 'arc', kind: 'upgrade', name: 'Phase',
    cost: 2, maxLevel: 2, req: [{ id: 'arc_spd', lvl: 1 }], x: 512, y: 260,
    desc: '+1 pierce per level.',
  },
  {
    id: 'arc_streakdmg', tree: 'arc', kind: 'upgrade', name: 'Kinetic Edge',
    cost: 2, maxLevel: 2, req: [{ id: 'arc_streak', lvl: 1 }], x: 512, y: 428,
    desc: '+1 damage from each bounce streak per level.',
  },
  {
    id: 'arc_chain', tree: 'arc', kind: 'upgrade', name: 'Chain Reaction',
    cost: 2, maxLevel: 2, req: [{ id: 'arc_pulse', lvl: 1 }], x: 752, y: 92,
    desc: 'Shed a bouncing spark every 14 bounces (-3 per level).',
  },
  {
    id: 'arc_streakpierce', tree: 'arc', kind: 'upgrade', name: 'Momentum Pierce',
    cost: 3, maxLevel: 1, req: [{ id: 'arc_streak', lvl: 2 }, { id: 'arc_pierce', lvl: 1 }], x: 752, y: 260,
    desc: 'Synergy: every streak also grants +1 pierce.',
  },
  {
    id: 'arc_conductor', tree: 'arc', kind: 'upgrade', name: 'Conductor',
    cost: 3, maxLevel: 2, req: [{ id: 'arc_chain', lvl: 1 }, { id: 'arc_streakdmg', lvl: 1 }], x: 752, y: 428,
    desc: 'Synergy: Chain sparks deal +1 damage per level.',
  },
  {
    id: 'arc_overload', tree: 'arc', kind: 'upgrade', name: 'Overload',
    cost: 3, maxLevel: 1, req: [{ id: 'arc_chain', lvl: 2 }, { id: 'arc_pulse', lvl: 2 }], x: 980, y: 92,
    desc: 'Synergy: pulses gain +1 damage, +0.5 px radius and come 2 bounces sooner.',
  },

  // ---------------------------------------------------------------- Maul
  {
    id: 'maul', tree: 'maul', kind: 'ball', ball: 'maul', name: 'Maul',
    cost: 0, maxLevel: 1, req: [], x: 92, y: 260,
    desc: 'Heavy crush round. Click to equip.',
  },
  {
    id: 'maul_dmg', tree: 'maul', kind: 'upgrade', name: 'Overcharge',
    cost: 1, maxLevel: 3, req: [{ id: 'maul', lvl: 1 }], x: 292, y: 92,
    desc: '+1 damage per level.',
  },
  {
    id: 'maul_splash', tree: 'maul', kind: 'upgrade', name: 'Crush',
    cost: 1, maxLevel: 2, req: [{ id: 'maul', lvl: 1 }], x: 292, y: 260,
    desc: '+1 crush damage to the pixels around each impact per level.',
  },
  {
    id: 'maul_spd', tree: 'maul', kind: 'upgrade', name: 'Siege Engine',
    cost: 1, maxLevel: 2, req: [{ id: 'maul', lvl: 1 }], x: 292, y: 428,
    desc: '+10% launch and bounce speed per level.',
  },
  {
    id: 'maul_impact', tree: 'maul', kind: 'upgrade', name: 'Shockwave',
    cost: 2, maxLevel: 2, req: [{ id: 'maul_dmg', lvl: 1 }], x: 512, y: 92,
    desc: 'Every bounce releases a shockwave (0.9 px, +0.35 px per level).',
  },
  {
    id: 'maul_ramp', tree: 'maul', kind: 'upgrade', name: 'Ramp',
    cost: 2, maxLevel: 2, req: [{ id: 'maul_splash', lvl: 1 }], x: 512, y: 260,
    desc: 'Steel ricochets add +1 damage and +6% size per level.',
  },
  {
    id: 'maul_fracture', tree: 'maul', kind: 'upgrade', name: 'Fracture',
    cost: 2, maxLevel: 1, req: [{ id: 'maul_splash', lvl: 2 }], x: 512, y: 428,
    desc: 'The crush also hits diagonals.',
  },
  {
    id: 'maul_blast', tree: 'maul', kind: 'upgrade', name: 'Blast Charge',
    cost: 2, maxLevel: 2, req: [{ id: 'maul_impact', lvl: 1 }], x: 752, y: 92,
    desc: 'Detonate once on the first impact (2.5 px +1 per level).',
  },
  {
    id: 'maul_seismic', tree: 'maul', kind: 'upgrade', name: 'Seismic Crush',
    cost: 3, maxLevel: 1, req: [{ id: 'maul_impact', lvl: 1 }, { id: 'maul_fracture', lvl: 1 }], x: 752, y: 260,
    desc: 'Synergy: every crush also releases a small shockwave.',
  },
  {
    id: 'maul_aftershock', tree: 'maul', kind: 'upgrade', name: 'Aftershock',
    cost: 3, maxLevel: 1, req: [{ id: 'maul_ramp', lvl: 1 }, { id: 'maul_splash', lvl: 2 }], x: 752, y: 428,
    desc: 'Synergy: each bounce adds +1 crush damage, up to +4.',
  },
  {
    id: 'maul_quake', tree: 'maul', kind: 'upgrade', name: 'Quake',
    cost: 3, maxLevel: 1, req: [{ id: 'maul_blast', lvl: 2 }, { id: 'maul_seismic', lvl: 1 }], x: 980, y: 260,
    desc: 'Synergy: release a 2.2 px shockwave every 6 bounces.',
  },

  // --------------------------------------------------------------- Drift
  {
    id: 'drift', tree: 'drift', kind: 'ball', ball: 'drift', name: 'Drift',
    cost: 0, maxLevel: 1, req: [], x: 92, y: 260,
    desc: 'Fast pierce round. Click to equip.',
  },
  {
    id: 'drift_dmg', tree: 'drift', kind: 'upgrade', name: 'Overcharge',
    cost: 1, maxLevel: 3, req: [{ id: 'drift', lvl: 1 }], x: 292, y: 92,
    desc: '+1 damage per level.',
  },
  {
    id: 'drift_spd', tree: 'drift', kind: 'upgrade', name: 'Ion Drive',
    cost: 1, maxLevel: 3, req: [{ id: 'drift', lvl: 1 }], x: 292, y: 260,
    desc: '+12% launch and bounce speed per level.',
  },
  {
    id: 'drift_pierce', tree: 'drift', kind: 'upgrade', name: 'Focus',
    cost: 1, maxLevel: 2, req: [{ id: 'drift', lvl: 1 }], x: 292, y: 428,
    desc: '+1 pierce and +1 pierce cap per level.',
  },
  {
    id: 'drift_needle', tree: 'drift', kind: 'upgrade', name: 'Needle',
    cost: 2, maxLevel: 1, req: [{ id: 'drift_pierce', lvl: 1 }], x: 512, y: 92,
    desc: 'Pierce grows on every bounce instead of every second bounce.',
  },
  {
    id: 'drift_charge', tree: 'drift', kind: 'upgrade', name: 'Elasticity',
    cost: 2, maxLevel: 2, req: [{ id: 'drift_spd', lvl: 1 }], x: 512, y: 260,
    desc: '+4% speed per bounce and a higher speed cap per level.',
  },
  {
    id: 'drift_kick', tree: 'drift', kind: 'upgrade', name: 'Kick',
    cost: 2, maxLevel: 2, req: [{ id: 'drift_pierce', lvl: 1 }], x: 512, y: 428,
    desc: 'Steel ricochets add +3% speed per level.',
  },
  {
    id: 'drift_pulse', tree: 'drift', kind: 'upgrade', name: 'Resonance',
    cost: 2, maxLevel: 2, req: [{ id: 'drift_needle', lvl: 1 }], x: 752, y: 92,
    desc: 'Release a shockwave every 8 bounces (-2 per level).',
  },
  {
    id: 'drift_spawn', tree: 'drift', kind: 'upgrade', name: 'Budding',
    cost: 2, maxLevel: 2, req: [{ id: 'drift_charge', lvl: 1 }], x: 752, y: 260,
    desc: 'Shed a bouncing spark every 12 bounces (-2 per level).',
  },
  {
    id: 'drift_phase', tree: 'drift', kind: 'upgrade', name: 'Phase Drive',
    cost: 3, maxLevel: 1, req: [{ id: 'drift_kick', lvl: 1 }, { id: 'drift_charge', lvl: 1 }], x: 752, y: 428,
    desc: 'Synergy: every pierce hit adds +2% speed.',
  },
  {
    id: 'drift_pulsespawn', tree: 'drift', kind: 'upgrade', name: 'Chain Pulse',
    cost: 3, maxLevel: 1, req: [{ id: 'drift_pulse', lvl: 1 }, { id: 'drift_spawn', lvl: 1 }], x: 980, y: 92,
    desc: 'Synergy: pulses also shed a spark.',
  },
  {
    id: 'drift_overwind', tree: 'drift', kind: 'upgrade', name: 'Overwind',
    cost: 3, maxLevel: 1, req: [{ id: 'drift_charge', lvl: 2 }], x: 980, y: 260,
    desc: 'Synergy: +40% speed cap.',
  },
];

const TECH_BY_ID = {};
for (const n of TECH_NODES) TECH_BY_ID[n.id] = n;

function techNodeCost(node, level) {
  if (node.cost === 0) return 0;
  return Math.max(1, Math.round(node.cost * Math.pow(1.5, level)));
}

function ballPrice(baseCost, costMult, demand) {
  const heat = Math.min(PRICING.cap, Math.max(0, demand || 0));
  return Math.max(1, Math.round(baseCost * costMult * (1 + heat * PRICING.perUnit)));
}
