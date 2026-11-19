'use strict';
/**
 * Procedural city generator.
 *
 * World model (flat typed arrays, row-major, index = y * size + x; x grows east, y grows south):
 *   kind[]      what a tile is (K.*)
 *   height[]    building height in floors (0 for anything you can walk on)
 *   district[]  index into world.districts
 *   bid[]       building id (>0 on building tiles), used for per-building variation
 *   mark[]      road paint code for ROAD tiles (see ROAD_MARK)
 *   deco[]      crosswalks on road tiles next to intersections (see DECO)
 *   glow[]      0-255 lamp light pooled on each tile (used for night ground lighting)
 *   props[]     street furniture: {x, y, type: PROP.*, v}; v = variant (signal: 0 red, 1 green;
 *               rooftop tank/antenna: building height in floors)
 *   wires[]     utility lines between poles: {x0, y0, x1, y1}
 *
 * One tile is about 8 m. FLOOR_H and EYE_Z (in tiles) live in render.js.
 */

const { mulberry32, hash2, toSeed } = require('./rng');
const { makeNamer } = require('./names');

const K = { NONE: 0, ROAD: 1, SIDEWALK: 2, PARK: 3, BUILDING: 4, PLAZA: 5 };
const D = { DOWNTOWN: 0, COMMERCIAL: 1, RESIDENTIAL: 2, INDUSTRIAL: 3, PARKLAND: 4 };
const DISTRICT_TYPE_NAMES = ['downtown', 'commercial', 'residential', 'industrial', 'parkland'];

/** Road paint. v = vertical road (runs north-south), h = horizontal road (runs east-west). */
const ROAD_MARK = { NONE: 0, V_CENTER: 1, V_LEFT: 2, V_RIGHT: 3, H_CENTER: 4, H_TOP: 5, H_BOTTOM: 6 };

/** Solid footprint radius (tiles) of props that block walking. Rooftop props and wires are not solid. */
const PROP_RADIUS = { 1: 0.07, 2: 0.11, 3: 0.07, 4: 0.09, 5: 0.08 }; // lamp, tree trunk, signal, hydrant, pole

/** Anything outside the map reads as a tall boundary wall. */
const EDGE_HEIGHT = 90;

/** Street furniture ("props"): standing objects drawn as sprites. */
const PROP = { LAMP: 1, TREE: 2, SIGNAL: 3, HYDRANT: 4, POLE: 5, TANK: 6, ANTENNA: 7 };
/** deco[]: crosswalk on a road tile, named for the intersection arm it sits on. */
const DECO = { NONE: 0, CROSS_N: 1, CROSS_S: 2, CROSS_W: 3, CROSS_E: 4, MANHOLE: 5 };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * @param {{seed?: number|string, size?: number}} opts
 */
