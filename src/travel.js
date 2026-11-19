'use strict';
/**
 * "Where is everything?" helpers: list the nearest named buildings and put the camera in front of one.
 * Pure functions, shared by the terminal player and the web page.
 */

const { wrapDelta, wrapCoord, canStandAt, FACE } = (() => {
  const w = require('./world');
  const c = require('./camera');
  return { wrapDelta: w.wrapDelta, wrapCoord: w.wrapCoord, FACE: w.FACE, canStandAt: (world, x, y) => c.canStand(world, x, y) && w.propClearance(world, x, y, c.PROP_BODY) >= 0 };
})();
const { bearingDeg } = require('./hud');

const SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const TILE_METRES = 8;
/** Unit vector pointing out of a storefront, for each FACE. */
const OUT = { [FACE.N]: [0, -1], [FACE.S]: [0, 1], [FACE.W]: [-1, 0], [FACE.E]: [1, 0] };

/**
 * The nearest named buildings to the camera, closest first.
 * Buildings you are already standing in front of (or inside, within `minDist` tiles) are skipped.
 * @returns {{store: object, dist: number, metres: number, bearing: number, compass: string}[]}
 */
function nearestStores(world, cam, n = 9, minDist = 2) {
  const out = [];
  for (const s of world.stores) {
    const dx = wrapDelta(world, s.x - cam.x), dy = wrapDelta(world, s.y - cam.y);
    const dist = Math.hypot(dx, dy);
    if (dist < minDist) continue;
    // already standing where arriveAt would put you? then it is not worth listing
    const [ox, oy] = OUT[s.face];
    if (Math.hypot(wrapDelta(world, s.x + ox * 3 - cam.x), wrapDelta(world, s.y + oy * 3 - cam.y)) < 1.5) continue;
    const bearing = bearingDeg(Math.atan2(dy, dx));
    out.push({ store: s, dist, metres: Math.round(dist * TILE_METRES), bearing, compass: SHORT[Math.round(bearing / 45) % 8] });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, n);
}

/**
 * Move the camera to the street in front of a store, looking at its sign.
 * Tries a few distances so a prop or odd corner never leaves you inside something.
 * @returns {boolean} false if no free spot was found (the camera is left unchanged)
 */
function arriveAt(world, cam, store) {
  const [dx, dy] = OUT[store.face];
  for (const d of [3, 2.5, 3.5, 2, 4, 1.5]) {
    const x = store.x + dx * d, y = store.y + dy * d;
    if (!canStandAt(world, x, y)) continue;
    cam.x = wrapCoord(world, x);
    cam.y = wrapCoord(world, y);
    cam.angle = Math.atan2(-dy, -dx);
    cam.pitch = 0.06;
    return true;
  }
  return false;
}

/** Menu text, one line per entry: "1  Cedar Grocery    96 m NE". */
function travelMenuLines(entries) {
  if (!entries.length) return ['NO BUILDINGS NEARBY'];
  const nameW = Math.max(...entries.map((e) => e.store.name.length));
  return entries.map((e, i) =>
    (i + 1) + '  ' + e.store.name.toUpperCase().padEnd(nameW) + '  ' + String(e.metres).padStart(4) + ' M ' + e.compass);
}

module.exports = { nearestStores, arriveAt, travelMenuLines };
