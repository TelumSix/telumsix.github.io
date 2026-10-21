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
  MAX_HEALTH: 80,
  FIELD_VERSION: 2,
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

/** Undamaged stone/soil hides its strength; damaged colour uses absolute HP. */
const FRESH_GREY = [138, 150, 168];
const FRESH_BROWN = [137, 103, 78];
const HEALTH_COLORS = [
  [1, [239, 83, 80]], [10, [245, 145, 76]], [20, [239, 205, 100]],
  [40, [110, 193, 138]], [60, [93, 183, 213]], [80, [162, 144, 216]],
];

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function pixelColorRGB(maxH, h, material = 0) {
  const m = clamp(maxH | 0, 1, CFG.MAX_HEALTH);
  const cur = clamp(h | 0, 1, m);
  if (cur >= m) return material ? FRESH_BROWN : FRESH_GREY;
  for (let i = 1; i < HEALTH_COLORS.length; i++) {
    const [upper, color] = HEALTH_COLORS[i];
    const [lower, previous] = HEALTH_COLORS[i - 1];
    if (cur <= upper) return mixRgb(previous, color, (cur - lower) / (upper - lower));
  }
  return HEALTH_COLORS.at(-1)[1];
}

function pixelCss(maxH, h) {
  const c = pixelColorRGB(maxH, h);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const WALL_RGB = [242, 247, 252];
const SHARD_RGB = [255, 209, 102];
const SHARD_CSS = '#ffd166';

// Stable IDs preserve selected balls and existing field saves.
const TECH_VERSION = 2;
const BALL_TYPES = [
  { id: 'arc', name: 'Rime', cost: 12, cooldown: 0.45, damage: 1, speed: 300, radius: 5, color: '#7dd3fc',
    short: 'frost / crystal', desc: 'A quiet frost seed. Every fourth hit freezes a surviving pixel for 4 seconds. Grow into a Glacier or a piercing Hail core.' },
  { id: 'maul', name: 'Cairn', cost: 28, cooldown: 0.85, damage: 2, speed: 220, radius: 7, color: '#d6a66b',
    short: 'earth / fracture', desc: 'A deliberate stone round. Starts with single-target damage. Choose spreading Tectonics or the focused Obelisk to break prepared targets.' },
  { id: 'drift', name: 'Volt', cost: 18, cooldown: 0.55, damage: 1, speed: 390, radius: 4, color: '#c4b5fd',
    short: 'charge / velocity', desc: 'A nimble spark with no starting pierce or speed growth. Become a chaining Storm or a precision Rail round.' },
];
const BALL_BY_ID = Object.fromEntries(BALL_TYPES.map(b => [b.id, b]));

// Effects add per rank. "set" effects select a behavior or visual form.
const TECH_NODES = [];
function addTech(id, tree, name, cost, maxLevel, req, x, y, desc, effects = {}, extra = {}) {
  TECH_NODES.push({ id, tree, name, cost, maxLevel, req: req.map(r => typeof r === 'string' ? { id: r, lvl: 1 } : r),
    x, y, desc, effects, kind: 'upgrade', ...extra });
}
function ballTree(tree, basics, paths) {
  const def = BALL_BY_ID[tree];
  addTech(tree, tree, def.name, 0, 1, [], 110, 365, def.desc, {}, { kind: 'ball', ball: tree });
  basics.forEach(([key, name, desc, effects, max = 2], i) =>
    addTech(tree + '_' + key, tree, name, 1, max, [tree], 330, 140 + 150 * i, desc, effects));
  paths.forEach((p, branch) => {
    const start = branch ? 450 : 110;
    const choice = tree + '_' + p.key;
    const rival = tree + '_' + paths[1 - branch].key;
    addTech(choice, tree, p.name, 3, 1, [tree + '_' + p.req], 560, start + 100,
      p.desc, p.effects, { excludes: [rival], form: p.form, tag: 'SPECIALIZATION' });
    p.nodes.forEach(([key, name, desc, effects, max = 1], i) => {
      const previous = i < 3 ? choice : tree + '_' + p.nodes[i - 3][0];
      addTech(tree + '_' + key, tree, name, i < 3 ? 2 : 3, max, [previous],
        i < 3 ? 800 : 1040, start + (i % 3) * 100, desc, effects);
    });
    const cap = tree + '_' + p.cap[0];
    addTech(cap, tree, p.cap[1], 6, 1, p.nodes.slice(3).map(n => tree + '_' + n[0]),
      1280, start + 100, p.cap[2], p.cap[3], { form: p.cap[4], tag: 'EVOLUTION' });
    addTech(tree + '_' + p.link[0], tree, p.link[1], 4, 1, [cap, p.link[2]],
      1510, start + 100, p.link[3], p.link[4], { tag: 'CROSS-BALL' });
  });
}
ballTree('arc', [
  ['dmg', 'Cold Press', '+1 direct damage per rank.', { damage: 1 }],
  ['frost', 'Cold Front', 'Freeze every 3 hits at rank 1, every 2 at rank 2.', { freezeRate: 1 }],
  ['duration', 'Deep Winter', '+3 seconds of freeze duration per rank.', { freezeDuration: 3 }],
  ['spd', 'Slipstream', '+8% launch speed per rank.', { speedBonus: 0.08 }],
], [
  { key: 'glacier', name: 'Glacier', req: 'frost', form: 'glacier',
    desc: 'Choose Glacier. Freeze every hit; seals off Hail specialization. Visual: round frost core with a snowy wake.',
    effects: { set: { freezeEvery: 1 } },
    nodes: [
      ['hoarfrost', 'Hoarfrost', 'Each freeze also freezes one adjacent pixel.', { freezeSpread: 1 }],
      ['brittle', 'Brittle', 'Frozen targets take +1 direct damage from ANY ball per rank.', { brittle: 1 }, 2],
      ['snowpulse', 'Snowglobe', 'Every 12 bounces, a 1.4-pixel frost pulse deals 1 damage and freezes survivors.', { set: { pulseEvery: 12, pulseR: 70, pulseDmg: 1, frostPulse: true } }],
      ['whiteout', 'Whiteout', 'Freeze two more neighboring pixels on a direct freeze.', { freezeSpread: 2 }],
      ['permafrost', 'Permafrost', '+6 freeze seconds; frost coatings remember their strongest Brittle bonus.', { freezeDuration: 6 }],
      ['coldheart', 'Cold Heart', 'Frost pulses arrive 4 bounces sooner and reach 0.6 pixels farther.', { pulseFaster: 4, pulseRadius: 30 }],
    ],
    cap: ['winter', 'Winter Crown', 'Evolution: pearl core, circular frost rim and snow trail. Frozen kills freeze up to 4 neighbors. +2 direct damage.', { frostBloom: 4, damage: 2 }, 'winter'],
    link: ['icefault', 'Ice Fault', 'maul_fault', 'Rime deals +4 damage to faulted pixels and refreshes their fault duration.', { faultBonus: 4, refreshFault: 1 }],
  },
  { key: 'hail', name: 'Hail', req: 'spd', form: 'hail',
    desc: 'Choose Hail. Start with 1 pierce; seals off Glacier specialization. Visual: round ice core and twin trails.',
    effects: { pierce: 1, pierceCap: 2 },
    nodes: [
      ['needle', 'Ice Needle', 'Regain 1 pierce every 6 bounces.', { set: { pierceEvery: 6 } }],
      ['coldedge', 'Cold Edge', '+2 direct damage against frozen pixels per rank.', { frozenBonus: 2 }, 2],
      ['splinter', 'Splinter', 'Every 18 bounces, shed a small ice chip. Chips last 18 seconds and cannot reproduce.', { set: { spawnEvery: 18, spawnCount: 1 } }],
      ['sleet', 'Sleet', 'Ice Needle recharges 2 bounces sooner; +1 pierce cap.', { pierceFaster: 2, pierceCap: 1 }],
      ['glasscut', 'Glass Cutter', 'Direct hits shatter frozen pixels with 24 health or less. Tougher ice takes +4 damage.', { shatterLimit: 24, frozenBonus: 4 }],
      ['diamond', 'Diamond Dust', 'Chips inherit freezing every hit and last 6 seconds longer.', { chipFrost: 1, fragLife: 6 }],
    ],
    cap: ['comet', 'Comet Heart', 'Evolution: polished round core and long twin wakes. +20% speed, +2 pierce cap; ice chips deal +2 damage.', { speedBonus: 0.2, pierceCap: 2, fragBonus: 2 }, 'comet'],
    link: ['supercool', 'Supercool', 'drift_charge', 'Rime hits on charged targets freeze every hit and add +3 damage without consuming charge.', { supercool: 1 }],
  },
]);
ballTree('maul', [
  ['dmg', 'Dense Core', '+1 direct damage per rank.', { damage: 1 }],
  ['fault', 'Fault Line', 'Every third direct hit marks a surviving pixel: +1 damage from ANY ball for 8 seconds. Rank 2: +2.', { faultPower: 1 }],
  ['streak', 'Patience', 'Earn +1 damage every 32 bounces at rank 1, every 24 at rank 2. Growth capped at +6.', { streakUnlock: 1 }],
  ['spd', 'Stone Skipper', '+8% launch speed per rank.', { speedBonus: 0.08 }],
], [
  { key: 'tectonic', name: 'Tectonic', req: 'fault', form: 'tectonic',
    desc: 'Choose Tectonic. Every fourth bounce crushes 4 neighbors for 1 damage. Seals off Obelisk. Visual: round banded stone and dust wake.',
    effects: { splash: 1, set: { crushEvery: 4 } },
    nodes: [
      ['earthstrike', 'Earth Strike', 'Direct impacts instantly shatter ANY frozen pixel. Crush hits gain +3 damage against ice.', { shatterLimit: CFG.MAX_HEALTH, areaFrozenBonus: 3 }],
      ['tremor', 'Tremor', '+1 crush damage per rank.', { splash: 1 }, 2],
      ['strata', 'Strata', 'Steel ricochets add +1 damage and +3% radius, capped.', { ramp: 1, rampSize: 0.03 }],
      ['faultwave', 'Fault Wave', 'Area hits mark surviving pixels with your Fault Line bonus.', { areaFault: 1 }],
      ['aftershock', 'Aftershock', 'Crush every 2 bounces instead of every 4; crush also hits diagonals.', { set: { crushEvery: 2, splashDiag: true } }],
      ['grounding', 'Grounding', 'A charged direct target discharges in a 1.5-pixel burst for 3 damage. Consumes charge.', { groundBurst: 3 }],
    ],
    cap: ['worldbreaker', 'Worldbreaker', 'Evolution: round molten core and ember-dust wake. Every 10 bounces, a 2-pixel quake deals 3 damage with ice/fault synergies.', { set: { pulseEvery: 10, pulseR: 100, pulseDmg: 3 } }, 'worldbreaker'],
    link: ['avalanche', 'Avalanche', 'arc_frost', 'Shattering a frozen pixel freezes up to 3 neighbors for 5 seconds, setting up the next strike.', { avalanche: 3 }],
  },
  { key: 'obelisk', name: 'Obelisk', req: 'dmg', form: 'obelisk',
    desc: 'Choose Obelisk. +2 direct damage, -10% speed. Seals off Tectonic. Visual: round engraved stone with a quiet dust trail.',
    effects: { damage: 2, speedBonus: -0.1 },
    nodes: [
      ['chisel', 'Chisel', '+3 direct damage against faulted pixels per rank.', { faultBonus: 3 }, 2],
      ['icepick', 'Ice Pick', '+5 direct damage against frozen pixels.', { frozenBonus: 5 }],
      ['anvil', 'Anvil', 'Steel ricochets add +1 damage, capped at +6 growth.', { ramp: 1 }],
      ['execution', 'Execution', 'Direct hits execute a pixel below 25% of its original health.', { execute: 0.25 }],
      ['monolith', 'Monolith', 'Frozen targets take double direct damage after bonuses.', { frozenMult: 1 }],
      ['lodestone', 'Lodestone', 'Charged targets take +5 direct damage; consumes the charge.', { chargeConsume: 5 }],
    ],
    cap: ['titan', 'Titan Core', 'Evolution: round gold-banded core and mineral wake. +4 damage; hitting faulted pixels grants one pierce (cap 2).', { damage: 4, faultPierce: 1, pierceCap: 2 }, 'titan'],
    link: ['fulcrum', 'Fulcrum', 'drift_charge', 'Charged direct hits discharge a 1.5-pixel burst for 4 damage. Consumes charge.', { groundBurst: 4 }],
  },
]);
ballTree('drift', [
  ['dmg', 'Live Wire', '+1 direct damage per rank.', { damage: 1 }],
  ['charge', 'Static Ink', 'Every third direct hit charges a survivor for 8 seconds. Rank 2: 14 seconds.', { chargeDuration: 6 }],
  ['spd', 'Tailwind', '+8% launch speed per rank.', { speedBonus: 0.08 }],
  ['focus', 'Focus', 'Start with +1 pierce and +1 pierce cap per rank. No automatic recharge yet.', { pierce: 1, pierceCap: 1 }],
], [
  { key: 'storm', name: 'Storm', req: 'charge', form: 'storm',
    desc: 'Choose Storm. Charge every direct hit. Seals off Rail. Visual: a sparking ring.',
    effects: { set: { staticEvery: 1 } },
    nodes: [
      ['arcwire', 'Arc Wire', 'Every fourth direct hit jumps to up to 2 nearby pixels for 1 damage.', { chainCount: 2, chainDamage: 1, set: { chainEvery: 4 } }],
      ['conductor', 'Ice Conductor', 'Frozen direct targets take +2 damage and always trigger your chain.', { frozenBonus: 2, iceChain: 1 }],
      ['capacitor', 'Capacitor', '+6 seconds of charge duration and +1 chain damage.', { chargeDuration: 6, chainDamage: 1 }],
      ['fork', 'Forked Sky', 'Chains reach two more pixels and apply charge to survivors.', { chainCount: 2, chainCharge: 1 }],
      ['thunder', 'Thunderclap', 'Direct hits on already charged pixels discharge +4 damage and consume their charge.', { chargeConsume: 4 }],
      ['relay', 'Relay', 'Chain every 2 direct hits instead of 4; chain search radius +1 pixel.', { set: { chainEvery: 2 }, chainRadius: 1 }],
    ],
    cap: ['tempest', 'Tempest Halo', 'Evolution: twin electric halos. +2 chain damage; chain jumps deal +3 against frozen pixels.', { chainDamage: 2, areaFrozenBonus: 3 }, 'tempest'],
    link: ['faultgrid', 'Fault Grid', 'maul_fault', 'Chains deal +4 damage to faulted pixels.', { areaFaultBonus: 4 }],
  },
  { key: 'rail', name: 'Rail', req: 'focus', form: 'rail',
    desc: 'Choose Rail. +12% speed; recharge one pierce every 6 bounces. Seals off Storm. Visual: round violet core and ribbon trails.',
    effects: { speedBonus: 0.12, set: { pierceEvery: 6 } },
    nodes: [
      ['windup', 'Windup', '+2% speed per bounce, up to 1.35x launch speed.', { charge: 0.02, chargeCapBonus: 0.35 }],
      ['tracer', 'Tracer', '+2 direct damage against charged pixels per rank without consuming charge.', { chargedBonus: 2 }, 2],
      ['ricochet', 'Steel Spring', 'Steel ricochets add +4% speed; +0.15x speed cap.', { chargeOnSteel: 0.04, chargeCapBonus: 0.15 }],
      ['tunnel', 'Tunnel Drive', 'Pierce recharges 3 bounces sooner; +2 pierce cap.', { pierceFaster: 3, pierceCap: 2 }],
      ['phase', 'Phase Drive', 'Piercing hits add +2% speed; +0.15x speed cap.', { pierceCharge: 0.02, chargeCapBonus: 0.15 }],
      ['prism', 'Prism Wake', 'Every 20 bounces shed 2 short-lived sparks. Each spark starts with 1 pierce.', { set: { spawnEvery: 20, spawnCount: 2 }, chipPierce: 1 }],
    ],
    cap: ['lightspeed', 'Aurora Lance', 'Evolution: luminous round core and twin ribbon wakes. +20% speed, +2 direct damage, +1 pierce cap.', { speedBonus: 0.2, damage: 2, pierceCap: 1 }, 'lightspeed'],
    link: ['coldrail', 'Cold Rail', 'arc_frost', 'Direct hits against frozen pixels gain +6 damage and restore 1 pierce.', { frozenBonus: 6, icePierce: 1 }],
  },
]);

addTech('core', 'field', 'Field Core', 0, 1, [], 110, 365, 'Shared economy and cross-ball reactions.', {}, { kind: 'core' });
const fieldNodes = [
  ['yield', 'Refinery', 1, 3, 'core', 330, 140, '+15% currency from destroyed pixels per rank.'],
  ['discount', 'Fabricator', 1, 3, 'core', 330, 365, 'Reduce launch prices by 8% per rank.'],
  ['damage', 'Tempered Cores', 3, 2, 'core', 330, 590, '+1 direct damage to all primary balls per rank.'],
  ['bounty', 'Reclamation', 2, 2, 'yield', 560, 140, '+1 currency per destroyed pixel per rank.'],
  ['duration', 'Long Memory', 2, 2, 'discount', 560, 365, '+2 seconds to new freeze, fault and charge coatings per rank.'],
  ['momentum', 'Momentum', 2, 2, 'damage', 560, 590, 'Earn +1 streak damage every 36 bounces; rank 2 every 28. Growth capped at +6.'],
  ['salvage', 'Reaction Salvage', 3, 2, 'bounty', 800, 140, 'A direct kill using a status reaction earns +2 currency per rank.'],
  ['lattice', 'Shared Lattice', 3, 1, 'duration', 800, 365, 'Direct hits on pixels with 2 or more statuses gain +2 damage.'],
  ['volley', 'Twin Launch', 5, 1, 'momentum', 800, 590, 'Launch two primary balls per shot. Blocks Focused Launch.', { excludes: ['focused'] }],
  ['focused', 'Focused Launch', 5, 1, 'momentum', 1040, 690, '+3 direct damage to primary balls. Blocks Twin Launch.', { excludes: ['volley'] }],
  ['sustain', 'Patient Harvest', 3, 2, 'salvage', 1040, 140, '+1 currency every 40 bounces per primary ball; rank 2 every 28.'],
  ['convergence', 'Convergence', 5, 1, 'lattice', 1040, 365, 'Direct hits on pixels with all 3 statuses gain another +6 damage.'],
  ['echo', 'Echo Chamber', 4, 1, 'volley', 1280, 590, 'Primary balls with a pulse gain +1 pulse damage and +0.3 pixels of radius.'],
  ['precision', 'Precision Tools', 4, 1, 'focused', 1280, 690, 'Primary direct hits execute pixels below 15% original health.'],
  ['balance', 'Fieldcraft', 6, 1, 'convergence', 1280, 365, 'Status reaction kills earn +5 more currency. +2 seconds to new coatings.'],
];
for (const [id, name, cost, max, req, x, y, desc, extra] of fieldNodes)
  addTech(id, 'field', name, cost, max, [req], x, y, desc, {}, extra);
// New side branches and late return routes preserve all existing purchases.
function sideNode(tree, key, name, req, x, y, desc, effects, extra = {}) {
  addTech(tree === 'field' ? key : tree + '_' + key, tree, name, extra.cost || 3, extra.maxLevel || 1,
    req, x, y, desc, effects, extra);
}
function exclusiveSides(tree, a, b) {
  const prefix = tree === 'field' ? '' : tree + '_';
  a.excludes = [prefix + b.key]; b.excludes = [prefix + a.key];
  for (const item of [a, b]) sideNode(tree, item.key, item.name, item.req, item.x, 850,
    item.desc, item.effects, { excludes: item.excludes, tag: 'CHOICE' });
}
sideNode('arc', 'powder', 'Powder Snow', ['arc_duration'], 110, 110, '+4 freeze seconds; a snowy wake even before specialization.', { freezeDuration: 4, set: { trailStyle: 'snow' } });
sideNode('arc', 'coldblood', 'Cold Memory', ['arc_frost'], 110, 650, 'Direct hits refresh existing frost to your current freeze duration.', { refreshFreeze: 1 });
exclusiveSides('arc',
  { key: 'stillwater', name: 'Stillwater', req: ['arc_frost'], x: 330, desc: '+3 damage against ice and +4 freeze seconds. Blocks White Wind.', effects: { frozenBonus: 3, freezeDuration: 4 } },
  { key: 'whitewind', name: 'White Wind', req: ['arc_spd'], x: 560, desc: '+20% speed and aurora trails. Blocks Stillwater.', effects: { speedBonus: 0.2, set: { trailStyle: 'aurora' } } });
sideNode('arc', 'blackice', 'Black Ice', ['arc_stillwater'], 800, 850, 'Shatter ice at 24 HP or less; +2 damage against tougher ice.', { shatterLimit: 24, frozenBonus: 2 });
sideNode('arc', 'snowrunner', 'Snow Runner', ['arc_whitewind'], 1040, 850, 'Direct kills restore 1 pierce; +2 pierce cap.', { onKillPierce: 1, pierceCap: 2 });
sideNode('arc', 'thawgate', 'Thaw Passage', ['arc_winter'], 1510, 110, 'RETURN ROUTE: reopen Ice Needle and Cold Edge from Hail. +1 starting pierce and cap. Hail specialization stays sealed.', { pierce: 1, pierceCap: 1 }, { cost: 5, tag: 'GATEWAY' });
sideNode('arc', 'glacialgate', 'Glacial Passage', ['arc_comet'], 1510, 650, 'RETURN ROUTE: reopen Snowglobe and Brittle from Glacier. Freeze one more neighbor. Glacier specialization stays sealed.', { freezeSpread: 1 }, { cost: 5, tag: 'GATEWAY' });
sideNode('arc', 'horizon', 'Boreal Horizon', ['arc_thawgate'], 1760, 110, 'Aurora ribbons, +6% speed and +1 pierce cap.', { speedBonus: 0.06, pierceCap: 1, set: { trailStyle: 'aurora' } });
sideNode('arc', 'rings', 'Snow Rings', ['arc_glacialgate', 'arc_snowpulse'], 1760, 650, '+0.5 pixels of pulse radius and +1 pulse damage.', { pulseRadius: 25, pulseDmg: 1 });
sideNode('arc', 'bloom', 'Crystal Garden', ['arc_winter'], 1760, 310, 'Either evolution: frozen kills freeze 2 additional neighbors.', { frostBloom: 2 }, { routes: [[{ id: 'arc_comet', lvl: 1 }]] });
sideNode('arc', 'thawburst', 'Thaw Echo', ['arc_icefault'], 1760, 450, 'Either cross-ball capstone: frozen direct kills release a 1.2-pixel burst for 2 damage.', { thawBurst: 2 }, { routes: [[{ id: 'arc_supercool', lvl: 1 }]] });

sideNode('maul', 'sediment', 'Sediment', ['maul_dmg'], 110, 110, '+2 direct damage to pixels in brown soil patches.', { soilBonus: 2 });
sideNode('maul', 'weathering', 'Weathering', ['maul_fault'], 110, 650, '+2 direct damage to targets below half their original health.', { woundedBonus: 2 });
exclusiveSides('maul',
  { key: 'deepcore', name: 'Deep Core', req: ['maul_dmg'], x: 330, desc: '+3 direct damage, -8% speed. Blocks Branching Fault.', effects: { damage: 3, speedBonus: -0.08 } },
  { key: 'widefault', name: 'Branching Fault', req: ['maul_fault'], x: 560, desc: '+1 fault bonus; newly applied direct faults spread to one neighbor. Blocks Deep Core.', effects: { faultPower: 1, faultSpread: 1 } });
sideNode('maul', 'pressure', 'Pressure Chamber', ['maul_deepcore'], 800, 850, '+4 damage against targets below half health.', { woundedBonus: 4 });
sideNode('maul', 'echo', 'Echo Strike', ['maul_widefault'], 1040, 850, 'Every eighth direct hit emits a 1.2-pixel burst for 2 damage.', { echoStrikeEvery: 8, echoStrikeDmg: 2 });
sideNode('maul', 'bedrockgate', 'Bedrock Passage', ['maul_worldbreaker'], 1510, 110, 'RETURN ROUTE: reopen Chisel and Ice Pick from Obelisk. +2 direct damage. Obelisk specialization stays sealed.', { damage: 2 }, { cost: 5, tag: 'GATEWAY' });
sideNode('maul', 'faultgate', 'Fault Passage', ['maul_titan'], 1510, 650, 'RETURN ROUTE: reopen Earth Strike and Tremor. Gain a 1-damage crush every fourth bounce. Tectonic specialization stays sealed.', { splash: 1, set: { crushEvery: 4 } }, { cost: 5, tag: 'GATEWAY' });
sideNode('maul', 'fossil', 'Fossil Record', ['maul_bedrockgate'], 1760, 110, '+3 damage against faulted pixels and +2 to brown-patch pixels.', { faultBonus: 3, soilBonus: 2 });
sideNode('maul', 'undertow', 'Undertow', ['maul_faultgate'], 1760, 650, 'Crushes gain +2 damage against ice and +2 against faults.', { areaFrozenBonus: 2, areaFaultBonus: 2 });
sideNode('maul', 'sunder', 'Sunder', ['maul_worldbreaker'], 1760, 310, 'Either evolution: direct kills restore 1 pierce; +2 pierce cap.', { onKillPierce: 1, pierceCap: 2 }, { routes: [[{ id: 'maul_titan', lvl: 1 }]] });
sideNode('maul', 'mantle', 'Charged Mantle', ['maul_avalanche'], 1760, 450, 'Either cross-ball capstone: charged direct impacts gain a 2-damage grounding burst, or add +2 to an existing burst.', { groundBurst: 2 }, { routes: [[{ id: 'maul_fulcrum', lvl: 1 }]] });

sideNode('drift', 'ioncoat', 'Ion Coat', ['drift_charge'], 110, 110, '+4 charge seconds and a fine ion wake.', { chargeDuration: 4, set: { trailStyle: 'ion' } });
sideNode('drift', 'overdrive', 'Gentle Overdrive', ['drift_spd'], 110, 650, '+6% launch speed per rank.', { speedBonus: 0.06 }, { maxLevel: 2, cost: 2 });
exclusiveSides('drift',
  { key: 'polarity', name: 'Polarity', req: ['drift_charge'], x: 330, desc: '+3 direct damage against charge and +1 chain damage. Blocks Free Current.', effects: { chargedBonus: 3, chainDamage: 1 } },
  { key: 'velocity', name: 'Free Current', req: ['drift_spd'], x: 560, desc: '+18% speed and +1 pierce cap. Blocks Polarity.', effects: { speedBonus: 0.18, pierceCap: 1 } });
sideNode('drift', 'capbank', 'Capacitor Bank', ['drift_polarity'], 800, 850, 'Charged direct targets discharge a 2-damage burst; consumes charge.', { groundBurst: 2 });
sideNode('drift', 'slipcoil', 'Slip Coil', ['drift_velocity'], 1040, 850, 'Direct kills restore 1 pierce; +1 pierce cap.', { onKillPierce: 1, pierceCap: 1 });
sideNode('drift', 'switchyard', 'Switchyard', ['drift_tempest'], 1510, 110, 'RETURN ROUTE: reopen Windup and Tracer from Rail. +1 starting pierce and cap. Rail specialization stays sealed.', { pierce: 1, pierceCap: 1 }, { cost: 5, tag: 'GATEWAY' });
sideNode('drift', 'cloudgate', 'Cloud Passage', ['drift_lightspeed', 'drift_charge'], 1510, 650, 'RETURN ROUTE: reopen Arc Wire and Ice Conductor from Storm. Charge lasts +4 seconds. Storm specialization stays sealed.', { chargeDuration: 4 }, { cost: 5, tag: 'GATEWAY' });
sideNode('drift', 'flywheel', 'Flywheel', ['drift_switchyard', 'drift_windup'], 1760, 110, '+0.2x speed cap; long ribbon trails.', { chargeCapBonus: 0.2, set: { trailStyle: 'ribbon' } });
sideNode('drift', 'skybridge', 'Sky Bridge', ['drift_cloudgate', 'drift_arcwire'], 1760, 650, '+1 chain damage and +1 pixel chain reach.', { chainDamage: 1, chainRadius: 1 });
sideNode('drift', 'reclaim', 'Energy Return', ['drift_tempest'], 1760, 310, 'Either evolution: direct kills restore 1 pierce; +1 pierce cap.', { onKillPierce: 1, pierceCap: 1 }, { routes: [[{ id: 'drift_lightspeed', lvl: 1 }]] });
sideNode('drift', 'echo', 'Pulse Engine', ['drift_faultgrid'], 1760, 450, 'Either cross-ball capstone: every tenth direct hit emits a 1.2-pixel burst for 2 damage.', { echoStrikeEvery: 10, echoStrikeDmg: 2 }, { routes: [[{ id: 'drift_coldrail', lvl: 1 }]] });

exclusiveSides('field',
  { key: 'surveyor', name: 'Surveyor', req: ['yield'], x: 330, desc: '+20% pixel currency. Blocks Reaction Economy.', effects: {} },
  { key: 'recycler', name: 'Reaction Economy', req: ['salvage'], x: 560, desc: '+4 currency per direct status-reaction kill. Blocks Surveyor.', effects: {} });
exclusiveSides('field',
  { key: 'relaynet', name: 'Relay Network', req: ['duration'], x: 800, desc: '+4 seconds to all new coatings. Blocks Hard Impact.', effects: {} },
  { key: 'hardimpact', name: 'Hard Impact', req: ['damage'], x: 1040, desc: '+2 primary direct damage. Blocks Relay Network.', effects: {} });
sideNode('field', 'pacing', 'Supply Rhythm', ['discount'], 1510, 140, 'Demand surcharges cool 25% faster.', {});
sideNode('field', 'weave', 'Harmonic Weave', ['echo'], 1510, 590, '+1 pulse damage, +0.3 pixels pulse radius, and +1 chain damage for primary balls.', {}, { routes: [[{ id: 'precision', lvl: 1 }]] });
sideNode('field', 'reunion', 'Reunion', ['convergence'], 1510, 365, 'RETURN ROUTE: reopen Echo Chamber and Precision Tools regardless of your launch choice. The other launch specialization stays sealed.', {}, { cost: 5, tag: 'GATEWAY' });
sideNode('field', 'reactor', 'Closed Circuit', ['balance'], 1510, 690, '+3 currency per direct status-reaction kill.', {});
sideNode('field', 'confluence', 'Confluence', ['relaynet'], 1760, 365, 'Either shared combat choice: +1 direct damage and +2 coating seconds.', {}, { cost: 5, routes: [[{ id: 'hardimpact', lvl: 1 }]] });

const TECH_BY_ID = Object.fromEntries(TECH_NODES.map(n => [n.id, n]));
for (const [gateway, targets] of [
  ['arc_thawgate', ['arc_needle', 'arc_coldedge']], ['arc_glacialgate', ['arc_snowpulse', 'arc_brittle']],
  ['maul_bedrockgate', ['maul_chisel', 'maul_icepick']], ['maul_faultgate', ['maul_earthstrike', 'maul_tremor']],
  ['drift_switchyard', ['drift_windup', 'drift_tracer']], ['drift_cloudgate', ['drift_arcwire', 'drift_conductor']],
  ['reunion', ['echo', 'precision']],
]) {
  TECH_BY_ID[gateway].reopens = targets;
  for (const id of targets) (TECH_BY_ID[id].routes ||= []).push([{ id: gateway, lvl: 1 }]);
}

// Old trees cannot map fairly onto mutually exclusive specializations.
// Refund historical rank prices while preserving the field and economy.
function migrateTechSave(data) {
  if (!data || data.techVersion === TECH_VERSION) return data || {};
  const oldCosts = {
    damage: 1, yield: 1, discount: 2, volley: 2, momentum: 2, bounty: 2, harvest: 2, resonance: 2, mitosis: 3,
    arc_dmg: 1, arc_spd: 1, arc_streak: 1, arc_pulse: 2, arc_pierce: 2, arc_streakdmg: 2,
    arc_chain: 2, arc_streakpierce: 3, arc_conductor: 3, arc_overload: 3,
    maul_dmg: 1, maul_splash: 1, maul_spd: 1, maul_impact: 2, maul_ramp: 2, maul_fracture: 2,
    maul_blast: 2, maul_seismic: 3, maul_aftershock: 3, maul_quake: 3,
    drift_dmg: 1, drift_spd: 1, drift_pierce: 1, drift_needle: 2, drift_charge: 2, drift_kick: 2,
    drift_pulse: 2, drift_spawn: 2, drift_phase: 3, drift_pulsespawn: 3, drift_overwind: 3,
  };
  let refund = 0;
  for (const [id, cost] of Object.entries(oldCosts)) {
    const ranks = Math.min(4, Math.max(0, Number(data.levels && data.levels[id]) | 0));
    for (let rank = 0; rank < ranks; rank++) refund += Math.max(1, Math.round(cost * Math.pow(1.5, rank)));
  }
  return { ...data, techVersion: TECH_VERSION, levels: {}, skill: (Number(data.skill) || 0) + refund, techRefund: refund };
}

function techNodeCost(node, level) {
  return node.cost === 0 ? 0 : Math.max(1, Math.round(node.cost * Math.pow(1.5, level)));
}
function ballPrice(baseCost, costMult, demand) {
  const heat = Math.min(PRICING.cap, Math.max(0, demand || 0));
  return Math.max(1, Math.round(baseCost * costMult * (1 + heat * PRICING.perUnit)));
}
