// Seeded random numbers and smooth value noise for the alpine valley.
// Every world feature (mountains, river, villages, trees) comes from these,
// so one seed rebuilds the exact same valley every time.

// mulberry32: small, fast, deterministic PRNG.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise: a lattice of random heights, smoothly interpolated.
export function makeNoise2D(seed) {
  const rng = makeRng(seed);
  const size = 256;
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % size) + size) % size;
    const x1 = (x0 + 1) % size;
    const y0 = ((yi % size) + size) % size;
    const y1 = (y0 + 1) % size;
    const v00 = lattice[y0 * size + x0];
    const v10 = lattice[y0 * size + x1];
    const v01 = lattice[y1 * size + x0];
    const v11 = lattice[y1 * size + x1];
    const u = smooth(xf), v = smooth(yf);
    const a = v00 + (v10 - v00) * u;
    const b = v01 + (v11 - v01) * u;
    return a + (b - a) * v; // 0..1
  };
}

// Fractal noise: several octaves of value noise, normalised to 0..1.
export function makeFbm(seed, octaves = 4) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise2D(seed + o * 101));
  return function fbm(x, y) {
    let sum = 0, amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const f = Math.pow(2, o);
      sum += layers[o](x * f, y * f) * amp;
      total += amp;
      amp *= 0.5;
    }
    return sum / total;
  };
}

// Deterministic 0..1 hash of integer grid coordinates, for per-cell colour variation.
export function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
