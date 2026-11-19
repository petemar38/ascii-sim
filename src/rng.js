'use strict';
/**
 * Deterministic randomness. Everything in the city derives from a seed, so a world
 * (and every test that depends on one) is exactly reproducible.
 */

/** Small fast seeded PRNG. Returns a function producing floats in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless 2D integer hash -> uint32. Good for per-tile and per-window variation. */
function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash2 scaled to [0, 1). */
function hash01(x, y, seed) {
  return hash2(x, y, seed) / 4294967296;
}

/** FNV-1a string hash, so seeds can be words ("aurora"). */
function strSeed(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Accepts a number or a string and returns a uint32 seed. */
function toSeed(v) {
  return typeof v === 'string' ? strSeed(v) : v >>> 0;
}

module.exports = { mulberry32, hash2, hash01, strSeed, toSeed };
