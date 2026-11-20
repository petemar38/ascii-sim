'use strict';
/**
 * Animals on the ground: cats, dogs, squirrels and rabbits. Like the birds they are small records plus a pose
 * function of the clock, so the world stays deterministic. Unlike the birds they are solid: you cannot walk through
 * one (`animalClearance`, used by stepCamera), and the skittish ones run off when you get close. A startled animal
 * only ever runs along a path that was checked to be clear of buildings and props, so it never goes through anything either.
 *
 * Runtime state (who is running where) lives in `world.fauna`, a Map from animal to a flight record; `updateFauna`
 * starts and ends those records and is safe to call every frame.
 */

const { mulberry32 } = require('./rng');
const W = () => require('./world'); // loaded lazily: world.js builds the animals

const ANIMAL = { CAT: 1, SQUIRREL: 2, DOG: 3, RABBIT: 4 };
const ANIMALS = [];
function an(id, name, d) { ANIMALS[id] = Object.assign({ name }, d); }
// size in tiles (exaggerated, like the birds); r = collision radius; flee = how close you can get before it bolts
an(ANIMAL.CAT,      'cat',               { size: 0.36, r: 0.14, flee: 3.2, speed: 5.0, dash: [3, 5.5], glyph: 99,  tones: [['B_ORANGE', 'B_WHITE'], ['B_GRAY', 'B_WHITE'], ['B_BLACK', 'B_BLACK'], ['B_BROWN', 'B_TAN'], ['B_WHITE', 'B_WHITE']] });
an(ANIMAL.SQUIRREL, 'gray squirrel',     { size: 0.26, r: 0.08, flee: 3.6, speed: 6.5, dash: [3, 6],   glyph: 115, tones: [['B_GRAY', 'B_WHITE'], ['B_BROWN', 'B_TAN']] });
an(ANIMAL.DOG,      'dog',               { size: 0.58, r: 0.24, flee: 0,   speed: 0,   dash: [0, 0],   glyph: 100, tones: [['B_BROWN', 'B_TAN'], ['B_BLACK', 'B_TAN'], ['B_TAN', 'B_WHITE'], ['B_GRAY', 'B_WHITE']] });
an(ANIMAL.RABBIT,   'cottontail rabbit', { size: 0.30, r: 0.10, flee: 4.2, speed: 7.0, dash: [3, 6],   glyph: 114, tones: [['B_TAN', 'B_WHITE'], ['B_BROWN', 'B_TAN']] });

const HOLD = 5;      // seconds a startled animal stands and watches
const BACK_SPEED = 0.9;

/** Can a body of radius r stand at (x, y)? Not inside a building, not touching a solid prop. */
function clearAt(world, x, y, r) {
  const { isWalkable, propClearance } = W();
  return isWalkable(world, x - r, y - r) && isWalkable(world, x + r, y - r) && isWalkable(world, x - r, y + r) && isWalkable(world, x + r, y + r)
    && propClearance(world, x, y, r) >= 0;
}

function makeAnimals(world) {
  const { size, kind, district, districts, props } = world;
  const { K, D, PROP } = W();
  const rnd = mulberry32(((world.seed | 0) ^ 0xa11a) >>> 0);
  const R = (a, b) => a + (b - a) * rnd();
  const list = [];
  const dtype = (x, y) => districts[district[Math.floor(y) * size + Math.floor(x)]].type;

  const add = (sp, x, y, roam) => {
    const spec = ANIMALS[sp];
    x = ((x % size) + size) % size; y = ((y % size) + size) % size;
    const r = spec.r + 0.02;
    if (!clearAt(world, x, y, r + 0.05)) return;
    let ax = 0, ay = 0, mode = 0;
    if (roam && rnd() < 0.55) { // wander in a little oval, if the whole oval is clear
      ax = R(0.15, 0.5); ay = R(0.15, 0.5);
      let ok = true;
      for (let k = 0; k < 16 && ok; k++) ok = clearAt(world, x + ax * Math.cos(k * 0.3927), y + ay * Math.sin(k * 0.3927), r + 0.05);
      if (ok) mode = 1; else { ax = ay = 0; }
    }
    list.push({ sp, x, y, mode, ax, ay, ph: rnd() * 100, v: (rnd() * spec.tones.length) | 0, a: rnd() * 6.283, r: spec.r });
  };

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = kind[y * size + x];
    if (k === K.YARD) {
      const q = rnd();
      if (q < 0.014) add(ANIMAL.CAT, x + R(0.2, 0.8), y + R(0.2, 0.8), true);
      else if (q < 0.022) add(ANIMAL.DOG, x + R(0.3, 0.7), y + R(0.3, 0.7), true);
      else if (q < 0.026) add(ANIMAL.RABBIT, x + R(0.2, 0.8), y + R(0.2, 0.8), true);
    } else if (k === K.PARK) {
      if (rnd() < 0.007) add(ANIMAL.RABBIT, x + R(0.2, 0.8), y + R(0.2, 0.8), true);
    } else if (k === K.SIDEWALK) {
      if (rnd() < 0.0008 && dtype(x, y) !== D.DOWNTOWN) add(ANIMAL.CAT, x + R(0.2, 0.8), y + R(0.2, 0.8), false);
    }
  }
  for (const p of props) { // squirrels at the foot of the trees
    if (p.type === PROP.TREE && rnd() < 0.07) add(ANIMAL.SQUIRREL, p.x + R(-0.35, 0.35), p.y + R(-0.35, 0.35), true);
  }

  /* index by home tile, for the collision and trigger queries */
  const grid = new Map();
  for (const a of list) {
    const key = Math.floor(a.y) * size + Math.floor(a.x);
    const g = grid.get(key);
    if (g) g.push(a); else grid.set(key, [a]);
  }
  world.animalGrid = grid;
  world.fauna = new Map();
  return list;
}

