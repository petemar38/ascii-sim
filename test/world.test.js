'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');

const w = C.generateWorld({ seed: 'aurora', size: 192 });

test('same seed gives identical world', () => {
  assert.strictEqual(C.worldHash(C.generateWorld({ seed: 'aurora', size: 192 })), C.worldHash(w));
});
test('different seeds differ', () => {
  assert.notStrictEqual(C.worldHash(C.generateWorld({ seed: 'other', size: 192 })), C.worldHash(w));
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
test('all road tiles are connected (the map wraps, so roads connect through the seam)', () => {
  const n = w.size, seen = new Uint8Array(n * n), q = [];
  let roads = 0, start = -1;
  for (let i = 0; i < n * n; i++) if (w.kind[i] === C.K.ROAD) { roads++; if (start < 0) start = i; }
  q.push(start); seen[start] = 1; let c = 1;
  while (q.length) {
    const i = q.pop(), x = i % n, y = (i / n) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
      if (!seen[j] && w.kind[j] === C.K.ROAD) { seen[j] = 1; c++; q.push(j); }
    }
  }
  assert.strictEqual(c, roads);
});

/* ---- wrap-around (torus) ---- */
test('lookups wrap: a point and the same point one map-width away are identical', () => {
  for (const [x, y] of [[3.2, 5.5], [100.5, 60.1], [191.9, 0.1]]) {
    assert.strictEqual(C.heightAt(w, x, y), C.heightAt(w, x + w.size, y - w.size));
    assert.strictEqual(C.kindAt(w, x, y), C.kindAt(w, x - 2 * w.size, y));
    assert.strictEqual(C.isWalkable(w, x, y), C.isWalkable(w, x, y + 3 * w.size));
  }
});
test('streets and blocks line up across the seam: no road dead-ends against it', () => {
  const n = w.size;
  const at = (x, y) => w.kind[((y + n) % n) * n + ((x + n) % n)];
  for (let i = 0; i < n; i++) {
    // a road tile on one side of the seam must continue as road, sidewalk or intersection on the other
    if (at(0, i) === C.K.ROAD && at(n - 1, i) !== C.K.ROAD) assert.ok(at(n - 1, i) !== C.K.BUILDING, 'building against road at x seam, y=' + i);
    if (at(i, 0) === C.K.ROAD && at(i, n - 1) !== C.K.ROAD) assert.ok(at(i, n - 1) !== C.K.BUILDING, 'building against road at y seam, x=' + i);
  }
});
test('the seam is quiet: nothing taller than a few floors within 10 tiles of it', () => {
  const n = w.size;
  let tallest = 0;
  for (let y = 0; y < n; y++) for (let d = -10; d <= 10; d++) tallest = Math.max(tallest, w.height[y * n + ((d + n) % n)], w.height[((d + n) % n) * n + y]);
  assert.ok(tallest <= 12, 'tallest building near the seam is ' + tallest);
});
test('wrap can be turned off for a walled map', () => {
  const walled = C.generateWorld({ seed: 'aurora', size: 192, wrap: false });
  assert.strictEqual(C.isWalkable(walled, -1, 5), false);
  assert.strictEqual(C.heightAt(walled, -1, 5) > 0, true);
  assert.strictEqual(C.worldHash(walled), C.worldHash(w)); // same city, only the edge behaviour differs
});
test('buildings come in all sizes: narrow and wide, short and tall, in every kind of district', () => {
  const n = w.size, seen = new Set(), dims = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, id = w.bid[i];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (x === 0 || y === 0) continue; // skip lots that wrap round the seam
    let wd = 0, dp = 0;
    while (w.bid[y * n + (x + wd) % n] === id) wd++;
    while (w.bid[((y + dp) % n) * n + x] === id) dp++;
    dims.push({ wd, dp, h: w.height[i], d: w.district[i] });
  }
  const has = (f) => dims.filter(f).length;
  assert.ok(has((b) => b.wd <= 2) >= 30, 'few narrow buildings');
  assert.ok(has((b) => b.wd >= 7) >= 15, 'few wide buildings');
  assert.ok(has((b) => b.dp >= 7) >= 10, 'few deep buildings');
  assert.ok(has((b) => b.h === 1) >= 30, 'few single-storey buildings');
  assert.ok(has((b) => b.h >= 12) >= 20, 'few high-rises');
  const types = new Set(w.district);
  // a tower somewhere outside downtown, and a low building right in the middle of downtown
  assert.ok(has((b) => b.d !== 0 && b.h >= 12) >= 3, 'no towers outside downtown');
  assert.ok(has((b) => b.d === 0 && b.h <= 4) >= 3, 'no low buildings downtown');
  assert.ok(types.size > 1);
});
