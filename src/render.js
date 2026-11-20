'use strict';
/**
 * Raycasting renderer with per-tile building heights.
 *
 * For every screen column a DDA walks the tile grid front to back. A tile only produces a
 * visible face if it is taller than everything already passed (a farther tile that is not
 * taller projects entirely below a nearer one), and each face is clipped against the
 * highest row already covered. That is what gives you a skyline instead of equal-height walls.
 *
 * Output is a Frame of ASCII char codes plus a parallel `tone` plane (material ids), so a
 * later color pass can tint without re-rendering. No I/O in this file.
 */

const { hash2 } = require('./rng');
const { K, ROAD_MARK, EDGE_HEIGHT, PROP, DECO, STORE } = require('./world');
const { shopCell, houseCell } = require('./facade');
const { SPECIES, birdPose } = require('./birds');

const FLOOR_H = 0.4; // one floor, in tiles (a tile is ~8 m, so ~3.2 m per floor)
const WINDOWS_PER_TILE = 3;

const RAMP = ' .:-=+*#%@';
const RAMP_LAST = RAMP.length - 1;
const RAMP_CODES = Array.from(RAMP, (c) => c.charCodeAt(0));

/** Material ids written to Frame.tone. */
const { TREES, SHRUBS, FLOWERS, WEED: WEEDK } = require('./veg');
const TONE = {
  SKY: 0, STAR: 1, ROAD: 2, MARKING: 3, SIDEWALK: 4, PARK: 5, PLAZA: 6,
  WALL: 7, WINDOW_LIT: 8, WINDOW_DARK: 9, EDGE: 10, VOID: 11,
  LAMP: 12, LAMP_LIT: 13, TRUNK: 14, LEAF: 15, SIGNAL_RED: 16, SIGNAL_GREEN: 17, CROSSWALK: 18, CURB: 19, MANHOLE: 20, FIRE_ESCAPE: 21, HYDRANT: 22, TANK: 23, WIRE: 24, DOOR: 25, SIGN: 26, AWNING: 27, COLUMN: 28,
  PINE: 29, BIRCH: 30, BLOSSOM_PINK: 31, BLOSSOM_WHITE: 32, FLOWER_YELLOW: 33, FLOWER_RED: 34, FLOWER_PURPLE: 35, WEED: 36, LEAF_LIGHT: 37, REDBUD: 38,
  B_GRAY: 40, B_ORANGE: 41, B_RED: 42, B_BLUE: 43, B_YELLOW: 44, B_BLACK: 45, B_BROWN: 46, B_WHITE: 47, B_TAN: 48, B_GREEN: 49,
};

const BIRD_TONES = { B_GRAY: TONE.B_GRAY, B_ORANGE: TONE.B_ORANGE, B_RED: TONE.B_RED, B_BLUE: TONE.B_BLUE, B_YELLOW: TONE.B_YELLOW, B_BLACK: TONE.B_BLACK, B_BROWN: TONE.B_BROWN, B_WHITE: TONE.B_WHITE, B_TAN: TONE.B_TAN, B_GREEN: TONE.B_GREEN };

/** frame.id value of a sprite cell (bird, wire) drawn over open sky, so the colour pass keeps the sky behind it. */
const SKY_BEHIND = 0xffffffff;

/** Write a sprite cell. Over open sky the cell remembers it, so the colour pass keeps the sky background behind it. */
function put(frame, i, glyph, toneId, dep) {
  frame.id[i] = (frame.tone[i] <= TONE.STAR || frame.id[i] === SKY_BEHIND) ? SKY_BEHIND : 0;
  frame.ch[i] = glyph; frame.tone[i] = toneId; frame.z[i] = dep;
}

