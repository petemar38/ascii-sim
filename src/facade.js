'use strict';
/**
 * Storefront architecture. Given a kind of shop and a position on its street-facing wall,
 * say what to draw there. One call per wall cell, so it allocates nothing.
 *
 *   shopCell(kind, center, u, vf, fl) -> glyph char code (0 = nothing special)
 *   shopCell.tone  -> TONE-like id for the glyph (see TONES)
 *   shopCell.glass -> 0 none, 1 lit/dark display window here (the renderer lights it at night)
 *
 * u  = 0..1 across the tile (left to right as seen from the street)
 * vf = 0..1 up the floor (0 = floor level, 1 = ceiling)
 * fl = floor number (0 = ground)
 * center = this tile holds the door and sign
 */

const { STORE } = require('./world');

const TONES = { DOOR: 25, AWNING: 27, COLUMN: 28, SIGN: 26 };
const PIPE = 124, EQ = 61, HASH = 35, UNDER = 95, CARET = 94, PLUS = 43, SPACE = 32, O = 79, DASH = 45;

function out(glyph, tone, glass) { shopCell.tone = tone || 0; shopCell.glass = glass || 0; return glyph; }
const between = (a, x, b) => x > a && x < b;
const stripes = (u, n) => ((Math.floor(u * n) & 1) ? HASH : EQ);

function shopCell(kind, center, u, vf, fl) {
  shopCell.tone = 0; shopCell.glass = 0;
  switch (kind) {
    case STORE.GROCERY: // wide striped awning, glass front, sliding double door
      if (fl !== 0) break;
      if (center && between(0.34, u, 0.66) && vf < 0.5) return out((u < 0.38 || u > 0.62 || between(0.48, u, 0.52)) ? PIPE : SPACE, TONES.DOOR);
      if (vf >= 0.52 && vf < 0.7) return out(stripes(u, 8), TONES.AWNING);
      if (vf > 0.06 && vf < 0.5 && between(0.04, u, 0.96)) return out(0, 0, 1);
      break;

    case STORE.DINER: // chrome band, continuous glass, checkerboard cornice
      if (fl !== 0) break;
      if (center && between(0.43, u, 0.57) && vf < 0.46) return out((u < 0.46 || u > 0.54) ? PIPE : SPACE, TONES.DOOR);
      if (vf >= 0.46 && vf < 0.54) return out(EQ, TONES.COLUMN);
      if (vf > 0.9) return out(((Math.floor(u * 12) & 1) ? HASH : SPACE), TONES.AWNING);
      if (vf > 0.06 && vf < 0.46 && between(0.02, u, 0.98)) return out(0, 0, 1);
      break;

    case STORE.PHARMACY: // glass front, awning, big cross on the side tiles
      if (fl !== 0) break;
      if (!center && ((between(0.45, u, 0.55) && between(0.52, vf, 0.96)) || (between(0.36, u, 0.64) && between(0.66, vf, 0.78)))) return out(PLUS, TONES.SIGN);
      if (center && between(0.36, u, 0.64) && vf < 0.5) return out((u < 0.4 || u > 0.6) ? PIPE : SPACE, TONES.DOOR);
      if (vf >= 0.5 && vf < 0.6 && center) return out(EQ, TONES.AWNING);
      if (vf > 0.06 && vf < 0.5 && between(0.06, u, 0.94)) return out(0, 0, 1);
      break;

    case STORE.BANK: // stone columns, steps, cornice, tall double doors
      if (fl !== 0) break;
      if (vf < 0.07) return out(UNDER, TONES.COLUMN); // steps
      if (vf > 0.93) return out(EQ, TONES.COLUMN);    // cornice
      if (Math.abs(u - 0.08) < 0.04 || Math.abs(u - 0.92) < 0.04 || (!center && Math.abs(u - 0.5) < 0.04)) return out(PIPE, TONES.COLUMN);
      if (center && between(0.36, u, 0.64) && vf < 0.62) return out((u < 0.4 || u > 0.6 || between(0.48, u, 0.52)) ? PIPE : SPACE, TONES.DOOR);
      if (vf > 0.18 && vf < 0.7 && (between(0.16, u, 0.4) || between(0.6, u, 0.84)) && !center) return out(0, 0, 1);
      break;

    case STORE.LIBRARY: // portico columns, steps, arched windows
      if (fl !== 0) break;
      if (vf < 0.07) return out(UNDER, TONES.COLUMN);
      if (Math.abs(u - 0.12) < 0.035 || Math.abs(u - 0.32) < 0.035 || Math.abs(u - 0.68) < 0.035 || Math.abs(u - 0.88) < 0.035) return out(PIPE, TONES.COLUMN);
      if (center && between(0.4, u, 0.6) && vf < 0.6) return out((u < 0.43 || u > 0.57) ? PIPE : SPACE, TONES.DOOR);
      if (vf > 0.22 && vf < 0.82 && (between(0.16, u, 0.29) || between(0.71, u, 0.84))) return out(vf > 0.74 ? CARET : 0, vf > 0.74 ? TONES.COLUMN : 0, vf <= 0.74 ? 1 : 0);
      break;

    case STORE.SCHOOL: // central entrance with a clock above, rows of tall windows
      if (fl === 0) {
        if (vf < 0.07) return out(UNDER, TONES.COLUMN);
        if (center && between(0.3, u, 0.7) && vf < 0.62) return out((u < 0.34 || u > 0.66 || between(0.48, u, 0.52)) ? PIPE : SPACE, TONES.DOOR);
        if (vf > 0.2 && vf < 0.74 && (between(0.1, u, 0.38) || between(0.62, u, 0.9))) return out(0, 0, 1);
      } else if (fl === 1 && center) { // clock
        const dx = (u - 0.5) / 0.1, dy = (vf - 0.5) / 0.22, r = dx * dx + dy * dy;
        if (r < 1) return out(r > 0.45 ? O : PLUS, TONES.SIGN);
      }
      break;

    case STORE.FIREHALL: // big bay doors across the whole front
      if (fl !== 0) break;
      if (vf < 0.82 && between(0.06, u, 0.94)) return out((Math.floor(vf * 26) & 1) ? EQ : DASH, TONES.DOOR); // rolled-up slats
      if (vf < 0.82 && (u <= 0.06 || u >= 0.94)) return out(PIPE, TONES.COLUMN);
      break;

    case STORE.CHURCH: // pointed door, tall narrow windows, rose window above
      if (fl === 0) {
        if (center) {
          if (vf < 0.06) return out(UNDER, TONES.COLUMN);
          if (between(0.38, u, 0.62) && vf < 0.74) return out((u < 0.42 || u > 0.58) ? PIPE : SPACE, TONES.DOOR);
          if (between(0.38, u, 0.62) && vf >= 0.74 && vf < 0.84) return out(CARET, TONES.COLUMN); // pointed arch
        } else if (between(0.4, u, 0.6) && vf > 0.2 && vf < 0.9) return out(0, 0, 1);
      } else if (fl === 1 && center) { // rose window
        const dx = (u - 0.5) / 0.14, dy = (vf - 0.5) / 0.28, r = dx * dx + dy * dy;
        if (r < 1) return r > 0.55 ? out(O, TONES.COLUMN) : out(0, 0, 1);
      }
      break;

    case STORE.HOTEL: // deep canopy, revolving door, glass lobby
      if (fl !== 0) break;
      if (vf >= 0.5 && vf < 0.66) return out(HASH, TONES.AWNING);
      if (center && between(0.4, u, 0.6) && vf < 0.5) return out(between(0.47, u, 0.53) ? O : SPACE, TONES.DOOR);
      if (vf > 0.06 && vf < 0.5 && between(0.04, u, 0.96)) return out(0, 0, 1);
      break;

    case STORE.HARDWARE: // roll-up shutter door, stacked stock outside the windows
      if (fl !== 0) break;
      if (center && between(0.1, u, 0.9) && vf < 0.64) return out((Math.floor(vf * 22) & 1) ? EQ : DASH, TONES.DOOR);
      if (!center) {
        if (vf < 0.2 && (between(0.08, u, 0.4) || between(0.55, u, 0.88))) return out(HASH, TONES.COLUMN); // stacked crates
        if (vf > 0.28 && vf < 0.56 && between(0.1, u, 0.9)) return out(0, 0, 1);
      }
      break;
    default: break;
  }
  return 0;
}

