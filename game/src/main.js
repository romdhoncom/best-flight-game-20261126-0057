// Northwind Mail — Alpine Air Post. The game loop, screens and wiring:
// input -> flight model -> missions -> renderer + HUD. Static files only,
// no network, no build step.

import { createInput } from './input.js';
import { createPlane, stepFlight, stallSpeed } from './flight.js';
import { heightAt, treePositions, housePositions, cloudPositions } from './terrain.js';
import { createRenderer, renderWorld } from './render.js';
import { drawHud } from './hud.js';
import { createAudio } from './audio.js';
import { MISSIONS, startMission, updateMission, objectiveText } from './missions.js';
import { applyShot } from './shots.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();
const plane = createPlane();

// World scatter, computed once (deterministic per seed).
const trees = treePositions();
const houses = housePositions();
const clouds = cloudPositions();

const state = {
  plane,
  screen: 'title', // title | briefing | flying | paused | ended
  missionIndex: 0,
  mission: null,
  rings: [],
  camera: 'chase',
  dusk: false,
  trees, houses, clouds,
  groundBelow: 0,
  banner: '',
  timeLeft: 0,
  score: 0,
  objectiveText: '',
  frozen: false,
  shotReady: false,
};

function resize() {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));

function currentMissionDef() { return MISSIONS[state.missionIndex]; }

function beginMission(i) {
  state.missionIndex = i;
  state.mission = startMission(plane, MISSIONS[i]);
  state.rings = state.mission.rings;
  state.dusk = MISSIONS[i].dusk;
  state.camera = 'chase';
  state.screen = 'briefing';
  state.banner = '';
}

function startFlying() {
  state.screen = 'flying';
  audio.unlock();
}

function endScreen() {
  state.screen = 'ended';
  const s = state.mission;
  statusEl.textContent = s.status === 'won'
    ? `Sortie complete. Score ${s.score}.`
    : `Sortie failed. ${s.endReason}`;
}

// ---- input mapping: keyboard + mouse steer ----
function readControls() {
  let pitch = 0, roll = 0, throttle = 0;
  if (input.isDown('ArrowUp')) pitch += 1;
  if (input.isDown('ArrowDown')) pitch -= 1;
  if (input.isDown('ArrowLeft')) roll -= 1;
  if (input.isDown('ArrowRight')) roll += 1;
  if (input.isDown('KeyW')) throttle += 1;
  if (input.isDown('KeyS')) throttle -= 1;
  // Mouse: hold the left button and the nose follows the pointer.
  if (input.mouse.down && input.mouse.active) {
    roll = Math.max(-1, Math.min(1, (input.mouse.x - 0.5) * 2.4));
    pitch = Math.max(-1, Math.min(1, (0.5 - input.mouse.y) * 2.4));
  }
  return {
    pitch, roll, throttle,
    flapsToggle: input.takePressed('KeyF'),
    gearToggle: input.takePressed('KeyG'),
  };
}

