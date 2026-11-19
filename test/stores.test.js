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

test('every kind of shop has its own look (facade signatures are all different)', () => {
  const { shopCell } = require('../src/facade');
  const sig = (kind, center, fl) => {
    let s = '';
    for (let vi = 0; vi < 24; vi++) for (let ui = 0; ui < 24; ui++) s += shopCell(kind, center, (ui + 0.5) / 24, (vi + 0.5) / 24, fl) + ',' + shopCell.glass + ';';
    return s;
  };
  const seen = new Map();
  for (const k of Object.values(C.STORE)) {
    const s = sig(k, true, 0) + '|' + sig(k, false, 0) + '|' + sig(k, true, 1);
    assert.ok(!seen.has(s), C.STORE_SIGN[k] + ' looks identical to ' + seen.get(s));
    seen.set(s, C.STORE_SIGN[k]);
  }
  // and they are not just minor variations: each pair differs in a meaningful share of cells
  const kinds = Object.values(C.STORE);
  for (let a = 0; a < kinds.length; a++) for (let b = a + 1; b < kinds.length; b++) {
    let diff = 0;
    for (let vi = 0; vi < 20; vi++) for (let ui = 0; ui < 20; ui++) {
      const u = (ui + 0.5) / 20, v = (vi + 0.5) / 20;
      const ga = shopCell(kinds[a], true, u, v, 0) + '/' + shopCell.glass;
      const gb = shopCell(kinds[b], true, u, v, 0) + '/' + shopCell.glass;
      if (ga !== gb) diff++;
    }
    assert.ok(diff >= 20, C.STORE_SIGN[kinds[a]] + ' and ' + C.STORE_SIGN[kinds[b]] + ' differ in only ' + diff + ' of 400 cells');
  }
});
test('the whole street wall of a shop is a storefront, with the door and sign on the middle tile', () => {
  let wide = 0;
  for (const s of w.stores) {
    assert.ok(s.facade.includes(s.anchorTile));
    for (const ti of s.facade) { assert.strictEqual(w.facades.get(ti), s); assert.strictEqual(w.kind[ti], C.K.BUILDING); }
    if (s.facade.length >= 3) wide++;
  }
  assert.ok(wide >= 20, 'only ' + wide + ' shops have a wide facade');
});
test('shops can be told apart from far away by their rooftops', () => {
  const kinds = new Set(w.props.filter((p) => p.type === C.PROP.ROOFPIECE).map((p) => p.k));
  for (const k of [C.STORE.FIREHALL, C.STORE.SCHOOL, C.STORE.LIBRARY, C.STORE.HOTEL, C.STORE.PHARMACY, C.STORE.DINER, C.STORE.BANK]) assert.ok(kinds.has(k), 'no rooftop piece for ' + C.STORE_SIGN[k]);
});