/**
 * House fronts. One call per wall cell on the street side of a house.
 *   houseCell(style, isDoor, isGarage, u, vf, fl) -> glyph code (0 = plain wall); sets houseCell.tone / houseCell.glass
 * Styles follow world.HOUSE: 1 ranch, 2 colonial, 3 bungalow, 4 tudor, 5 modern, 6 victorian.
 */
const SLASH = 47, BACK = 92, COLON = 58, QUOTE = 34;
function hout(glyph, tone, glass) { houseCell.tone = tone || 0; houseCell.glass = glass || 0; return glyph; }
function houseCell(style, isDoor, isGarage, u, vf, fl) {
  houseCell.tone = 0; houseCell.glass = 0;
  const door = (lo, hi, top) => isDoor && between(lo, u, hi) && fl === 0 && vf < top;
  const garageDoor = isGarage && fl === 0 && between(0.08, u, 0.92) && vf < 0.62;
  if (garageDoor) return hout(((Math.floor(vf * 20) & 1) ? EQ : DASH), TONES.DOOR);
  switch (style) {
    case 1: // ranch: one wide low storey, picture window, low roof
      if (door(0.35, 0.65, 0.66)) return hout((u < 0.4 || u > 0.6) ? PIPE : SPACE, TONES.DOOR);
      if (fl === 0 && !isDoor && vf > 0.22 && vf < 0.68 && between(0.12, u, 0.88)) return hout(0, 0, 1);
      if (fl === 0 && isDoor && vf > 0.3 && vf < 0.62 && (between(0.08, u, 0.28) || between(0.72, u, 0.92))) return hout(0, 0, 1);
      break;
    case 2: // colonial: symmetric windows with shutters, columns by the door
      if (door(0.38, 0.62, 0.62)) return hout((u < 0.42 || u > 0.58) ? PIPE : SPACE, TONES.DOOR);
      if (isDoor && fl === 0 && (Math.abs(u - 0.2) < 0.03 || Math.abs(u - 0.8) < 0.03) && vf < 0.78) return hout(PIPE, TONES.COLUMN);
      if (!isDoor && vf > 0.28 && vf < 0.74) {
        if (Math.abs(u - 0.2) < 0.045 || Math.abs(u - 0.8) < 0.045) return hout(PIPE, TONES.AWNING); // shutters
        if (between(0.3, u, 0.7)) return hout(0, 0, 1);
      }
      if (isDoor && fl === 1 && vf > 0.28 && vf < 0.74 && between(0.36, u, 0.64)) return hout(0, 0, 1);
      break;
    case 3: // bungalow: deep front porch with square columns
      if (fl === 0) {
        if (vf >= 0.7 && vf < 0.82) return hout(EQ, TONES.AWNING); // porch roof
        if (vf < 0.7 && (Math.abs(u - 0.08) < 0.04 || Math.abs(u - 0.92) < 0.04)) return hout(PIPE, TONES.COLUMN);
        if (vf < 0.12) return hout(UNDER, TONES.COLUMN); // porch step
        if (door(0.4, 0.6, 0.58)) return hout((u < 0.44 || u > 0.56) ? PIPE : SPACE, TONES.DOOR);
        if (!isDoor && vf > 0.22 && vf < 0.6 && between(0.25, u, 0.75)) return hout(0, 0, 1);
      }
      break;
    case 4: // tudor: half-timbering on the upper storey, steep roof
      if (door(0.4, 0.6, 0.6)) return hout((u < 0.44 || u > 0.56) ? PIPE : SPACE, TONES.DOOR);
      if (door(0.4, 0.6, 0.7)) return hout(CARET, TONES.COLUMN); // pointed lintel
      if (fl === 1) {
        if (Math.abs(vf - 0.5) < 0.05) return hout(DASH, TONES.COLUMN);
        if (u < 0.06 || u > 0.94 || Math.abs(u - 0.5) < 0.04) return hout(PIPE, TONES.COLUMN);
        if (vf > 0.55 && Math.abs(u - 0.25) < 0.12 * (vf - 0.45) * 4) return hout(((u < 0.25) ? BACK : SLASH), TONES.COLUMN);
        if (vf > 0.2 && vf < 0.44 && (between(0.14, u, 0.4) || between(0.6, u, 0.86))) return hout(0, 0, 1);
      } else if (!isDoor && vf > 0.25 && vf < 0.62 && between(0.25, u, 0.75)) return hout(0, 0, 1);
      break;
    case 5: // modern: slab door, floor-to-ceiling glass, flat roof line
      if (door(0.42, 0.58, 0.62)) return hout(PIPE, TONES.DOOR);
      if (fl === 0 && vf > 0.1 && vf < 0.78 && between(0.04, u, 0.96) && !isGarage) return hout(0, 0, 1);
      if (fl === 1 && vf > 0.3 && vf < 0.7) return hout(0, 0, 1); // ribbon window
      if (vf > 0.9) return hout(EQ, TONES.COLUMN);
      break;
    case 6: // victorian: tall, wraparound porch with balusters, arched windows, attic round window
      if (fl === 0) {
        if (vf >= 0.55 && vf < 0.66) return hout(EQ, TONES.AWNING); // porch roof
        if (vf < 0.3 && ((Math.floor(u * 14) & 1) === 0)) return hout(PIPE, TONES.COLUMN); // balusters
        if (vf < 0.55 && (u < 0.05 || u > 0.95)) return hout(PIPE, TONES.COLUMN);
        if (door(0.4, 0.6, 0.55)) return hout((u < 0.44 || u > 0.56) ? PIPE : SPACE, TONES.DOOR);
      } else if (fl === 1) {
        if (vf > 0.2 && vf < 0.62 && between(0.3, u, 0.7)) return hout(0, 0, 1);
        if (vf >= 0.62 && vf < 0.74 && between(0.3, u, 0.7)) return hout(CARET, TONES.COLUMN); // arch
      } else if (fl === 2) {
        const dx = (u - 0.5) / 0.16, dy = (vf - 0.5) / 0.3;
        if (dx * dx + dy * dy < 1) return hout(0, 0, 1);
      }
      break;
    default: break;
  }
  return 0;
}

module.exports = { shopCell, houseCell, TONES };
