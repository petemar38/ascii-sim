'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');

const w = C.generateWorld({ seed: 'aurora', size: 192 });
const S = w.size;
const roadRowY = w.hRoads[0].pos + 0.5; // a full east-west road, so we can walk straight across the seam

test('minimap: walking over the seam is counted, in both directions', () => {
  const ex = C.createExplorer(w);
  const cam = { x: S - 1, y: roadRowY, angle: 0, pitch: 0, eyeZ: 0.21 };
  C.exploreJump(ex, cam);
  for (let i = 0; i < 40; i++) { C.stepCamera(w, cam, { forward: 1 }, 0.1, true); C.explore(ex, cam); }
  assert.ok(cam.x < 40, 'wrapped to the west edge ' + cam.x);
  assert.strictEqual(ex.wx, 1);
  assert.strictEqual(C.loopLabel(ex), '1E 0');
  cam.angle = Math.PI; // and back again
  for (let i = 0; i < 40; i++) { C.stepCamera(w, cam, { forward: 1 }, 0.1, true); C.explore(ex, cam); }
  assert.strictEqual(ex.wx, 0);
  assert.strictEqual(C.loopLabel(ex), '0 0');
});

test('minimap: a teleport does not count as a loop', () => {
  const ex = C.createExplorer(w);
  const cam = { x: 2, y: roadRowY, angle: 0, pitch: 0, eyeZ: 0.21 };
  C.exploreJump(ex, cam);
  cam.x = S - 3; C.exploreJump(ex, cam);
  assert.strictEqual(ex.wx, 0);
});

test('minimap: the local map is centred on you and the seam shows as a line that passes under you', () => {
  const ex = C.createExplorer(w);
  const mid = 24;
  const at = (x) => C.buildMap(w, ex, { x, y: roadRowY, angle: 0, eyeZ: 0.21 }, 'local');
  const pinkAt = (m, cx) => { const i = 5 * m.cols + cx; return m.bg[i * 3] > m.bg[i * 3 + 1] + 40 && m.bg[i * 3 + 2] > m.bg[i * 3 + 1] + 20; };
  const before = at(S - 3.5);   // the seam is 4 tiles ahead
  assert.ok(pinkAt(before, mid + 4), 'seam ahead');
  const after = at(2.5);        // the seam is 2 tiles behind: you are over on the other side
  assert.ok(pinkAt(after, mid - 2), 'seam behind');
  for (const m of [before, after]) assert.ok(m.ch[12 * m.cols + mid] !== 32, 'you are in the middle');
});

test('minimap: the world map brings your marker back on the opposite edge', () => {
  const ex = C.createExplorer(w);
  const find = (m) => { for (let i = 0; i < m.ch.length; i++) if (m.ch[i] !== 32 && m.fg[i * 3] === 255 && m.fg[i * 3 + 1] === 236) return i % m.cols; return -1; };
  const right = find(C.buildMap(w, ex, { x: S - 1, y: 50, angle: 0 }, 'world'));
  const left = find(C.buildMap(w, ex, { x: 1, y: 50, angle: 0 }, 'world'));
  assert.ok(right >= 90 && left <= 5, `${right} ${left}`);
});

test('minimap: ground you have walked is lit, the rest stays dim', () => {
  const ex = C.createExplorer(w);
  const cam = { x: 30.5, y: roadRowY, angle: 0, eyeZ: 0.21 };
  C.exploreJump(ex, cam);
  const m = C.buildMap(w, ex, cam, 'local');
  const lum = (cx, cy) => { const i = cy * m.cols + cx; return m.bg[i * 3] + m.bg[i * 3 + 1] + m.bg[i * 3 + 2]; };
  assert.ok(C.exploredPercent(ex) > 0);
  assert.ok(lum(24, 12) > 0);
  // a far corner cell (never visited) is darker than one beside you of the same kind would be
  assert.ok(lum(1, 1) < 200);
});

test('minimap: html and ansi renderers produce one line per row', () => {
  const ex = C.createExplorer(w);
  const m = C.buildMap(w, ex, { x: 50, y: 50, angle: 1 }, 'local');
  assert.strictEqual(C.mapHtml(m).split('\n').length, m.rows);
  assert.strictEqual(C.mapAnsi(m, true).length, m.rows);
  assert.strictEqual(C.mapPlain(m)[0].length, m.cols);
});