function createFrame(cols, rows) {
  return {
    cols, rows,
    ch: new Uint8Array(cols * rows),
    tone: new Uint8Array(cols * rows),
    id: new Uint32Array(cols * rows), // wall face id per cell (0 = not a near wall); drives the edge pass
    z: new Float32Array(cols * rows), // distance to whatever each cell shows (sprites test against it)
    depth: new Float32Array(cols), // distance to the first wall per column (hook for sprites)
  };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
/* a mild gamma lifts dark tones so night scenes keep readable structure */
function rampCode(b) { return RAMP_CODES[Math.round(Math.pow(clamp01(b), 0.72) * RAMP_LAST)]; }

/* Sparse filler: low brightness fades to blank space with a scatter of dots (4x4 ordered dither),
 * instead of a solid wash of '.' ':' '-'. opts.filler = 'solid' restores the old look. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function sparseCode(b, x, r) {
  const v = clamp01(b) * 1.6;
  if (v < 0.10) return 32;
  if (v >= 0.55) return rampCode(b);
  return (BAYER[(r & 3) * 4 + (x & 3)] / 16) < ((v - 0.10) / 0.45) * 0.85 ? 46 : 32;
}

/** Day/night from the hour (0-24). day: 1 at noon, 0 at night. */
function lighting(time) {
  const sun = Math.sin(((time - 6) / 12) * Math.PI);
  const day = clamp01(sun * 2.2 + 0.35);
  return { day, night: 1 - day, ambient: 0.2 + 0.8 * day };
}

/**
 * Render the world from a camera into a frame (the frame is overwritten in full).
 *
 * @param {object} frame      from createFrame(cols, rows)
 * @param {object} world      from generateWorld()
 * @param {{x:number,y:number,angle:number,pitch:number,eyeZ:number}} cam
 * @param {{fov?:number, viewDist?:number, cellAspect?:number, time?:number}} [opts]
 *   cellAspect = glyph cell height / width (about 2 for typical monospace fonts)
 */
function render(frame, world, cam, opts = {}) {
  const { cols, rows, ch, tone, depth, id, z: zbuf } = frame;
  const fov = opts.fov || 1.15;
  const viewDist = opts.viewDist || 56;
  const cellAspect = opts.cellAspect || 2;
  const time = opts.time === undefined ? 21 : opts.time;
  const sparse = opts.filler !== 'solid';
  const light = lighting(time);
  const { ambient, night } = light;
  const size = world.size;
  const wrap = world.wrap !== false; // torus: the map has no edge, it joins up with itself
  const seed = world.seed | 0;

  const tanHalf = Math.tan(fov / 2);
  const focalX = cols / 2 / tanHalf; // in cell widths
  const focalY = focalX / cellAspect; // in rows per (dz / distance)
  const hz = rows * (opts.horizon === undefined ? 0.56 : opts.horizon) + cam.pitch * rows; // horizon row (float)
  const eyeZ = cam.eyeZ;
  const dirX = Math.cos(cam.angle), dirY = Math.sin(cam.angle);
  const planeX = -dirY, planeY = dirX;

  /* brightness of distant haze, shared by sky horizon and fog */
  const haze = sparse ? 0.08 + 0.12 * light.day : 0.10 + 0.24 * light.day;
  const skyTop = 0.0 + 0.08 * light.day;
  const dayScale = 0.30 + 0.70 * ambient;

  /* per-row ground distance, fog and sky brightness */
  const rowDist = new Float32Array(rows);
  const rowFog = new Float32Array(rows);
  const rowSky = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    const off = r + 0.5 - hz;
    if (off > 0) {
      const d = (eyeZ * focalY) / off;
      rowDist[r] = d;
      rowFog[r] = fog(d, viewDist);
    } else {
      const t = clamp01((hz - (r + 0.5)) / Math.max(1, hz));
      rowSky[r] = haze + (skyTop - haze) * Math.pow(t, 0.7);
    }
  }

  const maxSteps = Math.ceil(viewDist * 2) + 4;

  for (let x = 0; x < cols; x++) {
    const camX = ((2 * (x + 0.5)) / cols - 1) * tanHalf;
    const rdx = dirX + planeX * camX;
    const rdy = dirY + planeY * camX;

    /* ---- sky and ground ---- */
    const ang = cam.angle + Math.atan(camX);
    const starBucket = Math.floor(ang * 100);
    const horizonRow = Math.floor(hz);
    for (let r = 0; r < rows; r++) {
      const i = r * cols + x;
      if (r + 0.5 < hz) {
        let b = rowSky[r];
        let code = sparse ? sparseCode(b, x, r) : rampCode(b);
        let tn = TONE.SKY;
        if (night > 0.15) {
          const hv = hash2(starBucket, r - horizonRow, seed ^ 0x51ed);
          if ((hv & 0x3ff) < 14 * night) { code = (hv & 0x400) ? 42 : 46; tn = TONE.STAR; } // '*' or '.'
        }
        ch[i] = code; tone[i] = tn; id[i] = 0; zbuf[i] = 1e9;
      } else {
        const d = rowDist[r];
        let px = cam.x + rdx * d, py = cam.y + rdy * d;
        if (wrap) { px -= size * Math.floor(px / size); py -= size * Math.floor(py / size); } // so textures match from both sides of the seam
        const tx = Math.floor(px), ty = Math.floor(py);
        id[i] = 0; zbuf[i] = d;
        if (!wrap && (tx < 0 || ty < 0 || tx >= size || ty >= size)) { ch[i] = 32; tone[i] = TONE.VOID; continue; }
        const t = ty * size + tx;
        const fx = px - tx, fy = py - ty;
        let b, tn, parkHash = -1;
        switch (world.kind[t]) {
          case K.ROAD: {
            b = 0.20 + 0.03 * (hash2(Math.floor(px * 3), Math.floor(py * 3), seed) / 4294967296); tn = TONE.ROAD; // asphalt, kept dark so paint and curbs read
            const m = world.mark[t];
            const dc = world.deco[t];
            if (dc >= 1 && dc <= 4 && d < 26) {
              let bar, span;
              if (dc === DECO.CROSS_N) { span = fy > 0.35 && fy < 0.9; bar = (Math.floor(px * 2.5) & 1) === 0; }
              else if (dc === DECO.CROSS_S) { span = fy < 0.65 && fy > 0.1; bar = (Math.floor(px * 2.5) & 1) === 0; }
              else if (dc === DECO.CROSS_W) { span = fx > 0.35 && fx < 0.9; bar = (Math.floor(py * 2.5) & 1) === 0; }
              else { span = fx < 0.65 && fx > 0.1; bar = (Math.floor(py * 2.5) & 1) === 0; }
              if (span && bar) { b = 0.9; tn = TONE.CROSSWALK; }
            } else if (m !== 0 && d < 22) {
              let on = false;
              if (m === ROAD_MARK.V_CENTER) on = Math.abs(fx - 0.5) < 0.07 && (Math.floor(py * 3) & 1) === 0;
              else if (m === ROAD_MARK.V_LEFT) on = fx < 0.06 && (Math.floor(py * 3) & 1) === 0;
              else if (m === ROAD_MARK.V_RIGHT) on = fx > 0.94 && (Math.floor(py * 3) & 1) === 0;
              else if (m === ROAD_MARK.H_CENTER) on = Math.abs(fy - 0.5) < 0.07 && (Math.floor(px * 3) & 1) === 0;
              else if (m === ROAD_MARK.H_TOP) on = fy < 0.06 && (Math.floor(px * 3) & 1) === 0;
              else if (m === ROAD_MARK.H_BOTTOM) on = fy > 0.94 && (Math.floor(px * 3) & 1) === 0;
              if (on) { b = 0.85; tn = TONE.MARKING; }
            }
            if (dc === DECO.MANHOLE && d < 26) { // round cover
              const mx = fx - 0.5, my = fy - 0.5;
              if (mx * mx + my * my < 0.0144) { b = 0.7; tn = TONE.MANHOLE; }
            }
            break;
          }
          case K.SIDEWALK:
            b = 0.50 - ((fx % 0.5) < 0.07 || (fy % 0.5) < 0.07 ? 0.16 : 0); tn = TONE.SIDEWALK; // paving joints
            if (d < 34) { // curb: a bright lip on the side facing the road, so blocks read apart from streets
              const k = world.kind;
              const xl = tx > 0 ? tx - 1 : wrap ? size - 1 : -1, xr = tx < size - 1 ? tx + 1 : wrap ? 0 : -1;
              const yu = ty > 0 ? ty - 1 : wrap ? size - 1 : -1, yd = ty < size - 1 ? ty + 1 : wrap ? 0 : -1;
              if ((fx < 0.14 && xl >= 0 && k[ty * size + xl] === K.ROAD) || (fx > 0.86 && xr >= 0 && k[ty * size + xr] === K.ROAD) ||
                  (fy < 0.14 && yu >= 0 && k[yu * size + tx] === K.ROAD) || (fy > 0.86 && yd >= 0 && k[yd * size + tx] === K.ROAD)) { b = 0.86; tn = TONE.CURB; }
            }
            break;
          case K.PARK:
            b = 0.30 + 0.16 * (hash2(Math.floor(px * 3), Math.floor(py * 3), seed) / 4294967296); tn = TONE.PARK; parkHash = hash2(Math.floor(px * 3), Math.floor(py * 3), seed ^ 77); break;
          case K.YARD:
            b = 0.32 + 0.10 * (hash2(Math.floor(px * 3), Math.floor(py * 3), seed) / 4294967296); tn = TONE.PARK; parkHash = hash2(Math.floor(px * 3), Math.floor(py * 3), seed ^ 91); break;
          case K.PLAZA:
            b = ((Math.floor(px * 2) + Math.floor(py * 2)) & 1) ? 0.52 : 0.42; tn = TONE.PLAZA; break;
          default:
            b = 0.30; tn = TONE.ROAD;
        }
        const f = rowFog[r];
        const gl = world.glow[t];
        if (gl !== 0 && night > 0.15) b += (gl / 255) * 0.5 * night; // lamp light pooling on the ground
        b = b * dayScale * f + haze * (1 - f);
        if (tn === TONE.CROSSWALK) ch[i] = 35; // '#'
        else if (tn === TONE.CURB) ch[i] = 95; // '_'
        else if (tn === TONE.MANHOLE) ch[i] = 111; // 'o'
        else if (tn === TONE.MARKING && d < 22) ch[i] = 61; // '=' for paint
        else if (parkHash >= 0 && d < 24) { const q = parkHash & 7; ch[i] = q === 0 ? 34 : q === 1 ? 44 : q === 2 ? 39 : rampCode(b); } // grass: " , '
        else ch[i] = (sparse && tn === TONE.ROAD) ? sparseCode(b, x, r) : rampCode(b);
        tone[i] = tn;
      }
    }

    /* ---- walls: DDA front to back ---- */
    let mapX = Math.floor(cam.x), mapY = Math.floor(cam.y);
    const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    let stepX, stepY, sdx, sdy;
    if (rdx < 0) { stepX = -1; sdx = (cam.x - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - cam.x) * ddx; }
    if (rdy < 0) { stepY = -1; sdy = (cam.y - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - cam.y) * ddy; }

    let maxH = 0, minY = rows, firstHit = viewDist;
    for (let step = 0; step < maxSteps; step++) {
      let perp, side;
      if (sdx < sdy) { perp = sdx; sdx += ddx; mapX += stepX; side = 0; } else { perp = sdy; sdy += ddy; mapY += stepY; side = 1; }
      if (perp > viewDist) break;
      if (perp < 0.02) continue;

      const wx0 = wrap ? ((mapX % size) + size) % size : mapX, wy0 = wrap ? ((mapY % size) + size) % size : mapY;
      const oob = !wrap && (mapX < 0 || mapY < 0 || mapX >= size || mapY >= size);
      const t = oob ? -1 : wy0 * size + wx0;
      const h = oob ? EDGE_HEIGHT : world.height[t];
      if (h <= maxH) continue;
      maxH = h;
      if (perp < firstHit) firstHit = perp;

      const topRow = hz - (h * FLOOR_H - eyeZ) * focalY / perp;
      const botRow = hz + (eyeZ * focalY) / perp;
      const rs = Math.max(0, Math.ceil(topRow - 0.5));
      const re = Math.min(Math.ceil(botRow - 0.5), minY);

      if (re > rs) {
        const wallPos = side === 0 ? cam.y + perp * rdy : cam.x + perp * rdx;
        const wx = wallPos - Math.floor(wallPos);
        const bId = oob ? 0 : world.bid[t];
        const sideShade = side === 0 ? 0.95 : 0.66;
        const f = fog(perp, viewDist);
        const wallBase = sideShade * (0.28 + 0.62 * ambient);
        const winCell = wx * WINDOWS_PER_TILE;
        const wi = Math.floor(winCell);
        const wf = winCell - wi;
        const perpOverFocal = perp / focalY;
        /* level of detail: fine window panes only when each floor and window spans enough cells */
        const rowsPerFloor = (FLOOR_H * focalY) / perp;
        const colsPerTile = focalX / perp;
        const fineV = rowsPerFloor >= 1.7, fineH = colsPerTile >= 7;
        /* fire escape on some facades: platforms every floor, rails at the sides, a diagonal stair */
        const shop = !oob && world.facades ? world.facades.get(t) : undefined; // any tile on a shop's street wall
        const house = !oob && world.houses ? world.houses.get(t) : undefined; // front-wall tile of a suburban house
        const escOn = !shop && !house && !oob && fineV && f > 0.2 && h >= 4 && h <= 18 && hash2(wx0 * 5 + side, wy0 * 3, seed ^ 0xfe) / 4294967296 < 0.06;

        /* storefront: only on the one face of a shop building that looks onto the street */
        const hitFace = side === 0 ? (stepX > 0 ? 3 : 4) : (stepY > 0 ? 1 : 2); // which face of the tile this ray hit (matches world FACE)
        const storefront = shop !== undefined && shop.face === hitFace && fineV && f > 0.22;
        const houseFront = house !== undefined && house.face === hitFace && fineV && f > 0.22 ;
        const flip = hitFace === 1 || hitFace === 4; // read signs left to right as seen from the street
        const uu = flip ? 1 - wx : wx;
        const isCenter = storefront && shop.anchorTile === t; // door and sign live on the middle tile
        const signLen = isCenter ? shop.sign.length : 0;
        const signOn = isCenter && colsPerTile >= 12 && rowsPerFloor >= 2.5;
        const signX0 = 0.5 - signLen * 0.05;
        const rowVf = 1 / rowsPerFloor;
        const cpc = colsPerTile * 0.1; // columns per sign letter

        for (let r = rs; r < re; r++) {
          const z = eyeZ + (hz - (r + 0.5)) * perpOverFocal;
          const fz = z / FLOOR_H;
          const fl = Math.floor(fz);
          const vf = fz - fl;
          let b, tn, sp = 0;
          if (oob) {
            b = (wallBase * 0.8) * f + haze * (1 - f);
            b *= (wx < 0.12 || wx > 0.88) ? 0.6 : 1;
            tn = TONE.EDGE;
          } else {
            const inV = fineV ? (vf > 0.22 && vf < 0.78) : (vf > 0.12 && vf < 0.88);
            const inH = fineH ? (wf > 0.2 && wf < 0.8) : true;
            const shopFloor = (storefront && fl <= 1) || (houseFront && fl < house.floors);
            const isWin = fl >= 0 && inV && inH && !shopFloor;
            if (isWin) {
              const occupied = hash2(bId, 7, seed) / 4294967296 < 0.9;
              const lit = occupied && hash2(bId * 31 + wi + (side ? 17 : 0), fl, seed) / 4294967296 < night * 0.6 + 0.04;
              if (lit && night > 0.2) {
                const fw = Math.pow(f, 0.45); // lights stay visible farther than walls
                b = (0.55 + 0.45 * night) * fw + haze * (1 - fw);
                tn = TONE.WINDOW_LIT;
              } else if (fineV && fineH) {
                b = wallBase * 0.45 * f + haze * (1 - f);
                tn = TONE.WINDOW_DARK;
              } else {
                b = wallBase * f + haze * (1 - f);
                tn = TONE.WALL;
              }
            } else {
              b = wallBase * (fineV && vf < 0.06 ? 0.82 : 1) * f + haze * (1 - f);
              tn = TONE.WALL;
              if (r === rs && topRow >= 0) b += 0.10 * f; // roof edge catches light
            }
          }
          if (storefront && fl <= 1) {
            const u = uu;
            if (fl === 0 && signOn && vf > 0.7 && Math.abs(vf - 0.8) <= rowVf * 0.5 && u >= signX0 && u < signX0 + signLen * 0.1) {
              const s = (u - signX0) / 0.1, ci = Math.floor(s);
              if (Math.abs(s - ci - 0.5) <= 0.55 / cpc) { sp = shop.sign.charCodeAt(ci); tn = TONE.SIGN; }
            }
            if (!sp) {
              const g = shopCell(shop.kind, isCenter, u, vf, fl);
              if (g) { sp = g; tn = shopCell.tone; }
              else if (shopCell.glass) { // display window, lit at night
                if (night > 0.2) { const fw = Math.pow(f, 0.45); b = (0.55 + 0.4 * night) * fw + haze * (1 - fw); tn = TONE.WINDOW_LIT; }
                else { b = wallBase * 0.4 * f + haze * (1 - f); tn = TONE.WINDOW_DARK; }
              }
            }
          }
          if (houseFront && fl >= 0 && fl < house.floors) {
            const g = houseCell(house.style, house.i === house.door, house.i === house.garage, uu, vf, fl);
            if (g) { sp = g; tn = houseCell.tone; }
            else if (houseCell.glass) {
              const lit = hash2(bId * 13 + fl, 5, seed) / 4294967296 < night * 0.7 + 0.03;
              if (night > 0.2 && lit) { const fw = Math.pow(f, 0.45); b = (0.55 + 0.4 * night) * fw + haze * (1 - fw); tn = TONE.WINDOW_LIT; }
              else { b = wallBase * 0.4 * f + haze * (1 - f); tn = TONE.WINDOW_DARK; }
            }
          }
          if (escOn && fl >= 1 && fl < h) {
            const plat = vf < 0.14 && wx > 0.2 && wx < 0.8;
            const rail = (wx > 0.2 && wx < 0.26) || (wx > 0.74 && wx < 0.8);
            const tgt = (fl & 1) ? 0.3 + 0.4 * (1 - vf) : 0.3 + 0.4 * vf; // stair runs corner to corner
            if (plat) { sp = 61; tn = TONE.FIRE_ESCAPE; }
            else if (rail) { sp = 124; tn = TONE.FIRE_ESCAPE; }
            else if (fineH && Math.abs(wx - tgt) < 0.05) { sp = (fl & 1) ? 92 : 47; tn = TONE.FIRE_ESCAPE; }
          }
          const i = r * cols + x;
          ch[i] = sp || rampCode(b); tone[i] = tn;
          id[i] = (oob || perp > viewDist * 0.7) ? 0 : ((bId << 1) | side) + 1;
          zbuf[i] = perp;
        }
      }
      if (rs < minY) minY = rs;
      if (minY <= 0) break;
    }
    depth[x] = firstHit;
  }
  edgePass(frame);
  if (world.props && world.props.length) {
    drawProps(frame, world, cam, { wrapD: wrap ? (d) => d - size * Math.round(d / size) : (d) => d, hz, focalX, focalY, tanHalf, dirX, dirY, planeX, planeY, eyeZ, viewDist, light, haze, seed });
  }
  if (world.birds && world.birds.length) {
    drawBirds(frame, world, cam, { wrapD: wrap ? (d) => d - size * Math.round(d / size) : (d) => d, hz, focalX, focalY, tanHalf, planeX, planeY, dirX, dirY, eyeZ, viewDist, light, clock: opts.clock || 0 });
  }
  return frame;
}

