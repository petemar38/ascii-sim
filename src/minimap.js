'use strict';
/**
 * Minimap and exploration memory.
 *
 * The world is a torus, so the map is too:
 *   local   a north-up window always centred on you, which wraps like the world does (walk over the seam and the map
 *           just keeps scrolling), with the seam drawn as a pink line so you can see it pass under you
 *   world   the whole map at once; your marker leaves one edge and comes back on the opposite one
 * Tiles you have walked near are lit, the rest stay dim, so you can tell new ground from a loop. The explorer also counts
 * how many times you have crossed the seam in each direction.
 *
 * A map is a grid of cells {bg, fg, ch} that both the web page (HTML) and the terminal (ANSI) can draw.
 */

const { K } = require('./world');
const { bearingDeg } = require('./hud');

const SEEN_RADIUS = 8;

function createExplorer(world) {
  const size = world.size;
  let walkable = 0;
  for (let i = 0; i < size * size; i++) if (world.kind[i] !== K.BUILDING) walkable++;
  return { size, seen: new Uint8Array(size * size), walkable, count: 0, lastX: undefined, lastY: undefined, wx: 0, wy: 0, start: { x: world.spawn.x, y: world.spawn.y } };
}

function mark(ex, cx, cy) {
  const size = ex.size, r = SEEN_RADIUS, r2 = r * r + 1;
  const ix = Math.floor(cx), iy = Math.floor(cy);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r2) continue;
    const t = (((iy + dy) % size) + size) % size * size + (((ix + dx) % size) + size) % size;
    if (!ex.seen[t]) { ex.seen[t] = 1; ex.count++; }
  }
}

/** Call once per frame after moving: lights the ground around you and counts seam crossings. */
function explore(ex, cam) {
  if (ex.lastX !== undefined) {
    const dx = cam.x - ex.lastX, dy = cam.y - ex.lastY, h = ex.size / 2;
    if (dx > h) ex.wx--; else if (dx < -h) ex.wx++; // x jumped from low to high: you walked west over the seam
    if (dy > h) ex.wy--; else if (dy < -h) ex.wy++;
  }
  ex.lastX = cam.x; ex.lastY = cam.y;
  mark(ex, cam.x, cam.y);
}

/** After a teleport: move the reference point without counting a crossing. */
function exploreJump(ex, cam) {
  ex.lastX = cam.x; ex.lastY = cam.y;
  mark(ex, cam.x, cam.y);
}

/** "1E 0" style label: how many times round the world you have gone, east/west and north/south. */
function loopLabel(ex) {
  const f = (n, pos, neg) => (n === 0 ? '0' : Math.abs(n) + (n > 0 ? pos : neg));
  return f(ex.wx, 'E', 'W') + ' ' + f(ex.wy, 'S', 'N');
}

function exploredPercent(ex) {
  return Math.min(100, Math.round((100 * ex.count) / ex.walkable));
}

/* ---------- colours ---------- */
const KIND_RGB = {};
KIND_RGB[K.ROAD] = [96, 98, 108];
KIND_RGB[K.SIDEWALK] = [158, 154, 146];
KIND_RGB[K.PARK] = [52, 150, 72];
KIND_RGB[K.YARD] = [118, 186, 92];
KIND_RGB[K.PLAZA] = [196, 172, 134];
const DISTRICT_TINT = null; // reserved
const PLAIN = {};
PLAIN[K.ROAD] = 46; PLAIN[K.SIDEWALK] = 44; PLAIN[K.PARK] = 34; PLAIN[K.YARD] = 39; PLAIN[K.PLAZA] = 58; PLAIN[K.BUILDING] = 35;

function buildingRgb(h) {
  const t = Math.min(1, h / 22);
  return [150 + 80 * t, 108 + 84 * t, 82 + 78 * t];
}

const ARROWS = ['^', '/', '>', '\\', 'v', '/', '<', '\\'];

function newMap(cols, rows) {
  return { cols, rows, bg: new Uint8Array(cols * rows * 3), fg: new Uint8Array(cols * rows * 3), ch: new Uint8Array(cols * rows).fill(32), plain: new Uint8Array(cols * rows).fill(32) };
}

function setBg(m, i, rgb, dim) {
  const g = dim ? 0.42 : 1;
  m.bg[i * 3] = rgb[0] * g; m.bg[i * 3 + 1] = rgb[1] * g; m.bg[i * 3 + 2] = rgb[2] * g;
}

