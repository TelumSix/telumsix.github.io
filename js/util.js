'use strict';

// Shared silhouettes for the field, cached sprites, and evolution previews.
function drawBallForm(ctx, x, y, radius, form, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, radius * 0.2);
  const polygon = (points, outer, inner = outer) => {
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const a = i * TAU / points;
      const r = i % 2 ? inner : outer;
      if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  };
  const evolved = ['winter', 'comet', 'worldbreaker', 'titan', 'tempest', 'lightspeed'].includes(form);
  if (form === 'glacier' || form === 'winter') polygon(12, radius * 1.25, radius * 0.48);
  else if (['hail', 'comet', 'rail', 'lightspeed'].includes(form)) {
    ctx.beginPath();
    ctx.moveTo(radius * 1.6, 0);
    ctx.lineTo(-radius * 0.7, -radius * 0.65);
    ctx.lineTo(-radius * 0.2, 0);
    ctx.lineTo(-radius * 0.7, radius * 0.65);
    ctx.closePath();
    ctx.fill();
    if (evolved) {
      ctx.beginPath();
      ctx.moveTo(-radius, -radius * 0.5); ctx.lineTo(-radius * 2.4, -radius * 0.8);
      ctx.moveTo(-radius, radius * 0.5); ctx.lineTo(-radius * 2.4, radius * 0.8);
      ctx.stroke();
    }
  } else if (['tectonic', 'worldbreaker', 'obelisk', 'titan'].includes(form)) {
    polygon(form === 'obelisk' || form === 'titan' ? 4 : 6, radius * 1.1);
    ctx.strokeStyle = '#51443c';
    ctx.beginPath();
    ctx.moveTo(-radius * 0.5, -radius * 0.1);
    ctx.lineTo(0, radius * 0.3);
    ctx.lineTo(radius * 0.55, -radius * 0.4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.15, 0.3, TAU - 0.3);
    ctx.stroke();
  }
  if (evolved) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.8, radius * 0.12);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.65, radius * 1.25, 0.5, 0, TAU);
    ctx.stroke();
    if (form === 'worldbreaker') {
      ctx.fillRect(-radius * 1.8, -radius * 0.4, radius * 0.45, radius * 0.7);
      ctx.fillRect(radius * 1.4, -radius * 0.4, radius * 0.45, radius * 0.7);
    }
  }
  ctx.restore();
}

const TAU = Math.PI * 2;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function lerp(a, b, t) { return a + (b - a) * t; }

function mulberry32(a) {
  a |= 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmtInt = new Intl.NumberFormat('en-US');
function formatNum(n) { return fmtInt.format(Math.max(0, Math.round(n))); }

function plural(n, word) {
  return formatNum(n) + ' ' + word + (Math.round(n) === 1 ? '' : 's');
}

function formatCompact(n) {
  if (n >= 1e15) return (n / 1e15).toFixed(1).replace(/\.0$/, '') + 'Qa';
  if (n >= 1e12) return (n / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  return formatNum(n);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function b64encode(bytes) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function b64decode(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deflateBytes(bytes) {
  if (typeof CompressionStream === 'undefined') throw new Error('CompressionStream unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
