'use strict';
/**
 * Birds. What you would see in a central Pennsylvania spring: robins on the lawns, cardinals and blue jays
 * in the trees, goldfinches, chickadees, house sparrows, mourning doves and starlings on roofs, lamps and
 * wires, red-winged blackbirds on the tall weeds, barn swallows swooping over the parks, pigeons round the
 * downtown towers, crows, turkey vultures and red-tailed hawks soaring, Canada geese heading north in a V,
 * orioles, bluebirds, hummingbirds at the flower beds, a wild turkey now and then, and bats and owls at night.
 *
 * Birds are not stored as moving objects. Each one is a small record (where it lives and how it moves) and
 * `birdPose(bird, t)` says where it is at clock time t, so the world stays deterministic and a frame needs no state.
 */

const { mulberry32 } = require('./rng');
const { TREES } = require('./veg');

const BIRD = {
  ROBIN: 1, CARDINAL: 2, BLUEJAY: 3, CHICKADEE: 4, SPARROW: 5, DOVE: 6, GOLDFINCH: 7, REDWING: 8, STARLING: 9, GOOSE: 10,
  VULTURE: 11, HAWK: 12, SWALLOW: 13, PIGEON: 14, CROW: 15, ORIOLE: 16, BLUEBIRD: 17, HUMMING: 18, WOODPECKER: 19, TURKEY: 20,
  BAT: 21, OWL: 22,
};
const MODE = { PERCH: 0, GROUND: 1, CIRCLE: 2, LINE: 3, FLIT: 4, HOVER: 5 };

/** size in tiles (exaggerated, so a songbird is still a cell or two); back/breast/dot are tone names. */
const SPECIES = [];
function sp(id, name, size, back, breast, dot, extra) { SPECIES[id] = Object.assign({ name, size, back, breast, dot }, extra); }
sp(BIRD.ROBIN,      'American robin',         0.20, 'B_GRAY',  'B_ORANGE', 'B_ORANGE');
sp(BIRD.CARDINAL,   'northern cardinal',      0.20, 'B_RED',   'B_RED',    'B_RED');
sp(BIRD.BLUEJAY,    'blue jay',               0.24, 'B_BLUE',  'B_WHITE',  'B_BLUE');
sp(BIRD.CHICKADEE,  'black-capped chickadee', 0.15, 'B_GRAY',  'B_WHITE',  'B_GRAY');
sp(BIRD.SPARROW,    'house sparrow',          0.16, 'B_BROWN', 'B_TAN',    'B_BROWN');
sp(BIRD.DOVE,       'mourning dove',          0.26, 'B_TAN',   'B_TAN',    'B_TAN');
sp(BIRD.GOLDFINCH,  'American goldfinch',     0.15, 'B_BLACK', 'B_YELLOW', 'B_YELLOW');
sp(BIRD.REDWING,    'red-winged blackbird',   0.22, 'B_BLACK', 'B_RED',    'B_BLACK');
sp(BIRD.STARLING,   'European starling',      0.20, 'B_BLACK', 'B_BLACK',  'B_BLACK');
sp(BIRD.GOOSE,      'Canada goose',           0.50, 'B_GRAY',  'B_WHITE',  'B_GRAY');
sp(BIRD.VULTURE,    'turkey vulture',         0.70, 'B_BLACK', 'B_BROWN',  'B_BLACK', { dihedral: true });
sp(BIRD.HAWK,       'red-tailed hawk',        0.60, 'B_BROWN', 'B_WHITE',  'B_BROWN');
sp(BIRD.SWALLOW,    'barn swallow',           0.20, 'B_BLUE',  'B_ORANGE', 'B_BLUE');
sp(BIRD.PIGEON,     'rock pigeon',            0.28, 'B_GRAY',  'B_GRAY',   'B_GRAY');
sp(BIRD.CROW,       'American crow',          0.34, 'B_BLACK', 'B_BLACK',  'B_BLACK');
sp(BIRD.ORIOLE,     'Baltimore oriole',       0.20, 'B_BLACK', 'B_ORANGE', 'B_ORANGE');
sp(BIRD.BLUEBIRD,   'eastern bluebird',       0.18, 'B_BLUE',  'B_ORANGE', 'B_BLUE');
sp(BIRD.HUMMING,    'ruby-throated hummingbird', 0.10, 'B_GREEN', 'B_RED', 'B_GREEN');
sp(BIRD.WOODPECKER, 'downy woodpecker',       0.18, 'B_BLACK', 'B_WHITE',  'B_WHITE');
sp(BIRD.TURKEY,     'wild turkey',            0.50, 'B_BROWN', 'B_BROWN',  'B_BROWN');
sp(BIRD.BAT,        'little brown bat',       0.24, 'B_BLACK', 'B_BROWN',  'B_BLACK', { night: true });
sp(BIRD.OWL,        'barred owl',             0.34, 'B_BROWN', 'B_TAN',    'B_BROWN', { night: true });

