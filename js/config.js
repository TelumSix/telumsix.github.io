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
  MAX_HEALTH: 10,
  SAVE_KEY: 'pixelfield.save.v4',
  MUTE_KEY: 'pixelfield.muted',
  VOLUME_KEY: 'pixelfield.volumes',
  SHARD_COUNT: 900,
};

CFG.CELLS = CFG.GRID * CFG.GRID;
CFG.CHUNK_WORLD = CFG.CHUNK * CFG.PIXEL;
CFG.MINI_CELLS = CFG.MINI * CFG.MINI;

/**
 * Pixels start grey. The grey shade encodes toughness (max health); damage
 * heats the pixel yellow -> orange -> red. Steel is white.
 */
const FRESH_GREYS = [
  null,
  [106, 118, 136],
  [116, 128, 146],
  [126, 138, 156],
  [136, 148, 165],
  [146, 158, 175],
  [156, 168, 184],
  [166, 178, 193],
  [176, 187, 202],
  [186, 196, 210],
  [196, 205, 218],
];

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
  const base = FRESH_GREYS[m];
  if (m <= 1 || cur >= m) return base;
  const dmg = 1 - (cur - 1) / (m - 1);
  const heat = dmg < 0.5
    ? mixRgb(DAMAGE_YELLOW, DAMAGE_ORANGE, dmg * 2)
    : mixRgb(DAMAGE_ORANGE, DAMAGE_RED, (dmg - 0.5) * 2);
  return mixRgb(base, heat, Math.min(1, dmg * 1.08));
}