function tint(m, i, rgb, a) {
  for (let c = 0; c < 3; c++) m.bg[i * 3 + c] = m.bg[i * 3 + c] * (1 - a) + rgb[c] * a;
}

function put(m, i, ch, rgb) {
  m.ch[i] = ch; m.plain[i] = ch;
  m.fg[i * 3] = rgb[0]; m.fg[i * 3 + 1] = rgb[1]; m.fg[i * 3 + 2] = rgb[2];
}

const PINK = [255, 90, 200], YELLOW = [255, 236, 90], RED = [255, 80, 70], WHITE = [255, 255, 255];

/**
 * Build a map. mode 'local' (default 49 x 25, one column per tile, two tiles per row) or 'world' (the whole torus).
 * opts.blink: true/false toggles the player marker so it stands out; opts.cols/rows override the size.
 */
function buildMap(world, ex, cam, mode, opts = {}) {
  const size = world.size;
  const px = ((cam.x % size) + size) % size, py = ((cam.y % size) + size) % size;
  const deg = bearingDeg(cam.angle);
  const arrow = ARROWS[Math.round(deg / 45) % 8].charCodeAt(0);
  const blink = opts.blink !== false;

  if (mode === 'world') {
    const cols = opts.cols || 96, rows = opts.rows || 36;
    const bx = size / cols, by = size / rows;
    const m = newMap(cols, rows);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * bx), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * bx)), y0 = Math.floor(cy * by), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * by));
      let n = 0, bld = 0, road = 0, hSum = 0, seen = 0; const cnt = {};
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const t = (y % size) * size + (x % size), k = world.kind[t];
        n++; seen += ex.seen[t];
        if (k === K.BUILDING) { bld++; hSum += world.height[t]; } else if (k === K.ROAD) road++; else cnt[k] = (cnt[k] || 0) + 1;
      }
      const i = cy * cols + cx;
      let rgb, pk;
      if (bld > n * 0.4) { rgb = buildingRgb(hSum / bld); pk = K.BUILDING; }
      else if (road > n * 0.25) { rgb = KIND_RGB[K.ROAD]; pk = K.ROAD; }
      else {
        let best = K.SIDEWALK, bc = -1;
        for (const k in cnt) if (cnt[k] > bc) { bc = cnt[k]; best = +k; }
        rgb = KIND_RGB[best] || KIND_RGB[K.SIDEWALK]; pk = best;
      }
      setBg(m, i, rgb, seen < n * 0.04);
      if (seen >= n * 0.04) m.plain[i] = PLAIN[pk] || 32;
      if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) tint(m, i, PINK, 0.35); // the edges are the seam
    }
    const si = Math.min(rows - 1, Math.floor(ex.start.y / by)) * cols + Math.min(cols - 1, Math.floor(ex.start.x / bx));
    put(m, si, 83, RED); // S: where you started
    const pi = Math.min(rows - 1, Math.floor(py / by)) * cols + Math.min(cols - 1, Math.floor(px / bx));
    if (blink) put(m, pi, arrow, YELLOW); else put(m, pi, 64, YELLOW);
    return m;
  }

  /* local: centred on you, so crossing the seam changes nothing but where the pink line is */
  const cols = opts.cols || 49, rows = opts.rows || 25, tw = 1, th = 2;
  const m = newMap(cols, rows);
  const ox = Math.floor(px), oy = Math.floor(py);
  const mid = (cols - 1) / 2, midr = (rows - 1) / 2;
  const heading = cam.angle;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const wx = ox + Math.round((cx - mid) * tw), wy0 = oy + Math.round((cy - midr) * th);
    const i = cy * cols + cx;
    let best = -1, bestK = 0, seen = 0, seam = 0, h = 0;
    for (let q = 0; q < th; q++) {
      const ty = (((wy0 + q) % size) + size) % size, tx = ((wx % size) + size) % size, t = ty * size + tx;
      const k = world.kind[t], pri = k === K.BUILDING ? 5 : k === K.ROAD ? 4 : k === K.SIDEWALK ? 1 : 3;
      if (pri > best) { best = pri; bestK = k; h = world.height[t]; }
      seen += ex.seen[t];
      if (tx === 0) seam |= 1;
      if (ty === 0) seam |= 2;
    }
    setBg(m, i, bestK === K.BUILDING ? buildingRgb(h) : KIND_RGB[bestK] || KIND_RGB[K.SIDEWALK], seen === 0);
    if (seen > 0) m.plain[i] = PLAIN[bestK] || 32;
    /* what you are facing: a faint cone of light in front of you */
    const dx = (cx - mid) * tw, dy = (cy - midr) * th, d = Math.hypot(dx, dy);
    if (d > 0.8 && d < 9) {
      let da = Math.atan2(dy, dx) - heading;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < 0.55) tint(m, i, WHITE, 0.16);
    }
    if (seam) {
      tint(m, i, PINK, 0.7);
      put(m, i, seam === 3 ? 43 : seam === 1 ? 124 : 45, PINK);
    }
  }
  // N marker on the top edge, S marker if the start is on screen, then you
  put(m, 0 * cols + Math.floor(mid), 78, WHITE);
  const sdx = ((((ex.start.x - px) % size) + size + size / 2) % size) - size / 2, sdy = ((((ex.start.y - py) % size) + size + size / 2) % size) - size / 2;
  const scx = Math.round(mid + sdx / tw), scy = Math.round(midr + sdy / th);
  if (scx >= 0 && scx < cols && scy >= 0 && scy < rows) put(m, scy * cols + scx, 83, RED);
  const pi = Math.round(midr) * cols + Math.round(mid);
  put(m, pi, blink ? arrow : 64, YELLOW);
  return m;
}