/**
 * Silhouette pass: draws '|' where a near building face starts next to something different
 * (another face, sky or ground) and '_' along roof lines, so shapes read at a glance.
 */
function edgePass(frame) {
  const { cols, rows, ch, id, tone } = frame;
  for (let r = 0; r < rows; r++) {
    const row = r * cols;
    for (let x = cols - 1; x >= 0; x--) {
      const i = row + x, v = id[i];
      if (v === 0) continue;
      if (x > 0 && id[i - 1] !== v && tone[i] !== TONE.WINDOW_LIT) { ch[i] = 124; continue; } // '|'
      if (r > 0 && id[i - cols] === 0 && tone[i - cols] === TONE.SKY) ch[i] = 95;            // '_'
    }
  }
}

/* ------------------------------------------------------------------ props (sprites) */

/** Fill a vertical box (centre column sx, width wT tiles, z0..z1 in tiles) at distance dep. Cells already nearer win. */
function box(frame, g, sx, wT, z0, z1, dep, glyph, toneId, minRows) {
  const { cols, rows, ch, tone, id, z } = frame;
  const wc = Math.max(1, Math.round((wT * g.focalX) / dep));
  const c0 = Math.round(sx - wc / 2 - 0.0001), c1 = c0 + wc;
  const top = g.hz - ((z1 - g.eyeZ) * g.focalY) / dep;
  const bot = g.hz + ((g.eyeZ - z0) * g.focalY) / dep;
  let r0 = Math.ceil(top - 0.5), r1 = Math.ceil(bot - 0.5);
  if (r1 - r0 < minRows) r1 = r0 + minRows;
  if (r0 < 0) r0 = 0;
  if (r1 > rows) r1 = rows;
  for (let x = c0; x < c1; x++) {
    if (x < 0 || x >= cols) continue;
    for (let r = r0; r < r1; r++) {
      const i = r * cols + x;
      if (dep < z[i]) put(frame, i, glyph, toneId, dep);
    }
  }
}