function generateWorld(opts = {}) {
  /* a multiple of 24 keeps noise cells (8) and pole spacing (12) periodic across the wrap seam */
  const size = Math.max(48, Math.round((opts.size || 192) / 24) * 24);
  const wrap = opts.wrap !== false;
  const seedValue = toSeed(opts.seed === undefined ? 'aurora' : opts.seed);
  const rng = mulberry32(seedValue);
  const namer = makeNamer(rng);
  const n = size * size;

  const kind = new Uint8Array(n);
  const height = new Uint8Array(n);
  const district = new Uint8Array(n);
  const bid = new Uint16Array(n);
  const mark = new Uint8Array(n);
  const mod = (v) => ((v % size) + size) % size;
  const wd = (d) => d - size * Math.round(d / size); // shortest signed difference on the torus
  const idx = (x, y) => mod(y) * size + mod(x);        // every lookup wraps, so blocks may straddle the seam

  /* ---- districts: one downtown near the middle plus scattered seeds, nearest-seed wins ---- */
  const districts = [];
  districts.push({ type: D.DOWNTOWN, cx: size * (0.42 + rng() * 0.16), cy: size * (0.42 + rng() * 0.16) });
  for (const t of [D.COMMERCIAL, D.COMMERCIAL, D.RESIDENTIAL, D.RESIDENTIAL, D.RESIDENTIAL, D.INDUSTRIAL, D.PARKLAND]) {
    districts.push({ type: t, cx: size * (0.15 + rng() * 0.7), cy: size * (0.15 + rng() * 0.7) });
  }
  /* the wrap seam runs through quiet residential and parkland outskirts, far from downtown */
  districts.push({ type: D.RESIDENTIAL, cx: 0, cy: size * 0.27 }, { type: D.PARKLAND, cx: 0, cy: size * 0.73 },
                 { type: D.RESIDENTIAL, cx: size * 0.27, cy: 0 }, { type: D.PARKLAND, cx: size * 0.73, cy: 0 });
  for (const d of districts) d.name = namer.district(DISTRICT_TYPE_NAMES[d.type]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const noise = (hash2(x >> 3, y >> 3, seedValue) / 4294967296) * 6;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < districts.length; i++) {
        const dx = wd(x - districts[i].cx), dy = wd(y - districts[i].cy);
        const dist = Math.hypot(dx, dy) * (i === 0 ? 0.9 : 1) + noise;
        if (dist < bestD) { bestD = dist; best = i; }
      }
      district[idx(x, y)] = best;
    }
  }

  /* ---- roads: a jittered grid; every third line is a wider named avenue ---- */
  function roadLines() {
    const out = [];
    const start = 3 + Math.floor(rng() * 5);
    const limit = start + size; // roads and the gaps between them tile the whole circle [start, start + size)
    let p = start, i = 0;
    for (;;) {
      const avenue = i % 3 === 0, w = avenue ? 3 : 2;
      if (limit - (p + w) < 6) break; // no room for this road plus a closing gap
      out.push({ pos: p, w, avenue, name: namer.street(avenue) });
      i++;
      if (limit - (p + w) <= 12) break; // what is left becomes the closing gap
      p += w + 6 + Math.floor(rng() * 7);
    }
    const last = out[out.length - 1];
    const closing = limit - (last.pos + last.w);
    if (closing > 13) { // a closing gap that came out too wide gets one more street in the middle
      out.push({ pos: last.pos + last.w + ((closing - 2) >> 1), w: 2, avenue: false, name: namer.street(false) });
    }
    return out; // positions may run a tile or two past `size`; lookups wrap
  }
  const vRoads = roadLines(); // positioned by x, run along y
  const hRoads = roadLines(); // positioned by y, run along x

  const vCover = new Int16Array(size).fill(-1);
  const hCover = new Int16Array(size).fill(-1);
  vRoads.forEach((r, i) => { for (let x = r.pos; x < r.pos + r.w; x++) vCover[mod(x)] = i; });
  hRoads.forEach((r, i) => { for (let y = r.pos; y < r.pos + r.w; y++) hCover[mod(y)] = i; });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const vi = vCover[x], hi = hCover[y];
      if (vi < 0 && hi < 0) continue;
      const t = idx(x, y);
      kind[t] = K.ROAD;
      if (vi >= 0 && hi >= 0) continue; // intersection: unpainted
      if (vi >= 0) {
        const r = vRoads[vi], li = mod(x - r.pos);
        mark[t] = r.w === 3 ? (li === 1 ? ROAD_MARK.V_CENTER : 0) : (li === 0 ? ROAD_MARK.V_RIGHT : ROAD_MARK.V_LEFT);
      } else {
        const r = hRoads[hi], li = mod(y - r.pos);
        mark[t] = r.w === 3 ? (li === 1 ? ROAD_MARK.H_CENTER : 0) : (li === 0 ? ROAD_MARK.H_BOTTOM : ROAD_MARK.H_TOP);
      }
    }
  }

  /* ---- blocks: the rectangles between roads ---- */
  function gaps(roads) { // cyclic: the last gap runs through the seam to the first road
    const out = [];
    for (let i = 0; i < roads.length; i++) {
      const a = roads[i], b = roads[(i + 1) % roads.length];
      const g0 = a.pos + a.w, g1 = i + 1 < roads.length ? b.pos : b.pos + size;
      if (g1 > g0) out.push([g0, g1]);
    }
    return out;
  }
  const xGaps = gaps(vRoads), yGaps = gaps(hRoads);

  let nextBid = 1;

  function pickHeight(type, x, y) {
    const core = Math.hypot(wd(x - districts[0].cx), wd(y - districts[0].cy));
    const falloff = Math.exp(-Math.pow(core / 16, 2)); // towers cluster in the core
    switch (type) {
      case D.DOWNTOWN: return clamp(Math.round(4 + 6 * falloff + Math.pow(rng(), 1.3) * 30 * falloff), 4, 40);
      case D.COMMERCIAL: return 3 + Math.floor(rng() * 6) + (rng() < 0.08 ? 6 : 0);
      case D.RESIDENTIAL: return 2 + Math.floor(rng() * 3);
      case D.INDUSTRIAL: return 1 + Math.floor(rng() * 3);
      default: return 1 + Math.floor(rng() * 2);
    }
  }

  function placeBuilding(x0, y0, x1, y1, type) {
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const id = nextBid++ % 65535 + 1;
    const h = pickHeight(type, (x0 + x1) / 2, (y0 + y1) / 2);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = idx(x, y);
        kind[t] = K.BUILDING; height[t] = h; bid[t] = id;
      }
    }
    // tall downtown towers get a narrower upper tier for a varied skyline
    if (type === D.DOWNTOWN && h >= 14 && x1 - x0 >= 4 && y1 - y0 >= 4) {
      const extra = 4 + Math.floor(rng() * 7);
      for (let y = y0 + 1; y < y1 - 1; y++) {
        for (let x = x0 + 1; x < x1 - 1; x++) height[idx(x, y)] = clamp(h + extra, 0, 80);
      }
    }
  }

  function subdivide(x0, y0, x1, y1, type) {
    const w = x1 - x0, h = y1 - y0;
    const minLot = 3;
    const maxArea = type === D.INDUSTRIAL ? 60 : type === D.DOWNTOWN ? 28 : 24;
    if ((w * h <= maxArea && rng() < 0.85) || (w < minLot * 2 && h < minLot * 2)) {
      const alleyChance = type === D.DOWNTOWN ? 0.25 : type === D.RESIDENTIAL ? 0.7 : 0.45;
      const insetX = w > 4 && rng() < alleyChance ? 1 : 0;
      const insetY = h > 4 && rng() < alleyChance ? 1 : 0;
      placeBuilding(x0 + insetX, y0 + insetY, x1, y1, type);
      return;
    }
    if (w >= h && w >= minLot * 2) {
      const s = x0 + minLot + Math.floor(rng() * (w - 2 * minLot + 1));
      subdivide(x0, y0, s, y1, type);
      subdivide(s, y0, x1, y1, type);
    } else if (h >= minLot * 2) {
      const s = y0 + minLot + Math.floor(rng() * (h - 2 * minLot + 1));
      subdivide(x0, y0, x1, s, type);
      subdivide(x0, s, x1, y1, type);
    } else {
      placeBuilding(x0, y0, x1, y1, type);
    }
  }

  for (const [bx0, bx1] of xGaps) {
    for (const [by0, by1] of yGaps) {
      for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) kind[idx(x, y)] = K.SIDEWALK;
      const ix0 = bx0 + 1, iy0 = by0 + 1, ix1 = bx1 - 1, iy1 = by1 - 1;
      if (ix1 - ix0 < 2 || iy1 - iy0 < 2) continue;
      const cx = (bx0 + bx1) >> 1, cy = (by0 + by1) >> 1;
      const type = districts[district[idx(cx, cy)]].type;
      const roll = rng();
      let use = 'buildings';
      if (type === D.PARKLAND) use = roll < 0.7 ? 'park' : roll < 0.9 ? 'plaza' : 'buildings';
      else if (type === D.DOWNTOWN) use = roll < 0.1 ? 'plaza' : 'buildings';
      else use = roll < 0.08 ? 'park' : 'buildings';

      if (use === 'park' || use === 'plaza') {
        const k = use === 'park' ? K.PARK : K.PLAZA;
        for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) kind[idx(x, y)] = k;
      } else {
        subdivide(ix0, iy0, ix1, iy1, type);
      }
    }
  }

  /* ---- spawn: an intersection outside downtown, about 24 tiles out, facing the skyline ---- */
  const dt = districts[0];
  let spawn = null, bestScore = Infinity;
  for (const v of vRoads) {
    for (const h of hRoads) {
      const x = mod(v.pos + v.w / 2), y = mod(h.pos + h.w / 2);
      if (districts[district[idx(Math.floor(x), Math.floor(y))]].type === D.DOWNTOWN) continue;
      const score = Math.abs(Math.hypot(wd(x - dt.cx), wd(y - dt.cy)) - 32);
      if (score < bestScore) { bestScore = score; spawn = { x, y, angle: Math.atan2(wd(dt.cy - y), wd(dt.cx - x)) }; }
    }
  }
  if (!spawn) { // degenerate seeds: fall back to the intersection nearest the middle
    const sv = vRoads[vRoads.length >> 1], sh = hRoads[hRoads.length >> 1];
    spawn = { x: mod(sv.pos + sv.w / 2), y: mod(sh.pos + sh.w / 2), angle: 0 };
  }

  /* ---- landmarks: the tallest building in each district ---- */
  const landmarks = [];
  const tallest = districts.map(() => ({ h: 0, x: 0, y: 0 }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = idx(x, y);
      if (height[t] > tallest[district[t]].h) tallest[district[t]] = { h: height[t], x, y };
    }
  }
  tallest.forEach((b, i) => {
    if (b.h > 0) landmarks.push({ name: namer.landmark(), x: b.x + 0.5, y: b.y + 0.5, height: b.h, district: i });
  });

  /* ---- street furniture: uses hash2 only, so it never disturbs the generator's random stream ---- */
  const deco = new Uint8Array(size * size);
  const glow = new Uint8Array(size * size);
  const props = [];
  const h01 = (x, y, salt) => hash2(x, y, (seedValue ^ salt) | 0) / 4294967296;
  const kindOf = (x, y) => kind[idx(x, y)];

  for (const v of vRoads) {
    for (const h of hRoads) {
      /* crosswalks on the four arms */
      for (let x = v.pos; x < v.pos + v.w; x++) {
        if (kindOf(x, h.pos - 1) === K.ROAD) deco[idx(x, h.pos - 1)] = DECO.CROSS_N;
        if (kindOf(x, h.pos + h.w) === K.ROAD) deco[idx(x, h.pos + h.w)] = DECO.CROSS_S;
      }
      for (let y = h.pos; y < h.pos + h.w; y++) {
        if (kindOf(v.pos - 1, y) === K.ROAD) deco[idx(v.pos - 1, y)] = DECO.CROSS_W;
        if (kindOf(v.pos + v.w, y) === K.ROAD) deco[idx(v.pos + v.w, y)] = DECO.CROSS_E;
      }
      /* signals on the corner sidewalks; diagonal corners share a colour */
      const flip = hash2(v.pos, h.pos, seedValue | 0) & 1;
      const corners = [
        [v.pos - 1, h.pos - 1, 0.85, 0.85, 0], [v.pos + v.w, h.pos - 1, 0.15, 0.85, 1],
        [v.pos - 1, h.pos + h.w, 0.85, 0.15, 1], [v.pos + v.w, h.pos + h.w, 0.15, 0.15, 0],
      ];
      for (const [cx, cy, ox, oy, par] of corners) {
        if (kindOf(cx, cy) === K.SIDEWALK) props.push({ x: mod(cx) + ox, y: mod(cy) + oy, type: PROP.SIGNAL, v: par ^ flip });
      }
    }
  }

  const isRoad = (x, y) => kindOf(x, y) === K.ROAD;
  const poles = new Map(); // 'h|v:line:along' -> pole, to string wires between neighbours
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = kind[idx(x, y)];
      if (k === K.PARK) {
        if (h01(x, y, 0x7ee) < 0.16) props.push({ x: x + 0.2 + 0.6 * h01(x, y, 0x11), y: y + 0.2 + 0.6 * h01(x, y, 0x22), type: PROP.TREE, v: 0 });
      } else if (k === K.SIDEWALK) {
        const rw = isRoad(x - 1, y), re = isRoad(x + 1, y), rn = isRoad(x, y - 1), rs = isRoad(x, y + 1);
        const horiz = rw || re, vert = rn || rs;
        if (horiz === vert) continue; // not beside a road, or a corner tile
        const along = horiz ? y : x;
        const side = (rw || rn) ? 0 : 3; // stagger the two sides of a street
        const px = x + 0.5 + (rw ? -0.34 : re ? 0.34 : 0), py = y + 0.5 + (rn ? -0.34 : rs ? 0.34 : 0);
        if (along % 6 === 2 + side) {
          props.push({ x: px, y: py, type: PROP.LAMP, v: 0 });
        } else if (along % 6 === side && districts[district[idx(x, y)]].type >= D.RESIDENTIAL && h01(x, y, 0x33) < 0.6) {
          props.push({ x: x + 0.5, y: y + 0.5, type: PROP.TREE, v: 1 });
        } else if (side === 0 && along % 12 === 4 && (() => { const dtp = districts[district[idx(x, y)]].type; return dtp !== D.DOWNTOWN && dtp !== D.PARKLAND; })()) {
          const pole = { x: px, y: py, type: PROP.POLE, v: 0, horiz, along };
          props.push(pole);
          poles.set((horiz ? 'h:' + x : 'v:' + y) + ':' + along, pole);
        } else if (along % 12 === (side ? 10 : 1) && h01(x, y, 0x44) < 0.5) {
          props.push({ x: px, y: py, type: PROP.HYDRANT, v: 0 });
        }
      }
    }
  }
  /* utility wires between neighbouring poles on the same street */
  const wires = [];
  for (const [key, a] of poles) {
    const [dir, line, along] = key.split(':');
    const b = poles.get(dir + ':' + line + ':' + ((+along + 12) % size));
    if (b) wires.push({ x0: a.x, y0: a.y, x1: a.x + wd(b.x - a.x), y1: a.y + wd(b.y - a.y) }); // may run through the seam
  }
  /* manholes on plain road tiles */
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = idx(x, y);
    if (kind[t] === K.ROAD && deco[t] === 0 && h01(x, y, 0x55) < 0.05) deco[t] = DECO.MANHOLE;
  }
  /* rooftop water tanks on mid-rise buildings, antennas on towers */
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = idx(x, y);
    if (kind[t] !== K.BUILDING) continue;
    const hh = height[t];
    if (hh >= 5 && hh <= 18 && h01(x, y, 0x77) < 0.012) props.push({ x: x + 0.5, y: y + 0.5, type: PROP.TANK, v: hh });
    else if (hh >= 22 && h01(x, y, 0x78) < 0.05) props.push({ x: x + 0.5, y: y + 0.5, type: PROP.ANTENNA, v: hh });
  }
  for (const p of props) {
    if (p.type !== PROP.LAMP) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const tx = Math.floor(p.x) + dx, ty = Math.floor(p.y) + dy;
      const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y);
      if (d < 2.4) { const t = idx(tx, ty); glow[t] = Math.min(255, glow[t] + Math.round(210 * Math.pow(1 - d / 2.4, 1.4))); }
    }
  }

  /* spatial index for collision: tile index -> solid props whose centre is in that tile */
  const propGrid = new Map();
  for (const p of props) {
    if (!PROP_RADIUS[p.type]) continue;
    const k = idx(Math.floor(p.x), Math.floor(p.y));
    const list = propGrid.get(k);
    if (list) list.push(p); else propGrid.set(k, [p]);
  }

  return {
    seed: seedValue, size, wrap, kind, height, district, bid, mark, deco, glow, props, wires, propGrid,
    districts, vRoads, hRoads, spawn, landmarks,
  };
}

