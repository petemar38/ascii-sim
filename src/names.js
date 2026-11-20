'use strict';
/**
 * Name pools for districts, streets and landmarks. Names are drawn without
 * replacement from a seeded shuffle, so a given seed always names the city the same way.
 */

const DISTRICT_NAMES = {
  downtown: ['Aurora Towers', 'Meridian Core', 'Zenith Square', 'Halcyon Heights', 'Vector Plaza', 'Lattice Center'],
  commercial: ['Signal Market', 'Relay Exchange', 'Beacon Row', 'Quartz Arcade', 'Cobalt Mile', 'Static Bazaar'],
  residential: ['Vantage Gardens', 'Ember Hollow', 'Orbit Court', 'Willow Static', 'Harbor Lights', 'Cinder Green'],
  industrial: ['Foundry Flats', 'Terminal Yards', 'Rivet Works', 'Anvil Basin', 'Kiln Quarter'],
  parkland: ['Phosphor Commons', 'Neon Meadow', 'Lumen Park', 'Fernwave Reach'],
  suburb: ['Maple Hollow', 'Cedar Glen', 'Juniper Ridge', 'Lantern Heights', 'Fable Grove', 'Copper Meadows', 'Willowbrook', 'Orchard Lane'],
};

const STREET_WORDS = [
  'Signal', 'Terminal', 'Meridian', 'Vector', 'Relay', 'Beacon', 'Quartz', 'Halcyon', 'Orbit', 'Cinder',
  'Vantage', 'Harbor', 'Foundry', 'Lattice', 'Phosphor', 'Static', 'Cobalt', 'Ember', 'Zenith', 'Echo',
  'Radial', 'Tangent', 'Prism', 'Vertex', 'Nimbus', 'Argon', 'Ion', 'Delta', 'Sigma', 'Kernel', 'Cipher',
  'Lumen', 'Ripple', 'Vesper', 'Ferrite', 'Mica',
];
const AVENUE_SUFFIX = ['Avenue', 'Boulevard', 'Parkway', 'Road'];
const STREET_SUFFIX = ['Street', 'Row', 'Lane', 'Way', 'Court', 'Place'];
const LANDMARK_NAMES = [
  'The Overlook', 'Relay Tower', 'Terminal Hall', 'Beacon Spire', 'Foundry Works', 'Lumen Exchange',
  'Cobalt Atrium', 'The Lattice', 'Vector House', 'Argon Arcade',
];

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** Create a namer bound to a seeded rng. */
function makeNamer(rng) {
  const streetPool = shuffle(STREET_WORDS.slice(), rng);
  const districtPools = {};
  for (const k of Object.keys(DISTRICT_NAMES)) districtPools[k] = shuffle(DISTRICT_NAMES[k].slice(), rng);
  const landmarkPool = shuffle(LANDMARK_NAMES.slice(), rng);
  let overflow = 0;

  return {
    street(avenue) {
      const word = streetPool.length ? streetPool.pop() : 'Nameless' + (++overflow);
      const suffixes = avenue ? AVENUE_SUFFIX : STREET_SUFFIX;
      return word + ' ' + suffixes[Math.floor(rng() * suffixes.length)];
    },
    district(typeName) {
      const pool = districtPools[typeName];
      return pool && pool.length ? pool.pop() : typeName[0].toUpperCase() + typeName.slice(1) + ' ' + (++overflow);
    },
    landmark() {
      return landmarkPool.length ? landmarkPool.pop() : 'Landmark ' + (++overflow);
    },
  };
}

module.exports = { makeNamer, DISTRICT_NAMES };