/** Utility lines: two sagging conductors per span, sampled in 3D, projected, joined cell to cell. */
function drawWires(frame, world, cam, g) {
  const wires = world.wires;
  if (!wires || !wires.length) return;
  const { cols, rows, ch, tone, id, z } = frame;
  for (const w of wires) {
    const mx = (w.x0 + w.x1) / 2, my = (w.y0 + w.y1) / 2;
    if (Math.hypot(g.wrapD(mx - cam.x), g.wrapD(my - cam.y)) > g.viewDist * 0.75) continue;
    const len = Math.hypot(w.x1 - w.x0, w.y1 - w.y0);
    const nx = -(w.y1 - w.y0) / len, ny = (w.x1 - w.x0) / len; // sideways, for the two conductors
    const n = Math.min(120, Math.ceil(len * 6));
    for (let lane = 0; lane < 2; lane++) {
      const off = lane ? 0.11 : -0.11, zb = lane ? 0.86 : 0.93;
      let pc = 0, pr = 0, pd = 0, have = false;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = w.x0 + (w.x1 - w.x0) * t + nx * off, y = w.y0 + (w.y1 - w.y0) * t + ny * off;
        const zz = zb - 0.1 * (len / 6) * 4 * t * (1 - t); // catenary-ish sag
        const dx = g.wrapD(x - cam.x), dy = g.wrapD(y - cam.y);
        const dep = dx * g.dirX + dy * g.dirY;
        if (dep < 0.4) { have = false; continue; }
        const camX = (dx * g.planeX + dy * g.planeY) / dep;
        const c = Math.floor((camX / g.tanHalf + 1) * cols * 0.5);
        const r = Math.floor(g.hz - ((zz - g.eyeZ) * g.focalY) / dep);
        if (have) {
          const dc = c - pc, dr = r - pr, steps = Math.max(Math.abs(dc), Math.abs(dr));
          if (steps < cols) {
            const slope = dc === 0 ? 99 : dr / dc;
            const glyph = Math.abs(slope) > 2 ? 124 : Math.abs(slope) < 0.5 ? 45 : (slope > 0 ? 92 : 47);
            for (let s = 0; s <= steps; s++) {
              const u = steps ? s / steps : 0;
              const cc = Math.round(pc + dc * u), rr = Math.round(pr + dr * u), dd = pd + (dep - pd) * u;
              if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue;
              const i = rr * cols + cc;
              if (dd < z[i]) put(frame, i, glyph, TONE.WIRE, dd);
            }
          }
        }
        pc = c; pr = r; pd = dep; have = true;
      }
    }
  }
}

