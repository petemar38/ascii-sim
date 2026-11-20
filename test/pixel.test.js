'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');

const w = C.generateWorld({ seed: 'aurora', size: 192 });
const cam = C.createCamera(w);

test('pixel mode: every cell becomes an opaque pixel, sky on top, no black holes in solid fill', () => {
  const W = 160, H = 90, f = C.createFrame(W, H);
  C.render(f, w, cam, { time: 12, cellAspect: 1, filler: 'solid' });
  const rgba = C.pixelRgba(f, C.makePalette(12), new Uint8ClampedArray(W * H * 4), { dither: false });
  let black = 0;
  for (let i = 0; i < W * H; i++) {
    assert.strictEqual(rgba[i * 4 + 3], 255);
    if (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2] === 0) black++;
  }
  let skyOk = 0, skyN = 0;
  for (let i = 0; i < W * H; i++) if (f.tone[i] === C.TONE.SKY) { skyN++; if (rgba[i * 4 + 2] > rgba[i * 4]) skyOk++; }
  assert.ok(skyN > 50 && skyOk === skyN, 'open sky is blue');
  assert.ok(black < W * H * 0.01, 'black pixels ' + black);
});

test('pixel mode: night is darker than day', () => {
  const W = 120, H = 70, f = C.createFrame(W, H), sum = (t) => {
    C.render(f, w, cam, { time: t, cellAspect: 1, filler: 'solid' });
    const a = C.pixelRgba(f, C.makePalette(t), new Uint8ClampedArray(W * H * 4));
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2];
    return s;
  };
  assert.ok(sum(12) > sum(23) * 1.5);
});

test('pixel mode: terminal half blocks pack two pixel rows into one text row, with the map over the right end', () => {
  const f = C.createFrame(60, 40);
  C.render(f, w, cam, { time: 12, cellAspect: 1, filler: 'solid' });
  const plain = C.halfBlockRows(f, C.makePalette(12), true);
  assert.strictEqual(plain.length, 20);
  assert.ok(plain[0].includes('▀'));
  const ex = C.createExplorer(w), m = C.buildMap(w, ex, cam, 'local', { cols: 15, rows: 8 });
  const withMap = C.halfBlockRows(f, C.makePalette(12), true, { x0: 45, y0: 0, rows: C.mapAnsi(m, true) });
  assert.strictEqual(withMap.length, 20);
  assert.ok(withMap[0].length !== plain[0].length);
  assert.strictEqual(withMap[10], plain[10]);
});
