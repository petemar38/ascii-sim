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

test('rendering is seamless: a camera one map-width away sees exactly the same frame', () => {
  for (const [x, y, a] of [[2.5, 40.5, Math.PI], [w.size - 2.5, 100.5, 0], [60.5, 1.5, -Math.PI / 2], [30.5, w.size - 1.5, Math.PI / 2]]) {
    const f1 = C.createFrame(90, 30), f2 = C.createFrame(90, 30);
    C.render(f1, w, { x, y, angle: a, pitch: 0.06, eyeZ: 0.21 }, { time: 21 });
    C.render(f2, w, { x: x + w.size, y: y - w.size, angle: a, pitch: 0.06, eyeZ: 0.21 }, { time: 21 });
    assert.strictEqual(C.frameHash(f1), C.frameHash(f2));
  }
});
test('the view across the seam is continuous: stepping over it changes the frame only slightly', () => {
  const street = w.hRoads[0];
  const cam = { x: w.size - 0.3, y: street.pos + street.w / 2, angle: 0, pitch: 0.06, eyeZ: 0.21 }; // down a street, so nothing blocks the step
  const before = C.createFrame(90, 30), after = C.createFrame(90, 30);
  C.render(before, w, cam, { time: 12 });
  C.stepCamera(w, cam, { forward: 1, strafe: 0, turn: 0, look: 0 }, 0.1, false); // 0.32 tiles: crosses x = size
  assert.ok(cam.x < 1, 'camera should have wrapped to the west edge, got ' + cam.x);
  C.render(after, w, cam, { time: 12 });
  let diff = 0;
  for (let i = 0; i < before.ch.length; i++) if (before.ch[i] !== after.ch[i]) diff++;
  assert.ok(diff < before.ch.length * 0.45, 'frame jumped across the seam: ' + diff + ' of ' + before.ch.length + ' cells changed');
});

test('colour: every cell gets a colour, text survives unchanged, and day and night differ', () => {
  const cam = { x: w.spawn.x, y: w.spawn.y, angle: w.spawn.angle, pitch: 0.06, eyeZ: 0.21 };
  const f = C.createFrame(90, 30);
  C.render(f, w, cam, { time: 12 });
  const day = C.makePalette(12), night = C.makePalette(0);
  const html = C.htmlRows(f, day);
  // stripping tags and unescaping gives back exactly the plain rows
  const plain = html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.strictEqual(plain, C.frameRows(f).join('\n'));
  // ANSI rows carry the same characters
  const ansi = C.ansiRows(f, day, true).map((r) => r.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.deepStrictEqual(ansi, C.frameRows(f));
  assert.notStrictEqual(day.css.join(), night.css.join());
  // colours must not all be one: a city has a sky, ground, walls and lights
  const used = new Set();
  for (let i = 0; i < f.ch.length; i++) if (f.ch[i] !== 32) used.add(C.slotOf(f, i) >> 2);
  assert.ok(used.size >= 6, 'only ' + used.size + ' different colours in a street view');
  // fewer runs than cells: the page must stay cheap to update
  assert.ok((html.match(/<span/g) || []).length < f.ch.length * 0.5);
});
test('colour: lit windows and stars stay bright at night; walls get different materials per building', () => {
  const night = C.makePalette(0);
  const lit = C.TONE.WINDOW_LIT * 4 * 3, wall = C.TONE.WALL * 4 * 3;
  assert.ok(night.rgb[lit] > 200, 'a lit window is not bright at night');
  assert.ok(night.rgb[wall] < 140, 'walls should go dim at night');
  const slots = new Set();
  const cam = { x: w.spawn.x, y: w.spawn.y, angle: 0, pitch: 0.06, eyeZ: 0.21 };
  for (const a of [0, 1.6, 3.1, 4.7]) {
    const f = C.createFrame(120, 40);
    C.render(f, w, { ...cam, angle: a }, { time: 12 });
    for (let i = 0; i < f.ch.length; i++) if (f.tone[i] === C.TONE.WALL && f.id[i] > 0) slots.add(C.slotOf(f, i) >> 2);
  }
  assert.ok(slots.size >= 3, 'walls all look alike: ' + slots.size + ' materials seen');
});

test('colour: the sky is blue by day, dark by night, and glows at the horizon at dusk', () => {
  const lum = (css) => { const v = [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16)); return v[0] + v[1] + v[2]; };
  const noon = C.makePalette(12).sky.css, night = C.makePalette(0).sky.css, dusk = C.makePalette(17.6).sky.css;
  assert.ok(lum(noon[0]) > 3 * lum(night[0]), 'day sky is not much brighter than night');
  assert.ok(parseInt(noon[0].slice(5, 7), 16) > parseInt(noon[0].slice(1, 3), 16) + 40, 'day zenith should be blue');
  assert.ok(parseInt(dusk[7].slice(1, 3), 16) > parseInt(C.makePalette(0).sky.css[7].slice(1, 3), 16) + 60, 'no warm glow at the horizon at dusk');
  // sky cells carry a background; ground cells do not
  const f = C.createFrame(60, 20);
  C.render(f, w, { x: w.spawn.x, y: w.spawn.y, angle: w.spawn.angle, pitch: 0.06, eyeZ: 0.21 }, { time: 12 });
  const html = C.htmlRows(f, C.makePalette(12));
  assert.ok(/background:#/.test(html));
  assert.ok(C.skyStep(f, 0) >= 0 && C.skyStep(f, f.ch.length - 1) === -1);
});