function drawProps(frame, world, cam, g) {
  const { cols, rows, ch, tone, id, z } = frame;
  const props = world.props;
  const night = g.light.night, ambient = g.light.ambient;
  const vis = [];
  for (let n = 0; n < props.length; n++) {
    const p = props[n];
    const dx = g.wrapD(p.x - cam.x), dy = g.wrapD(p.y - cam.y);
    const dep = dx * g.dirX + dy * g.dirY;
    if (dep < 0.4 || dep > g.viewDist) continue;
    if (dep > g.viewDist * 0.72 && p.type >= PROP.FLOWER) continue;
    const camX = (dx * g.planeX + dy * g.planeY) / dep;
    if (camX > g.tanHalf * 1.2 || camX < -g.tanHalf * 1.2) continue;
    vis.push({ p, dep, sx: (camX / g.tanHalf + 1) * cols * 0.5 });
  }
  drawWires(frame, world, cam, g);
  const lampOn = night > 0.25;

  for (const { p, dep, sx } of vis) {
    const f = fog(dep, g.viewDist);
    if (p.type === PROP.LAMP) {
      if (f > 0.2) box(frame, g, sx, 0.05, 0, 0.6, dep, 124, TONE.LAMP, 1); // pole '|'
      box(frame, g, sx, 0.16, 0.58, 0.68, dep, lampOn ? 64 : 111, lampOn ? TONE.LAMP_LIT : TONE.LAMP, 1); // head '@' lit / 'o'
    } else if (p.type === PROP.SIGNAL) {
      box(frame, g, sx, 0.04, 0, 0.5, dep, 124, TONE.LAMP, 1);
      box(frame, g, sx, 0.11, 0.46, 0.62, dep, p.v ? 79 : 79, p.v ? TONE.SIGNAL_GREEN : TONE.SIGNAL_RED, 1); // head 'O'
    } else if (p.type === PROP.HYDRANT) {
      box(frame, g, sx, 0.07, 0, 0.1, dep, 105, TONE.HYDRANT, 1); // 'i'
    } else if (p.type === PROP.POLE) {
      if (f > 0.1) box(frame, g, sx, 0.05, 0, 1.0, dep, 124, TONE.LAMP, 1);
      box(frame, g, sx, 0.34, 0.9, 0.94, dep, 61, TONE.LAMP, 1); // crossarm
    } else if (p.type === PROP.TANK) {
      const z0 = p.v * FLOOR_H;
      box(frame, g, sx, 0.2, z0, z0 + 0.1, dep, 124, TONE.TANK, 1);        // legs
      box(frame, g, sx, 0.3, z0 + 0.1, z0 + 0.3, dep, 35, TONE.TANK, 1);   // tank '#'
      box(frame, g, sx, 0.14, z0 + 0.3, z0 + 0.36, dep, 94, TONE.TANK, 1); // roof '^'
    } else if (p.type === PROP.ROOFPIECE) {
      const z0 = p.v * FLOOR_H;
      switch (p.k) {
        case STORE.FIREHALL: // hose tower
          box(frame, g, sx, 0.16, z0, z0 + 0.42, dep, 72, TONE.TANK, 1);
          box(frame, g, sx, 0.2, z0 + 0.42, z0 + 0.48, dep, 61, TONE.TANK, 1);
          break;
        case STORE.SCHOOL: // flagpole and flag
          box(frame, g, sx, 0.025, z0, z0 + 0.6, dep, 124, TONE.LAMP, 1);
          box(frame, g, sx, 0.12, z0 + 0.46, z0 + 0.58, dep, 62, TONE.SIGN, 1);
          break;
        case STORE.LIBRARY: // low dome
          box(frame, g, sx, 0.3, z0, z0 + 0.07, dep, 61, TONE.TANK, 1);
          box(frame, g, sx, 0.2, z0 + 0.07, z0 + 0.14, dep, 40, TONE.TANK, 1);
          box(frame, g, sx, 0.05, z0 + 0.14, z0 + 0.2, dep, 124, TONE.TANK, 1);
          break;
        case STORE.HOTEL: // rooftop sign block on a mast
          box(frame, g, sx, 0.04, z0, z0 + 0.3, dep, 124, TONE.LAMP, 1);
          box(frame, g, sx, 0.24, z0 + 0.24, z0 + 0.4, dep, lampOn ? 64 : 72, lampOn ? TONE.LAMP_LIT : TONE.TANK, 1);
          break;
        case STORE.PHARMACY: // rooftop cross
          box(frame, g, sx, 0.04, z0, z0 + 0.3, dep, 43, TONE.SIGN, 1);
          box(frame, g, sx, 0.16, z0 + 0.18, z0 + 0.23, dep, 43, TONE.SIGN, 1);
          break;
        case STORE.DINER: // roof sign
          box(frame, g, sx, 0.22, z0, z0 + 0.1, dep, lampOn ? 42 : 61, lampOn ? TONE.SIGN : TONE.TANK, 1);
          break;
        case STORE.BANK: // flag on a short pole
          box(frame, g, sx, 0.025, z0, z0 + 0.36, dep, 124, TONE.LAMP, 1);
          box(frame, g, sx, 0.1, z0 + 0.28, z0 + 0.36, dep, 62, TONE.SIGN, 1);
          break;
        case 101: case 102: case 103: case 104: case 106: { // pitched roofs: stacked slabs narrowing to a ridge, steeper for tudor and victorian
          const w = Math.min(p.w || 2.4, 4) + 0.3;
          const steep = p.k === 104 || p.k === 106 ? 0.13 : p.k === 102 ? 0.1 : 0.08;
          const layers = p.k === 104 || p.k === 106 ? 5 : p.k === 102 ? 4 : 3;
          for (let n = 0; n < layers; n++) {
            const wn = w * (1 - n / (layers + 0.6));
            box(frame, g, sx, wn, z0 + n * steep, z0 + (n + 1) * steep, dep, n === layers - 1 ? 94 : n === 0 ? 61 : 45, TONE.TANK, 1);
          }
          if (p.k === 106) { // turret with a pointed cap
            box(frame, g, sx, 0.18, z0, z0 + 0.34, dep, 35, TONE.TANK, 1);
            box(frame, g, sx, 0.22, z0 + 0.34, z0 + 0.4, dep, 94, TONE.TANK, 1);
            box(frame, g, sx, 0.08, z0 + 0.4, z0 + 0.5, dep, 94, TONE.TANK, 1);
          }
          break;
        }
        case 105: // flat roof with a parapet and a rooftop box
          box(frame, g, sx, Math.min(p.w || 2.4, 4) + 0.2, z0, z0 + 0.03, dep, 95, TONE.TANK, 1);
          box(frame, g, sx, 0.3, z0 + 0.03, z0 + 0.09, dep, 35, TONE.TANK, 1);
          break;
        case 190: // chimney
          box(frame, g, sx, 0.08, z0, z0 + 0.17, dep, 35, TONE.TANK, 1);
          break;
        default: break;
      }
    } else if (p.type === PROP.PLAY) {
      const col = (tiles) => (tiles * g.focalX) / dep;
      if (p.v === 0) { // swing set: two end frames, a top bar, two swings
        box(frame, g, sx - col(0.3), 0.05, 0, 0.36, dep, 124, TONE.SIGN, 1);
        box(frame, g, sx + col(0.3), 0.05, 0, 0.36, dep, 124, TONE.SIGN, 1);
        box(frame, g, sx, 0.7, 0.34, 0.38, dep, 61, TONE.SIGN, 1);
        box(frame, g, sx - col(0.11), 0.07, 0.08, 0.11, dep, 117, TONE.AWNING, 1);
        box(frame, g, sx + col(0.11), 0.07, 0.08, 0.11, dep, 117, TONE.AWNING, 1);
      } else if (p.v === 1) { // slide: tower, ramp
        box(frame, g, sx - col(0.18), 0.14, 0, 0.3, dep, 72, TONE.AWNING, 1);
        box(frame, g, sx - col(0.18), 0.18, 0.3, 0.34, dep, 94, TONE.AWNING, 1);
        box(frame, g, sx + col(0.12), 0.3, 0.02, 0.2, dep, 47, TONE.SIGN, 1);
      } else if (p.v === 2) { // jungle gym: a grid of bars
        box(frame, g, sx, 0.46, 0.2, 0.26, dep, 43, TONE.SIGN, 1);
        box(frame, g, sx - col(0.2), 0.04, 0, 0.2, dep, 124, TONE.SIGN, 1);
        box(frame, g, sx + col(0.2), 0.04, 0, 0.2, dep, 124, TONE.SIGN, 1);
        box(frame, g, sx, 0.04, 0, 0.2, dep, 124, TONE.SIGN, 1);
      } else { // seesaw
        box(frame, g, sx, 0.5, 0.08, 0.12, dep, 61, TONE.AWNING, 1);
        box(frame, g, sx, 0.06, 0, 0.08, dep, 94, TONE.SIGN, 1);
      }
    } else if (p.type === PROP.STEEPLE) {
      const z0 = p.v * FLOOR_H;
      box(frame, g, sx, 0.2, z0, z0 + 0.3, dep, 72, TONE.TANK, 1);          // tower 'H'
      box(frame, g, sx, 0.1, z0 + 0.3, z0 + 0.52, dep, 94, TONE.TANK, 1);   // spire '^'
      box(frame, g, sx, 0.03, z0 + 0.5, z0 + 0.6, dep, 43, TONE.TANK, 1);   // cross '+'
    } else if (p.type === PROP.ANTENNA) {
      const z0 = p.v * FLOOR_H;
      box(frame, g, sx, 0.03, z0, z0 + 0.6, dep, 124, TONE.LAMP, 1);
      if (lampOn) box(frame, g, sx, 0.09, z0 + 0.58, z0 + 0.66, dep, 42, TONE.SIGNAL_RED, 1); // beacon '*'
    } else if (p.type === PROP.TREE) {
      const sp = TREES[p.k || 0], hh = hash2((p.x * 64) | 0, (p.y * 64) | 0, g.seed ^ 0x77) / 4294967296;
      const sc = (p.v ? 0.72 : 1) * (0.85 + 0.3 * hh);
      const trunkH = sp.trunkH * sc, rad = sp.rad * sc, ry = sp.ry * sc;
      box(frame, g, sx, sp.shape === 'cone' ? 0.06 : 0.07, 0, trunkH + 0.04, dep, 124, TONE[sp.trunk], 1);
      blob(frame, g, sx, dep, f, { cz: trunkH + ry * 0.85, rad, ry, shape: sp.shape, tone: TONE[sp.leaf], bloom: sp.bloom && TONE[sp.bloom], bloomP: sp.bloomP || 0, ambient, salt: hh });
    } else if (p.type === PROP.SHRUB) {
      const sp = SHRUBS[p.k || 0];
      blob(frame, g, sx, dep, f, { cz: sp.h * 0.5, rad: sp.rad, ry: sp.h * 0.5, shape: 'ell', tone: TONE[sp.leaf], bloom: sp.bloom && TONE[sp.bloom], bloomP: sp.bloomP || 0, ambient, salt: p.x });
    } else if (p.type === PROP.FLOWER) {
      if (dep > g.viewDist * 0.72) continue;
      const sp = FLOWERS[p.k || 0], n = p.k <= 1 ? 4 : 3;
      for (let q = 0; q < n; q++) {
        const r1 = hash2((p.x * 97) | 0, (p.y * 97) | 0, q + 11) / 4294967296, r2 = hash2((p.x * 53) | 0, (p.y * 53) | 0, q + 31) / 4294967296;
        const h = sp.h[0] + (sp.h[1] - sp.h[0]) * r2, sq = sx + ((r1 - 0.5) * 0.34 * g.focalX) / dep;
        if (h > 0.06 && f > 0.25) box(frame, g, sq, 0.015, 0, h * 0.85, dep, 124, TONE.LEAF, 1);
        box(frame, g, sq, 0.05, h * 0.8, h + 0.02, dep, sp.glyph, TONE[sp.head[(p.v + q) % sp.head.length]], 1);
      }
    } else if (p.type === PROP.WEED) {
      if (dep > g.viewDist * 0.72) continue;
      const k = p.k || 0, lean = (q) => [92, 124, 47][q % 3];
      if (k === WEEDK.GRASS) {
        for (let q = 0; q < 3; q++) box(frame, g, sx + ((q - 1) * 0.07 * g.focalX) / dep, 0.015, 0, 0.08 + 0.03 * ((q * 7 + ((p.x * 10) | 0)) % 3), dep, lean(q), q === 1 ? TONE.WEED : TONE.LEAF, 1);
      } else if (k === WEEDK.THISTLE) {
        box(frame, g, sx, 0.015, 0, 0.16, dep, 124, TONE.LEAF, 1);
        box(frame, g, sx, 0.06, 0.15, 0.21, dep, 42, TONE.FLOWER_PURPLE, 1);
      } else if (k === WEEDK.MULLEIN) {
        box(frame, g, sx, 0.03, 0, 0.2, dep, 124, TONE.WEED, 1);
        box(frame, g, sx, 0.03, 0.2, 0.34, dep, 124, TONE.FLOWER_YELLOW, 1);
        box(frame, g, sx, 0.12, 0, 0.04, dep, 118, TONE.WEED, 1);
      } else if (k === WEEDK.BURDOCK) {
        blob(frame, g, sx, dep, f, { cz: 0.07, rad: 0.18, ry: 0.07, shape: 'ell', tone: TONE.LEAF, ambient, salt: p.x });
      } else if (k === WEEDK.FERN) {
        for (let q = 0; q < 3; q++) box(frame, g, sx + ((q - 1) * 0.07 * g.focalX) / dep, 0.03, 0, 0.12, dep, q === 0 ? 92 : q === 1 ? 124 : 47, TONE.LEAF, 1);
      } else { // crabgrass in a pavement crack
        box(frame, g, sx, 0.05, 0, 0.05, dep, 34, TONE.WEED, 1);
      }
    }
  }
}