/* ---------- queries ---------- */

function inBounds(world, x, y) {
  return world.wrap || (x >= 0 && y >= 0 && x < world.size && y < world.size);
}

/** Wrap a coordinate into [0, size). Identity when the world has walls. */
function wrapCoord(world, v) {
  return world.wrap ? ((v % world.size) + world.size) % world.size : v;
}

/** Shortest signed difference between two coordinates. Plain subtraction when the world has walls. */
function wrapDelta(world, d) {
  return world.wrap ? d - world.size * Math.round(d / world.size) : d;
}

function tileAt(world, x, y) {
  const tx = Math.floor(wrapCoord(world, x)), ty = Math.floor(wrapCoord(world, y));
  return inBounds(world, tx, ty) ? ty * world.size + tx : -1;
}

/** Building height in floors at a (possibly fractional) position; EDGE_HEIGHT outside a walled map. */
function heightAt(world, x, y) {
  const t = tileAt(world, x, y);
  return t < 0 ? EDGE_HEIGHT : world.height[t];
}

function kindAt(world, x, y) {
  const t = tileAt(world, x, y);
  return t < 0 ? K.NONE : world.kind[t];
}

/** A point is walkable when it is inside the map and not inside a building. */
function isWalkable(world, x, y) {
  const t = tileAt(world, x, y);
  return t >= 0 && world.height[t] === 0;
}