const ESC = { 38: '&amp;', 60: '&lt;', 62: '&gt;' };
const hex = (a, o) => '#' + [a[o], a[o + 1], a[o + 2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** HTML for a <pre>: one span per cell run of the same colours. */
function mapHtml(m) {
  let out = '';
  for (let y = 0; y < m.rows; y++) {
    let key = '';
    let open = false;
    for (let x = 0; x < m.cols; x++) {
      const i = y * m.cols + x, c = m.ch[i];
      const k = hex(m.bg, i * 3) + (c !== 32 ? hex(m.fg, i * 3) : '');
      if (k !== key) {
        if (open) out += '</span>';
        out += '<span style="background:' + hex(m.bg, i * 3) + (c !== 32 ? ';color:' + hex(m.fg, i * 3) : '') + '">';
        key = k; open = true;
      }
      out += ESC[c] || String.fromCharCode(c);
    }
    if (open) out += '</span>';
    if (y < m.rows - 1) out += '\n';
  }
  return out;
}

/** One ANSI string per map row (truecolor or 256-colour), each ending with a reset. */
function mapAnsi(m, truecolor) {
  const cube = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const code = (a, o, fg) => truecolor ? `\x1b[${fg ? 38 : 48};2;${Math.round(a[o])};${Math.round(a[o + 1])};${Math.round(a[o + 2])}m`
    : `\x1b[${fg ? 38 : 48};5;${16 + 36 * cube(a[o]) + 6 * cube(a[o + 1]) + cube(a[o + 2])}m`;
  const rows = [];
  for (let y = 0; y < m.rows; y++) {
    let line = '';
    for (let x = 0; x < m.cols; x++) {
      const i = y * m.cols + x, c = m.ch[i];
      line += code(m.bg, i * 3, false) + (c !== 32 ? code(m.fg, i * 3, true) : '') + String.fromCharCode(c);
    }
    rows.push(line + '\x1b[0m');
  }
  return rows;
}

/** Plain-text rows, for the green-phosphor terminal mode. */
function mapPlain(m) {
  const rows = [];
  for (let y = 0; y < m.rows; y++) rows.push(String.fromCharCode.apply(null, m.plain.subarray(y * m.cols, (y + 1) * m.cols)));
  return rows;
}

/** Two HUD lines about where you have been. */
function mapHudLines(ex) {
  const pad = (l) => (l + '.'.repeat(11)).slice(0, 11);
  return [pad('LOOPS') + ' ' + loopLabel(ex), pad('EXPLORED') + ' ' + exploredPercent(ex) + '%'];
}

module.exports = { mapHudLines, createExplorer, explore, exploreJump, loopLabel, exploredPercent, buildMap, mapHtml, mapAnsi, mapPlain, SEEN_RADIUS };