const FLOOR_H = 0.4;

function pick(rnd, table) {
  let tot = 0;
  for (const e of table) tot += e[1];
  let r = rnd() * tot;
  for (const e of table) { r -= e[1]; if (r <= 0) return e[0]; }
  return table[table.length - 1][0];
}

/**
 * Place every bird in the world. ctx supplies the finished world arrays and the enum values of world.js.
 * Everything here uses its own generator, so it never disturbs the rest of the world.
 */
function makeBirds(ctx) {
  const { size, seed, kind, district, districts, props, wires, buildings, K, D, PROP } = ctx;
  const rnd = mulberry32((seed ^ 0xb1d5) >>> 0);
  const birds = [];
  const area = (size * size) / (288 * 288);
  const R = (a, b) => a + (b - a) * rnd();
  const idx = (x, y) => (((y % size) + size) % size) * size + (((x % size) + size) % size);
  const dtype = (x, y) => districts[district[idx(Math.floor(x), Math.floor(y))]].type;

  const perch = (s, x, y, z, bias) => birds.push({ sp: s, mode: MODE.PERCH, x, y, z, a: rnd() * 6.283, ph: rnd() * 100, bias: bias || 0.12 });

  /* ground feeders on the lawns */
  const LAWN = [[BIRD.ROBIN, 44], [BIRD.SPARROW, 12], [BIRD.STARLING, 14], [BIRD.DOVE, 8], [BIRD.CROW, 9], [BIRD.BLUEBIRD, 3]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = kind[y * size + x];
    if (k !== K.YARD && k !== K.PARK) continue;
    if (rnd() > (k === K.PARK ? 0.012 : 0.009)) continue;
    const gx = x + R(0.2, 0.8), gy = y + R(0.2, 0.8);
    if (k === K.PARK && rnd() < 0.09) { // a few geese grazing
      const n = 3 + ((rnd() * 4) | 0);
      for (let q = 0; q < n; q++) birds.push({ sp: BIRD.GOOSE, mode: MODE.GROUND, x: gx + R(-0.8, 0.8), y: gy + R(-0.8, 0.8), z: 0, ax: R(0.2, 0.5), ay: R(0.2, 0.5), ph: rnd() * 100, bias: 0.1 });
      continue;
    }
    if (rnd() < 0.015) { birds.push({ sp: BIRD.TURKEY, mode: MODE.GROUND, x: gx, y: gy, z: 0, ax: 0.5, ay: 0.4, ph: rnd() * 100, bias: 0.1 }); continue; }
    birds.push({ sp: pick(rnd, LAWN), mode: MODE.GROUND, x: gx, y: gy, z: 0, ax: R(0.2, 0.6), ay: R(0.2, 0.6), ph: rnd() * 100, bias: 0.1 });
  }

  /* in the trees: songbirds high in the crown, a woodpecker on the trunk; owls at night */
  const TREEBIRDS = [[BIRD.CARDINAL, 26], [BIRD.BLUEJAY, 18], [BIRD.CHICKADEE, 16], [BIRD.GOLDFINCH, 12], [BIRD.ORIOLE, 8], [BIRD.ROBIN, 12], [BIRD.WOODPECKER, 5], [BIRD.OWL, 5]];
  for (const p of props) {
    if (p.type === PROP.TREE) {
      if (rnd() > 0.11) continue;
      const t = TREES[p.k || 0], sc = p.v ? 0.72 : 1;
      const s = pick(rnd, TREEBIRDS);
      if (s === BIRD.WOODPECKER) perch(s, p.x, p.y, R(0.1, t.trunkH * sc + 0.1), 0.12);
      else perch(s, p.x + R(-0.08, 0.08), p.y + R(-0.08, 0.08), (t.trunkH + t.ry * R(0.9, 1.5)) * sc, t.rad * sc + 0.1);
    } else if (p.type === PROP.LAMP) {
      if (rnd() < 0.07) perch(pick(rnd, [[BIRD.PIGEON, 30], [BIRD.SPARROW, 20], [BIRD.STARLING, 25], [BIRD.DOVE, 15], [BIRD.CROW, 10]]), p.x, p.y, 0.68, 0.12);
      if (rnd() < 0.13) { // bats hawk insects round the lamps at dusk
        const n = 1 + ((rnd() * 2) | 0);
        for (let q = 0; q < n; q++) birds.push({ sp: BIRD.BAT, mode: MODE.FLIT, cx: p.x, cy: p.y, ax: R(0.8, 2), ay: R(0.8, 2), az: R(0.1, 0.25), z: R(0.55, 0.9), w1: R(1.4, 2.4), w2: R(1.1, 2.1), w3: R(1, 2), ph: rnd() * 100, rate: 5, bias: 0.12 });
      }
    } else if (p.type === PROP.PLAY && rnd() < 0.15) {
      perch(pick(rnd, [[BIRD.ROBIN, 30], [BIRD.SPARROW, 25], [BIRD.STARLING, 20], [BIRD.CROW, 15]]), p.x, p.y, p.v === 0 ? 0.36 : 0.3, 0.2);
    } else if (p.type === PROP.ROOFPIECE && p.k === 190 && rnd() < 0.3) { // chimney tops
      perch(pick(rnd, [[BIRD.ROBIN, 25], [BIRD.DOVE, 25], [BIRD.CARDINAL, 15], [BIRD.STARLING, 20], [BIRD.SPARROW, 15]]), p.x, p.y, p.v * FLOOR_H + 0.19, 0.12);
    } else if (p.type === PROP.STEEPLE && rnd() < 0.8) {
      const n = 1 + ((rnd() * 3) | 0);
      for (let q = 0; q < n; q++) perch(rnd() < 0.7 ? BIRD.PIGEON : BIRD.DOVE, p.x + R(-0.15, 0.15), p.y + R(-0.15, 0.15), p.v * FLOOR_H + 0.3, 0.16);
    } else if (p.type === PROP.ANTENNA && rnd() < 0.12) {
      perch(rnd() < 0.5 ? BIRD.HAWK : BIRD.CROW, p.x, p.y, p.v * FLOOR_H + 0.62, 0.12);
    } else if (p.type === PROP.WEED && (p.k === 1 || p.k === 2) && rnd() < 0.18) { // redwings and goldfinches on the tall weeds
      perch(p.k === 2 ? BIRD.REDWING : BIRD.GOLDFINCH, p.x, p.y, p.k === 2 ? 0.36 : 0.22, 0.1);
    } else if (p.type === PROP.FLOWER && p.k <= 1 && rnd() < 0.05) { // hummingbirds at the flower beds
      birds.push({ sp: BIRD.HUMMING, mode: MODE.HOVER, cx: p.x, cy: p.y, ax: 0.12, ay: 0.12, az: 0.03, z: 0.2, w1: R(2, 4), w2: R(2, 4), w3: R(3, 5), ph: rnd() * 100, bias: 0.1 });
    }
  }

  /* on the utility wires: little rows of doves, starlings, sparrows, and the first barn swallows back */
  for (const w of wires) {
    if (rnd() > 0.3) continue;
    const len = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    const nx = -(w.y1 - w.y0) / len, ny = (w.x1 - w.x0) / len;
    const s = pick(rnd, [[BIRD.DOVE, 28], [BIRD.STARLING, 22], [BIRD.SPARROW, 14], [BIRD.SWALLOW, 24], [BIRD.PIGEON, 8], [BIRD.BLUEBIRD, 4]]);
    const n = 1 + ((rnd() * 4) | 0);
    for (let q = 0; q < n; q++) {
      const t = R(0.12, 0.88), off = -0.11, zz = 0.93 - 0.1 * (len / 6) * 4 * t * (1 - t);
      perch(s, w.x0 + (w.x1 - w.x0) * t + nx * off, w.y0 + (w.y1 - w.y0) * t + ny * off, zz, 0.12);
    }
  }

  /* on the rooftops */
  for (const b of buildings) {
    if (rnd() > 0.07) continue;
    const dt = dtype((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const table = dt === D.SUBURB
      ? [[BIRD.DOVE, 26], [BIRD.ROBIN, 20], [BIRD.CARDINAL, 16], [BIRD.SPARROW, 14], [BIRD.STARLING, 12], [BIRD.CROW, 8], [BIRD.BLUEJAY, 4]]
      : [[BIRD.PIGEON, 50], [BIRD.STARLING, 18], [BIRD.SPARROW, 12], [BIRD.CROW, 10], [BIRD.DOVE, 8], [BIRD.HAWK, b.h > 12 ? 5 : 0]];
    const s = pick(rnd, table);
    const n = s === BIRD.PIGEON || s === BIRD.STARLING ? 1 + ((rnd() * 3) | 0) : 1;
    for (let q = 0; q < n; q++) {
      const x = R(b.x0 + 0.3, Math.max(b.x0 + 0.31, b.x1 - 0.3)), y = R(b.y0 + 0.3, Math.max(b.y0 + 0.31, b.y1 - 0.3));
      perch(s, x, y, b.h * FLOOR_H + (dt === D.SUBURB ? 0.12 : 0.02), 0.1);
    }
  }

  /* geese heading north in a V, high up */
  const nGeese = Math.max(2, Math.round(6 * area));
  for (let g = 0; g < nGeese; g++) {
    const a = -Math.PI / 2 + R(-0.5, 0.5), speed = R(1.6, 2.2), n = 5 + ((rnd() * 5) | 0);
    const x0 = R(0, size), y0 = R(0, size), z0 = R(2.2, 3.8), ph = rnd() * 100;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let q = 0; q < n; q++) {
      const row = Math.ceil(q / 2), side = q === 0 ? 0 : (q % 2 ? 1 : -1);
      const bx = -dx * row * 0.7 - dy * side * row * 0.55, by = -dy * row * 0.7 + dx * side * row * 0.55;
      birds.push({ sp: BIRD.GOOSE, mode: MODE.LINE, x: x0 + bx, y: y0 + by, z: z0 + R(-0.05, 0.05), vx: dx * speed, vy: dy * speed, rate: 1.5, ph: ph + q * 0.13, bias: 0.3 });
    }
  }

  /* turkey vultures (a kettle of three or four) and red-tailed hawks, soaring in wide circles */
  for (let g = 0, n = Math.max(2, Math.round(8 * area)); g < n; g++) {
    const cx = R(0, size), cy = R(0, size), r = R(5, 11), w = (rnd() < 0.5 ? -1 : 1) * R(0.1, 0.17), z = R(2.6, 4.2);
    const m = 2 + ((rnd() * 3) | 0);
    for (let q = 0; q < m; q++) birds.push({ sp: BIRD.VULTURE, mode: MODE.CIRCLE, cx: cx + R(-1.5, 1.5), cy: cy + R(-1.5, 1.5), R: r + R(-1.5, 1.5), w, z: z + R(-0.4, 0.4), dz: 0.15, rate: 0, ph: rnd() * 100, bias: 0.3 });
  }
  for (let g = 0, n = Math.max(2, Math.round(7 * area)); g < n; g++) {
    birds.push({ sp: BIRD.HAWK, mode: MODE.CIRCLE, cx: R(0, size), cy: R(0, size), R: R(4, 9), w: (rnd() < 0.5 ? -1 : 1) * R(0.13, 0.22), z: R(2, 3.6), dz: 0.2, rate: 0, ph: rnd() * 100, bias: 0.3 });
  }

  /* crows, a few on the wing */
  for (let g = 0, n = Math.max(2, Math.round(14 * area)); g < n; g++) {
    const cx = R(0, size), cy = R(0, size), r = R(3, 9), w = (rnd() < 0.5 ? -1 : 1) * R(0.2, 0.35), z = R(0.9, 2);
    const m = 1 + ((rnd() * 3) | 0);
    for (let q = 0; q < m; q++) birds.push({ sp: BIRD.CROW, mode: MODE.CIRCLE, cx, cy, R: r + R(-0.8, 0.8), w, z: z + R(-0.2, 0.2), dz: 0.2, rate: 2.5, ph: rnd() * 100, bias: 0.2 });
  }

  /* pigeon flocks wheeling round the downtown and commercial blocks */
  for (let g = 0, n = Math.max(2, Math.round(12 * area)); g < n; g++) {
    let cx = 0, cy = 0;
    for (let tries = 0; tries < 40; tries++) {
      cx = R(0, size); cy = R(0, size);
      if (dtype(cx, cy) <= D.COMMERCIAL) break;
    }
    const r = R(3, 6), w = (rnd() < 0.5 ? -1 : 1) * R(0.3, 0.45), z = R(1.1, 2.6), m = 7 + ((rnd() * 6) | 0), ph0 = rnd() * 6.28;
    for (let q = 0; q < m; q++) birds.push({ sp: BIRD.PIGEON, mode: MODE.CIRCLE, cx, cy, R: r + R(-0.7, 0.7), w, z: z + R(-0.3, 0.3), dz: 0.25, rate: 3, ph: ph0 + R(-0.5, 0.5), bias: 0.2 });
  }

  /* barn swallows swooping low over the parks and lawns; starling murmurations */
  const parks = [];
  for (let y = 0; y < size; y += 3) for (let x = 0; x < size; x += 3) if (kind[y * size + x] === K.PARK) parks.push([x, y]);
  if (parks.length) {
    for (let g = 0, n = Math.max(3, Math.round(16 * area)); g < n; g++) {
      const [px, py] = parks[(rnd() * parks.length) | 0];
      const m = 2 + ((rnd() * 3) | 0);
      for (let q = 0; q < m; q++) birds.push({ sp: BIRD.SWALLOW, mode: MODE.FLIT, cx: px, cy: py, ax: R(3, 6), ay: R(3, 6), az: R(0.15, 0.3), z: R(0.5, 0.95), w1: R(0.7, 1.1), w2: R(0.6, 1), w3: R(1.5, 2.5), ph: rnd() * 100, rate: 4, bias: 0.15 });
    }
    for (let g = 0, n = Math.max(1, Math.round(3 * area)); g < n; g++) {
      const [px, py] = parks[(rnd() * parks.length) | 0], w1 = R(0.35, 0.5), w2 = R(0.3, 0.45), ph0 = rnd() * 100, z = R(1, 1.8);
      for (let q = 0; q < 14; q++) birds.push({ sp: BIRD.STARLING, mode: MODE.FLIT, cx: px, cy: py, ax: 5 + R(-0.6, 0.6), ay: 4 + R(-0.6, 0.6), az: 0.4, z, w1, w2, w3: 0.5, ph: ph0 + R(-0.35, 0.35), rate: 4.5, bias: 0.15 });
    }
  }
  return birds;
}

const P = { x: 0, y: 0, z: 0, hx: 1, hy: 0, flap: false, flying: false };

/** Position, heading and wing state of a bird at clock time t (seconds). Returns a shared object, so copy what you keep. */
function birdPose(b, t) {
  const o = P;
  switch (b.mode) {
    case MODE.PERCH: {
      const a = b.a + (Math.floor(t / (4 + (b.ph % 5)) + b.ph) & 1) * Math.PI; // now and then it turns round
      o.x = b.x; o.y = b.y; o.z = b.z; o.hx = Math.cos(a); o.hy = Math.sin(a); o.flap = false; o.flying = false;
      break;
    }
    case MODE.GROUND: {
      const a1 = 0.35 * t + b.ph, a2 = 0.27 * t + b.ph * 1.7;
      o.x = b.x + b.ax * Math.sin(a1); o.y = b.y + b.ay * Math.sin(a2);
      o.z = b.z + 0.012 * Math.abs(Math.sin(5 * t + b.ph));
      o.hx = b.ax * 0.35 * Math.cos(a1); o.hy = b.ay * 0.27 * Math.cos(a2);
      o.flap = false; o.flying = false;
      break;
    }
    case MODE.CIRCLE: {
      const a = b.w * t + b.ph, s = b.w < 0 ? -1 : 1;
      o.x = b.cx + b.R * Math.cos(a); o.y = b.cy + b.R * Math.sin(a);
      o.z = b.z + b.dz * Math.sin(0.4 * t + b.ph);
      o.hx = -s * Math.sin(a); o.hy = s * Math.cos(a);
      o.flap = b.rate > 0 && ((t * b.rate + b.ph) % 1) < 0.5; o.flying = true;
      break;
    }
    case MODE.LINE: {
      o.x = b.x + b.vx * t; o.y = b.y + b.vy * t; o.z = b.z + 0.08 * Math.sin(0.5 * t + b.ph);
      o.hx = b.vx; o.hy = b.vy;
      o.flap = ((t * b.rate + b.ph) % 1) < 0.5; o.flying = true;
      break;
    }
    case MODE.FLIT: case MODE.HOVER: {
      const a1 = b.w1 * t + b.ph, a2 = b.w2 * t + b.ph * 1.3;
      o.x = b.cx + b.ax * Math.sin(a1); o.y = b.cy + b.ay * Math.sin(a2);
      o.z = b.z + b.az * Math.sin(b.w3 * t + b.ph * 0.7);
      o.hx = b.ax * b.w1 * Math.cos(a1); o.hy = b.ay * b.w2 * Math.cos(a2);
      o.flap = b.mode === MODE.HOVER ? (Math.floor(t * 18) & 1) === 0 : ((t * b.rate + b.ph) % 1) < 0.5; o.flying = true;
      break;
    }
    default: break;
  }
  return o;
}

module.exports = { BIRD, MODE, SPECIES, makeBirds, birdPose };
