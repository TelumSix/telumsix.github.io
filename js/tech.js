'use strict';

class Tech {
  constructor(levels) {
    this.levels = {};
    for (const id of ['core', 'arc', 'maul', 'drift']) {
      if (!(this.levels[id] > 0)) this.levels[id] = 1;
    }
    for (const node of TECH_NODES) {
      if (node.cost === 0) continue;
      this.levels[node.id] = clamp(Number(levels && levels[node.id]) | 0, 0, node.maxLevel);
    }
    // Imported saves cannot enable both specializations or orphaned ranks.
    for (const node of TECH_NODES) {
      if (this.level(node.id) && this.blockedBy(node).length) this.levels[node.id] = 0;
    }
    for (let pass = 0; pass < TECH_NODES.length; pass++) {
      let changed = false;
      for (const node of TECH_NODES) {
        if (this.level(node.id) && !this.reqsMet(node)) {
          this.levels[node.id] = 0;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  level(id) {
    const v = this.levels[id];
    return v ? v | 0 : 0;
  }

  nodeCost(node) {
    return techNodeCost(node, this.level(node.id));
  }

  reqsMet(node) {
    return this.routes(node).some(route => route.every(r => this.level(r.id) >= r.lvl));
  }

  routes(node) {
    return [node.req, ...(node.routes || [])];
  }

  maxed(node) {
    return this.level(node.id) >= node.maxLevel;
  }

  blockedBy(node, seen = new Set()) {
    if (seen.has(node.id)) return [];
    seen.add(node.id);
    const own = (node.excludes || []).filter(id => this.level(id) > 0);
    if (own.length) return own;
    const blocked = [];
    for (const route of this.routes(node)) {
      const routeBlocks = route.flatMap(req => this.blockedBy(TECH_BY_ID[req.id], new Set(seen)));
      if (!routeBlocks.length) return [];
      blocked.push(...routeBlocks);
    }
    return [...new Set(blocked)];
  }

  canBuy(node, skill) {
    return !this.maxed(node) && !this.blockedBy(node).length && this.reqsMet(node) && skill >= this.nodeCost(node);
  }

  unlockedBalls() {
    return BALL_TYPES.slice();
  }

  getEffects() {
    const L = id => this.level(id);
    return {
      damageBonus: L('damage') + 3 * L('focused') + 2 * L('hardimpact') + L('confluence'),
      yieldMult: 1 + 0.15 * L('yield') + 0.2 * L('surveyor'),
      volley: 1 + L('volley'),
      costMult: Math.pow(0.92, L('discount')),
      bounty: L('bounty'),
      streakEvery: L('momentum') ? 44 - 8 * L('momentum') : 0,
      harvestEvery: L('sustain') ? 52 - 12 * L('sustain') : 0,
      statusDuration: 2 * L('duration') + 2 * L('balance') + 4 * L('relaynet') + 2 * L('confluence'),
      reactionYield: 2 * L('salvage') + 5 * L('balance') + 4 * L('recycler') + 3 * L('reactor'),
      lattice: L('lattice') * 2,
      convergence: L('convergence') * 6,
      echo: L('echo') + L('weave'),
      chainDamage: L('weave'),
      demandCooling: 1 + 0.25 * L('pacing'),
      execute: L('precision') * 0.15,
    };
  }

  ballStats(def) {
    const e = this.getEffects();
    const s = {
      damage: def.damage + e.damageBonus, speed: def.speed, radius: def.radius,
      color: def.color, form: 'seed', speedBonus: 0, chargeCapBonus: 0,
      pierce: 0, pierceCap: 0, pierceEvery: 0, pierceFaster: 0,
      ramp: 0, rampSize: 0, charge: 0, chargeCap: 1, chargeOnSteel: 0, pierceCharge: 0,
      streakEvery: e.streakEvery || 40, streakDamage: e.streakEvery ? 1 : 0,
      splash: 0, splashCap: 0, splashDiag: false, crushEvery: 1,
      pulseEvery: 0, pulseR: 0, pulseDmg: 0, pulseFaster: 0, pulseRadius: 0,
      spawnEvery: 0, spawnCount: 0, fragBonus: 0, fragLife: 18,
      harvestEvery: e.harvestEvery, execute: e.execute,
      freezeEvery: def.id === 'arc' ? 4 : 0, freezeRate: 0, freezeDuration: 4,
      chargeDuration: 2, faultDuration: 8, staticEvery: 3,
      staticEnabled: this.level('drift_charge') > 0 && def.id === 'drift',
      lattice: e.lattice, convergence: e.convergence, reactionYield: e.reactionYield,
    };
    for (const node of TECH_NODES) {
      const rank = this.level(node.id);
      if (node.tree !== def.id || !rank) continue;
      for (const [key, value] of Object.entries(node.effects)) {
        if (key === 'set') Object.assign(s, value);
        else if (key === 'shatterLimit') s[key] = Math.max(s[key] || 0, value);
        else s[key] = (s[key] || 0) + value * rank;
      }
      if (node.form) s.form = node.form;
    }
    s.freezeEvery = s.freezeEvery ? Math.max(1, s.freezeEvery - s.freezeRate) : 0;
    if (s.chainCount) s.chainDamage += e.chainDamage;
    s.freezeDuration += e.statusDuration;
    s.chargeDuration += e.statusDuration;
    s.faultDuration += e.statusDuration;
    s.speed *= 1 + s.speedBonus;
    s.chargeCap = 1 + s.chargeCapBonus;
    s.pierceCap = Math.max(s.pierce, s.pierceCap);
    if (s.pierceEvery) s.pierceEvery = Math.max(1, s.pierceEvery - s.pierceFaster);
    if (s.streakUnlock) {
      s.streakEvery = Math.min(s.streakEvery, 40 - 8 * s.streakUnlock);
      s.streakDamage = 1;
    }
    s.splashCap = s.splash;
    if (s.pulseEvery) {
      s.pulseEvery = Math.max(2, s.pulseEvery - s.pulseFaster);
      s.pulseR += s.pulseRadius + e.echo * 15;
      s.pulseDmg += e.echo;
    }
    s.formName = (TECH_NODES.find(n => n.form === s.form) || {}).name || def.name;
    const palettes = { glacier: '#a5f3fc', winter: '#e0faff', hail: '#38bdf8', comet: '#67e8f9',
      tectonic: '#fbbf24', worldbreaker: '#fb923c', obelisk: '#d6c2a5', titan: '#fde68a',
      storm: '#a78bfa', tempest: '#e9d5ff', rail: '#e879f9', lightspeed: '#f0abfc' };
    s.color = palettes[s.form] || def.color;
    return s;
  }
}

/* ======================================================================== */

const NODE_W = 184;
const NODE_H = 62;
const COL_GAP = 54;
const COL_W = NODE_W + COL_GAP;
const ROW_H = 84;
const PAD_X = 34;
const PAD_Y = 30;

// Authored coordinates only rank siblings; node placement is derived from the
// requirement graph so the tree stays tidy as upgrades are added.
const AUTHORED_POS = new Map(TECH_NODES.map(n => [n.id, { x: n.x, y: n.y }]));
const TREE_LAYOUTS = new Map();

const byAuthored = (a, b) => AUTHORED_POS.get(a).y - AUTHORED_POS.get(b).y ||
  AUTHORED_POS.get(a).x - AUTHORED_POS.get(b).x;

function computeTreeLayout(tree) {
  const nodes = TECH_NODES.filter(n => n.tree === tree);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const reqs = n => n.req.map(r => r.id).filter(id => byId.has(id));

  const depth = new Map();
  for (const n of nodes) if (!reqs(n).length) depth.set(n.id, 0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const n of nodes) {
      const list = reqs(n);
      if (!list.length || !list.every(r => depth.has(r))) continue;
      const d = Math.max(...list.map(r => depth.get(r))) + 1;
      if (depth.get(n.id) !== d) { depth.set(n.id, d); moved = true; }
    }
    if (!moved) break;
  }

  // A node hangs off its deepest requirement; shallower ones become skip links.
  const parent = new Map();
  for (const n of nodes) {
    const candidates = reqs(n).filter(r => depth.get(r) === depth.get(n.id) - 1).sort(byAuthored);
    if (candidates.length) parent.set(n.id, candidates[0]);
  }
  const children = new Map(nodes.map(n => [n.id, []]));
  for (const [id, p] of parent) children.get(p).push(id);
  for (const list of children.values()) list.sort(byAuthored);
  const root = nodes.find(n => !parent.has(n.id));

  // Each leaf claims a lane; parents sit centred over their child span.
  const lane = new Map();
  let lanes = 0;
  const place = id => {
    const kids = children.get(id);
    if (!kids.length) { lane.set(id, lanes); return lanes++; }
    let first = 0;
    let last = 0;
    kids.forEach((kid, i) => {
      const y = place(kid);
      if (i === 0) first = y;
      last = y;
    });
    const middle = (first + last) / 2;
    lane.set(id, middle);
    return middle;
  };
  place(root.id);

  const maxDepth = Math.max(...depth.values());
  const contentBottom = PAD_Y + (lanes - 1) * ROW_H + NODE_H;

  const pos = new Map();
  for (const n of nodes) {
    pos.set(n.id, {
      x: PAD_X + NODE_W / 2 + depth.get(n.id) * COL_W,
      y: PAD_Y + NODE_H / 2 + lane.get(n.id) * ROW_H,
    });
  }

  // A tinted band behind each root branch makes the lanes easy to follow.
  const span = id => children.get(id).reduce((acc, kid) => {
    const [a, b] = span(kid);
    return [Math.min(acc[0], a), Math.max(acc[1], b)];
  }, [lane.get(id), lane.get(id)]);
  const bandX0 = PAD_X + NODE_W + 4;
  const bandX1 = PAD_X + NODE_W + maxDepth * COL_W + 6;
  const bands = children.get(root.id).map((id, i) => {
    const [a, b] = span(id);
    return { alt: i % 2 === 1, x0: bandX0, x1: bandX1,
      y0: PAD_Y + a * ROW_H - 8, y1: PAD_Y + b * ROW_H + NODE_H + 8 };
  });

  return {
    tree, pos, bands,
    width: PAD_X * 2 + NODE_W + maxDepth * COL_W,
    height: contentBottom + PAD_Y,
  };
}

class TechUI {
  constructor(game) {
    this.game = game;
    this.overlay = document.getElementById('techOverlay');
    this.canvas = document.getElementById('treeCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = document.getElementById('treeInfo');
    this.treeWrap = document.getElementById('treeWrap');
    this.tree = 'arc';
    this.hover = null;
    this.selectedNode = null;
    this.scaleX = 1;
    this.scaleY = 1;
    this.viewScale = 0.85;
    this.bind();
  }

  bind() {
    document.getElementById('treeZoomOut').addEventListener('click', () => this.setZoom(this.viewScale - 0.15));
    document.getElementById('treeZoomIn').addEventListener('click', () => this.setZoom(this.viewScale + 0.15));
    document.getElementById('treeFit').addEventListener('click', () => {
      this.ensureLayout();
      const availH = Math.max(this.treeWrap.clientHeight, window.innerHeight * 0.52);
      this.setZoom(Math.min((this.treeWrap.clientWidth - 4) / this.treeW, (availH - 4) / this.treeH));
    });
    this.info.addEventListener('click', e => {
      if (e.target.closest('[data-buy-tech]') && this.inspected) {
        this.game.buyNode(this.inspected);
        this.draw();
        this.setInfo(this.inspected);
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.treeDrag) {
        const dx = e.clientX - this.treeDrag.x, dy = e.clientY - this.treeDrag.y;
        if (Math.hypot(dx, dy) > 6) this.treeDrag.moved = true;
        if (this.treeDrag.moved && e.pointerType !== 'touch') {
          this.treeWrap.scrollLeft = this.treeDrag.left - dx;
          this.treeWrap.scrollTop = this.treeDrag.top - dy;
          this.canvas.style.cursor = 'grabbing';
          return;
        }
      }
      const hit = this.hitTest(e);
      if (hit !== this.hover) {
        this.hover = hit;
        this.draw();
        this.setInfo(hit || this.selectedNode);
      }
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hover) {
        this.hover = null;
        this.draw();
      }
      this.setInfo(this.selectedNode);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.treeDrag = { x: e.clientX, y: e.clientY, left: this.treeWrap.scrollLeft,
        top: this.treeWrap.scrollTop, moved: false, node: this.hitTest(e) };
      if (e.pointerType !== 'touch') {
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener('pointerup', () => {
      const drag = this.treeDrag;
      this.treeDrag = null;
      this.canvas.style.cursor = 'pointer';
      if (drag && !drag.moved && drag.node) this.clickNode(drag.node);
    });
    this.canvas.addEventListener('pointercancel', () => {
      this.treeDrag = null;
      this.canvas.style.cursor = 'pointer';
    });

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.tree = tab.dataset.tree;
        this.hover = null;
        this.selectedNode = null;
        this.updateTabs();
        this.resize();
        this.draw();
        this.setInfo(null);
        this.game.sfx.click();
      });
    });

    document.getElementById('btnCloseTech').addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // The panel height shifts with the info box and the tab content, so keep
    // the backing store in sync instead of drawing at a stale scale.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        if (!this.isOpen) return;
        this.resize();
        this.draw();
      });
      this._ro.observe(this.canvas);
    }
  }

  updateTabs() {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tree === this.tree);
    });
    if (this.treeWrap) this.treeWrap.classList.remove('hidden');
    this.updateCount();
    this.setZoom(this.viewScale);
  }

  setZoom(scale) {
    this.ensureLayout();
    this.viewScale = clamp(scale, 0.15, 1.3);
    this.canvas.style.width = Math.round(this.treeW * this.viewScale) + 'px';
    this.canvas.style.height = Math.round(this.treeH * this.viewScale) + 'px';
    this.resize();
    this.draw();
  }

  open() {
    this.overlay.classList.remove('hidden');
    this.updateTabs();
    if (!this._openedOnce) {
      this._openedOnce = true;
      this.fitWidth();
      // Scrollbars only exist after the panel has laid out, so measure again.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => { if (this.isOpen) this.fitWidth(); }));
      }
    }
    this.resize();
    this.draw();
    this.setInfo(this.selectedNode);
    this.game.sfx.click();
  }

  fitWidth() {
    this.ensureLayout();
    // Hide the horizontal scrollbar while measuring so it cannot feed back
    // into its own width and leave a permanent horizontal gutter.
    const wrap = this.treeWrap;
    const overflowX = wrap.style.overflowX;
    wrap.style.overflowX = 'hidden';
    const available = wrap.clientWidth;
    wrap.style.overflowX = overflowX;
    this.viewScale = clamp((available - 4) / this.treeW, 0.3, 1.3);
    this.setZoom(this.viewScale);
  }

  close() {
    this.overlay.classList.add('hidden');
    this.hover = null;
    this.game.sfx.click();
  }

  get isOpen() {
    return !this.overlay.classList.contains('hidden');
  }

  resize() {
    this.ensureLayout();
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scaleX = w / this.treeW;
    this.scaleY = h / this.treeH;
  }

  toTree(e) {
    this.ensureLayout();
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * this.treeW,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * this.treeH,
    };
  }

  ensureLayout() {
    if (!TREE_LAYOUTS.has(this.tree)) TREE_LAYOUTS.set(this.tree, computeTreeLayout(this.tree));
    const layout = TREE_LAYOUTS.get(this.tree);
    for (const node of TECH_NODES) {
      const p = layout.pos.get(node.id);
      if (p) { node.x = p.x; node.y = p.y; }
    }
    this.treeW = layout.width;
    this.treeH = layout.height;
    return layout;
  }

  nodes() {
    return TECH_NODES.filter(n => n.tree === this.tree);
  }

  hitTest(e) {
    const p = this.toTree(e);
    for (const node of this.nodes()) {
      if (Math.abs(p.x - node.x) <= NODE_W / 2 && Math.abs(p.y - node.y) <= NODE_H / 2) {
        return node;
      }
    }
    return null;
  }

  clickNode(node) {
    const game = this.game;
    if (node.kind === 'ball') {
      game.selectBall(node.ball);
      this.close();
      return;
    }
    if (node.kind === 'core') {
      game.toast('The field core is always active.', 'gold');
      return;
    }
    this.selectedNode = node;
    if (game.tech.canBuy(node, game.skill)) game.buyNode(node);
    this.draw();
    this.setInfo(node);
  }

  refresh() {
    this.updateCount();
    this.draw();
  }

  updateCount() {
    const nodes = this.nodes().filter(n => n.cost);
    document.getElementById('treeCount').textContent = nodes.filter(n => this.game.tech.level(n.id)).length + ' / ' + nodes.length + ' upgrades';
  }

  setInfo(node) {
    this.inspected = node;
    if (!node) {
      const hint = 'Click a node to buy. Red links mark permanent choices; teal routes reopen selected rival talents later. Drag/scroll to explore, or fit the tree.';
      this.info.innerHTML = `<div class="ti-head"><span class="muted">${hint}</span></div><div class="ti-desc"></div>`;
      return;
    }
    const game = this.game;
    const tech = game.tech;
    const lvl = tech.level(node.id);
    const maxed = tech.maxed(node);
    const cost = tech.nodeCost(node);
    const reqs = tech.routes(node).map(route => route.map(r => {
      const rn = TECH_BY_ID[r.id];
      const ok = tech.level(r.id) >= r.lvl;
      return `<span class="${ok ? 'req-ok' : 'req-no'}">${rn.name}${r.lvl > 1 ? ' Lv ' + r.lvl : ''}</span>`;
    }).join(' + ')).join(' <span class="muted">or</span> ');

    const blocked = tech.blockedBy(node);
    let status;
    if (node.kind === 'core') status = '<span class="req-ok">Active</span>';
    else if (node.kind === 'ball') {
      status = game.selected === node.ball
        ? '<span class="req-ok">Equipped</span>'
        : '<span class="req-ok">Unlocked — click to equip</span>';
    }
    else if (blocked.length) status = '<span class="req-no">Sealed by ' + blocked.map(id => TECH_BY_ID[id].name).join(', ') + '</span>';
    else if (maxed) status = '<span class="req-ok">Max level</span>';
    else if (!tech.reqsMet(node)) status = `<span class="req-no">Locked</span>${reqs ? ' — needs ' + reqs : ''}`;
    else if (game.skill < cost) status = `<span class="req-no">Need ${cost - game.skill} more \u2726</span>`;
    else status = `<span class="cost">\u2726 ${cost}</span> — ready to buy`;

    const levelTxt = node.maxLevel > 1 ? `<span class="ti-lv">Lv ${lvl}/${node.maxLevel}</span>` : '';

    const choice = (node.excludes || []).map(id => TECH_BY_ID[id].name).join(', ');
    const returns = (node.reopens || []).map(id => TECH_BY_ID[id].name).join(', ');
    const details = (node.tag ? node.tag + ' · ' : '') + (choice ? 'Blocks ' + choice + '. ' : '') +
      (returns ? 'Reopens: ' + returns + '.' : '');
    const buy = node.kind === 'upgrade'
      ? '<button class="btn tiny" data-buy-tech ' + (tech.canBuy(node, game.skill) ? '' : 'disabled') + '>' +
        (choice ? 'Choose ' : 'Purchase ') + node.name + ' · ✦ ' + cost + '</button>' : '';
    this.info.innerHTML =
      `<div class="ti-head"><b>${node.name}</b>${levelTxt}<span class="ti-state">${status}</span></div>` +
      `<div class="ti-desc">${node.desc}</div>` +
      '<div class="ti-actions"><span class="muted">' + details + '</span>' + buy + '</div>';
  }

  draw() {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;
    const layout = this.ensureLayout();
    const treeW = this.treeW;
    const treeH = this.treeH;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);

    // backdrop dots
    ctx.fillStyle = 'rgba(120, 160, 220, 0.07)';
    for (let y = 20; y < treeH; y += 28) {
      for (let x = 20; x < treeW; x += 28) {
        ctx.fillRect(x, y, 1.4, 1.4);
      }
    }

    // branch bands
    for (const band of layout.bands) {
      if (!band.alt) continue;
      roundRectPath(ctx, band.x0, band.y0, band.x1 - band.x0, band.y1 - band.y0, 14);
      ctx.fillStyle = 'rgba(120, 160, 220, 0.035)';
      ctx.fill();
    }

    const tech = this.game.tech;
    const nodes = this.nodes();
    const set = new Set(nodes.map(n => n.id));

    ctx.lineWidth = 2;
    for (const node of nodes) {
      for (const r of node.req) {
        if (!set.has(r.id)) continue;
        const from = TECH_BY_ID[r.id];
        const ok = tech.level(r.id) >= r.lvl;
        const skip = Math.abs(from.x - node.x) > COL_W * 1.01;
        ctx.strokeStyle = ok ? 'rgba(52, 211, 153, 0.45)' : 'rgba(96, 122, 158, 0.22)';
        if (skip) ctx.strokeStyle = ok ? 'rgba(52, 211, 153, 0.2)' : 'rgba(96, 122, 158, 0.14)';
        ctx.beginPath();
        const x1 = from.x + NODE_W / 2;
        const x2 = node.x - NODE_W / 2;
        const mx = (x1 + x2) * 0.5;
        ctx.moveTo(x1, from.y);
        ctx.bezierCurveTo(mx, from.y, mx, node.y, x2, node.y);
        ctx.stroke();
      }
    }
    // Return routes arc over the lanes and only surface when they matter.
    ctx.setLineDash([3, 7]);
    for (const node of nodes) {
      for (const route of node.routes || []) {
        for (const r of route) {
          const from = TECH_BY_ID[r.id];
          if (from.tree !== this.tree) continue;
          const active = tech.level(r.id) > 0;
          const focus = this.hover === node || this.hover === from || this.selectedNode === node || this.selectedNode === from;
          if (!active && !focus) continue;
          ctx.strokeStyle = active || focus ? 'rgba(99,214,208,0.65)' : 'rgba(99,214,208,0.18)';
          ctx.beginPath();
          ctx.moveTo(from.x, from.y - NODE_H / 2);
          ctx.bezierCurveTo(from.x, 12, node.x, 12, node.x, node.y - NODE_H / 2);
          ctx.stroke();
        }
      }
    }

    // Exclusive pairs sit in one column; otherwise link the facing edges.
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(248,113,113,0.34)';
    for (const node of nodes) {
      for (const id of node.excludes || []) {
        const other = TECH_BY_ID[id];
        if (node.id > id || other.tree !== this.tree) continue;
        ctx.beginPath();
        if (Math.abs(node.x - other.x) < 1) {
          const edge = node.x - NODE_W / 2;
          ctx.moveTo(edge - 4, node.y);
          ctx.lineTo(edge - 20, node.y);
          ctx.lineTo(edge - 20, other.y);
          ctx.lineTo(edge - 4, other.y);
        } else {
          const dir = Math.sign(other.x - node.x);
          ctx.moveTo(node.x + dir * (NODE_W / 2 + 4), node.y);
          ctx.lineTo(other.x - dir * (NODE_W / 2 + 4), other.y);
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    for (const node of nodes) this.drawNode(ctx, node);
  }

  drawNode(ctx, node) {
    const game = this.game;
    const tech = game.tech;
    const lvl = tech.level(node.id);
    const maxed = tech.maxed(node);
    const reqsOk = tech.reqsMet(node);
    const cost = tech.nodeCost(node);
    const affordable = game.skill >= cost;
    const hovered = this.hover === node || this.selectedNode === node;
    const blocked = tech.blockedBy(node).length > 0;

    const x = node.x - NODE_W / 2;
    const y = node.y - NODE_H / 2;

    let fill = 'rgba(13, 21, 36, 0.94)';
    let border = 'rgba(66, 88, 120, 0.45)';
    let title = '#c6d4e8';
    let sub = '#7d93b3';

    if (blocked) {
      fill = 'rgba(36, 17, 29, 0.8)';
      border = 'rgba(248, 113, 113, 0.28)';
      title = '#926e80';
      sub = '#dc879a';
    } else if (maxed) {
      fill = 'rgba(10, 36, 29, 0.95)';
      border = 'rgba(52, 211, 153, 0.65)';
      title = '#d9ffef';
      sub = '#7fe3bd';
    } else if (node.tag === 'GATEWAY') {
      fill = 'rgba(12, 38, 41, 0.95)';
      border = 'rgba(99,214,208,0.65)';
      title = '#b7f4ed';
      sub = '#63d6d0';
    } else if (reqsOk) {
      border = affordable ? 'rgba(56, 189, 248, 0.75)' : 'rgba(74, 116, 155, 0.6)';
      title = '#e2ecfa';
      sub = affordable ? '#ffd166' : '#7d93b3';
    }

    if (hovered) {
      fill = maxed ? 'rgba(14, 48, 39, 0.98)' : 'rgba(26, 42, 66, 0.98)';
      border = maxed ? 'rgba(52, 211, 153, 0.9)' : 'rgba(120, 200, 255, 0.9)';
    }

    if (affordable && !maxed && reqsOk && !blocked) {
      ctx.save();
      ctx.shadowColor = 'rgba(56, 189, 248, 0.45)';
      ctx.shadowBlur = 18;
      roundRectPath(ctx, x, y, NODE_W, NODE_H, 12);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    } else {
      roundRectPath(ctx, x, y, NODE_W, NODE_H, 12);
      ctx.fillStyle = fill;
      ctx.fill();
    }

    roundRectPath(ctx, x + 0.5, y + 0.5, NODE_W - 1, NODE_H - 1, 12);
    ctx.strokeStyle = border;
    ctx.lineWidth = hovered ? 2 : 1.4;
    ctx.stroke();

    // icon
    const ix = x + 24;
    const iy = node.y;
    if (node.kind === 'ball') {
      const def = BALL_BY_ID[node.ball];
      const rad = clamp(def.radius * 1.05, 5, 10);
      ctx.save();
      ctx.shadowColor = def.color;
      ctx.shadowBlur = maxed ? 16 : 10;
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(ix, iy, rad, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else if (node.kind === 'core') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(ix, iy, 9, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ix, iy, 3, 0, TAU);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fill();
    } else if (node.form) {
      drawBallForm(ctx, ix, iy, 8, node.form, BALL_BY_ID[node.tree].color);
    } else {
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = maxed ? 'rgba(255, 209, 102, 0.85)' : 'rgba(120, 190, 240, 0.75)';
      ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();
    }

    // title
    ctx.font = '600 13px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = title;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.name, x + 42, node.y - 6);

    // subtitle
    let subText;
    if (node.kind === 'core') subText = 'Active';
    else if (node.kind === 'ball') subText = game.selected === node.id ? 'Equipped' : 'Click to equip';
    else if (blocked) subText = 'Sealed · rival chosen';
    else if (maxed) subText = node.form ? 'Evolved · active' : 'Max level';
    else subText = '\u2726 ' + cost + (node.tag ? ' · ' + node.tag.toLowerCase() : '');
    ctx.font = '500 11px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = sub;
    ctx.fillText(subText, x + 42, node.y + 11);

    // level pips
    if (node.maxLevel > 1) {
      const pw = 7;
      const total = node.maxLevel * pw - 3;
      let px = x + NODE_W - 12 - total;
      const py = node.y + 20;
      for (let i = 0; i < node.maxLevel; i++) {
        ctx.beginPath();
        ctx.arc(px + i * pw, py, 2.3, 0, TAU);
        ctx.fillStyle = i < lvl ? '#ffd166' : 'rgba(140, 170, 220, 0.2)';
        ctx.fill();
      }
    }
  }
}
