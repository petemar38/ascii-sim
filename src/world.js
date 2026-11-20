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

const K = { NONE: 0, ROAD: 1, SIDEWALK: 2, PARK: 3, BUILDING: 4, PLAZA: 5, YARD: 6 };
const D = { DOWNTOWN: 0, COMMERCIAL: 1, RESIDENTIAL: 2, INDUSTRIAL: 3, PARKLAND: 4, SUBURB: 5 };
const DISTRICT_TYPE_NAMES = ['downtown', 'commercial', 'residential', 'industrial', 'parkland', 'suburb'];

/** Road paint. v = vertical road (runs north-south), h = horizontal road (runs east-west). */
const ROAD_MARK = { NONE: 0, V_CENTER: 1, V_LEFT: 2, V_RIGHT: 3, H_CENTER: 4, H_TOP: 5, H_BOTTOM: 6 };

/** Kinds of shops and public buildings. STORE_SIGN is the text painted on the sign (8 characters at most). */
const STORE = { GROCERY: 1, LIBRARY: 2, PHARMACY: 3, DINER: 4, BANK: 5, HOTEL: 6, SCHOOL: 7, FIREHALL: 8, CHURCH: 9, HARDWARE: 10 };
const STORE_SIGN = ['', 'GROCERY', 'LIBRARY', 'PHARMACY', 'DINER', 'BANK', 'HOTEL', 'SCHOOL', 'FIREHALL', 'CHURCH', 'HARDWARE'];
/** Styles of suburban houses (the facade and the roof both follow the style). */
const HOUSE = { RANCH: 1, COLONIAL: 2, BUNGALOW: 3, TUDOR: 4, MODERN: 5, VICTORIAN: 6 };
const HOUSE_FLOORS = [0, 1, 2, 1, 2, 2, 3];
/** Which face of a building carries its storefront (the direction the face looks towards). */
const FACE = { N: 1, S: 2, W: 3, E: 4 };

/** Solid footprint radius (tiles) of props that block walking. Rooftop props and wires are not solid. */
const PROP_RADIUS = { 1: 0.07, 2: 0.11, 3: 0.07, 4: 0.09, 5: 0.08, 10: 0.2 }; // lamp, tree trunk, signal, hydrant, pole, playground equipment

/** Anything outside the map reads as a tall boundary wall. */
const EDGE_HEIGHT = 90;

/** Street furniture ("props"): standing objects drawn as sprites. */
const PROP = { LAMP: 1, TREE: 2, SIGNAL: 3, HYDRANT: 4, POLE: 5, TANK: 6, ANTENNA: 7, STEEPLE: 8, ROOFPIECE: 9, PLAY: 10 };
/** deco[]: crosswalk on a road tile, named for the intersection arm it sits on. */
const DECO = { NONE: 0, CROSS_N: 1, CROSS_S: 2, CROSS_W: 3, CROSS_E: 4, MANHOLE: 5 };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * @param {{seed?: number|string, size?: number}} opts
 */
