// The alpine valley: a seeded heightfield with a river valley, four airstrips,
// three villages, pine forests, and the mission rings.
// Everything the game asks about the world goes through here: heightAt(x, z),
// the strip list, the ring list, and the tree/cloud scatter.

import { makeFbm, makeRng, hash2 } from './random.js';

export const WORLD = {
  size: 4096,          // metres, x and z run -2048..2048
  waterLevel: 4,       // the river surface
  cell: 64,            // terrain grid cell, metres
  seed: 20261126,
};

// Airstrips: flat pads the terrain function honours, each with a heading
// (degrees, the direction you land toward) and a home flag.
export const STRIPS = [
  { id: 'home',  name: 'Pine Hollow',   x: 0,     z: 900,  heading: 0,   alt: 26, home: true },
  { id: 'birch', name: 'Birchfield',    x: -620,  z: -300, heading: 35,  alt: 34 },
  { id: 'stone', name: 'Stonebridge',   x: 540,   z: -1150, heading: 160, alt: 48 },
  { id: 'eagle', name: "Eagle's Rest",  x: 980,   z: 420,  heading: 250, alt: 118, high: true },
];

// Village houses cluster around the low strips.
export const VILLAGES = [
  { strip: 'home',  count: 12, spread: 190 },
  { strip: 'birch', count: 9,  spread: 150 },
  { strip: 'stone', count: 8,  spread: 140 },
];

const fbm = makeFbm(WORLD.seed, 4);
const ridge = makeFbm(WORLD.seed + 77, 3);

// Raw mountain height before the valley carve and the strip pads.
function baseHeight(x, z) {
  const nx = x / 900, nz = z / 900;
  let h = fbm(nx + 3.7, nz + 9.1) * 190;
  // Ridge walls east and west: the valley runs north-south.
  const wall = Math.max(0, (Math.abs(x) - 950) / 1100);
  h += wall * wall * 320 + ridge(nx * 2 + 1.3, nz * 2 + 4.4) * wall * 140;
  // A high shoulder around Eagle's Rest.
  const de = Math.hypot(x - 980, z - 420);
  h += Math.max(0, 1 - de / 700) * 90;
  return h;
}

// The river snakes down the valley floor, close to x = 0.
export function riverX(z) {
  return Math.sin(z / 420) * 130 + Math.sin(z / 173 + 2.0) * 55;
}

export function heightAt(x, z) {
  // Outside the world, keep rising so the plane never flies off the edge.
  const cx = Math.max(-2048, Math.min(2048, x));
  const cz = Math.max(-2048, Math.min(2048, z));
  let h = baseHeight(cx, cz);
  // Carve the valley floor along the river.
  const dRiver = Math.abs(cx - riverX(cz));
  const valley = Math.max(0, 1 - dRiver / 620);
  h = h * (1 - valley * 0.92) + 8 * valley;
  // Flatten a pad around every strip so runways sit on level ground.
  for (const s of STRIPS) {
    const d = Math.hypot(cx - s.x, cz - s.z);
    if (d < 260) {
      const t = Math.max(0, 1 - d / 260);
      const blend = t * t * (3 - 2 * t);
      h = h * (1 - blend) + s.alt * blend;
    }
  }
  // Flat apron around the river so the water reads as a flat blue ribbon.
  if (dRiver < 46) h = Math.min(h, 4.2);
  return h;
}

export function isWater(x, z) {
  return Math.abs(x - riverX(z)) < 34 && heightAt(x, z) <= WORLD.waterLevel + 1.5;
}

export function stripById(id) {
  return STRIPS.find((s) => s.id === id);
}

// Is the point over a runway (within the strip rectangle)?
export function stripAt(x, z) {
  for (const s of STRIPS) {
    const rad = (s.heading * Math.PI) / 180;
    const dx = x - s.x, dz = z - s.z;
    const along = dx * Math.sin(rad) + dz * Math.cos(rad);
    const across = dx * Math.cos(rad) - dz * Math.sin(rad);
    if (Math.abs(along) <= 210 && Math.abs(across) <= 16) return s;
  }
  return null;
}

// Ring course for the Ridge Rings mission: 8 rings over the valley.
export function ringCourse() {
  const pts = [
    [-260, 700], [180, 380], [-420, 60], [300, -260],
    [-180, -620], [420, -900], [-380, -1250], [120, -1500],
  ];
  return pts.map(([x, z], i) => ({
    x, z,
    y: heightAt(x, z) + 55 + (i % 3) * 14,
    r: 13,
  }));
}

// Pine forests: deterministic scatter, denser on the valley slopes.
export function treePositions() {
  const rng = makeRng(WORLD.seed + 5);
  const trees = [];
  for (let i = 0; i < 900; i++) {
    const x = (rng() * 2 - 1) * 1950;
    const z = (rng() * 2 - 1) * 1950;
    const h = heightAt(x, z);
    if (h < 12 || h > 170) continue; // not in the river, not on the snowy tops
    if (stripAt(x, z)) continue;
    if (Math.abs(x - riverX(z)) < 50) continue;
    trees.push({ x, z, y: h, s: 0.7 + rng() * 0.9 });
  }
  return trees;
}

// Village houses: small boxes with a roof, clustered near their strip.
export function housePositions() {
  const rng = makeRng(WORLD.seed + 9);
  const houses = [];
  for (const v of VILLAGES) {
    const s = stripById(v.strip);
    for (let i = 0; i < v.count; i++) {
      const a = rng() * Math.PI * 2;
      const d = 90 + rng() * v.spread;
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d * 0.8;
      if (stripAt(x, z)) continue;
      houses.push({ x, z, y: heightAt(x, z), w: 9 + rng() * 5, d: 8 + rng() * 4, h: 5 + rng() * 3, rot: rng() * Math.PI });
    }
  }
  return houses;
}

// Drifting clouds: billboards the renderer draws as soft ellipses.
export function cloudPositions() {
  const rng = makeRng(WORLD.seed + 13);
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    clouds.push({
      x: (rng() * 2 - 1) * 1900,
      z: (rng() * 2 - 1) * 1900,
      y: 330 + rng() * 160,
      r: 90 + rng() * 130,
    });
  }
  return clouds;
}

export { hash2 };
