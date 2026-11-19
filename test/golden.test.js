'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src');

const file = path.join(__dirname, 'golden.json');
const w = C.generateWorld({ seed: 'aurora', size: 192 });
const cam = C.createCamera(w);
const out = { world: C.worldHash(w) };
for (const t of [8, 12, 21]) {
  const f = C.createFrame(100, 36);
  C.render(f, w, cam, { time: t });
  out['frame_' + t] = C.frameHash(f);
}

test('golden hashes (run `npm run test:update-golden` after intentional changes)', () => {
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    return;
  }
  assert.deepStrictEqual(out, JSON.parse(fs.readFileSync(file, 'utf8')));
});