/** A leafy blob (tree crown, shrub): an ellipse cell by cell, cone-shaped for conifers, with hanging strands for willows. */
function blob(frame, g, sx, dep, f, o) {
  const { cols, rows, ch, tone, id, z } = frame;
  const { cz, rad, ry } = o;
  const wc = Math.max(1, Math.round((rad * 2 * g.focalX) / dep));
  const c0 = Math.round(sx - wc / 2);
  const top = g.hz - ((cz + ry - g.eyeZ) * g.focalY) / dep;
  const bot = g.hz - ((cz - ry - g.eyeZ) * g.focalY) / dep;
  const r0 = Math.max(0, Math.ceil(top - 0.5)), r1 = Math.min(rows, Math.max(r0 + 1, Math.ceil(bot - 0.5)));
  const hr = Math.max(0.5, (r1 - r0) / 2), hc = Math.max(0.5, wc / 2);
  const seed = g.seed;
  for (let x = c0; x < c0 + wc; x++) {
    if (x < 0 || x >= cols) continue;
    const ux = (x + 0.5 - (c0 + wc / 2)) / hc;
    for (let r = r0; r < r1; r++) {
      const uy = (r + 0.5 - (r0 + hr)) / hr;
      if (o.shape === 'cone' ? Math.abs(ux) > 0.12 + 0.9 * (uy + 1) / 2 : ux * ux + uy * uy > 1.05) continue;
      const i = r * cols + x;
      if (dep >= z[i]) continue;
      const tex = hash2(x * 7 + (r0 | 0), r, seed) / 4294967296;
      if (o.bloom && tex < o.bloomP) { // a blossom
        put(frame, i, 42, o.bloom, dep);
        continue;
      }
      const lit = 1 - 0.25 * (uy + 1) / 2; // top catches more light
      const b = ((0.28 + 0.5 * o.ambient) * (0.75 + 0.5 * tex) * lit) * f + g.haze * (1 - f);
      put(frame, i, rampCode(b), o.tone, dep);
    }
  }
  if (o.shape === 'drop' && f > 0.2) { // willow: strands hang below the crown
    const sr = Math.max(1, Math.round(ry * 1.1 * g.focalY / dep));
    for (let x = c0 + 1; x < c0 + wc - 1; x++) {
      if (x < 0 || x >= cols || hash2(x, r1, seed ^ 0x3b) / 4294967296 > 0.7) continue;
      for (let r = r1; r < Math.min(rows, r1 + sr); r++) {
        const i = r * cols + x;
        if (dep < z[i]) put(frame, i, 124, o.tone, dep);
      }
    }
  }
}

