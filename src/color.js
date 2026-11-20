'use strict';
/**
 * Colour pass. The renderer already says what every cell IS (frame.tone) and how bright it is
 * (the glyph it picked from the ramp), so colour is just a lookup, with no change to the renderer:
 *
 *   const pal = makePalette(time);          // day and night versions blended by the hour
 *   htmlRows(frame, pal)                    // one string, <span>s per run of one colour (web)
 *   ansiRows(frame, pal, truecolor)         // array of strings with ANSI colour codes (terminal)
 *
 * Walls get one of six materials per building (brick, sandstone, concrete, slate, plaster, timber),
 * so a street stops being one colour. Lights, stars, signals and signs stay bright at night.
 */

const { TONE: T, RAMP, lighting } = require('./render');

const LEVELS = 4;
const LEVEL_GAIN = [0.42, 0.64, 0.84, 1];
const WALL_BASE = 40; // palette slot where the per-building wall materials start
const WALL_HUES = [
  [182, 96, 76], [200, 172, 124], [152, 152, 158], [112, 132, 164], [208, 198, 172], [138, 100, 80],
];

// [daylight colour, night colour]; a single colour means the same at both
const BASE = [];
function def(tone, day, night) { BASE[tone] = [day, night || day]; }
def(T.SKY, [118, 176, 238], [16, 22, 56]);
def(T.STAR, [236, 236, 208]);
def(T.ROAD, [96, 96, 102], [58, 60, 76]);
def(T.MARKING, [236, 212, 92], [190, 170, 80]);
def(T.SIDEWALK, [168, 162, 154], [92, 94, 112]);
def(T.PARK, [66, 156, 74], [26, 84, 52]);
def(T.PLAZA, [186, 164, 130], [100, 90, 90]);
def(T.WALL, [160, 150, 142], [96, 94, 116]);
def(T.WINDOW_LIT, [255, 222, 128]);
def(T.WINDOW_DARK, [70, 98, 140], [28, 40, 78]);
def(T.EDGE, [224, 220, 214], [150, 150, 176]);
def(T.VOID, [0, 0, 0]);
def(T.LAMP, [170, 172, 178], [110, 112, 132]);
def(T.LAMP_LIT, [255, 232, 150]);
def(T.TRUNK, [118, 84, 52], [64, 52, 50]);
def(T.LEAF, [60, 166, 62], [24, 88, 52]);
def(T.SIGNAL_RED, [255, 70, 56]);
def(T.SIGNAL_GREEN, [70, 236, 100]);
def(T.CROSSWALK, [240, 240, 240], [170, 172, 190]);
def(T.CURB, [176, 176, 172], [110, 112, 130]);
def(T.MANHOLE, [86, 86, 90], [54, 56, 72]);
def(T.FIRE_ESCAPE, [58, 58, 64], [120, 124, 146]);
def(T.HYDRANT, [236, 56, 44], [200, 60, 56]);
def(T.TANK, [158, 124, 92], [100, 88, 90]);
def(T.WIRE, [48, 48, 54], [110, 112, 140]);
def(T.DOOR, [150, 92, 52], [96, 70, 62]);
def(T.SIGN, [255, 204, 70], [255, 190, 80]);
def(T.AWNING, [222, 64, 60], [140, 56, 70]);
def(T.COLUMN, [228, 222, 206], [140, 140, 160]);

// tones that glow: they keep full brightness whatever glyph they were drawn with
const EMISSIVE = new Set([T.STAR, T.WINDOW_LIT, T.LAMP_LIT, T.SIGNAL_RED, T.SIGNAL_GREEN, T.SIGN, T.SKY, T.VOID]);

// how dense a glyph looks, 0..1: the ramp glyphs by position, everything else reads as fairly solid
const DENSITY = new Float32Array(256).fill(0.8);
for (let i = 0; i < RAMP.length; i++) DENSITY[RAMP.charCodeAt(i)] = i / (RAMP.length - 1);
DENSITY[32] = 0; DENSITY[46] = 0.18; DENSITY[44] = 0.2; DENSITY[39] = 0.2; DENSITY[34] = 0.28; DENSITY[95] = 0.35;

