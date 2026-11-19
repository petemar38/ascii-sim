'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');

const w = C.generateWorld({ seed: 'aurora', size: 128 });

test('same seed gives identical world', () => {
  assert.strictEqual(C.worldHash(C.generateWorld({ seed: 'aurora', size: 128 })), C.worldHash(w));
});
test('different seeds differ', () => {
  assert.notStrictEqual(C.worldHash(C.generateWorld({ seed: 'other', size: 128 })), C.worldHash(w));
});
test('building heights only on building tiles; others are flat', () => {
  for (let i = 0; i < w.size * w.size; i++) {
    if (w.kind[i] === C.K.BUILDING) { assert.ok(w.height[i] > 0); assert.ok(w.bid[i] > 0); }
    else assert.strictEqual(w.height[i], 0);
  }
});
test('spawn is walkable and has a street name', () => {
  assert.ok(C.isWalkable(w, w.spawn.x, w.spawn.y));
  assert.ok(C.locate(w, w.spawn.x, w.spawn.y).street);
});
test('all road tiles are connected', () => {
  const n = w.size, seen = new Uint8Array(n * n), q = [];
  let roads = 0, start = -1;
  for (let i = 0; i < n * n; i++) if (w.kind[i] === C.K.ROAD) { roads++; if (start < 0) start = i; }
  q.push(start); seen[start] = 1; let c = 1;
  while (q.length) {
    const i = q.pop(), x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (!seen[j] && w.kind[j] === C.K.ROAD) { seen[j] = 1; c++; q.push(j); }
    }
  }
  assert.strictEqual(c, roads);
});
