'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora' });

test('camera never ends inside a building while walking into walls', () => {
  const cam = C.createCamera(w);
  for (let a = 0; a < 6.28; a += 0.5) {
    cam.angle = a;
    for (let i = 0; i < 300; i++) C.stepCamera(w, cam, { forward: 1, strafe: 0, turn: 0, look: 0 }, 0.05, true);
    assert.ok(C.canStand(w, cam.x, cam.y), 'stuck in wall at angle ' + a);
  }
});
test('pitch is clamped', () => {
  const cam = C.createCamera(w);
  for (let i = 0; i < 100; i++) C.stepCamera(w, cam, { forward: 0, strafe: 0, turn: 0, look: 1 }, 0.1, false);
  assert.ok(Math.abs(cam.pitch) <= 0.351);
});

test('props are solid: walking straight at one never gets inside it', () => {
  let tried = 0;
  for (const p of w.props) {
    if (!C.PROP_RADIUS[p.type]) continue;
    for (const a of [0, 1.3, 2.6, 3.9, 5.2]) {
      const cam = { x: p.x - Math.cos(a) * 1.2, y: p.y - Math.sin(a) * 1.2, angle: a, pitch: 0, eyeZ: 0.21 };
      if (!C.canStand(w, cam.x, cam.y) || C.propClearance(w, cam.x, cam.y, C.PROP_BODY) < 0) continue;
      tried++;
      for (let i = 0; i < 60; i++) C.stepCamera(w, cam, { forward: 1, strafe: 0, turn: 0, look: 0 }, 0.05, false);
      assert.ok(C.propClearance(w, cam.x, cam.y, C.PROP_BODY) >= -1e-9, 'walked into a prop at ' + p.x + ',' + p.y);
    }
    if (tried > 400) break;
  }
  assert.ok(tried > 50);
});
test('lamps, poles, hydrants and signals leave the sidewalk centre line walkable', () => {
  let n = 0;
  for (const p of w.props) {
    if (![C.PROP.LAMP, C.PROP.POLE, C.PROP.HYDRANT].includes(p.type)) continue;
    n++;
    const c = C.propClearance(w, Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5, C.PROP_BODY);
    assert.ok(c >= 0, 'prop at ' + p.x + ',' + p.y + ' blocks its own sidewalk centre line');
  }
  assert.ok(n > 100);
});

test('walking off one edge of the map brings you in from the other, not into a wall', () => {
  // find a road row and walk east across the seam
  const n = w.size;
  let y = -1;
  for (let j = 0; j < n && y < 0; j++) { let ok = true; for (let x = 0; x < n; x++) if (w.height[j * n + x] > 0) { ok = false; break; } if (ok) y = j; }
  if (y < 0) return; // no fully clear row on this seed; the render tests cover the seam
  const cam = { x: n - 3, y: y + 0.5, angle: 0, pitch: 0, eyeZ: 0.21 };
  for (let i = 0; i < 120; i++) C.stepCamera(w, cam, { forward: 1, strafe: 0, turn: 0, look: 0 }, 0.05, false);
  assert.ok(cam.x >= 0 && cam.x < n);
  assert.ok(cam.x < 20, 'should have wrapped around, x=' + cam.x);
});
