'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src');
const w = C.generateWorld({ seed: 'aurora' });

test('HUD has six lines', () => assert.strictEqual(C.buildHud(w, C.createCamera(w), 12).length, 6));
test('compass bearings', () => {
  assert.strictEqual(C.compassPoint(0), 'NORTH');
  assert.strictEqual(C.compassPoint(90), 'EAST');
});
test('locate returns names for out-of-road tiles too', () => {
  const l = C.locate(w, 3.5, 3.5);
  assert.ok(l.district);
});
