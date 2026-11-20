'use strict';
/**
 * Plant species: what grows in a central Pennsylvania spring (oaks, maples, white pine, hemlock, birch,
 * dogwood, redbud, cherry, Bradford pear, willow, tulip poplar), the shrubs round the houses (forsythia,
 * lilac, mountain laurel, azalea, boxwood), the flower beds (tulips, daffodils) and the weeds that come
 * with them (dandelion, clover, violets, thistle, mullein, burdock, fern, crabgrass in the pavement cracks).
 *
 * Tones are named here and mapped to ids by the renderer, so this file has no dependency on it.
 */

const TREE = { OAK: 0, MAPLE: 1, PINE: 2, BIRCH: 3, CHERRY: 4, DOGWOOD: 5, WILLOW: 6, POPLAR: 7, REDBUD: 8, PEAR: 9, HEMLOCK: 10 };
// dims in tiles: trunk height, canopy radius (sideways) and half-height; shape ell | cone | drop
const TREES = [];
function tree(id, name, d) { TREES[id] = Object.assign({ name }, d); }
tree(TREE.OAK,     'oak',            { trunkH: 0.26, rad: 0.30, ry: 0.28, shape: 'ell',  leaf: 'LEAF', trunk: 'TRUNK' });
tree(TREE.MAPLE,   'red maple',      { trunkH: 0.24, rad: 0.27, ry: 0.28, shape: 'ell',  leaf: 'LEAF_LIGHT', trunk: 'TRUNK', bloom: 'REDBUD', bloomP: 0.12 });
tree(TREE.PINE,    'white pine',     { trunkH: 0.10, rad: 0.22, ry: 0.50, shape: 'cone', leaf: 'PINE', trunk: 'TRUNK' });
tree(TREE.BIRCH,   'birch',          { trunkH: 0.28, rad: 0.20, ry: 0.30, shape: 'ell',  leaf: 'LEAF_LIGHT', trunk: 'BIRCH' });
tree(TREE.CHERRY,  'cherry',         { trunkH: 0.18, rad: 0.27, ry: 0.22, shape: 'ell',  leaf: 'LEAF', trunk: 'TRUNK', bloom: 'BLOSSOM_PINK', bloomP: 0.62 });
tree(TREE.DOGWOOD, 'dogwood',        { trunkH: 0.14, rad: 0.24, ry: 0.18, shape: 'ell',  leaf: 'LEAF', trunk: 'TRUNK', bloom: 'BLOSSOM_WHITE', bloomP: 0.6 });
tree(TREE.WILLOW,  'weeping willow', { trunkH: 0.22, rad: 0.36, ry: 0.30, shape: 'drop', leaf: 'LEAF_LIGHT', trunk: 'TRUNK' });
tree(TREE.POPLAR,  'tulip poplar',   { trunkH: 0.30, rad: 0.17, ry: 0.46, shape: 'ell',  leaf: 'LEAF_LIGHT', trunk: 'TRUNK' });
tree(TREE.REDBUD,  'redbud',         { trunkH: 0.14, rad: 0.24, ry: 0.19, shape: 'ell',  leaf: 'LEAF', trunk: 'TRUNK', bloom: 'REDBUD', bloomP: 0.7 });
tree(TREE.PEAR,    'Bradford pear',  { trunkH: 0.20, rad: 0.19, ry: 0.30, shape: 'ell',  leaf: 'LEAF', trunk: 'TRUNK', bloom: 'BLOSSOM_WHITE', bloomP: 0.65 });
tree(TREE.HEMLOCK, 'hemlock',        { trunkH: 0.08, rad: 0.26, ry: 0.40, shape: 'cone', leaf: 'PINE', trunk: 'TRUNK' });

/** Shrubs: a leafy blob of radius `rad`, height `h`, with blossoms speckled over it. */
const SHRUB = { BOXWOOD: 0, FORSYTHIA: 1, LILAC: 2, LAUREL: 3, AZALEA: 4 };
const SHRUBS = [
  { name: 'boxwood',          rad: 0.20, h: 0.16, leaf: 'PINE' },
  { name: 'forsythia',        rad: 0.24, h: 0.24, leaf: 'LEAF_LIGHT', bloom: 'FLOWER_YELLOW', bloomP: 0.7 },
  { name: 'lilac',            rad: 0.24, h: 0.30, leaf: 'LEAF', bloom: 'FLOWER_PURPLE', bloomP: 0.55 },
  { name: 'mountain laurel',  rad: 0.22, h: 0.22, leaf: 'PINE', bloom: 'BLOSSOM_PINK', bloomP: 0.4 },
  { name: 'azalea',           rad: 0.20, h: 0.18, leaf: 'LEAF', bloom: 'REDBUD', bloomP: 0.65 },
];

/** Flower beds and lawn flowers. head = flower tone, h = stem height range. */
const FLOWER = { TULIP: 0, DAFFODIL: 1, DANDELION: 2, VIOLET: 3, CLOVER: 4 };
const FLOWERS = [
  { name: 'tulip',     head: ['FLOWER_RED', 'FLOWER_YELLOW', 'FLOWER_PURPLE'], h: [0.10, 0.17], glyph: 79 },   // 'O'
  { name: 'daffodil',  head: ['FLOWER_YELLOW'],                                 h: [0.09, 0.15], glyph: 64 },   // '@'
  { name: 'dandelion', head: ['FLOWER_YELLOW', 'BLOSSOM_WHITE'],                h: [0.03, 0.07], glyph: 42 },   // '*'
  { name: 'violet',    head: ['FLOWER_PURPLE'],                                 h: [0.02, 0.05], glyph: 42 },
  { name: 'clover',    head: ['BLOSSOM_WHITE', 'BLOSSOM_PINK'],                 h: [0.02, 0.05], glyph: 111 },  // 'o'
];

/** Weeds. */
const WEED = { GRASS: 0, THISTLE: 1, MULLEIN: 2, BURDOCK: 3, FERN: 4, CRACK: 5 };
const WEEDS = [
  { name: 'tall grass' }, { name: 'thistle' }, { name: 'mullein' }, { name: 'burdock' }, { name: 'fern' }, { name: 'crabgrass' },
];

module.exports = { TREE, TREES, SHRUB, SHRUBS, FLOWER, FLOWERS, WEED, WEEDS };