const mix = (a, b, t) => Math.round(a + (b - a) * t);

/** Colours for one time of day (0-24). rgb is a flat Uint8Array: slot * 3. */
function makePalette(time) {
  const { night } = lighting(time);
  const slots = WALL_BASE + WALL_HUES.length;
  const rgb = new Uint8Array(slots * LEVELS * 3);
  const css = new Array(slots * LEVELS);
  for (let s = 0; s < slots; s++) {
    let day, nite;
    if (s >= WALL_BASE) {
      const h = WALL_HUES[s - WALL_BASE];
      day = h; nite = [h[0] * 0.5 + 12, h[1] * 0.5 + 12, h[2] * 0.55 + 36]; // night walls go dim and bluish
    } else if (BASE[s]) { [day, nite] = BASE[s]; } else { day = nite = [200, 200, 200]; }
    for (let l = 0; l < LEVELS; l++) {
      const gain = s < WALL_BASE && EMISSIVE.has(s) ? 1 : LEVEL_GAIN[l];
      const o = (s * LEVELS + l) * 3;
      rgb[o] = Math.min(255, mix(day[0], nite[0], night) * gain);
      rgb[o + 1] = Math.min(255, mix(day[1], nite[1], night) * gain);
      rgb[o + 2] = Math.min(255, mix(day[2], nite[2], night) * gain);
      css[s * LEVELS + l] = '#' + [rgb[o], rgb[o + 1], rgb[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return { rgb, css };
}

/** Palette slot (colour and brightness level) of cell i. */
function slotOf(frame, i) {
  const tone = frame.tone[i];
  const emissive = EMISSIVE.has(tone);
  const level = emissive ? LEVELS - 1 : Math.min(LEVELS - 1, Math.floor(DENSITY[frame.ch[i]] * LEVELS));
  let s = tone;
  if (tone === T.WALL && frame.id[i] > 0) s = WALL_BASE + (Math.imul((frame.id[i] - 1) >> 1, 2654435761) >>> 0) % WALL_HUES.length;
  return s * LEVELS + level;
}

const ESC = { 38: '&amp;', 60: '&lt;', 62: '&gt;' };

/** One string for the whole frame, rows joined with newlines, ready for innerHTML. */
function htmlRows(frame, pal) {
  const { cols, rows, ch } = frame;
  let out = '';
  for (let y = 0; y < rows; y++) {
    let cur = -1, open = false;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, c = ch[i];
      if (c !== 32) {
        const s = slotOf(frame, i);
        if (s !== cur) { if (open) out += '</span>'; out += '<span style="color:' + pal.css[s] + '">'; cur = s; open = true; }
      }
      out += ESC[c] || String.fromCharCode(c);
    }
    if (open) out += '</span>';
    if (y < rows - 1) out += '\n';
  }
  return out;
}

const cube = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));

/** Rows with ANSI colour. truecolor: 24-bit codes; otherwise the nearest of the 256-colour cube. */
function ansiRows(frame, pal, truecolor) {
  const { cols, rows, ch } = frame;
  const res = [];
  for (let y = 0; y < rows; y++) {
    let line = '', cur = -1;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, c = ch[i];
      if (c !== 32) {
        const s = slotOf(frame, i);
        if (s !== cur) {
          const o = s * 3;
          line += truecolor ? `\x1b[38;2;${pal.rgb[o]};${pal.rgb[o + 1]};${pal.rgb[o + 2]}m`
            : `\x1b[38;5;${16 + 36 * cube(pal.rgb[o]) + 6 * cube(pal.rgb[o + 1]) + cube(pal.rgb[o + 2])}m`;
          cur = s;
        }
      }
      line += String.fromCharCode(c);
    }
    res.push(line);
  }
  return res;
}

module.exports = { makePalette, slotOf, htmlRows, ansiRows, LEVELS };
