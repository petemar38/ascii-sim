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
 *           , and . change the hour, L lists the nearest buildings (1-9 to go there), Q or Esc quits.
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
const world = C.generateWorld({ seed: opt.seed === undefined ? 'aurora' : (isNaN(+opt.seed) ? opt.seed : +opt.seed), size: +opt.size || 288 });
const cam = C.createCamera(world);
let time = opt.time !== undefined ? +opt.time : 12;
const HUD_LINES = 8;

const headless = opt.frames !== undefined || !process.stdout.isTTY;

if (headless) {
  const cols = +opt.cols || 120, rows = +opt.rows || 40;
  const frame = C.createFrame(cols, rows);
  C.render(frame, world, cam, { time, clock: opt.clock !== undefined ? +opt.clock : 0 });
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
let menu = null; // list of entries while the travel menu is open
const ex = C.createExplorer(world);
C.exploreJump(ex, cam);
let mapMode = 1; // M cycles: 0 off, 1 local (centred on you), 2 the whole world
let colorOn = process.env.ASCII_SIM_COLOR !== "0"; // colour is the default; C toggles, ASCII_SIM_COLOR=0 starts in green phosphor
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || '');
process.stdin.on('keypress', (str, key) => {
  if (!key) return;
  if (menu) {
    const n = parseInt(str, 10);
    if (n >= 1 && n <= menu.length) { C.arriveAt(world, cam, menu[n - 1].store); C.exploreJump(ex, cam); menu = null; held.clear(); }
    else if (key.name === 'escape' || str === 'l' || str === 'L') menu = null;
    else if (key.ctrl && key.name === 'c') return cleanup();
    process.stdout.write('\x1b[2J');
    return;
  }
  if (str === 'l' || str === 'L') { menu = C.nearestStores(world, cam, 9); held.clear(); process.stdout.write('\x1b[2J'); return; }
  if (key.name === 'escape' || (key.name === 'q') || (key.ctrl && key.name === 'c')) return cleanup();
  if (str === 'm' || str === 'M') { mapMode = (mapMode + 1) % 3; process.stdout.write('\x1b[2J'); return; }
  if (str === 'c' || str === 'C') { colorOn = !colorOn; process.stdout.write('\x1b[2J'); return; }
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
  if (!menu) C.stepCamera(world, cam, input, dt, run);
  C.explore(ex, cam);
  C.render(frame, world, cam, { time, clock: now / 1000 });
  const useColor = colorOn && !menu; // the travel menu is drawn as plain text over the view
  let overlay = null, mm = null;
  if (mapMode && !menu) {
    const mc = mapMode === 1 ? Math.max(15, Math.min(49, (Math.floor(cols * 0.38) | 1))) : Math.max(20, Math.min(96, cols - 2));
    const mr = mapMode === 1 ? Math.max(8, Math.min(25, Math.floor(rows * 0.6))) : Math.max(10, Math.min(36, rows - 2));
    mm = C.buildMap(world, ex, cam, mapMode === 1 ? 'local' : 'world', { cols: mc, rows: mr, blink: Math.floor(now / 400) % 2 === 0 });
    overlay = { x0: cols - mc, y0: 0, rows: useColor ? C.mapAnsi(mm, truecolor) : C.mapPlain(mm) };
  }
  const rowsOut = useColor ? C.ansiRows(frame, C.makePalette(time), truecolor, overlay) : C.frameRows(frame);
  if (overlay && !useColor) overlay.rows.forEach((t, i) => { if (i < rowsOut.length) rowsOut[i] = rowsOut[i].slice(0, overlay.x0) + t; });
  if (menu) { // draw the travel menu over the top-left of the view
    const lines = ['NEAREST BUILDINGS  (1-9 go there, L or Esc closes)', ''].concat(C.travelMenuLines(menu));
    lines.forEach((t, i) => {
      if (i + 1 >= rowsOut.length) return;
      const w = Math.min(cols - 2, 56);
      rowsOut[i + 1] = ' ' + ('  ' + t).padEnd(w).slice(0, w) + rowsOut[i + 1].slice(w + 1);
    });
  }
  const hud = C.buildHud(world, cam, time).concat(C.mapHudLines(ex));
  process.stdout.write('\x1b[H\x1b[32m' + rowsOut.join('\n') + '\x1b[32m\n' + '-'.repeat(cols) + '\n' + hud.join('\n') + '\x1b[0m');
}, 33);
