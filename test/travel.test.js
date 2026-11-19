'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora', size: 192 });
const OUT = { [C.FACE.N]: [0, -1], [C.FACE.S]: [0, 1], [C.FACE.W]: [-1, 0], [C.FACE.E]: [1, 0] };

test('nearestStores gives up to nine, closest first, using wrapped distance', () => {
  const cam = C.createCamera(w);
  const list = C.nearestStores(w, cam, 9);
  assert.strictEqual(list.length, 9);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].dist >= list[i - 1].dist);
  assert.strictEqual(new Set(list.map((e) => e.store.id)).size, 9);
  // nothing outside the list is closer than its last entry
  const far = list[8].dist;
  for (const s of w.stores) {
    if (list.some((e) => e.store === s)) continue;
    const d = Math.hypot(C.wrapDelta(w, s.x - cam.x), C.wrapDelta(w, s.y - cam.y));
    assert.ok(d >= far - 1e-9 || d < 2 || Math.hypot(C.wrapDelta(w, s.x + OUT[s.face][0] * 3 - cam.x), C.wrapDelta(w, s.y + OUT[s.face][1] * 3 - cam.y)) < 1.5);
  }
});
test('the list works across the wrap seam', () => {
  const cam = { x: 1, y: 1, angle: 0, pitch: 0, eyeZ: 0.21 };
  for (const e of C.nearestStores(w, cam, 9)) assert.ok(e.dist < w.size / 2 * Math.SQRT2);
});
test('menu lines are numbered 1 to 9 and name each building', () => {
  const lines = C.travelMenuLines(C.nearestStores(w, C.createCamera(w), 9));
  assert.strictEqual(lines.length, 9);
  lines.forEach((l, i) => assert.ok(l.startsWith(String(i + 1) + '  ')));
});
test('arriveAt puts you in front of any store, standing on free ground, facing it', () => {
  for (const s of w.stores) {
    const cam = { x: 0, y: 0, angle: 0, pitch: 0, eyeZ: 0.21 };
    assert.ok(C.arriveAt(w, cam, s), 'no free spot in front of ' + s.name);
    assert.ok(C.canStand(w, cam.x, cam.y));
    assert.ok(C.propClearance(w, cam.x, cam.y, C.PROP_BODY) >= 0);
    const dx = C.wrapDelta(w, s.x - cam.x), dy = C.wrapDelta(w, s.y - cam.y);
    assert.ok(Math.hypot(dx, dy) <= 4.2);
    const facing = (Math.cos(cam.angle) * dx + Math.sin(cam.angle) * dy) / Math.hypot(dx, dy);
    assert.ok(facing > 0.999, 'not facing ' + s.name);
  }
});
test('after arriving you can read the sign', () => {
  let n = 0;
  for (const s of w.stores) {
    if (s.sign.length < 4) continue;
    const cam = { x: 0, y: 0, angle: 0, pitch: 0, eyeZ: 0.21 };
    C.arriveAt(w, cam, s);
    const f = C.createFrame(150, 44);
    C.render(f, w, cam, { time: 12 });
    const re = new RegExp(s.sign.split('').map((c) => c + '+').join('[^A-Z\\n]{0,8}'));
    assert.match(C.frameRows(f).join('\n'), re, 'cannot read ' + s.name);
    if (++n >= 25) break;
  }
});
test('the store you are standing in front of is not offered again', () => {
  const cam = { x: 0, y: 0, angle: 0, pitch: 0, eyeZ: 0.21 };
  C.arriveAt(w, cam, w.stores[5]);
  assert.ok(!C.nearestStores(w, cam, 9).some((e) => e.store === w.stores[5]));
});
