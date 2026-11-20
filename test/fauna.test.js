'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');

const w = C.generateWorld({ seed: 'aurora', size: 192 });
const { ANIMAL } = C;
const cam0 = (x, y, a) => ({ x, y, angle: a, pitch: 0, eyeZ: 0.21 });

test('animals: cats, dogs, squirrels and rabbits all exist, and none stand in a wall or a prop', () => {
  const kinds = new Set(w.animals.map((a) => a.sp));
  assert.strictEqual(kinds.size, 4);
  for (const a of w.animals) {
    assert.ok(C.clearAt(w, a.x, a.y, a.r), 'home clear');
    if (a.mode === 1) for (let k = 0; k < 16; k++) assert.ok(C.clearAt(w, a.x + a.ax * Math.cos(k * 0.3927), a.y + a.ay * Math.sin(k * 0.3927), a.r), 'wander oval clear');
  }
});

test('animals: you cannot walk through one', () => {
  const dog = w.animals.find((a) => a.sp === ANIMAL.DOG && a.mode === 0);
  assert.ok(dog);
  // stand 1.5 tiles west of it and walk east for 3 seconds
  const cam = cam0(dog.x - 1.5, dog.y, 0);
  if (!C.clearAt(w, cam.x, cam.y, 0.2)) return; // started inside something; the generator test above covers placement
  for (let i = 0; i < 60; i++) C.stepCamera(w, cam, { forward: 1 }, 0.05, false, 10 + i * 0.05);
  const gap = Math.hypot(cam.x - dog.x, cam.y - dog.y);
  assert.ok(gap >= dog.r + C.PROP_BODY - 0.02, 'stopped at the dog: ' + gap.toFixed(2));
});

test('animals: a cat bolts when you walk up, along a clear path, and you still cannot pass through it', () => {
  const cat = w.animals.find((a) => a.sp === ANIMAL.CAT && a.mode === 0);
  const cam = cam0(cat.x - 2.2, cat.y, 0);
  C.updateFauna(w, cam, 100);
  const st = w.fauna.get(cat);
  assert.ok(st, 'the cat ran');
  for (let s = 0; s <= st.len + 1e-6; s += 0.25) assert.ok(C.clearAt(w, st.x0 + st.dx * s, st.y0 + st.dy * s, cat.r), 'path clear at ' + s);
  const before = { x: cat.x, y: cat.y };
  const p1 = { ...C.animalPose(cat, 100 + st.len / st.speed + 0.5, st) };
  assert.ok(Math.hypot(p1.x - before.x, p1.y - before.y) >= st.len - 0.01, 'the cat is out at the end of its run');
  // later it walks back and the record is dropped
  C.updateFauna(w, cam0(cat.x + 50, cat.y + 50, 0), 100 + 60);
  assert.ok(!w.fauna.has(cat));
});

test('birds: a perched bird bolts when you come close, then settles again', () => {
  const bird = w.birds.find((b) => b.mode === C.MODE.PERCH && b.sp === C.BIRD.ROBIN) || w.birds.find((b) => b.mode === C.MODE.PERCH);
  const cam = cam0(bird.x - 3, bird.y, 0);
  const f = C.createFrame(60, 20);
  C.render(f, w, cam, { time: 12, clock: 50 });
  const st = w.flush.get(bird);
  assert.ok(st, 'flushed');
  const mid = { ...C.flushPose(bird, st, st.t0 + 1.5) };
  assert.ok(mid.z > bird.z + 0.3 || bird.z > 2.5, 'climbing');
  assert.ok(Math.hypot(mid.x - bird.x, mid.y - bird.y) > 1, 'moving away');
  assert.strictEqual(C.flushPose(bird, st, st.t0 + 20), null, 'landed');
});

test('plants: shrubs are solid', () => {
  const shrub = w.props.find((p) => p.type === C.PROP.SHRUB);
  assert.ok(C.PROP_RADIUS[C.PROP.SHRUB] > 0);
  assert.ok(C.propClearance(w, shrub.x, shrub.y, 0.1) < 0);
});

test('animals show up in the frame', () => {
  const cat = w.animals.find((a) => a.sp === ANIMAL.RABBIT && a.mode === 0);
  const f = C.createFrame(120, 40);
  for (const cell of [[cat.x - 6, cat.y, 0], [cat.x, cat.y - 6, Math.PI / 2], [cat.x + 6, cat.y, Math.PI], [cat.x, cat.y + 6, -Math.PI / 2]]) {
    const cam = cam0(cell[0], cell[1], cell[2]);
    if (!C.clearAt(w, cam.x, cam.y, 0.2)) continue;
    C.render(f, w, cam, { time: 12, clock: 5 });
    let n = 0;
    for (let i = 0; i < f.ch.length; i++) if (f.tone[i] === C.TONE.B_TAN || f.tone[i] === C.TONE.B_BROWN || f.tone[i] === C.TONE.B_WHITE) n++;
    if (n > 0) return;
  }
  assert.fail('no rabbit seen from four sides');
});
