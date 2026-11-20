'use strict';
/**
 * Pixel pass: turns a frame (rendered with square cells, see render's pixel mode) into real coloured pixels, the way an
 * early-90s DOS game would draw it:
 *   - walls, ground and windows are textured: brick, stone, concrete, slate, stucco and plank walls, asphalt, paving slabs,
 *     grass, window frames and mullions. Textures fade out with distance (so they never shimmer) using the pixel size
 *     of one texture cell, a poor man's mip map.
 *   - the whole picture is quantised to a fixed 6x6x6 colour cube (216 colours) with ordered (Bayer) dithering, which gives
 *     the stippled shading and banded sky of 256-colour VGA.
 * Colours still come from the day/night palette in color.js, so dusk and night carry over.
 */

const { TONE: T, MAT } = require('./render');
const { LEVELS, slotOf, skyStep, EMISSIVE, WALL_BASE, WALL_HUES } = require('./color');

const px = [0, 0, 0];

/* ---------- hashing and texture helpers ---------- */
function h2(i, j) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** How much of a texture's detail to show: 0 when one texture cell is under about a pixel, 1 when it is a few. */
const amp = (cellPx) => clamp((cellPx - 1.1) / 2.2, 0, 1);

let TM = 1, TX = 0; // outputs: brightness multiplier, and how far to mix toward the light mortar colour

function brick(u, v, texel) {
  const ch = 0.06, bl = 0.15, rowf = v / ch, row = Math.floor(rowf), fv = rowf - row;
  const uu = u / bl + (row & 1 ? 0.5 : 0), col = Math.floor(uu), fu = uu - col;
  const a = amp(ch * texel);
  if (fv < 0.17 || fu < 0.07) { TM = 1.06; TX = 0.5 * a; return; }
  TM = 1 + (0.8 + 0.4 * h2(col, row) - 1) * a * 0.55; TX = 0;
  if (fv > 0.85) TM *= 1 - 0.07 * a; // a shadowed lower edge on each brick
}
function stone(u, v, texel) {
  const ch = 0.11, bl = 0.27, rowf = v / ch, row = Math.floor(rowf), fv = rowf - row;
  const uu = u / bl + h2(row, 91) * 3, col = Math.floor(uu), fu = uu - col;
  const a = amp(ch * texel);
  if (fv < 0.09 || fu < 0.04) { TM = 0.84; TX = 0.25 * a; TM = 1 + (TM - 1) * a; return; }
  TM = 1 + (0.86 + 0.28 * h2(col, row + 7) - 1) * a * 0.6 + (h2(Math.floor(u * 30), Math.floor(v * 30)) - 0.5) * 0.08 * amp(texel / 30);
  TX = 0;
}
function concrete(u, v, texel) {
  const pw = 0.6, ph = 0.42, fu = u / pw - Math.floor(u / pw), fv = v / ph - Math.floor(v / ph);
  const a = amp(ph * texel * 0.25);
  const n = (h2(Math.floor(u * 28), Math.floor(v * 28)) - 0.5) * 0.12 * amp(texel / 28);
  TM = 1 + n; TX = 0;
  if (fu < 0.03 || fv < 0.045) TM *= 1 - 0.22 * a; // panel seams
  else TM *= 1 + (h2(Math.floor(u / pw), Math.floor(v / ph)) - 0.5) * 0.1 * a; // each panel a shade of its own
}
function slate(u, v, texel) {
  const ch = 0.055, bl = 0.1, rowf = v / ch, row = Math.floor(rowf), fv = rowf - row;
  const uu = u / bl + (row & 1 ? 0.5 : 0), col = Math.floor(uu), fu = uu - col;
  const a = amp(ch * texel);
  TX = 0;
  if (fv < 0.14 || fu < 0.07) TM = 1 - 0.34 * a; else TM = 1 + (h2(col * 3, row) - 0.5) * 0.3 * a;
}
function plaster(u, v, texel) {
  const n = (h2(Math.floor(u * 26), Math.floor(v * 26)) - 0.5) * 0.14 * amp(texel / 26);
  const s = (h2(Math.floor(u * 3), Math.floor(v * 3)) - 0.5) * 0.08;
  TM = 1 + n + s * amp(texel / 3 * 4); TX = 0;
}
function timber(u, v, texel) {
  const pw = 0.1, pf = u / pw, pl = Math.floor(pf), fu = pf - pl, a = amp(pw * texel);
  TX = 0;
  if (fu < 0.07) { TM = 1 - 0.4 * a; return; }
  TM = 1 + (h2(pl, 5) - 0.5) * 0.26 * a + (h2(pl, Math.floor(v * 36)) - 0.5) * 0.1 * amp(texel / 36);
}
const WALL_TEX = [brick, stone, concrete, slate, plaster, timber];

