'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora', size: 192 });

const OPEN = (k) => k === C.K.SIDEWALK || k === C.K.ROAD || k === C.K.PLAZA;
const DIR = { [C.FACE.N]: [0, -1], [C.FACE.S]: [0, 1], [C.FACE.W]: [-1, 0], [C.FACE.E]: [1, 0] };

test('there is a good variety of stores and every kind of public building', () => {
  const kinds = new Set(w.stores.map((s) => s.kind));
  for (const k of Object.values(C.STORE)) assert.ok(kinds.has(k), 'no store of kind ' + C.STORE_SIGN[k]);
  assert.ok(w.stores.length > 40);
});
test('signs fit on a facade (8 characters at most) and are upper case letters', () => {
  for (const s of w.stores) { assert.ok(s.sign.length >= 3 && s.sign.length <= 8); assert.match(s.sign, /^[A-Z]+$/); }
});
test('every storefront is on a building tile whose front faces open ground', () => {
  for (const s of w.stores) {
    const tx = Math.floor(s.x), ty = Math.floor(s.y), n = w.size;
    const t = ty * n + tx;
    assert.strictEqual(w.kind[t], C.K.BUILDING);
    assert.strictEqual(w.shops.get(t), s);
    const [dx, dy] = DIR[s.face];
    const front = w.kind[(((ty + dy) % n + n) % n) * n + (((tx + dx) % n + n) % n)];
    assert.ok(OPEN(front), s.name + ' faces ' + front);
  }
});
test('a church gets a steeple on its roof', () => {
  const churches = w.stores.filter((s) => s.kind === C.STORE.CHURCH);
  assert.ok(churches.length >= 3);
  assert.ok(w.props.filter((p) => p.type === C.PROP.STEEPLE).length === churches.length);
});
test('stores are deterministic per seed', () => {
  const again = C.generateWorld({ seed: 'aurora', size: 192 });
  assert.deepStrictEqual(again.stores.map((s) => [s.name, s.x, s.y, s.face]), w.stores.map((s) => [s.name, s.x, s.y, s.face]));
});
test('standing in front of a store you can read its sign', () => {
  let read = 0;
  for (const s of w.stores) {
    if (s.sign.length < 4) continue;
    const [dx, dy] = DIR[s.face];
    const cam = { x: s.x + dx * 4, y: s.y + dy * 4, angle: Math.atan2(-dy, -dx), pitch: 0.06, eyeZ: 0.21 };
    if (!C.canStand(w, cam.x, cam.y)) continue;
    const f = C.createFrame(150, 44);
    C.render(f, w, cam, { time: 12 });
    const text = C.frameRows(f).join('\n');
    const re = new RegExp(s.sign.split('').map((c) => c + '+').join('[^A-Z\\n]{0,8}'));
    assert.match(text, re, 'could not read the ' + s.name + ' sign');
    if (++read >= 12) break;
  }
  assert.ok(read >= 8);
});