/** Nearest road on one axis (distance measured to the road's center line). */
function nearestRoad(world, roads, p) {
  let best = roads[0], bd = Infinity;
  for (const r of roads) {
    const d = Math.abs(wrapDelta(world, p - (r.pos + r.w / 2)));
    if (d < bd) { bd = d; best = r; }
  }
  return { road: best, dist: bd };
}

/**
 * Where am I? Returns district, current street, cross street and tile kind.
 * "Street" is whichever road is closest; "cross" is the nearest road on the other axis.
 */
function locate(world, x, y) {
  const cxp = world.wrap ? wrapCoord(world, x) : clamp(x, 0, world.size - 1e-6);
  const cyp = world.wrap ? wrapCoord(world, y) : clamp(y, 0, world.size - 1e-6);
  const tx = Math.floor(cxp), ty = Math.floor(cyp);
  const t = ty * world.size + tx;
  const d = world.districts[world.district[t]];
  const v = nearestRoad(world, world.vRoads, cxp); // vertical road: distance along x
  const h = nearestRoad(world, world.hRoads, cyp);
  const alongV = v.dist <= h.dist;
  return {
    district: d.name,
    districtType: DISTRICT_TYPE_NAMES[d.type],
    street: (alongV ? v.road : h.road).name,
    cross: (alongV ? h.road : v.road).name,
    kind: world.kind[t],
    height: world.height[t],
  };
}