/* ground */
function asphalt(u, v, texel) { TM = 1 + (h2(Math.floor(u * 30), Math.floor(v * 30)) - 0.5) * 0.24 * amp(texel / 30); TX = 0; }
function sidewalk(u, v, texel) { TM = 1 + (h2(Math.floor(u * 26), Math.floor(v * 26)) - 0.5) * 0.14 * amp(texel / 26); TX = 0; }
function grass(u, v, texel) {
  const n = h2(Math.floor(u * 38), Math.floor(v * 38));
  const patch = h2(Math.floor(u * 2.4), Math.floor(v * 2.4));
  TM = (1 + (n - 0.5) * 0.4 * amp(texel / 38)) * (0.92 + 0.16 * patch); TX = 0;
}
function plaza(u, v, texel) {
  const fu = u * 4 - Math.floor(u * 4), fv = v * 4 - Math.floor(v * 4), a = amp(texel / 4 * 0.5);
  TX = 0;
  if (fu < 0.06 || fv < 0.06) TM = 1 - 0.28 * a; else TM = 1 + (h2(Math.floor(u * 4), Math.floor(v * 4)) - 0.5) * 0.2 * a;
}

/* ---------- colour of one cell ---------- */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LIGHT = [206, 200, 188]; // mortar and trim

function fullColor(pal, slot, gain, out) {
  const o = (slot * LEVELS + LEVELS - 1) * 3;
  out[0] = pal.rgb[o] * gain; out[1] = pal.rgb[o + 1] * gain; out[2] = pal.rgb[o + 2] * gain;
}

const base = [0, 0, 0], trim = [0, 0, 0];

/** Colour of cell i (into the shared px array). */
function pixelOf(frame, pal, i) {
  const bg = skyStep(frame, i);
  if (bg >= 0 && (frame.ch[i] === 32 || frame.tone[i] === T.SKY)) { // open sky: just the gradient
    px[0] = pal.sky.rgb[bg * 3]; px[1] = pal.sky.rgb[bg * 3 + 1]; px[2] = pal.sky.rgb[bg * 3 + 2];
    return px;
  }
  const tone = frame.tone[i];
  if (bg >= 0 && tone <= T.STAR) { px[0] = 236; px[1] = 236; px[2] = 208; return px; } // a star on the sky
  const mat = frame.mat ? frame.mat[i] : 0, br = frame.br ? frame.br[i] : 0;
  if (mat === 0 || br === 0 || frame.z[i] <= 0) {
    let s;
    if (frame.ch[i] === 32) s = (tone === T.WALL && frame.id[i] > 0 ? slotOf(frame, i) : tone * LEVELS) + 1; // a blank solid cell: dim, not black
    else s = slotOf(frame, i);
    px[0] = pal.rgb[s * 3]; px[1] = pal.rgb[s * 3 + 1]; px[2] = pal.rgb[s * 3 + 2];
    if (br > 0 && !EMISSIVE.has(tone) && mat === 0) { // untextured but brightness is known: shade smoothly, not in four glyph steps
      let slot = tone;
      if (tone === T.WALL && frame.id[i] > 0) slot = WALL_BASE + (Math.imul((frame.id[i] - 1) >> 1, 2654435761) >>> 0) % WALL_HUES.length;
      fullColor(pal, slot, 0.30 + 0.70 * Math.pow(br / 255, 0.72), px);
    }
    return px;
  }
  const texel = frame.focalX / frame.z[i];
  const gain = 0.30 + 0.70 * Math.pow(br / 255, 0.72);
  const u = frame.tu[i], v = frame.tv[i];
  if (mat === MAT.WINDOW) return windowColor(frame, pal, i, tone, gain, u, v, texel);
  let slot = tone, fn = null;
  if (mat === MAT.WALL) {
    const hue = frame.id[i] > 0 ? (Math.imul((frame.id[i] - 1) >> 1, 2654435761) >>> 0) % WALL_HUES.length : -1;
    if (hue >= 0) { slot = WALL_BASE + hue; fn = WALL_TEX[hue]; }
  } else if (mat === MAT.ASPHALT) fn = asphalt;
  else if (mat === MAT.SIDEWALK) fn = sidewalk;
  else if (mat === MAT.GRASS) fn = grass;
  else if (mat === MAT.PLAZA) fn = plaza;
  fullColor(pal, slot, gain, base);
  if (!fn) { px[0] = base[0]; px[1] = base[1]; px[2] = base[2]; return px; }
  fn(u, v, texel);
  const lr = LIGHT[0] * gain, lg = LIGHT[1] * gain, lb = LIGHT[2] * gain;
  // mortar takes the light colour at this brightness, scaled to the palette's day or night level
  const dayK = (pal.rgb[(T.COLUMN * LEVELS + LEVELS - 1) * 3] / 228);
  px[0] = base[0] * TM + (lr * dayK - base[0] * TM) * TX;
  px[1] = base[1] * TM + (lg * dayK - base[1] * TM) * TX;
  px[2] = base[2] * TM + (lb * dayK - base[2] * TM) * TX;
  return px;
}

