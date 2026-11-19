'use strict';
/**
 * First-person camera and walking. Pure functions over a plain camera object, no I/O,
 * so a future NPC or vehicle controller can reuse stepCamera's collision logic.
 *
 * Angle 0 faces east (+x); angles grow clockwise on a north-up map (y points south).
 */

const { isWalkable, propClearance, wrapCoord } = require('./world');

const WALK_SPEED = 3.2; // tiles per second
const RUN_SPEED = 6.0;
const TURN_SPEED = 1.9; // radians per second
const LOOK_SPEED = 0.9;
const MAX_PITCH = 0.35; // fraction of screen height the horizon may shift
const RADIUS = 0.22;      // against buildings
const PROP_BODY = 0.18;   // against lamps, trees, poles, hydrants, signals

function createCamera(world) {
  const s = world.spawn;
  return { x: s.x, y: s.y, angle: s.angle, pitch: 0.06, eyeZ: 0.21 };
}

/** True if a body of the given radius centered at (x, y) overlaps no building. */
function canStand(world, x, y, r = RADIUS) {
  return isWalkable(world, x - r, y - r) && isWalkable(world, x + r, y - r)
    && isWalkable(world, x - r, y + r) && isWalkable(world, x + r, y + r);
}

/**
 * Advance the camera by dt seconds.
 * input: { forward, strafe, turn, look } each in [-1, 1]; run: boolean.
 * Movement is resolved per axis, so you slide along walls instead of sticking to them.
 */
function stepCamera(world, cam, input, dt, run = false) {
  cam.angle += (input.turn || 0) * TURN_SPEED * dt;
  cam.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cam.pitch + (input.look || 0) * LOOK_SPEED * dt));

  const f = input.forward || 0, s = input.strafe || 0;
  if (f === 0 && s === 0) return cam;
  const speed = (run ? RUN_SPEED : WALK_SPEED) * dt;
  const ca = Math.cos(cam.angle), sa = Math.sin(cam.angle);
  const dx = (ca * f - sa * s) * speed;
  const dy = (sa * f + ca * s) * speed;
  /* a move is allowed if it is clear of buildings and props; if already touching a prop it may only move away */
  const ok = (nx, ny) => {
    if (!canStand(world, nx, ny)) return false;
    const c = propClearance(world, nx, ny, PROP_BODY);
    return c >= 0 || c >= propClearance(world, cam.x, cam.y, PROP_BODY);
  };
  if (ok(cam.x + dx, cam.y)) cam.x += dx;
  if (ok(cam.x, cam.y + dy)) cam.y += dy;
  cam.x = wrapCoord(world, cam.x); // crossing the seam puts you on the other side of the map
  cam.y = wrapCoord(world, cam.y);
  return cam;
}

module.exports = { createCamera, stepCamera, canStand, RADIUS, PROP_BODY, WALK_SPEED, RUN_SPEED };
