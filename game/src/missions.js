// The three sorties. Each has its own goal, wind, fuel and clock, and the
// score rewards deliveries, rings, smooth flying and what is left in the
// tank and on the clock when the last objective is done.

import { STRIPS, stripById, stripAt, ringCourse, heightAt } from './terrain.js';
import { placeOnStrip, placeInAir } from './flight.js';

export const MISSIONS = [
  {
    id: 'mail',
    name: 'Morning Mail',
    brief: 'The valley post is waiting. Fly the Kestrel from Pine Hollow to Birchfield, drop the mail, then on to Stonebridge. Two landings, one tank, a light valley breeze.',
    wind: { x: 2, z: 1 },
    fuel: 100,
    timeLimit: 600,
    dusk: false,
    startStrip: 'home',
    objectives: [
      { type: 'land', strip: 'birch', text: 'Land at Birchfield and drop the mail' },
      { type: 'land', strip: 'stone', text: 'Land at Stonebridge — last delivery' },
    ],
  },
  {
    id: 'rings',
    name: 'Ridge Rings',
    brief: 'Eight golden rings hang over the valley passes. Thread them all, in order, then bring the Kestrel home to Pine Hollow. Mind the ridges — the rings sit low.',
    wind: { x: -3, z: 2 },
    fuel: 100,
    timeLimit: 480,
    dusk: false,
    startStrip: 'home',
    objectives: [
      { type: 'ring', index: 0, text: 'Fly through ring 1 of 8' },
      { type: 'ring', index: 1, text: 'Fly through ring 2 of 8' },
      { type: 'ring', index: 2, text: 'Fly through ring 3 of 8' },
      { type: 'ring', index: 3, text: 'Fly through ring 4 of 8' },
      { type: 'ring', index: 4, text: 'Fly through ring 5 of 8' },
      { type: 'ring', index: 5, text: 'Fly through ring 6 of 8' },
      { type: 'ring', index: 6, text: 'Fly through ring 7 of 8' },
      { type: 'ring', index: 7, text: 'Fly through ring 8 of 8' },
      { type: 'land', strip: 'home', text: 'Land back at Pine Hollow' },
    ],
  },
  {
    id: 'storm',
    name: 'Storm Medicine',
    brief: 'A climber is hurt at Eagle\u2019s Rest, the high strip. Dusk is falling, a 25-knot crosswind is raking the ridge, and the tank is short. One landing, no second chances.',
    wind: { x: 11, z: -4 },
    fuel: 70,
    timeLimit: 360,
    dusk: true,
    startStrip: 'home',
    objectives: [
      { type: 'land', strip: 'eagle', text: 'Land the medicine at Eagle\u2019s Rest' },
    ],
  },
];

// Rings with their course normals (each ring faces along the course).
export function buildRings() {
  const pts = ringCourse();
  return pts.map((pt, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    let dx = next.x - prev.x, dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    return { ...pt, normal: { x: dx, y: 0, z: dz }, passed: false };
  });
}

export function createMissionRun(def) {
  return {
    def,
    index: 0,
    score: 0,
    timeLeft: def.timeLimit,
    rings: def.id === 'rings' ? buildRings() : [],
    status: 'flying', // flying | won | lost
    endReason: '',
    banner: '',
    bannerT: 0,
    legDamage: 0, // damage when the current leg started (smooth-landing bonus)
  };
}

export function startMission(plane, def) {
  const run = createMissionRun(def);
  const strip = stripById(def.startStrip);
  placeOnStrip(plane, strip, { fuel: def.fuel, windX: def.wind.x, windZ: def.wind.z });
  run.legDamage = 0;
  return run;
}

export function objectiveText(run) {
  if (run.status === 'won') return 'Sortie complete — well flown.';
  if (run.status === 'lost') return run.endReason;
  const obj = run.def.objectives[run.index];
  return obj ? obj.text : '—';
}

// Advance the mission one step. Returns 'chime' when an objective completes,
// 'thud' when the plane crashes, null otherwise.
export function updateMission(run, plane, dt) {
  if (run.status !== 'flying') return null;
  run.timeLeft -= dt;
  if (run.bannerT > 0) run.bannerT -= dt;
  if (run.timeLeft <= 0) {
    run.status = 'lost';
    run.endReason = 'Out of time — the sortie window closed.';
    return null;
  }
  if (plane.crashed) {
    run.status = 'lost';
    run.endReason = plane.crashReason || 'The Kestrel went down.';
    return 'thud';
  }
  const obj = run.def.objectives[run.index];
  if (!obj) return null;

  if (obj.type === 'land') {
    const s = stripAt(plane.x, plane.z);
    if (plane.onGround && s && s.id === obj.strip && plane.speed < 8) {
      const smooth = plane.damage <= run.legDamage + 0.5;
      run.score += smooth ? 1500 : 1000;
      run.banner = smooth
        ? `Delivered at ${s.name} — smooth landing, +1500`
        : `Delivered at ${s.name} — +1000`;
      run.bannerT = 3;
      run.legDamage = plane.damage;
      run.index++;
      if (run.index >= run.def.objectives.length) {
        finishRun(run, plane);
        return 'chime';
      }
      return 'chime';
    }
  } else if (obj.type === 'ring') {
    const ring = run.rings[obj.index];
    if (ring && !ring.passed) {
      const d = Math.hypot(plane.x - ring.x, plane.y - ring.y, plane.z - ring.z);
      if (d < ring.r + 5) {
        ring.passed = true;
        run.score += 250;
        run.banner = `Ring ${obj.index + 1} of 8 — +250`;
        run.bannerT = 2.5;
        run.index++;
        if (run.index >= run.def.objectives.length) {
          finishRun(run, plane);
          return 'chime';
        }
        return 'chime';
      }
    }
  }
  return null;
}

function finishRun(run, plane) {
  run.status = 'won';
  const timeBonus = Math.round(run.timeLeft) * 5;
  const fuelBonus = Math.round(plane.fuel) * 5;
  run.score += timeBonus + fuelBonus;
  run.endReason = `Sortie complete! Time bonus +${timeBonus}, fuel bonus +${fuelBonus}.`;
  run.banner = 'Sortie complete!';
  run.bannerT = 4;
}

export function stripName(id) {
  const s = STRIPS.find((x) => x.id === id);
  return s ? s.name : id;
}
