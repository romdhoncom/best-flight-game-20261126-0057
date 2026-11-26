// Posed screenshot states: ?shot=cover|approach|rings|title&seed=1 puts the
// game in a fixed, deterministic pose so the maker's screenshots are real
// renders of the running game, taken the same way every time.

import { placeInAir } from './flight.js';
import { stripById, heightAt, ringCourse } from './terrain.js';
import { MISSIONS, startMission } from './missions.js';

export const SHOT_NAMES = ['cover', 'approach', 'rings', 'title'];

// Returns true when the shot freezes physics (a still frame for capture).
export function applyShot(state, name) {
  const plane = state.plane;
  if (name === 'title') {
    state.screen = 'title';
    state.frozen = true;
    return true;
  }
  if (name === 'cover') {
    // Ridge Rings, cruising over the valley with ring 1 ahead.
    const run = startMission(plane, MISSIONS[1]);
    const rings = run.rings;
    const r0 = rings[0];
    const dir = r0.normal;
    placeInAir(plane, r0.x - dir.x * 170, r0.y + 6, r0.z - dir.z * 170,
      (Math.atan2(dir.x, -dir.z) * 180) / Math.PI, 56,
      { throttle: 0.72, gear: false, flaps: false, windX: -3, windZ: 2 });
    state.mission = run;
    state.rings = rings;
    state.camera = 'chase';
    state.dusk = false;
    state.screen = 'flying';
    state.frozen = true;
    return true;
  }
  if (name === 'approach') {
    // Morning Mail, short final to Pine Hollow: gear down, flaps down.
    const run = startMission(plane, MISSIONS[0]);
    const home = stripById('home');
    const rad = (home.heading * Math.PI) / 180;
    placeInAir(plane,
      home.x - Math.sin(rad) * 480, home.alt + 80, home.z + Math.cos(rad) * 480,
      home.heading, 31,
      { throttle: 0.42, gear: true, flaps: true, pitch: -3, windX: 2, windZ: 1 });
    state.mission = run;
    state.rings = [];
    state.camera = 'chase';
    state.dusk = false;
    state.screen = 'flying';
    state.frozen = true;
    return true;
  }
  if (name === 'rings') {
    // Ridge Rings, banking toward ring 2 just past ring 1.
    const run = startMission(plane, MISSIONS[1]);
    const rings = run.rings;
    rings[0].passed = true;
    run.index = 1;
    const r1 = rings[1];
    const dir = r1.normal;
    placeInAir(plane, r1.x - dir.x * 190, r1.y + 10, r1.z - dir.z * 190,
      (Math.atan2(dir.x, -dir.z) * 180) / Math.PI, 58,
      { throttle: 0.75, gear: false, flaps: false, roll: 26, windX: -3, windZ: 2 });
    state.mission = run;
    state.rings = rings;
    state.camera = 'chase';
    state.dusk = false;
    state.screen = 'flying';
    state.frozen = true;
    return true;
  }
  return false;
}

export { ringCourse, heightAt };