/** FNV-1a over the world arrays; used by tests to assert determinism. */
/**
 * Smallest gap between a body of radius r at (x, y) and any solid prop nearby.
 * Negative means overlapping. Infinity when nothing is close.
 */
function propClearance(world, x, y, r) {
  const size = world.size;
  const tx = Math.floor(wrapCoord(world, x)), ty = Math.floor(wrapCoord(world, y));
  let best = Infinity;
  for (let j = ty - 1; j <= ty + 1; j++) {
    for (let i = tx - 1; i <= tx + 1; i++) {
      let ci = i, cj = j;
      if (world.wrap) { ci = (i + size) % size; cj = (j + size) % size; } else if (i < 0 || j < 0 || i >= size || j >= size) continue;
      const list = world.propGrid.get(cj * size + ci);
      if (!list) continue;
      for (const p of list) {
        const c = Math.hypot(wrapDelta(world, p.x - x), wrapDelta(world, p.y - y)) - r - PROP_RADIUS[p.type];
        if (c < best) best = c;
      }
    }
  }
  return best;
}

function worldHash(world) {
  let h = 2166136261 >>> 0;
  const feed = (arr) => { for (let i = 0; i < arr.length; i++) { h ^= arr[i] & 0xff; h = Math.imul(h, 16777619) >>> 0; } };
  feed(world.kind); feed(world.height); feed(world.district); feed(world.mark); feed(world.deco); feed(world.glow);
  h ^= world.props.length ^ (world.wires.length << 12); h = Math.imul(h, 16777619) >>> 0;
  return h >>> 0;
}

module.exports = {
  K, D, DISTRICT_TYPE_NAMES, ROAD_MARK, EDGE_HEIGHT, PROP, DECO,
  generateWorld, inBounds, heightAt, kindAt, isWalkable, locate, worldHash, propClearance, PROP_RADIUS, wrapCoord, wrapDelta,
};
