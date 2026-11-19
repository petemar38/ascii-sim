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
