'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora', size: 192 });

test('crosswalks only on road tiles', () => {
  let n = 0;
  for (let i = 0; i < w.deco.length; i++) if (w.deco[i]) { n++; assert.strictEqual(w.kind[i], C.K.ROAD); }
  assert.ok(n > 0);
});
test('props exist, are inside the map and never inside buildings', () => {
  const types = new Set();
  const roof = [C.PROP.TANK, C.PROP.ANTENNA, C.PROP.STEEPLE, C.PROP.ROOFPIECE];
  for (const p of w.props) {
    types.add(p.type);
    assert.ok(C.inBounds(w, p.x, p.y));
    if (roof.includes(p.type)) assert.strictEqual(C.kindAt(w, p.x, p.y), C.K.BUILDING); // on rooftops
    else assert.notStrictEqual(C.kindAt(w, p.x, p.y), C.K.BUILDING);
  }
  assert.deepStrictEqual([...types].sort(), Object.values(C.PROP).sort());
});
test('lamps sit on sidewalks and light the ground nearby', () => {
  for (const p of w.props) if (p.type === C.PROP.LAMP) {
    assert.strictEqual(C.kindAt(w, p.x, p.y), C.K.SIDEWALK);
    assert.ok(w.glow[Math.floor(p.y) * w.size + Math.floor(p.x)] > 0);
  }
});
test('props are deterministic per seed', () => {
  assert.deepStrictEqual(C.generateWorld({ seed: 'aurora', size: 192 }).props, w.props);
});

test('wires join two poles that are on the same street', () => {
  assert.ok(w.wires.length > 0);
  for (const s of w.wires) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    assert.ok(len > 8 && len < 14, 'span length ' + len);
    assert.ok(Math.abs(s.x1 - s.x0) < 1e-9 || Math.abs(s.y1 - s.y0) < 1e-9);
  }
});
test('manholes only on plain road tiles', () => {
  let n = 0;
  for (let i = 0; i < w.deco.length; i++) if (w.deco[i] === C.DECO.MANHOLE) { n++; assert.strictEqual(w.kind[i], C.K.ROAD); }
  assert.ok(n > 0);
});