function pixelCss(maxH, h) {
  const c = pixelColorRGB(maxH, h);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const WALL_RGB = [242, 247, 252];
const SHARD_RGB = [255, 209, 102];
const SHARD_CSS = '#ffd166';

// Every ball is built around what happens when it bounces.
const BALL_TYPES = [
  {
    id: 'spark', name: 'Spark', cost: 10, cooldown: 0.25, damage: 1, speed: 300, radius: 5, color: '#38bdf8',
    short: '1 dmg', desc: 'The classic ricochet. Cheap, quick, and it sharpens with every long streak.',
  },
  {
    id: 'rubber', name: 'Rubber', cost: 42, cooldown: 0.45, damage: 1, speed: 240, radius: 4.5, color: '#4ade80',
    charge: 0.05, chargeCap: 1.7, short: 'speeds up',
    desc: 'Picks up 5% speed on every bounce (up to +70%) — slow at first, frantic once it is loose.',
  },
  {
    id: 'slug', name: 'Slug', cost: 70, cooldown: 0.55, damage: 3, speed: 250, radius: 8, color: '#fb923c',
    splash: 1, short: '3 dmg · crush',
    desc: 'A heavy round that cracks the pixels around every impact as well as the one it hits.',
  },
  {
    id: 'bouncer', name: 'Bouncer', cost: 95, cooldown: 0.55, damage: 1, speed: 320, radius: 5, color: '#a3e635',
    ramp: 1, rampSize: 0.12, short: 'steel ramp',
    desc: 'Every steel ricochet makes it heavier and bigger (+1 damage, +12% size, up to +10).',
  },
  {
    id: 'bumper', name: 'Bumper', cost: 130, cooldown: 0.6, damage: 1, speed: 290, radius: 6, color: '#f43f5e',
    impact: { r: 0.9, dmg: 1 }, short: 'shockwave',
    desc: 'Shockwave ball: every bounce cracks a small area instead of a single pixel.',
  },
  {
    id: 'ricochet', name: 'Ricochet', cost: 180, cooldown: 0.6, damage: 1, speed: 470, radius: 3.5, color: '#c084fc',
    pierceGrow: { every: 2, cap: 4 }, short: 'pierce grows',
    desc: 'Fast and slim. Every second bounce it learns to pierce, and it keeps both tricks.',
  },
  {
    id: 'echo', name: 'Echo', cost: 240, cooldown: 0.75, damage: 1, speed: 310, radius: 5, color: '#22d3ee',
    pulse: { every: 3, r: 1.4, dmg: 1 }, short: 'pulse / 3',
    desc: 'Releases a shockwave every third bounce, damaging everything nearby.',
  },
  {
    id: 'spore', name: 'Spore', cost: 340, cooldown: 0.85, damage: 1, speed: 370, radius: 6, color: '#fbbf24',
    spawn: { every: 8, count: 2 }, short: 'splits / 8',
    desc: 'Sheds two bouncing sparks every eighth bounce. The field fills up fast.',
  },
  {
    id: 'nova', name: 'Nova', cost: 700, cooldown: 1.5, damage: 3, speed: 290, radius: 10, color: '#f8fafc',
    pulse: { every: 10, r: 5, dmg: 4 }, short: 'pulse / 10',
    desc: 'Every tenth bounce it detonates a five-pixel crater. A late-game field clearer.',
  },
];

const BALL_BY_ID = {};
for (const b of BALL_TYPES) BALL_BY_ID[b.id] = b;

const TECH_NODES = [
  // ---------------------------------------------------------- Arsenal
  {
    id: 'spark', tree: 'arsenal', kind: 'ball', ball: 'spark', name: 'Spark',
    cost: 0, maxLevel: 1, req: [], x: 92, y: 260,
    desc: 'Your starting round. Cheap, quick, reliable.',
  },
  {
    id: 'rubber', tree: 'arsenal', kind: 'ball', ball: 'rubber', name: 'Rubber',
    cost: 1, maxLevel: 1, req: [{ id: 'spark', lvl: 1 }], x: 292, y: 92,
    desc: 'Speeds up on every bounce until it is a blur.',
  },
  {
    id: 'slug', tree: 'arsenal', kind: 'ball', ball: 'slug', name: 'Slug',
    cost: 1, maxLevel: 1, req: [{ id: 'spark', lvl: 1 }], x: 292, y: 260,
    desc: 'Heavy round · 3 damage and a crush on every bounce.',
  },
  {
    id: 'bouncer', tree: 'arsenal', kind: 'ball', ball: 'bouncer', name: 'Bouncer',
    cost: 2, maxLevel: 1, req: [{ id: 'spark', lvl: 1 }], x: 292, y: 428,
    desc: 'Grows heavier and bigger with every steel ricochet.',
  },
  {
    id: 'bumper', tree: 'arsenal', kind: 'ball', ball: 'bumper', name: 'Bumper',
    cost: 2, maxLevel: 1, req: [{ id: 'rubber', lvl: 1 }], x: 512, y: 92,
    desc: 'Every bounce shakes loose the pixels around it.',
  },
  {
    id: 'ricochet', tree: 'arsenal', kind: 'ball', ball: 'ricochet', name: 'Ricochet',
    cost: 3, maxLevel: 1, req: [{ id: 'slug', lvl: 1 }], x: 512, y: 260,
    desc: 'Learns to pierce a little more with every bounce.',
  },
  {
    id: 'echo', tree: 'arsenal', kind: 'ball', ball: 'echo', name: 'Echo',
    cost: 3, maxLevel: 1, req: [{ id: 'bouncer', lvl: 1 }], x: 512, y: 428,
    desc: 'Pulses a shockwave every third bounce.',
  },
  {
    id: 'spore', tree: 'arsenal', kind: 'ball', ball: 'spore', name: 'Spore',
    cost: 4, maxLevel: 1, req: [{ id: 'ricochet', lvl: 1 }, { id: 'echo', lvl: 1 }], x: 752, y: 92,
    desc: 'Sheds bouncing sparks as it ricochets.',
  },
  {
    id: 'nova', tree: 'arsenal', kind: 'ball', ball: 'nova', name: 'Nova',
    cost: 6, maxLevel: 1, req: [{ id: 'spore', lvl: 1 }], x: 752, y: 260,
    desc: 'Every tenth bounce, a five-pixel crater.',
  },

  // --------------------------------------------------------- Upgrades
  {
    id: 'core', tree: 'upgrades', kind: 'core', name: 'Field Core',
    cost: 0, maxLevel: 1, req: [], x: 92, y: 260,
    desc: 'The core of your operation. Every upgrade branches from here.',
  },
  {
    id: 'damage', tree: 'upgrades', kind: 'upgrade', name: 'Overcharge',
    cost: 1, maxLevel: 3, req: [{ id: 'core', lvl: 1 }], x: 306, y: 92,
    desc: '+1 damage on every ball.',
  },
  {
    id: 'yield', tree: 'upgrades', kind: 'upgrade', name: 'Refinery',
    cost: 1, maxLevel: 4, req: [{ id: 'core', lvl: 1 }], x: 306, y: 260,
    desc: '+25% currency from every pixel destroyed.',
  },
  {
    id: 'rapid', tree: 'upgrades', kind: 'upgrade', name: 'Autoloader',
    cost: 1, maxLevel: 2, req: [{ id: 'core', lvl: 1 }], x: 306, y: 428,
    desc: 'Launch 30% faster.',
  },
  {
    id: 'volley', tree: 'upgrades', kind: 'upgrade', name: 'Volley',
    cost: 2, maxLevel: 3, req: [{ id: 'damage', lvl: 1 }], x: 530, y: 92,
    desc: '+1 ball per shot, fanned out.',
  },
  {
    id: 'discount', tree: 'upgrades', kind: 'upgrade', name: 'Fabricator',
    cost: 2, maxLevel: 3, req: [{ id: 'yield', lvl: 2 }], x: 530, y: 260,
    desc: 'Ball launch cost reduced by 12%.',
  },
  {
    id: 'radius', tree: 'upgrades', kind: 'upgrade', name: 'Heavy Core',
    cost: 1, maxLevel: 3, req: [{ id: 'rapid', lvl: 1 }], x: 530, y: 428,
    desc: '+15% ball radius.',
  },
  {
    id: 'velocity', tree: 'upgrades', kind: 'upgrade', name: 'Railgun',
    cost: 1, maxLevel: 3, req: [{ id: 'volley', lvl: 1 }], x: 756, y: 92,
    desc: '+15% ball speed.',
  },
  {
    id: 'momentum', tree: 'upgrades', kind: 'upgrade', name: 'Momentum',
    cost: 2, maxLevel: 3, req: [{ id: 'discount', lvl: 1 }], x: 756, y: 260,
    desc: '+2 bounces of momentum: the damage bonus from a bounce streak arrives sooner.',
  },
  {
    id: 'bounty', tree: 'upgrades', kind: 'upgrade', name: 'Bounty',
    cost: 2, maxLevel: 3, req: [{ id: 'discount', lvl: 2 }], x: 756, y: 428,
    desc: '+1 currency for every pixel destroyed.',
  },
  {
    id: 'streakdmg', tree: 'upgrades', kind: 'upgrade', name: 'Kinetic Edge',
    cost: 2, maxLevel: 2, req: [{ id: 'core', lvl: 1 }], x: 92, y: 92,
    desc: 'Bounce streaks hit for +1 extra damage per level.',
  },
  {
    id: 'harvest', tree: 'upgrades', kind: 'upgrade', name: 'Kinetic Harvest',
    cost: 2, maxLevel: 2, req: [{ id: 'core', lvl: 1 }], x: 92, y: 428,
    desc: 'Every ball earns +1 currency every 24 bounces (12 at level 2).',
  },
  {
    id: 'elastic', tree: 'upgrades', kind: 'upgrade', name: 'Elastic Field',
    cost: 2, maxLevel: 2, req: [{ id: 'velocity', lvl: 1 }], x: 980, y: 92,
    desc: 'Every ball gains +4% speed per bounce, up to +18% per level.',
  },
  {
    id: 'resonance', tree: 'upgrades', kind: 'upgrade', name: 'Resonance Field',
    cost: 2, maxLevel: 2, req: [{ id: 'radius', lvl: 1 }], x: 980, y: 260,
    desc: 'Balls without a pulse of their own release a shockwave every 12 bounces (-4 per level).',
  },
  {
    id: 'mitosis', tree: 'upgrades', kind: 'upgrade', name: 'Mitosis',
    cost: 3, maxLevel: 2, req: [{ id: 'resonance', lvl: 1 }], x: 980, y: 428,
    desc: 'Balls without a spawner shed a spark every 16 bounces (-5 per level).',
  },
];

const BALL_EXTRA = {
  spark: { stat: 'chain', name: 'Chain', cost: 2, maxLevel: 2, desc: 'Spark sheds a spark every 14 bounces (-3 per level).' },
  rubber: { stat: 'overwind', name: 'Overwind', cost: 2, maxLevel: 2, desc: '+40% speed cap per level.' },
  slug: { stat: 'fracture', name: 'Fracture', cost: 2, maxLevel: 2, desc: 'The crush also hits diagonals; level 2 adds +1 crush damage.' },
  bouncer: { stat: 'kick', name: 'Kick', cost: 2, maxLevel: 2, desc: 'Steel ricochets also add +3% speed per level (up to +60%).' },
  bumper: { stat: 'amplify', name: 'Amplify', cost: 2, maxLevel: 2, desc: '+0.6 px shockwave radius and +1 damage at level 2.' },
  ricochet: { stat: 'needle', name: 'Needle', cost: 2, maxLevel: 2, desc: 'Pierce grows on every bounce instead of every second.' },
  echo: { stat: 'feedback', name: 'Feedback', cost: 2, maxLevel: 2, desc: '+1 pulse damage and one bounce sooner per level.' },
  spore: { stat: 'budding', name: 'Budding', cost: 2, maxLevel: 2, desc: 'Bursts come 2 bounces sooner per level.' },
  nova: { stat: 'pulsefrags', name: 'Chain Nova', cost: 2, maxLevel: 2, desc: 'Pulses also shed 1 spark per level.' },
};

/**
 * Signature upgrade for each ball. Every ball also gets Damage / Speed /
 * Size nodes; these four chips are the per-ball track of the tech tree.
 */
const BALL_SIG = {
  spark: { stat: 'streak', step: 4, name: 'Streak', cost: 1, maxLevel: 2, desc: 'Spark\'s bounce-streak bonus arrives 4 bounces sooner per level.' },
  rubber: { stat: 'charge', step: 0.03, name: 'Elasticity', cost: 2, maxLevel: 2, desc: '+3% more speed per bounce and a higher speed cap per level.' },
  slug: { stat: 'splash', step: 1, name: 'Crush', cost: 2, maxLevel: 2, desc: '+1 damage to the pixels around each impact per level.' },
  bouncer: { stat: 'ramp', step: 1, name: 'Ramp', cost: 2, maxLevel: 2, desc: 'Bouncer gains +1 more damage per steel ricochet.' },
  bumper: { stat: 'impact', step: 0.5, name: 'Shockwave', cost: 2, maxLevel: 2, desc: '+0.5 px shockwave radius per level; level 2 hits for 2.' },
  ricochet: { stat: 'pierce', step: 2, name: 'Focus', cost: 2, maxLevel: 2, desc: '+2 pierce cap per level.' },
  echo: { stat: 'pulse', step: 0.7, name: 'Resonance', cost: 2, maxLevel: 2, desc: '+0.7 px shockwave radius per level.' },
  spore: { stat: 'frags', step: 1, name: 'Bloom', cost: 2, maxLevel: 2, desc: '+1 spark per burst per level.' },
  nova: { stat: 'pulse', step: 1.5, name: 'Supernova', cost: 2, maxLevel: 2, desc: '+1.5 px pulse radius per level.' },
};

for (const def of BALL_TYPES) {
  const sig = BALL_SIG[def.id];
  const extra = BALL_EXTRA[def.id];
  const upgrades = [
    { stat: 'dmg', name: 'Damage', cost: 1, maxLevel: 2, desc: `+1 damage for ${def.name}.` },
    { stat: 'spd', name: 'Speed', cost: 1, maxLevel: 2, desc: `+20% speed for ${def.name}.` },
    { stat: 'size', name: 'Size', cost: 1, maxLevel: 2, desc: `+12% radius for ${def.name}.` },
    { stat: 'reload', name: 'Reload', cost: 1, maxLevel: 2, desc: `${def.name} reloads 15% faster per level.` },
    { stat: sig.stat, name: sig.name, cost: sig.cost, maxLevel: sig.maxLevel, desc: sig.desc, sig: true },
    { stat: extra.stat, name: extra.name, cost: extra.cost, maxLevel: extra.maxLevel, desc: extra.desc, sig: true },
  ];
  for (const u of upgrades) {
    TECH_NODES.push({
      id: `${def.id}_${u.stat}`,
      tree: 'balls',
      kind: 'ballup',
      ball: def.id,
      stat: u.stat,
      sig: !!u.sig,
      name: u.name,
      label: u.name,
      cost: u.cost,
      maxLevel: u.maxLevel,
      req: [{ id: def.id, lvl: 1 }],
      x: 0, y: 0,
      desc: u.desc,
    });
  }
}

const TECH_BY_ID = {};
for (const n of TECH_NODES) TECH_BY_ID[n.id] = n;

function techNodeCost(node, level) {
  if (node.cost === 0) return 0;
  return Math.max(1, Math.round(node.cost * Math.pow(1.5, level)));
}
