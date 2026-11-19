#!/usr/bin/env node
'use strict';
/**
 * Terminal player.
 *
 *   node bin/play.js                  interactive (needs a TTY)
 *   node bin/play.js --frames 1       headless: print one frame and the HUD, then exit
 *
 * Options: --seed <word|number>  --size <tiles>  --time <hour 0-24>  --cols <n>  --rows <n>
 * Controls: W/S move, A/D strafe, arrows turn and look, Shift+W run,
 *           , and . change the hour, Q or Esc quits.
 */

const C = require('../src');

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { out[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
  }
  return out;
}

const opt = args();
const world = C.generateWorld({ seed: opt.seed === undefined ? 'aurora' : (isNaN(+opt.seed) ? opt.seed : +opt.seed), size: +opt.size || 128 });
const cam = C.createCamera(world);
let time = opt.time !== undefined ? +opt.time : 21;
const HUD_LINES = 6;

const headless = opt.frames !== undefined || !process.stdout.isTTY;

if (headless) {
  const cols = +opt.cols || 120, rows = +opt.rows || 40;
  const frame = C.createFrame(cols, rows);
  C.render(frame, world, cam, { time });
  process.stdout.write(C.frameRows(frame).join('\n') + '\n' + C.buildHud(world, cam, time).join('\n') + '\n');
  process.exit(0);
}

/* ---- interactive ---- */
const held = new Map(); // key -> expiry (terminals send repeats, never key-up)
const HOLD_MS = 130;

function size() {
  return {
    cols: +opt.cols || Math.max(40, process.stdout.columns || 100),
    rows: +opt.rows || Math.max(12, (process.stdout.rows || 40) - HUD_LINES - 1),
  };
}

let { cols, rows } = size();
let frame = C.createFrame(cols, rows);
process.stdout.on('resize', () => { ({ cols, rows } = size()); frame = C.createFrame(cols, rows); process.stdout.write('\x1b[2J'); });

function cleanup() {
  process.stdout.write('\x1b[?25h\x1b[0m\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
}

require('readline').emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
  if (!key) return;
  if (key.name === 'escape' || (key.name === 'q') || (key.ctrl && key.name === 'c')) return cleanup();
  if (str === ',') time = (time + 23.5) % 24;
  else if (str === '.') time = (time + 0.5) % 24;
  else held.set(key.name + (key.shift || (str && str !== str.toLowerCase()) ? '+shift' : ''), Date.now() + HOLD_MS);
});

function down(name) {
  for (const [k, exp] of held) {
    if (k.split('+')[0] === name && exp > Date.now()) return true;
  }
  return false;
}

process.stdout.write('\x1b[2J\x1b[?25l');
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const input = {
    forward: (down('w') ? 1 : 0) - (down('s') ? 1 : 0),
    strafe: (down('d') ? 1 : 0) - (down('a') ? 1 : 0),
    turn: (down('right') ? 1 : 0) - (down('left') ? 1 : 0),
    look: (down('up') ? 1 : 0) - (down('down') ? 1 : 0),
  };
  const run = [...held.keys()].some((k) => k.endsWith('+shift'));
  C.stepCamera(world, cam, input, dt, run);
  C.render(frame, world, cam, { time });
  const hud = C.buildHud(world, cam, time);
  process.stdout.write('\x1b[H\x1b[32m' + C.frameRows(frame).join('\n') + '\n' + '-'.repeat(cols) + '\n' + hud.join('\n') + '\x1b[0m');
}, 33);
