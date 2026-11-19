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

module.exports = { shopCell, TONES };
