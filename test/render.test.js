'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora' });

function shot(time) { const cam = C.createCamera(w), f = C.createFrame(80, 30); C.render(f, w, cam, { time }); return f; }

test('frame has right size and printable ASCII only', () => {
  const f = shot(12);
  assert.strictEqual(f.ch.length, 80 * 30);
  for (const c of f.ch) assert.ok(c >= 32 && c <= 126);
  assert.strictEqual(C.frameRows(f).length, 30);
});
test('rendering is deterministic', () => {
  assert.strictEqual(C.frameHash(shot(21)), C.frameHash(shot(21)));
});
test('day and night differ', () => {
  assert.notStrictEqual(C.frameHash(shot(12)), C.frameHash(shot(23)));
});

test('rendering is seamless: a camera one map-width away sees exactly the same frame', () => {
  for (const [x, y, a] of [[2.5, 40.5, Math.PI], [w.size - 2.5, 100.5, 0], [60.5, 1.5, -Math.PI / 2], [30.5, w.size - 1.5, Math.PI / 2]]) {
    const f1 = C.createFrame(90, 30), f2 = C.createFrame(90, 30);
    C.render(f1, w, { x, y, angle: a, pitch: 0.06, eyeZ: 0.21 }, { time: 21 });
    C.render(f2, w, { x: x + w.size, y: y - w.size, angle: a, pitch: 0.06, eyeZ: 0.21 }, { time: 21 });
    assert.strictEqual(C.frameHash(f1), C.frameHash(f2));
  }
});
test('the view across the seam is continuous: stepping over it changes the frame only slightly', () => {
  const cam = { x: w.size - 0.3, y: 40.5, angle: 0, pitch: 0.06, eyeZ: 0.21 };
  const before = C.createFrame(90, 30), after = C.createFrame(90, 30);
  C.render(before, w, cam, { time: 12 });
  C.stepCamera(w, cam, { forward: 1, strafe: 0, turn: 0, look: 0 }, 0.1, false); // 0.32 tiles: crosses x = size
  assert.ok(cam.x < 1, 'camera should have wrapped to the west edge, got ' + cam.x);
  C.render(after, w, cam, { time: 12 });
  let diff = 0;
  for (let i = 0; i < before.ch.length; i++) if (before.ch[i] !== after.ch[i]) diff++;
  assert.ok(diff < before.ch.length * 0.45, 'frame jumped across the seam: ' + diff + ' of ' + before.ch.length + ' cells changed');
});