/** Birds: one to a few cells each, drawn after the props and tested against the depth buffer. */
const BIRD_UP_L = 92, BIRD_UP_R = 47, BIRD_FLAT = 45; // '\\' '/' '-'
function drawBirds(frame, world, cam, g) {
  const { cols, rows, ch, tone, id, z } = frame;
  const night = g.light.night, t = g.clock;
  for (const b of world.birds) {
    const spc = SPECIES[b.sp];
    if (spc.night ? night < 0.5 : night > 0.72) continue; // songbirds roost after dusk, bats and owls come out
    const pose = birdPose(b, t);
    const dx = g.wrapD(pose.x - cam.x), dy = g.wrapD(pose.y - cam.y);
    const dep = dx * g.dirX + dy * g.dirY;
    if (dep < 1 || dep > g.viewDist * 0.9) continue;
    const camX = (dx * g.planeX + dy * g.planeY) / dep;
    if (camX > g.tanHalf * 1.05 || camX < -g.tanHalf * 1.05) continue;
    const sx = (camX / g.tanHalf + 1) * cols * 0.5;
    const wc = Math.max(1, Math.min(b.mode <= 1 ? 4 : 9, Math.round((spc.size * g.focalX) / dep)));
    const row = Math.floor(g.hz - ((pose.z + spc.size * 0.2 - g.eyeZ) * g.focalY) / dep);
    if (row < 0 || row >= rows) continue;
    const back = BIRD_TONES[spc.back], breast = BIRD_TONES[spc.breast], dot = BIRD_TONES[spc.dot];
    const dd = dep - b.bias;
    const c0 = Math.round(sx - wc / 2);
    const right = pose.hx * g.planeX + pose.hy * g.planeY >= 0; // heading to the right of the screen
    for (let k = 0; k < wc; k++) {
      const x = c0 + k;
      if (x < 0 || x >= cols) continue;
      const i = row * cols + x;
      if (dd >= z[i]) continue;
      let glyph, tn;
      if (pose.flying) {
        if (wc === 1) { glyph = pose.flap ? 118 : BIRD_FLAT; tn = dot; }
        else {
          const L = wc === 2 ? 1 : Math.floor((wc - 1) / 2), body = wc === 2 ? -1 : L;
          const up = pose.flap || spc.dihedral;
          if (k === body) { glyph = wc >= 6 ? 79 : 111; tn = breast; }
          else { glyph = up ? (k < L ? BIRD_UP_L : BIRD_UP_R) : BIRD_FLAT; tn = back; }
        }
      } else if (wc === 1) { glyph = 111; tn = dot; }
      else { // perched or on the ground: tail, body, head, facing the way it is heading
        const head = right ? wc - 1 : 0, tail = right ? 0 : wc - 1;
        if (k === head) { glyph = 111; tn = back; }
        else if (k === tail && wc >= 3) { glyph = 126; tn = back; }
        else { glyph = 79; tn = breast; }
      }
      put(frame, i, glyph, tn, dd);
    }
  }
}

function fog(d, viewDist) {
  const t = 1 - d / viewDist;
  return t <= 0 ? 0 : Math.pow(t, 1.3);
}

/** Frame -> array of row strings. */
function frameRows(frame) {
  const { cols, rows, ch } = frame;
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    out[r] = String.fromCharCode.apply(null, ch.subarray(r * cols, (r + 1) * cols));
  }
  return out;
}

/** FNV-1a over a frame's char plane; used by the golden-frame test. */
function frameHash(frame) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < frame.ch.length; i++) { h ^= frame.ch[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

module.exports = { SKY_BEHIND, render, createFrame, frameRows, frameHash, lighting, TONE, RAMP, FLOOR_H };