function generateWorld(opts = {}) {
  /* a multiple of 24 keeps noise cells (8) and pole spacing (12) periodic across the wrap seam */
  const size = Math.max(48, Math.round((opts.size || 288) / 24) * 24);
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
  /* suburbs: a few seeds well away from downtown */
  for (let i = 0, nSub = Math.max(3, Math.round(size / 40)); i < nSub; i++) {
    let cx = 0, cy = 0;
    for (let tries = 0; tries < 40; tries++) {
      cx = size * (0.05 + rng() * 0.9); cy = size * (0.05 + rng() * 0.9);
      if (Math.hypot(wd(cx - districts[0].cx), wd(cy - districts[0].cy)) > size * 0.28) break;
    }
    districts.push({ type: D.SUBURB, cx, cy });
  }
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
  const buildings = []; // every lot placed: {id, x0, y0, x1, y1, h, type}

  function pickHeight(type, x, y, area) {
    const core = Math.hypot(wd(x - districts[0].cx), wd(y - districts[0].cy));
    const falloff = Math.exp(-Math.pow(core / 16, 2)); // towers cluster in the core
    const r = rng(), spread = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    const big = Math.min(1, area / 40); // bigger footprints make taller buildings more likely
    switch (type) {
      case D.DOWNTOWN:
        if (r < 0.1) return spread(2, 4); // an old low building squeezed between towers
        return clamp(Math.round(4 + 6 * falloff + Math.pow(rng(), 1.3) * 30 * falloff), 4, 40);
      case D.COMMERCIAL:
        if (r < 0.14) return 1;
        if (r < 0.62) return spread(2, 5);
        if (r < 0.9) return spread(5, 9);
        return spread(10, 16 + Math.round(big * 6));
      case D.RESIDENTIAL:
        if (r < 0.1) return 1;
        if (r < 0.62) return spread(2, 4); // brownstones and rowhouses
        if (r < 0.86) return spread(4, 7);
        if (r < 0.96) return spread(8, 12);
        return spread(14, 20 + Math.round(big * 6)); // the odd apartment tower
      case D.INDUSTRIAL:
        if (r < 0.7) return spread(1, 2);
        if (r < 0.93) return spread(3, 4);
        return spread(5, 8);
      default: return r < 0.8 ? 1 : spread(2, 3);
    }
  }

  function placeBuilding(x0, y0, x1, y1, type, forceH) {
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    const id = nextBid++ % 65535 + 1;
    let h = forceH || pickHeight(type, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * (y1 - y0));
    // keep the wrap-around seam quiet: nothing tall within 12 tiles of it, so it is hard to spot
    const seamDist = (a0, a1) => { const m0 = mod(a0), m1 = mod(a1 - 1); return m1 < m0 ? 0 : Math.min(m0, size - 1 - m1); }; // 0 when the lot straddles the seam
    if (Math.min(seamDist(x0, x1), seamDist(y0, y1)) < 12) h = Math.min(h, 6);
    buildings.push({ id, x0, y0, x1, y1, h, type });
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

  function subdivide(x0, y0, x1, y1, type, grain) {
    const w = x1 - x0, h = y1 - y0;
    const minLot = type !== D.INDUSTRIAL && grain < 0.45 ? 2 : 3; // fine-grained blocks get narrow rowhouse lots
    const base = type === D.INDUSTRIAL ? 60 : type === D.DOWNTOWN ? 28 : 24;
    const maxArea = Math.round(base * (grain < 0.2 ? 0.3 : grain < 0.45 ? 0.5 : grain < 0.75 ? 1 : grain < 0.92 ? 2.4 : 5)); // 5 = one big slab per block
    if ((w * h <= maxArea && rng() < 0.9) || (w < minLot * 2 && h < minLot * 2)) {
      const alleyChance = type === D.DOWNTOWN ? 0.25 : type === D.RESIDENTIAL ? 0.7 : 0.45;
      const insetX = w > 4 && rng() < alleyChance ? 1 : 0;
      const insetY = h > 4 && rng() < alleyChance ? 1 : 0;
      placeBuilding(x0 + insetX, y0 + insetY, x1, y1, type);
      return;
    }
    // split along the long side; the cut lands anywhere that leaves both halves at least minLot wide
    if (w >= h && w >= minLot * 2) {
      const s = x0 + minLot + Math.floor(rng() * (w - 2 * minLot + 1));
      subdivide(x0, y0, s, y1, type, grain);
      subdivide(s, y0, x1, y1, type, grain);
    } else if (h >= minLot * 2) {
      const s = y0 + minLot + Math.floor(rng() * (h - 2 * minLot + 1));
      subdivide(x0, y0, x1, s, type, grain);
      subdivide(x0, s, x1, y1, type, grain);
    } else {
      placeBuilding(x0, y0, x1, y1, type);
    }
  }

  /* ---- suburbs: detached houses with front yards, driveways, the odd playground and school ---- */
  const houses = new Map();   // front-wall tile -> {style, face, door, garage, floors, i}
  const playProps = [], roofProps = [], pendingSchools = [];
  function scatterPlay(x0, y0, x1, y1, n) {
    const mine = [];
    for (let tries = 0; tries < n * 12 && mine.length < n; tries++) {
      const x = x0 + 0.7 + rng() * (x1 - x0 - 1.4), y = y0 + 0.7 + rng() * (y1 - y0 - 1.4);
      if (mine.some((q) => Math.hypot(q.x - x, q.y - y) < 1.5)) continue;
      mine.push({ x: mod(x), y: mod(y), type: PROP.PLAY, v: Math.floor(rng() * 4) });
    }
    for (const p of mine) playProps.push(p);
  }
  function suburbBlock(ix0, iy0, ix1, iy1) {
    const W = ix1 - ix0, H = iy1 - iy0;
    for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) kind[idx(x, y)] = K.YARD;
    const roll = rng();
    if (roll < 0.08 && W >= 6 && H >= 7) { // a school: long low building on the street, playground and field behind
      placeBuilding(ix0, iy0, ix1, iy0 + 3, D.SUBURB, 2);
      pendingSchools.push(buildings[buildings.length - 1]);
      scatterPlay(ix0, iy0 + 3, ix1, iy1, 3 + Math.floor(rng() * 3));
      return;
    }
    if (roll < 0.18 && W >= 4 && H >= 4) { // a playground park
      for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) kind[idx(x, y)] = K.PARK;
      scatterPlay(ix0, iy0, ix1, iy1, 3 + Math.floor(W * H / 14));
      return;
    }
    const alongX = W >= H, L = alongX ? W : H, Dd = alongX ? H : W;
    const rowDepths = Dd >= 6 ? [Dd >> 1, Dd - (Dd >> 1)] : [Dd];
    let off = 0;
    rowDepths.forEach((rd, ri) => {
      const frontLow = rowDepths.length === 2 ? ri === 0 : rng() < 0.5; // the street this row of houses faces
      let c = 0;
      while (c <= L - 3) {
        let lw = 3 + Math.floor(rng() * 3);
        if (c + lw > L) lw = L - c;
        if (lw < 3) break;
        let hw = lw >= 5 ? 3 + (rng() < 0.5 ? 1 : 0) : lw - 1;
        hw = Math.max(2, Math.min(hw, lw));
        const a0 = c + Math.floor(rng() * (lw - hw + 1));
        const hd = rd >= 5 ? 2 + Math.floor(rng() * 2) : Math.max(2, rd - 1);
        const fy = Math.min(rd - hd, 1 + (rd - hd - 1 > 1 && rng() < 0.5 ? 1 : 0));
        c += lw;
        if (hd < 2 || fy < 1) continue;
        const cross0 = frontLow ? off + fy : off + rd - fy - hd;
        const x0 = alongX ? ix0 + a0 : ix0 + cross0, y0 = alongX ? iy0 + cross0 : iy0 + a0;
        const x1 = alongX ? x0 + hw : x0 + hd, y1 = alongX ? y0 + hd : y0 + hw;
        // style: big lots get big houses
        const pool = hw >= 4 ? [2, 4, 6, 6] : [1, 1, 2, 2, 3, 3, 4, 5, 5, 6];
        const style = pool[Math.floor(rng() * pool.length)];
        const floors = HOUSE_FLOORS[style];
        const garage = (style === HOUSE.RANCH || style === HOUSE.MODERN || (style === HOUSE.COLONIAL && rng() < 0.5)) && hw >= 2;
        const garageK = garage ? (rng() < 0.5 ? 0 : hw - 1) : -1;
        const doorK = garage ? (garageK === 0 ? hw - 1 : 0) : (hw >> 1);
        placeBuilding(x0, y0, x1, y1, D.SUBURB, floors);
        const face = alongX ? (frontLow ? FACE.N : FACE.S) : (frontLow ? FACE.W : FACE.E);
        const crossFront = frontLow ? cross0 : cross0 + hd - 1;
        for (let k = 0; k < hw; k++) {
          const tx = alongX ? ix0 + a0 + k : ix0 + crossFront, ty = alongX ? iy0 + crossFront : iy0 + a0 + k;
          houses.set(idx(tx, ty), { style, face, door: doorK, garage: garageK, floors, i: k, hw });
        }
        for (const k of [doorK, garageK]) { // driveway and front path run from the sidewalk to the house
          if (k < 0) continue;
          for (let s = 0; s < fy; s++) {
            const cr = frontLow ? off + s : off + rd - 1 - s;
            kind[idx(alongX ? ix0 + a0 + k : ix0 + cr, alongX ? iy0 + cr : iy0 + a0 + k)] = K.SIDEWALK;
          }
        }
        const rx = (x0 + x1) / 2, ry = (y0 + y1) / 2;
        roofProps.push({ x: mod(rx), y: mod(ry), type: PROP.ROOFPIECE, v: floors, k: 100 + style, w: (hw + hd) / 2 });
        if (style !== HOUSE.MODERN && rng() < 0.65) roofProps.push({ x: mod(rx + (rng() - 0.5) * (x1 - x0 - 1)), y: mod(ry + (rng() - 0.5) * (y1 - y0 - 1)), type: PROP.ROOFPIECE, v: floors, k: 190 });
      }
      off += rd;
    });
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
      if (type === D.SUBURB) use = 'suburb';
      else if (type === D.PARKLAND) use = roll < 0.7 ? 'park' : roll < 0.9 ? 'plaza' : 'buildings';
      else if (type === D.DOWNTOWN) use = roll < 0.1 ? 'plaza' : 'buildings';
      else use = roll < 0.08 ? 'park' : 'buildings';

      if (use === 'park' || use === 'plaza') {
        const k = use === 'park' ? K.PARK : K.PLAZA;
        for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) kind[idx(x, y)] = k;
      } else if (use === 'suburb') {
        suburbBlock(ix0, iy0, ix1, iy1);
      } else {
        subdivide(ix0, iy0, ix1, iy1, type, rng());
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

  /* ---- stores and public buildings ----
   * Assigned with hash2 only (never the main random stream), so existing layouts do not change.
   * A store needs a face looking onto a sidewalk, road or plaza; that face carries the storefront and sign. */
  const stores = [];
  const shops = new Map(); // anchor tile index -> store record
  const facades = new Map(); // every tile along a shop's street-facing wall -> store record (the anchor tile holds door and sign)
  const OPEN = (k) => k === K.SIDEWALK || k === K.ROAD || k === K.PLAZA;
  const S = STORE;
  const MIX = { // probability a building is a store, and what kind
    [D.DOWNTOWN]:   { p: 0.30, w: [[S.BANK, 0.2], [S.HOTEL, 0.15], [S.DINER, 0.25], [S.PHARMACY, 0.15], [S.GROCERY, 0.15], [S.LIBRARY, 0.1]] },
    [D.COMMERCIAL]: { p: 0.45, w: [[S.GROCERY, 0.25], [S.PHARMACY, 0.15], [S.DINER, 0.2], [S.BANK, 0.1], [S.HARDWARE, 0.15], [S.HOTEL, 0.05], [S.LIBRARY, 0.1]] },
    [D.RESIDENTIAL]:{ p: 0.12, w: [[S.GROCERY, 0.3], [S.DINER, 0.2], [S.SCHOOL, 0.15], [S.CHURCH, 0.15], [S.LIBRARY, 0.1], [S.FIREHALL, 0.1]] },
    [D.INDUSTRIAL]: { p: 0.15, w: [[S.HARDWARE, 0.6], [S.FIREHALL, 0.2], [S.DINER, 0.2]] },
    [D.PARKLAND]:   { p: 0.05, w: [[S.LIBRARY, 0.5], [S.CHURCH, 0.5]] },
  };
  const LOW = { [S.GROCERY]: [1, 2], [S.DINER]: [1, 2], [S.PHARMACY]: [1, 3], [S.BANK]: [2, 6], [S.HARDWARE]: [1, 2], [S.LIBRARY]: [2, 5], [S.SCHOOL]: [2, 4], [S.FIREHALL]: [2, 3], [S.CHURCH]: [2, 4] };
  const WORDS = ['Harbor', 'Maple', 'Union', 'Orbit', 'Cedar', 'Lantern', 'Copper', 'Juniper', 'Beacon', 'Willow', 'Atlas', 'Ember', 'Vista', 'Quartz', 'Meridian', 'Fable'];
  const sh = (a, b, salt) => hash2(a, b, (seedValue ^ salt) | 0) / 4294967296;

  function bestFace(b) { // the building edge with the most open neighbours, and the tile in the middle of it
    const xm = (b.x0 + b.x1 - 1) >> 1, ym = (b.y0 + b.y1 - 1) >> 1;
    const cand = [];
    let c = 0;
    for (let x = b.x0; x < b.x1; x++) if (OPEN(kind[idx(x, b.y1)])) c++;
    cand.push({ face: FACE.S, count: c, len: b.x1 - b.x0, x: xm, y: b.y1 - 1 });
    c = 0; for (let x = b.x0; x < b.x1; x++) if (OPEN(kind[idx(x, b.y0 - 1)])) c++;
    cand.push({ face: FACE.N, count: c, len: b.x1 - b.x0, x: xm, y: b.y0 });
    c = 0; for (let y = b.y0; y < b.y1; y++) if (OPEN(kind[idx(b.x1, y)])) c++;
    cand.push({ face: FACE.E, count: c, len: b.y1 - b.y0, x: b.x1 - 1, y: ym });
    c = 0; for (let y = b.y0; y < b.y1; y++) if (OPEN(kind[idx(b.x0 - 1, y)])) c++;
    cand.push({ face: FACE.W, count: c, len: b.y1 - b.y0, x: b.x0, y: ym });
    cand.sort((p, q) => q.count - p.count || sh(b.id, p.face, 0x5a) - sh(b.id, q.face, 0x5a));
    const e = cand[0];
    if (e.count < 2 || e.count * 2 < e.len) return null;
    const t = idx(e.x, e.y);
    if (kind[t] !== K.BUILDING || bid[t] !== b.id) return null;
    const [fx, fy] = { [FACE.N]: [0, -1], [FACE.S]: [0, 1], [FACE.W]: [-1, 0], [FACE.E]: [1, 0] }[e.face];
    // you need room to stand back and read it: the two tiles in front must be open ground, not another building
    return OPEN(kind[idx(e.x + fx, e.y + fy)]) && OPEN(kind[idx(e.x + fx * 2, e.y + fy * 2)]) ? e : null;
  }

  function makeStore(b, k, e) {
    const word = WORDS[Math.floor(sh(b.id, k, 0x6b) * WORDS.length)];
    const label = STORE_SIGN[k][0] + STORE_SIGN[k].slice(1).toLowerCase();
    if (b.type !== D.DOWNTOWN) { // downtown shops stay as the ground floor of their tower
      const lo = LOW[k] || [b.h, b.h];
      const nh = k === S.HOTEL ? Math.max(b.h, 6 + Math.floor(sh(b.id, 3, 0x51) * 8)) : lo[0] + Math.floor(sh(b.id, 3, 0x51) * (lo[1] - lo[0] + 1));
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (bid[idx(x, y)] === b.id) height[idx(x, y)] = nh;
      b.h = nh;
    }
    const rec = { id: b.id, kind: k, sign: STORE_SIGN[k], name: word + ' ' + label, x: mod(e.x) + 0.5, y: mod(e.y) + 0.5, face: e.face,
                  x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, height: b.h, district: district[idx(e.x, e.y)] };
    rec.anchorTile = idx(e.x, e.y);
    const [ox, oy] = { [FACE.N]: [0, -1], [FACE.S]: [0, 1], [FACE.W]: [-1, 0], [FACE.E]: [1, 0] }[e.face];
    rec.facade = [];
    const along = e.face === FACE.N || e.face === FACE.S ? [b.x0, b.x1] : [b.y0, b.y1];
    for (let k = along[0]; k < along[1]; k++) { // the whole wall, not just the middle tile
      const tx = e.face === FACE.N || e.face === FACE.S ? k : e.x, ty = e.face === FACE.N || e.face === FACE.S ? e.y : k;
      const ti = idx(tx, ty);
      if (kind[ti] === K.BUILDING && bid[ti] === b.id && OPEN(kind[idx(tx + ox, ty + oy)])) { facades.set(ti, rec); rec.facade.push(ti); }
    }
    stores.push(rec);
    shops.set(idx(e.x, e.y), rec);
    b.store = rec;
  }

  for (const b of pendingSchools) { // suburban schools: the building was placed on purpose, so it gets its storefront first
    const e = bestFace(b);
    if (e) makeStore(b, S.SCHOOL, e);
  }
  for (const b of buildings) { // random assignment
    const mix = MIX[b.type];
    if (!mix || sh(b.id, 1, 0x4d) >= mix.p) continue;
    if (b.type !== D.DOWNTOWN && b.h > 8) continue; // towers stay towers
    const e = bestFace(b);
    if (!e) continue;
    let r = sh(b.id, 2, 0x4e) * mix.w.reduce((a, q) => a + q[1], 0), k = mix.w[mix.w.length - 1][0];
    for (const [kk, wt] of mix.w) { if (r < wt) { k = kk; break; } r -= wt; }
    makeStore(b, k, e);
  }
  /* guarantee some variety: every city gets at least a few of each public building */
  const ENSURE = [[S.LIBRARY, [D.COMMERCIAL, D.RESIDENTIAL], 3, 12], [S.SCHOOL, [D.RESIDENTIAL], 3, 12], [S.FIREHALL, [D.COMMERCIAL, D.RESIDENTIAL, D.INDUSTRIAL], 3, 10],
                  [S.CHURCH, [D.RESIDENTIAL, D.COMMERCIAL], 3, 10], [S.GROCERY, [D.RESIDENTIAL, D.COMMERCIAL], 6, 6]];
  for (const [k, types, min, minArea] of ENSURE) {
    let have = stores.filter((s) => s.kind === k).length;
    const pool = buildings.filter((b) => !b.store && (b.h <= 8 || b.type === D.DOWNTOWN) && types.includes(b.type) && (b.x1 - b.x0) * (b.y1 - b.y0) >= minArea)
      .sort((p, q) => sh(p.id, k, 0x7c) - sh(q.id, k, 0x7c));
    for (const b of pool) {
      if (have >= min) break;
      const e = bestFace(b);
      if (!e) continue;
      makeStore(b, k, e);
      have++;
    }
  }

  /* keep the sidewalk in front of every storefront clear, so signs and doors stay visible */
  const frontage = new Set();
  for (const s of stores) {
    const [fx, fy] = { [FACE.N]: [0, -1], [FACE.S]: [0, 1], [FACE.W]: [-1, 0], [FACE.E]: [1, 0] }[s.face];
    for (const ti of s.facade) {
      const tx = ti % size, ty = (ti / size) | 0;
      frontage.add(idx(tx + fx, ty + fy));
      frontage.add(idx(tx + fx + (fx === 0 ? 1 : 0), ty + fy + (fy === 0 ? 1 : 0)));
      frontage.add(idx(tx + fx - (fx === 0 ? 1 : 0), ty + fy - (fy === 0 ? 1 : 0)));
    }
  }

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
      if (k === K.YARD) {
        if (h01(x, y, 0x7ef) < 0.07) props.push({ x: x + 0.2 + 0.6 * h01(x, y, 0x13), y: y + 0.2 + 0.6 * h01(x, y, 0x24), type: PROP.TREE, v: 0 });
      } else if (k === K.PARK) {
        if (h01(x, y, 0x7ee) < 0.16) props.push({ x: x + 0.2 + 0.6 * h01(x, y, 0x11), y: y + 0.2 + 0.6 * h01(x, y, 0x22), type: PROP.TREE, v: 0 });
      } else if (k === K.SIDEWALK) {
        if (frontage.has(idx(x, y))) continue;
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
  for (const p of playProps) props.push(p);
  for (const p of roofProps) props.push(p);
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
  for (const s of stores) { // a distinctive rooftop piece, so each kind can be told apart from far away
    if ([STORE.FIREHALL, STORE.SCHOOL, STORE.LIBRARY, STORE.HOTEL, STORE.PHARMACY, STORE.DINER, STORE.BANK].includes(s.kind)) {
      props.push({ x: mod((s.x0 + s.x1) / 2), y: mod((s.y0 + s.y1) / 2), type: PROP.ROOFPIECE, v: s.height, k: s.kind });
    }
  }
  for (const s of stores) if (s.kind === STORE.CHURCH) { // a steeple on every church
    props.push({ x: mod((s.x0 + s.x1) / 2), y: mod((s.y0 + s.y1) / 2), type: PROP.STEEPLE, v: s.height });
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
    seed: seedValue, size, wrap, kind, height, district, bid, mark, deco, glow, props, wires, propGrid, stores, shops, facades, houses,
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
  h ^= world.props.length ^ (world.wires.length << 12);
  for (const s of world.stores) { h ^= s.kind * 31 + (s.face << 8) + Math.floor(s.x) * 7; h = Math.imul(h, 16777619) >>> 0; } h = Math.imul(h, 16777619) >>> 0;
  return h >>> 0;
}

module.exports = {
  K, D, DISTRICT_TYPE_NAMES, HOUSE, ROAD_MARK, EDGE_HEIGHT, PROP, DECO,
  generateWorld, inBounds, heightAt, kindAt, isWalkable, locate, worldHash, propClearance, PROP_RADIUS, wrapCoord, wrapDelta, STORE, STORE_SIGN, FACE,
};
