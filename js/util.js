'use strict';

// Every core stays a circle. Evolutions decorate its surface and wake.
function drawBallForm(ctx, x, y, radius, form, color, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(0.65, radius * 0.12);
  const evolved = ['winter', 'comet', 'worldbreaker', 'titan', 'tempest', 'lightspeed'].includes(form);
  if (['glacier', 'winter', 'hail', 'comet'].includes(form)) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.72, 0.3, 4.7);
    ctx.stroke();
    ctx.fillStyle = '#e4faff';
    ctx.beginPath();
    ctx.arc(radius * 0.25, radius * 0.15, radius * 0.22, 0, TAU);
    ctx.fill();
  } else if (['tectonic', 'worldbreaker', 'obelisk', 'titan'].includes(form)) {
    ctx.strokeStyle = 'rgba(75,49,30,0.65)';
    ctx.lineWidth = Math.max(1, radius * 0.18);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.62, 0.2, 2.8);
    ctx.arc(0, 0, radius * 0.35, 3.2, 5.6);
    ctx.stroke();
  } else if (form !== 'seed') {
    ctx.strokeStyle = '#f5e9ff';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.65, -0.4, 2);
    ctx.arc(0, 0, radius * 0.42, 2.4, 4.7);
    ctx.stroke();
  }
  if (evolved) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.7, radius * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.28, 0, TAU);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.beginPath();
  ctx.arc(-radius * 0.28, -radius * 0.3, radius * 0.24, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function ballTrailStyle(b) {
  if (b.rules && b.rules.trailStyle) return b.rules.trailStyle;
  if (['glacier', 'winter'].includes(b.form)) return 'snow';
  if (['hail', 'comet'].includes(b.form)) return 'twin';
  if (['tectonic', 'worldbreaker', 'obelisk', 'titan'].includes(b.form)) return 'dust';
  if (['storm', 'tempest'].includes(b.form)) return 'ion';
  if (['rail', 'lightspeed'].includes(b.form)) return 'ribbon';
  return 'soft';
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
