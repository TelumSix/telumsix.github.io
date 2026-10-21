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
    for (const r of node.req) {
      if (this.level(r.id) < r.lvl) return false;
    }
    return true;
  }

  maxed(node) {
    return this.level(node.id) >= node.maxLevel;
  }

  blockedBy(node, seen = new Set()) {
    if (seen.has(node.id)) return [];
    seen.add(node.id);
    const blocked = (node.excludes || []).filter(id => this.level(id) > 0);
    for (const req of node.req) blocked.push(...this.blockedBy(TECH_BY_ID[req.id], seen));
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
      damageBonus: L('damage') + 3 * L('focused'),
      yieldMult: 1 + 0.15 * L('yield'),
      volley: 1 + L('volley'),
      costMult: Math.pow(0.92, L('discount')),
      bounty: L('bounty'),
      streakEvery: L('momentum') ? 44 - 8 * L('momentum') : 0,
      harvestEvery: L('sustain') ? 52 - 12 * L('sustain') : 0,
      statusDuration: 2 * L('duration') + 2 * L('balance'),
      reactionYield: 2 * L('salvage') + 5 * L('balance'),
      lattice: L('lattice') * 2,
      convergence: L('convergence') * 6,
      echo: L('echo'),
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
        else s[key] = (s[key] || 0) + value * rank;
      }
      if (node.form) s.form = node.form;
    }
    s.freezeEvery = s.freezeEvery ? Math.max(1, s.freezeEvery - s.freezeRate) : 0;
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

const TREE_W = 1640;
const TREE_H = 760;
const NODE_W = 184;
const NODE_H = 62;

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
    this.bind();
  }

  bind() {
    this.info.addEventListener('click', e => {
      if (e.target.closest('[data-buy-tech]') && this.inspected) {
        this.game.buyNode(this.inspected);
        this.draw();
        this.setInfo(this.inspected);
        this.updateNodeSelect();
      }
    });
    document.getElementById('techNodeSelect').addEventListener('change', e => {
      const node = TECH_BY_ID[e.target.value];
      if (node) this.clickNode(node);
    });
    this.canvas.addEventListener('pointermove', (e) => {
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
      e.preventDefault();
      const hit = this.hitTest(e);
      if (hit) this.clickNode(hit);
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
    this.updateNodeSelect();
  }

  updateNodeSelect() {
    const select = document.getElementById('techNodeSelect');
    select.innerHTML = '<option value="">Inspect an upgrade…</option>' + this.nodes().map(n => {
      const state = this.game.tech.blockedBy(n).length ? 'sealed' : this.game.tech.maxed(n) ? 'owned' : this.game.tech.reqsMet(n) ? 'available' : 'locked';
      return '<option value="' + n.id + '">' + n.name + ' · ' + state + '</option>';
    }).join('');
    if (this.selectedNode) select.value = this.selectedNode.id;
  }

  open() {
    this.overlay.classList.remove('hidden');
    this.updateTabs();
    this.resize();
    this.draw();
    this.setInfo(this.selectedNode);
    this.game.sfx.click();
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
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scaleX = w / TREE_W;
    this.scaleY = h / TREE_H;
  }

  toTree(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * TREE_W,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * TREE_H,
    };
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
    this.draw();
    this.setInfo(node);
    document.getElementById('techNodeSelect').value = node.id;
  }

  refresh() {
    this.draw();
  }

  setInfo(node) {
    this.inspected = node;
    if (!node) {
      const hint = 'Select a node, then purchase below. Specializations seal their rival branch. Scroll to explore.';
      this.info.innerHTML = `<div class="ti-head"><span class="muted">${hint}</span></div><div class="ti-desc"></div>`;
      return;
    }
    const game = this.game;
    const tech = game.tech;
    const lvl = tech.level(node.id);
    const maxed = tech.maxed(node);
    const cost = tech.nodeCost(node);
    const reqs = node.req.map(r => {
      const rn = TECH_BY_ID[r.id];
      const ok = tech.level(r.id) >= r.lvl;
      return `<span class="${ok ? 'req-ok' : 'req-no'}">${rn.name}${r.lvl > 1 ? ' Lv ' + r.lvl : ''}</span>`;
    }).join(' · ');

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
    const details = (node.tag ? node.tag + ' · ' : '') + (choice ? 'Permanently blocks ' + choice + '. ' : '');
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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);

    // backdrop dots
    ctx.fillStyle = 'rgba(120, 160, 220, 0.07)';
    for (let y = 20; y < TREE_H; y += 28) {
      for (let x = 20; x < TREE_W; x += 28) {
        ctx.fillRect(x, y, 1.4, 1.4);
      }
    }

    const tech = this.game.tech;
    const nodes = this.nodes();
    const set = new Set(nodes.map(n => n.id));
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = '#7d93b3';
    ctx.textAlign = 'left';
    ctx.fillText('FOUNDATIONS', 250, 40);
    ctx.fillText('CHOOSE ONE PATH', 470, 40);
    ctx.fillText('SPECIALIZE & COMBINE', 720, 40);
    ctx.fillText('EVOLUTION', 1200, 40);
    ctx.fillText('CROSS-BALL SYNERGY', 1420, 40);

    ctx.lineWidth = 2;
    for (const node of nodes) {
      for (const r of node.req) {
        if (!set.has(r.id)) continue;
        const from = TECH_BY_ID[r.id];
        const ok = tech.level(r.id) >= r.lvl;
        const x1 = from.x + NODE_W / 2;
        const y1 = from.y;
        const x2 = node.x - NODE_W / 2;
        const y2 = node.y;
        const mx = (x1 + x2) * 0.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
        ctx.strokeStyle = ok ? 'rgba(52, 211, 153, 0.45)' : 'rgba(96, 122, 158, 0.22)';
        ctx.stroke();
      }
    }

    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(248,113,113,0.5)';
    for (const node of nodes) {
      for (const id of node.excludes || []) {
        const other = TECH_BY_ID[id];
        if (node.id > id || other.tree !== this.tree) continue;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y + NODE_H / 2);
        ctx.lineTo(other.x, other.y - NODE_H / 2);
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
    } else {
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = maxed ? 'rgba(255, 209, 102, 0.85)' : 'rgba(120, 190, 240, 0.75)';
      ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();
    }
    if (node.form) drawBallForm(ctx, ix, iy, 8, node.form, BALL_BY_ID[node.tree].color);

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
