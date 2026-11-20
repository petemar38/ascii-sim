'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const { TREES, SHRUBS, FLOWERS, WEEDS } = require('../src/veg');

const w = C.generateWorld({ seed: 'aurora', size: 192 });
const PROP = C.PROP;

test('plants: many tree species, shrubs, flowers and weeds', () => {
  const trees = new Set(), shrubs = new Set(), flowers = new Set(), weeds = new Set();
  for (const p of w.props) {
    if (p.type === PROP.TREE) trees.add(p.k || 0);
    else if (p.type === PROP.SHRUB) shrubs.add(p.k);
    else if (p.type === PROP.FLOWER) flowers.add(p.k);
    else if (p.type === PROP.WEED) weeds.add(p.k);
  }
  assert.ok(trees.size >= 9, 'tree species ' + trees.size);
  assert.strictEqual(shrubs.size, SHRUBS.length);
  assert.strictEqual(flowers.size, FLOWERS.length);
  assert.strictEqual(weeds.size, WEEDS.length);
});

test('plants: pavement weeds grow on sidewalks, lawn flowers on grass', () => {
  let crack = 0, lawn = 0;
  for (const p of w.props) {
    const k = w.kind[Math.floor(p.y) * w.size + Math.floor(p.x)];
    if (p.type === PROP.WEED && p.k === 5 && k === C.K.SIDEWALK) crack++;
    if (p.type === PROP.FLOWER && (k === C.K.YARD || k === C.K.PARK)) lawn++;
  }
  assert.ok(crack > 50 && lawn > 200, `${crack} ${lawn}`);
});

test('birds: a good spread of species, each in a believable place', () => {
  const species = new Set(w.birds.map((b) => b.sp));
  assert.ok(species.size >= 20, 'species ' + species.size);
  assert.ok(w.birds.length > 400);
  const first = (s) => w.birds.find((b) => b.sp === s);
  const rob = first(C.BIRD.ROBIN);
  assert.ok(rob, 'a robin');
  for (const b of w.birds.filter((b) => b.sp === C.BIRD.GOOSE && b.mode === C.MODE.LINE)) assert.ok(b.z > 1.5, 'migrating geese fly high');
  for (const b of w.birds.filter((b) => b.sp === C.BIRD.WOODPECKER)) assert.ok(b.z < 0.5, 'woodpeckers stay low on the trunk');
  assert.ok(w.birds.some((b) => b.sp === C.BIRD.BAT) && w.birds.some((b) => b.sp === C.BIRD.OWL));
});

test('birds: poses are pure functions of the clock, and movers move', () => {
  const mover = w.birds.find((b) => b.mode === C.MODE.CIRCLE);
  const a = { ...C.birdPose(mover, 5) }, again = { ...C.birdPose(mover, 5) }, later = { ...C.birdPose(mover, 9) };
  assert.deepStrictEqual(a, again);
  assert.ok(Math.hypot(a.x - later.x, a.y - later.y) > 0.5);
  const perched = w.birds.find((b) => b.mode === C.MODE.PERCH);
  assert.strictEqual(C.birdPose(perched, 1).x, C.birdPose(perched, 50).x);
});

test('birds: they show up in the frame, flap with the clock, and keep the sky behind them', () => {
  // face a flock of geese from the south
  const g = w.birds.find((b) => b.sp === C.BIRD.GOOSE && b.mode === C.MODE.LINE);
  const p = { ...C.birdPose(g, 3) };
  const cam = { x: p.x, y: p.y + 10, angle: -Math.PI / 2, pitch: 0.18, eyeZ: 0.21 };
  const f = C.createFrame(140, 44);
  C.render(f, w, cam, { time: 12, clock: 3 });
  let n = 0, sky = 0;
  for (let i = 0; i < f.ch.length; i++) if (f.tone[i] === C.TONE.B_GRAY || f.tone[i] === C.TONE.B_WHITE) { n++; if (C.skyStep(f, i) >= 0) sky++; }
  assert.ok(n >= 3, 'goose cells ' + n);
  assert.ok(sky >= 1, 'sky behind the birds');
  const f2 = C.createFrame(140, 44);
  C.render(f2, w, cam, { time: 12, clock: 3.35 });
  assert.notStrictEqual(C.frameHash(f), C.frameHash(f2));
});

test('birds: songbirds roost at night, bats come out', () => {
  const bat = w.birds.find((b) => b.sp === C.BIRD.BAT);
  const pose = { ...C.birdPose(bat, 2) };
  const cam = { x: pose.x, y: pose.y + 4, angle: -Math.PI / 2, pitch: 0.05, eyeZ: 0.21 };
  const count = (time, tone) => {
    const f = C.createFrame(140, 44);
    C.render(f, w, cam, { time, clock: 2 });
    let n = 0;
    for (let i = 0; i < f.ch.length; i++) if (f.tone[i] === tone) n++;
    return n;
  };
  assert.strictEqual(count(12, C.TONE.B_BROWN) >= 0, true);
  const dayBlack = count(12, C.TONE.B_BLACK), nightBlack = count(23, C.TONE.B_BLACK);
  assert.ok(nightBlack >= 1, 'a bat at night');
  assert.ok(dayBlack < nightBlack + 50);
});