/** Where an animal is at clock time t. st = its flight record if it is running, else undefined. */
const P = { x: 0, y: 0, hx: 1, hy: 0, moving: false, done: false };
function animalPose(a, t, st) {
  const o = P;
  o.done = false;
  if (st) {
    const e = t - st.t0, dashT = st.len / st.speed, backT = st.len / BACK_SPEED;
    if (e < 0) { o.x = st.x0; o.y = st.y0; o.hx = st.hx; o.hy = st.hy; o.moving = false; return o; }
    let s;
    if (e < dashT) { s = st.speed * e; o.moving = true; o.hx = st.dx; o.hy = st.dy; }
    else if (e < dashT + HOLD) { s = st.len; o.moving = false; o.hx = -st.dx; o.hy = -st.dy; }
    else if (e < dashT + HOLD + backT) { s = st.len - BACK_SPEED * (e - dashT - HOLD); o.moving = true; o.hx = -st.dx; o.hy = -st.dy; }
    else { o.done = true; }
    if (!o.done) { o.x = st.x0 + st.dx * s; o.y = st.y0 + st.dy * s; return o; }
  }
  if (a.mode === 1) {
    const a1 = 0.28 * t + a.ph, a2 = 0.21 * t + a.ph * 1.7;
    o.x = a.x + a.ax * Math.sin(a1); o.y = a.y + a.ay * Math.sin(a2);
    o.hx = a.ax * 0.28 * Math.cos(a1); o.hy = a.ay * 0.21 * Math.cos(a2);
    o.moving = true;
  } else {
    const turn = (Math.floor(t / (7 + (a.ph % 6)) + a.ph) & 1) * Math.PI; // now and then it looks the other way
    o.x = a.x; o.y = a.y; o.hx = Math.cos(a.a + turn); o.hy = Math.sin(a.a + turn); o.moving = false;
  }
  return o;
}

function wd(world, d) { return world.wrap ? d - world.size * Math.round(d / world.size) : d; }

/** How long a clear straight run (up to `want` tiles) is there from (x, y) in direction (dx, dy)? */
function runLength(world, x, y, dx, dy, want, r) {
  let len = 0;
  for (let s = 0.25; s <= want + 1e-6; s += 0.25) {
    if (!clearAt(world, x + dx * s, y + dy * s, r + 0.03)) break;
    len = s;
  }
  return len;
}

/** Start and end flights. Call every frame (stepCamera and render both do). */
function updateFauna(world, cam, clock) {
  if (!world.animals || !world.animals.length) return;
  const size = world.size, fauna = world.fauna;
  for (const [a, st] of fauna) { // finished runs
    animalPose(a, clock, st);
    if (P.done || clock < st.t0 - 1) fauna.delete(a);
  }
  const cx = Math.floor(cam.x), cy = Math.floor(cam.y);
  const near = [];
  for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) {
    const g = world.animalGrid.get((((cy + j) % size + size) % size) * size + (((cx + i) % size + size) % size));
    if (g) for (const a of g) near.push(a);
  }
  for (const a of near) {
    const spec = ANIMALS[a.sp];
    if (!spec.flee) continue;
    const st = fauna.get(a);
    if (st) { // a run in progress: if it is standing and watching and you walk up again, it bolts again from where it stands
      const e = clock - st.t0, dashT = st.len / st.speed;
      if (e < dashT || e > dashT + HOLD) continue;
    }
    const pose = animalPose(a, clock, st);
    const px = pose.x, py = pose.y;
    const dx = wd(world, px - cam.x), dy = wd(world, py - cam.y), d = Math.hypot(dx, dy);
    if (d > spec.flee) continue;
    const base = d < 1e-6 ? a.ph : Math.atan2(dy, dx), want = spec.dash[0] + (spec.dash[1] - spec.dash[0]) * ((a.ph * 7) % 1);
    let best = 0, bestAng = base;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4]) {
      const ang = base + off, len = runLength(world, px, py, Math.cos(ang), Math.sin(ang), want, a.r);
      if (len > best + 1e-6) { best = len; bestAng = ang; }
      if (best >= want - 1e-6) break;
    }
    if (best < 0.75) continue; // cornered: it stays put (and you still cannot walk through it)
    fauna.set(a, { t0: clock + ((a.ph * 13) % 1) * 0.25, x0: px, y0: py, dx: Math.cos(bestAng), dy: Math.sin(bestAng), len: best, speed: spec.speed, hx: -Math.cos(base), hy: -Math.sin(base) });
  }
}

/**
 * Smallest gap between a body of radius r at (x, y) and any animal (negative = overlapping). Pass the clock so running animals are where they really are.
 */
function animalClearance(world, x, y, r, clock) {
  if (!world.animals || !world.animals.length) return Infinity;
  const size = world.size, fauna = world.fauna;
  let best = Infinity;
  const test = (a, st) => {
    const p = animalPose(a, clock, st);
    const c = Math.hypot(wd(world, p.x - x), wd(world, p.y - y)) - r - a.r;
    if (c < best) best = c;
  };
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const g = world.animalGrid.get((((ty + j) % size + size) % size) * size + (((tx + i) % size + size) % size));
    if (g) for (const a of g) if (!fauna.has(a)) test(a, undefined);
  }
  for (const [a, st] of fauna) {
    const p = animalPose(a, clock, st);
    if (Math.abs(wd(world, p.x - x)) < 12 && Math.abs(wd(world, p.y - y)) < 12) test(a, st);
  }
  return best;
}

module.exports = { ANIMAL, ANIMALS, makeAnimals, animalPose, updateFauna, animalClearance, clearAt };
