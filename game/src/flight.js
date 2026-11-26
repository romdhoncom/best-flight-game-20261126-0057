// The flight model for the Alpine Kestrel, a single-prop STOL bush plane.
// Arcade-realistic: lift needs speed, the wing stalls, flaps lower the stall
// speed, gear and flaps matter on landing, fuel burns, wind pushes the ground
// track, and hard arrivals hurt. All speeds in m/s, angles in degrees,
// positions in metres. One fixed step per frame (dt = 1/60).

import { heightAt, isWater, stripAt } from './terrain.js';

export const PLANE = {
  stallClean: 24,     // m/s, flaps up
  stallFlaps: 18,     // m/s, flaps down
  rotateSpeed: 26,    // m/s, lifts off the runway
  maxSpeed: 78,       // m/s at full throttle, level
  maxPitch: 12,       // degrees up/down the pilot can command
  maxRoll: 55,        // degrees of bank
  fuelBurn: 0.115,    // % of tank per second at cruise throttle
  tankLitres: 120,
};

export function createPlane() {
  return {
    x: 0, y: 0, z: 0,          // position (y = altitude above sea level)
    heading: 0,                // degrees, 0 = north (-z)
    pitch: 0,                  // degrees, + = nose up
    roll: 0,                   // degrees, + = right wing down
    speed: 0,                  // airspeed m/s
    vs: 0,                     // vertical speed m/s
    throttle: 0,               // 0..1
    flaps: false,
    gear: true,
    fuel: 100,                 // % of tank
    damage: 0,                 // % ; 100 = wrecked
    onGround: true,
    crashed: false,
    crashReason: '',
    windX: 0, windZ: 0,        // wind vector, m/s
    groundSpeed: 0,
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const deg2rad = (d) => (d * Math.PI) / 180;

// Place the plane on a strip, ready for takeoff (or for a posed screenshot).
export function placeOnStrip(p, strip, opts = {}) {
  const rad = deg2rad(strip.heading);
  // Start 150 m behind the strip centre, so the runway lies ahead.
  p.x = strip.x - Math.sin(rad) * 150;
  p.z = strip.z + Math.cos(rad) * 150;
  p.y = strip.alt + 1.2;
  p.heading = strip.heading;
  p.pitch = 0; p.roll = 0;
  p.speed = opts.speed ?? 0;
  p.vs = 0;
  p.throttle = opts.throttle ?? 0;
  p.flaps = opts.flaps ?? false;
  p.gear = opts.gear ?? true;
  p.fuel = opts.fuel ?? 100;
  p.damage = opts.damage ?? 0;
  p.onGround = true;
  p.crashed = false; p.crashReason = '';
  p.windX = opts.windX ?? 0; p.windZ = opts.windZ ?? 0;
}

// Place the plane in the air (mission starts, posed shots).
export function placeInAir(p, x, y, z, heading, speed, opts = {}) {
  p.x = x; p.y = y; p.z = z;
  p.heading = heading;
  p.pitch = opts.pitch ?? 0;
  p.roll = opts.roll ?? 0;
  p.speed = speed;
  p.vs = 0;
  p.throttle = opts.throttle ?? 0.65;
  p.flaps = opts.flaps ?? false;
  p.gear = opts.gear ?? true;
  p.fuel = opts.fuel ?? 100;
  p.damage = opts.damage ?? 0;
  p.onGround = false;
  p.crashed = false; p.crashReason = '';
  p.windX = opts.windX ?? 0; p.windZ = opts.windZ ?? 0;
}

// One physics step. `ctl` is { pitch: -1..1, roll: -1..1, throttle: -1..1 }
// plus edge flags the caller sets (flapsToggle, gearToggle).
export function stepFlight(p, ctl, dt) {
  if (p.crashed) return;

  if (ctl.flapsToggle) p.flaps = !p.flaps;
  if (ctl.gearToggle) p.gear = !p.gear;

  // Throttle: W/S nudge it, it stays where you leave it.
  p.throttle = clamp(p.throttle + ctl.throttle * 0.55 * dt, 0, 1);

  const stall = p.flaps ? PLANE.stallFlaps : PLANE.stallClean;
  const flying = !p.onGround;

  // Target attitude from the stick, eased toward it.
  const targetPitch = clamp(ctl.pitch * PLANE.maxPitch, -PLANE.maxPitch, PLANE.maxPitch);
  const targetRoll = clamp(ctl.roll * PLANE.maxRoll, -PLANE.maxRoll, PLANE.maxRoll);
  const ease = flying ? 2.2 : 4.0;
  p.pitch = lerp(p.pitch, targetPitch, Math.min(1, ease * dt));
  p.roll = lerp(p.roll, targetRoll, Math.min(1, ease * dt));

  // Speed: thrust minus drag; drag grows with the square of speed.
  const thrust = p.throttle * 26;
  const drag = 0.0042 * p.speed * p.speed + (p.flaps ? 1.6 : 0) + (p.gear && flying ? 0.8 : 0);
  p.speed = Math.max(0, p.speed + (thrust - drag) * dt);

  // Lift: below stall speed the wing gives up and the nose drops.
  const lift = clamp(p.speed / stall, 0, 1.35);
  const stalled = p.speed < stall && flying;

  // Banked turn: heading follows the bank, faster when faster.
  const turnRate = Math.sin(deg2rad(p.roll)) * (p.speed / 40) * 24;
  p.heading = (p.heading + turnRate * dt + 360) % 360;

  // Vertical speed: pitch times speed, minus the sink of a stalled wing.
  // Capped so a full-power climb stays believable for a bush plane.
  let vs = Math.sin(deg2rad(p.pitch)) * p.speed * Math.min(lift, 1);
  if (stalled) vs -= (1 - lift) * 9;
  if (flying) vs -= (1 - lift) * 1.2; // a little sink even near the stall
  vs = clamp(vs, -14, 13);
  p.vs = lerp(p.vs, vs, Math.min(1, 3 * dt));

  // Move: airspeed along the nose, wind across the ground.
  const hRad = deg2rad(p.heading);
  const vx = Math.sin(hRad) * p.speed * Math.cos(deg2rad(p.pitch)) + p.windX;
  const vz = -Math.cos(hRad) * p.speed * Math.cos(deg2rad(p.pitch)) + p.windZ;
  p.x += vx * dt;
  p.z += vz * dt;
  p.groundSpeed = Math.hypot(vx, vz);

  // Fuel: burns with throttle; an empty tank means a glide, not a crash.
  if (p.throttle > 0 && p.fuel > 0) {
    p.fuel = Math.max(0, p.fuel - PLANE.fuelBurn * (0.3 + p.throttle) * dt);
    if (p.fuel === 0) p.throttle = 0;
  }

  // Ground and terrain contact.
  const ground = heightAt(p.x, p.z);
  const water = isWater(p.x, p.z);
  const strip = stripAt(p.x, p.z);
  const clearance = p.y - ground;

  if (flying) {
    p.y += p.vs * dt;
    if (p.y <= ground + 1.2) {
      // Touchdown (or a meeting with the hillside).
      if (strip && Math.abs(p.vs) <= 3.2 && p.gear) {
        p.onGround = true;
        p.y = ground + 1.2;
        p.pitch = 0; p.roll = 0;
        if (Math.abs(p.vs) > 1.6) p.damage = Math.min(100, p.damage + (Math.abs(p.vs) - 1.6) * 9);
      } else if (strip && !p.gear) {
        crash(p, 'Belly landing — the gear was up.');
      } else if (strip && Math.abs(p.vs) > 3.2) {
        crash(p, `Hard landing — ${Math.abs(p.vs).toFixed(1)} m/s down on the runway.`);
      } else if (water) {
        crash(p, 'Ditched in the river.');
      } else {
        crash(p, 'Flew into the mountainside.');
      }
    }
  } else {
    // Rolling on the ground: accelerate, rotate, or slow down.
    p.y = ground + 1.2;
    if (p.speed > PLANE.rotateSpeed && p.pitch > 4) {
      p.onGround = false;
      p.y += 0.5;
    }
    if (p.speed < 1 && p.throttle < 0.05) p.speed = 0;
    // Rolling off the strip into rough ground slows you hard.
    if (!strip && p.speed > 12) {
      p.speed = Math.max(0, p.speed - 14 * dt);
      p.damage = Math.min(100, p.damage + 4 * dt);
    }
  }

  // World edge: turn the plane gently back toward the valley.
  if (Math.abs(p.x) > 2000 || Math.abs(p.z) > 2000) {
    p.heading = (Math.atan2(p.x, -p.z) * 180) / Math.PI + 180;
  }
  if (p.damage >= 100 && !p.crashed) crash(p, 'The Kestrel took too much damage.');
}

function crash(p, reason) {
  p.crashed = true;
  p.crashReason = reason;
  p.speed = 0;
  p.vs = 0;
}

export function stallSpeed(p) {
  return p.flaps ? PLANE.stallFlaps : PLANE.stallClean;
}
