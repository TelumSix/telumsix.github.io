import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let wallTime = 0;
class Param {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ kind: 'set', value, time }); }
  exponentialRampToValueAtTime(value, time) { this.events.push({ kind: 'ramp', value, time }); }
  setTargetAtTime(value, time) { this.value = value; this.events.push({ kind: 'target', value, time }); }
  cancelScheduledValues() {}
}
class Node {
  constructor(ctx) {
    this.ctx = ctx;
    this.connections = [];
    for (const key of ['gain', 'frequency', 'Q', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release'])
      this[key] = new Param();
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; }
  start(time) { this.startTime = time; }
  stop(time = this.ctx.currentTime) { this.stopTime = time; }
}
class AudioContext {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.nodes = []; this.oscillators = []; }
  node() { const node = new Node(this); this.nodes.push(node); return node; }
  createGain() { return this.node(); }
  createBiquadFilter() { return this.node(); }
  createDynamicsCompressor() { return this.node(); }
  createDelay() { return this.node(); }
  createOscillator() { const node = this.node(); this.oscillators.push(node); return node; }
  resume() { return Promise.resolve(); }
  advance(seconds) {
    this.currentTime += seconds;
    wallTime += seconds * 1000;
    for (const osc of this.oscillators) if (!osc.finished && osc.stopTime <= this.currentTime) {
      osc.finished = true;
      osc.onended?.();
    }
  }
}
const saved = new Map();
const context = vm.createContext({
  console, performance: { now: () => wallTime }, window: { AudioContext },
  localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
});
for (const file of ['js/util.js', 'js/config.js', 'js/sfx.js'])
  vm.runInContext(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
const Sfx = vm.runInContext('Sfx', context);
const sound = new Sfx();
sound.ensure();
assert.equal(sound.filter.type, 'lowpass');
assert.ok(sound.compressor.ratio.value >= 4, 'dense mixes pass through a compressor');
assert.equal(sound.delay.connections[0], sound.wet);
assert.ok(!sound.wet.connections.includes(sound.delay), 'delay has no feedback build-up');

for (let frame = 0; frame < 600; frame++) {
  for (let i = 0; i < 100; i++) { sound.hit(); sound.wall(); sound.bounce(); }
  sound.update();
  if (frame % 7 === 0) sound.explode(true);
  if (frame % 19 === 0) sound.shoot({ id: 'drift' });
  if (frame % 45 === 0) sound.shard();
  if (frame % 60 === 0) sound.buy();
  assert.ok(sound.voices.size <= 12, 'polyphony has a hard ceiling');
  sound.ctx.advance(1 / 60);
}
assert.ok(sound.ctx.oscillators.length < 220, '60,000 impacts are coalesced into a small ensemble');
for (const osc of sound.ctx.oscillators) {
  assert.ok(['sine', 'triangle'].includes(osc.type), 'no harsh square or saw voices');
  assert.ok(osc.frequency.events[0].value <= 660, 'busy scenes never climb into shrill registers');
  const envelope = osc.connections[0].gain.events;
  assert.equal(envelope[0].value, 0.0001, 'voices start quietly');
  assert.ok(envelope[1].time > envelope[0].time, 'every voice has a soft attack');
}
sound.setVolume('master', 0);
assert.equal(sound.master.gain.value, 0, 'zero master volume is respected');
sound.setVolume('fx', 0.4);
assert.equal(sound.fxBus.gain.value, 0.4);
sound.setEnabled(false);
assert.equal(sound.voices.size, 0, 'muting clears scheduled and active notes');
const count = sound.ctx.oscillators.length;
sound.buy(); sound.hit(); sound.wall(); sound.shard(); sound.win(); sound.update();
assert.equal(sound.ctx.oscillators.length, count, 'muted events cannot create new voices');
sound.setEnabled(true);
sound.setVolume('master', 0.3);
sound.ctx.advance(2);
assert.ok(sound.ctx.oscillators.every(osc => osc.disconnected), 'finished voices release their nodes');
const restored = new Sfx();
assert.equal(restored.volumes.master, 0.3);
assert.equal(restored.volumes.fx, 0.4);
console.log('OK — dense audio mix, harmonic registers, soft envelopes, voice cleanup, mute and mixer persistence');