// ---- screens ----
function drawTitle(ctx, W, H, t) {
  ctx.fillStyle = 'rgba(8,14,24,0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc442';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText('NORTHWIND MAIL', W / 2, H * 0.20);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px sans-serif';
  ctx.fillText('Alpine Air Post — fly the Kestrel between the mountain villages', W / 2, H * 0.20 + 38);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#cfe0ee';
  ctx.fillText('A STOL bush plane, three sorties, one valley. Land soft, mind the fuel, mind the wind.', W / 2, H * 0.20 + 66);

  MISSIONS.forEach((m, i) => {
    const y = H * 0.40 + i * 92;
    const sel = i === state.missionIndex;
    ctx.fillStyle = sel ? 'rgba(255,196,66,0.16)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 330, y - 34, 660, 76, 10); ctx.fill();
    ctx.strokeStyle = sel ? '#ffc442' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = sel ? '#ffc442' : '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}. ${m.name}`, W / 2 - 310, y - 6);
    ctx.fillStyle = '#cfe0ee';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${m.objectives.length} objective${m.objectives.length > 1 ? 's' : ''} · ${Math.round(m.timeLimit / 60)} min · ${m.fuel}% fuel`, W / 2 - 310, y + 18);
  });

  ctx.fillStyle = '#9fb4c8';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('1 / 2 / 3 — pick a sortie      Enter — fly      Arrows — pitch & bank      W / S — throttle', W / 2, H * 0.40 + 3 * 92 + 16);
  ctx.fillText('F — flaps      G — gear      C — camera      Mouse — hold to steer      P — pause', W / 2, H * 0.40 + 3 * 92 + 40);
}

function drawBriefing(ctx, W, H) {
  const m = currentMissionDef();
  ctx.fillStyle = 'rgba(8,14,24,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc442';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(m.name, W / 2, H * 0.26);
  ctx.fillStyle = '#ffffff';
  ctx.font = '17px sans-serif';
  wrapCenter(ctx, m.brief, W / 2, H * 0.32, 620, 26);
  ctx.fillStyle = '#cfe0ee';
  ctx.font = '15px sans-serif';
  const windKt = Math.round(Math.hypot(m.wind.x, m.wind.z) * 1.944);
  ctx.fillText(`Wind ${windKt} kt   ·   Fuel ${m.fuel}%   ·   Limit ${Math.round(m.timeLimit / 60)} min${m.dusk ? '   ·   Dusk' : ''}`, W / 2, H * 0.32 + 110);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Press Enter to take off', W / 2, H * 0.32 + 160);
}

function drawEnded(ctx, W, H) {
  const s = state.mission;
  ctx.fillStyle = 'rgba(8,14,24,0.68)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = s.status === 'won' ? '#7fd07f' : '#ff9a7a';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(s.status === 'won' ? 'SORTIE COMPLETE' : 'SORTIE FAILED', W / 2, H * 0.34);
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px sans-serif';
  ctx.fillText(s.endReason, W / 2, H * 0.34 + 40);
  ctx.font = 'bold 30px monospace';
  ctx.fillText(`SCORE  ${s.score}`, W / 2, H * 0.34 + 92);
  ctx.fillStyle = '#cfe0ee';
  ctx.font = '15px sans-serif';
  ctx.fillText('R — fly it again      Enter — back to the mission list', W / 2, H * 0.34 + 132);
}

function wrapCenter(ctx, text, cx, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, yy);
      line = w; yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, cx, yy);
}

// ---- main loop ----
let last = performance.now();
let frames = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const W = canvas.width, H = canvas.height;
  const ctx = renderer.ctx;
  const t = now / 1000;

  // Global keys, whatever the screen.
  if (input.takePressed('KeyC') && state.screen === 'flying') {
    state.camera = state.camera === 'chase' ? 'cockpit' : 'chase';
  }
  if (input.takePressed('KeyP')) {
    if (state.screen === 'flying') state.screen = 'paused';
    else if (state.screen === 'paused') state.screen = 'flying';
  }
  if (input.takePressed('KeyR') && (state.screen === 'flying' || state.screen === 'ended' || state.screen === 'paused')) {
    beginMission(state.missionIndex);
  }

  if (state.screen === 'title') {
    // The title flies over the valley: a slow orbit for the backdrop. This
    // runs before the key handling, so picking a sortie (which places the
    // plane on its strip) wins over the orbit for the rest of the frame.
    plane.x = Math.sin(t * 0.05) * 500;
    plane.z = Math.cos(t * 0.05) * 500 + 200;
    plane.y = heightAt(plane.x, plane.z) + 260;
    plane.heading = (Math.atan2(Math.cos(t * 0.05), Math.sin(t * 0.05)) * 180) / Math.PI + 90;
    plane.speed = 40;
    if (input.takePressed('Digit1')) state.missionIndex = 0;
    if (input.takePressed('Digit2')) state.missionIndex = 1;
    if (input.takePressed('Digit3')) state.missionIndex = 2;
    if (input.takePressed('Enter')) beginMission(state.missionIndex);
    state.dusk = false;
    state.camera = 'chase';
    renderWorld(renderer, state, t);
    drawTitle(ctx, W, H, t);
  } else if (state.screen === 'briefing') {
    if (input.takePressed('Enter')) startFlying();
    renderWorld(renderer, state, t);
    drawBriefing(ctx, W, H);
  } else if (state.screen === 'paused') {
    renderWorld(renderer, state, t);
    drawHud(ctx, W, H, state);
    ctx.fillStyle = 'rgba(8,14,24,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', W / 2, H / 2);
    ctx.font = '15px sans-serif';
    ctx.fillText('P — resume      R — restart the sortie', W / 2, H / 2 + 34);
  } else if (state.screen === 'ended') {
    if (input.takePressed('Enter')) state.screen = 'title';
    if (input.takePressed('KeyR')) beginMission(state.missionIndex);
    renderWorld(renderer, state, t);
    drawHud(ctx, W, H, state);
    drawEnded(ctx, W, H);
  } else {
    // flying
    if (!state.frozen) {
      const ctl = readControls();
      stepFlight(plane, ctl, dt);
      const ev = updateMission(state.mission, plane, dt);
      if (ev === 'chime') audio.chime();
      if (ev === 'thud') audio.thud();
      if (state.mission.status !== 'flying') endScreen();
      audio.update(plane.throttle, plane.speed, !plane.onGround);
    }
    state.groundBelow = heightAt(plane.x, plane.z);
    state.timeLeft = state.mission.timeLeft;
    state.score = state.mission.score;
    state.objectiveText = objectiveText(state.mission);
    state.banner = state.mission.bannerT > 0 ? state.mission.banner : '';
    renderWorld(renderer, state, t);
    drawHud(ctx, W, H, state);
  }

  input.endFrame();
  frames++;
  if (state.frozen && frames >= 5 && !state.shotReady) {
    state.shotReady = true;
    window.__shotReady = true;
  }
  requestAnimationFrame(frame);
}

// Posed screenshot: ?shot=cover|approach|rings|title
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
if (shot) {
  applyShot(state, shot);
  state.banner = '';
}

// Expose the live state for the playtest driver and the screenshot tool.
window.__game = state;
window.__plane = plane;
window.__stallSpeed = () => stallSpeed(plane);

requestAnimationFrame(frame);
