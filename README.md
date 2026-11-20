# ascii-sim

A game and simulation engine for rendering 3D environments in ASCII.
Zero dependencies, CPU-only. Node 18+ (developed on 22). Runs in a terminal or as one self-contained HTML file.

The first world is a procedural city you can walk through: a CPU raycaster draws it as ASCII.

> Dedicated to my late father, who wrote an ASCII 2.5D maze in Pascal in the early 1980s, in under 1 KB of RAM.

    npm test            # 14 tests incl. golden frame hashes
    npm run bench       # fps at several resolutions (~1500 fps at 120x44)
    npm run play        # terminal: WASD move, arrows turn/look, Shift run, , . time, Q quit
    npm run play -- --frames 1 --time 12   # headless single frame
    npm run build:web   # writes dist/index.html (open it directly, no server)

## Layout

    src/rng.js      seeded PRNG + hashes (mulberry32, hash2, strSeed)
    src/names.js    seeded district / street / landmark names
    src/world.js    generateWorld(): grid of tiles (kind, height, district, bid, road marks)
    src/camera.js   camera + collision (per-axis sliding)
    src/render.js   raycaster -> frame {ch, tone, depth}; lighting(time)
    src/hud.js      district / street / bearing / position / clock lines
    bin/play.js     terminal player
    web/template.html + tools/bundle.js   browser front end

## Stores and public buildings

`world.stores` lists shops and public buildings (grocery, library, pharmacy, diner, bank, hotel, school,
firehall, church, hardware) with a name, sign text, position and which way the storefront faces.
The whole street-facing wall of each one is drawn as a storefront (`world.facades`), and `src/facade.js`
decides what each kind looks like: striped awnings and sliding doors on groceries, a checker cornice and
chrome band on diners, stone columns and steps on banks, bay doors on firehalls, a rose window on churches,
a clock on schools, a deep canopy on hotels, shutter doors and crates at hardware stores, crosses on
pharmacies, a portico on libraries. Display windows light up at night, and the middle tile carries the door and
a sign you can read from a few tiles away. Most kinds also have a distinctive rooftop piece (hose tower, flagpole,
dome, cross, sign) so you can tell them apart from far away. A test fails if two kinds ever look alike.
Stores are assigned with `hash2` only, so adding or tuning them never changes the road layout.

## Suburbs

Away from downtown the city thins out into suburban districts (`D.SUBURB`). Blocks there hold detached houses in six
styles (`HOUSE`: ranch, colonial, bungalow, tudor, modern, victorian). Each has its own front (garage door, shutters,
porch, half-timbering, glass wall, arches) and its own roof piece, with a lawn (`K.YARD`), a driveway and a front path
from the sidewalk. Some blocks are playground parks (swings, slide, jungle gym, seesaw: `PROP.PLAY`, solid for collision),
and some are schools with a field and play area behind them; those are real `SCHOOL` stores, so they show up in the L list.
`world.houses` maps each house's front-wall tiles to `{style, face, door, garage, floors}`.

## Finding buildings

`nearestStores(world, cam, 9)` lists the nearest named buildings (distance in metres and compass direction),
`travelMenuLines(entries)` formats them, and `arriveAt(world, cam, store)` puts the camera on the street in
front of one, looking at its sign. In the web page and terminal player, press **L**, then **1-9**.

## The world wraps

The map is a torus: walk off one edge and you arrive on the opposite one, and you can see straight
through the seam. The generator lays roads, blocks and districts out periodically (the seam runs through
quiet residential and parkland outskirts, far from downtown), and every lookup (`heightAt`, `kindAt`,
`isWalkable`, `locate`, collision, sprites, wires, lamp glow) wraps. Default size is 288 tiles; sizes are
rounded to a multiple of 24 so everything stays periodic. View distance is 56 tiles, well under the map
width, so you never see the same buildings twice.

    generateWorld({ seed: 'aurora' })                          // 288 tiles, wraps (default)
    generateWorld({ seed: 'aurora', size: 192, wrap: false })  // walled map, same city

Use `wrapDelta(world, d)` for the shortest signed difference between two coordinates and
`wrapCoord(world, v)` to normalise one. Anything that measures a distance should use them.

## Conventions

x east, y south. Angle 0 faces east, clockwise. One tile is about 8 m; one floor is 0.4 tile.
All arrays are typed and indexed `y * size + x`. Everything is deterministic from `seed`.

## Pipeline

1. `generateWorld({seed, size})` builds roads (jittered grid, every third line an avenue),
   blocks (recursive lot splitting), districts (downtown, commercial, residential, industrial, parkland), heights.
2. `render(frame, world, cam, {fov, viewDist, cellAspect, time})`: DDA per column, front to back.
   A tile makes a face only if taller than everything already passed; each face is clipped
   to rows not yet covered. Ground is cast per row. Sky has hashed stars. Fog fades to haze.
   Distant facades drop window detail (level of detail) so they stay readable.
3. `frame.tone` holds a semantic tone per cell (TONE.WALL, WINDOW_LIT, ...). Monochrome
   today, but color is just a lookup from tone (and brightness) to a style.

## Street furniture

`world.props` (lamps, trees, signals, hydrants, utility poles, rooftop tanks, antennas), `world.wires`
(sagging lines between poles), `world.deco` (crosswalks, manholes) and `world.glow` (lamp light on the
ground) are all generated deterministically from the seed with `hash2`, so adding a new kind never
changes the existing city. Fire escapes are drawn procedurally on some facades in `render.js`.

## Extension points

- **Minimap**: draw from `world.kind/height` plus `cam.x, cam.y, cam.angle`; add a HUD overlay.
- **Color**: map `frame.tone` to ANSI or CSS classes in `bin/play.js` / `web/template.html`.
- **Interiors**: add door tiles in `world.js`, a second world per building (`bid`), switch on entry.
- **NPCs**: billboard sprites; `frame.depth` is the per-cell z-buffer you need for occlusion.
- **Performance**: the hot loops are in `render.js`; use `bench/bench.js` before and after.
  Ideas: precomputed per-column ray directions, skip unchanged frames, coarser rays for distant columns.

## Golden test

`test/golden.json` stores hashes of worlds and frames. If you change rendering on purpose,
run `npm run test:update-golden` and review the diff.