/** A window: frame, mullions and glass, only when the pane is big enough on screen to show them. */
function windowColor(frame, pal, i, tone, gain, wu, wv, texel) {
  const lit = tone === T.WINDOW_LIT;
  const winPx = 0.2 * texel; // pane width in pixels
  if (lit) { const o = (T.WINDOW_LIT * LEVELS + LEVELS - 1) * 3; base[0] = pal.rgb[o]; base[1] = pal.rgb[o + 1]; base[2] = pal.rgb[o + 2]; }
  else fullColor(pal, T.WINDOW_DARK, gain, base);
  fullColor(pal, T.COLUMN, gain, trim);
  let r = base[0], g = base[1], b = base[2];
  if (winPx >= 4) {
    const frameHit = wu < 0.11 || wu > 0.89 || wv < 0.09 || wv > 0.91;
    const mull = winPx >= 7 && (Math.abs(wu - 0.5) < 0.05 || Math.abs(wv - 0.5) < 0.04);
    if (frameHit || mull) {
      if (lit) { r *= 0.32; g *= 0.28; b *= 0.22; } else { r = trim[0] * 0.9; g = trim[1] * 0.9; b = trim[2] * 0.9; }
    } else if (lit) { const k = 0.82 + 0.3 * wv; r *= k; g *= k; b *= k; } // warm, a little brighter low in the pane
    else { const k = wu + (1 - wv) < 0.85 ? 1.22 : 1; r *= k; g *= k; b *= k * 1.05; } // a glint in the upper-left of each pane
  }
  px[0] = r; px[1] = g; px[2] = b;
  return px;
}

/** Ordered dithering to the 6x6x6 colour cube. */
function quantise(c, x, y) {
  const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
  for (let k = 0; k < 3; k++) {
    const q = Math.round((c[k] + t * 34) / 51) * 51;
    c[k] = q < 0 ? 0 : q > 255 ? 255 : q;
  }
}

/** Fill an RGBA buffer (Uint8ClampedArray, cols * rows * 4) for canvas putImageData. opts.dither: false for plain truecolour. */
function pixelRgba(frame, pal, out, opts = {}) {
  const { cols, rows } = frame, dither = opts.dither !== false;
  for (let y = 0, i = 0, o = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++, i++, o += 4) {
      const c = pixelOf(frame, pal, i);
      if (dither) quantise(c, x, y);
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
    }
  }
  return out;
}

/** Terminal pixels: each character cell is two pixels, an upper half block with a foreground and a background colour. */
function halfBlockRows(frame, pal, truecolor, overlay, opts = {}) {
  const { cols, rows } = frame, dither = opts.dither === true;
  const cube6 = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const code = (r, g, b, fg) => truecolor ? `\x1b[${fg ? 38 : 48};2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`
    : `\x1b[${fg ? 38 : 48};5;${16 + 36 * cube6(r) + 6 * cube6(g) + cube6(b)}m`;
  const out = [];
  for (let y = 0; y + 1 < rows; y += 2) {
    let line = '';
    const r = y >> 1, ovRow = overlay && r >= overlay.y0 && r < overlay.y0 + overlay.rows.length ? overlay.rows[r - overlay.y0] : null;
    for (let x = 0; x < (ovRow ? overlay.x0 : cols); x++) {
      const a = pixelOf(frame, pal, y * cols + x);
      if (dither) quantise(a, x, y);
      const ar = a[0], ag = a[1], ab = a[2];
      const b = pixelOf(frame, pal, (y + 1) * cols + x);
      if (dither) quantise(b, x, y + 1);
      line += code(ar, ag, ab, true) + code(b[0], b[1], b[2], false) + '▀';
    }
    out.push(line + '\x1b[0m' + (ovRow || ''));
  }
  return out;
}

module.exports = { pixelOf, pixelRgba, halfBlockRows };
