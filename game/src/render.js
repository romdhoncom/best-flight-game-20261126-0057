// The renderer: a pinhole camera over the heightfield valley.
// Terrain is drawn as projected quads, back to front, coloured by height and
// slope; villages, trees, rings and clouds are projected the same way. The
// Kestrel itself is a canvas-drawn bush plane in a rear three-quarter view,
// banked with the roll. No images, no network: every pixel is drawn here.

import { WORLD, STRIPS, heightAt, stripAt, hash2 } from './terrain.js';

const CELL = WORLD.cell;
const GRID = Math.round(WORLD.size / CELL); // 64 cells across
const FOV = (68 * Math.PI) / 180;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  // Precompute the terrain vertex heights once: 65x65 vertices.
  const verts = new Float32Array((GRID + 1) * (GRID + 1));
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      verts[j * (GRID + 1) + i] = heightAt(-2048 + i * CELL, -2048 + j * CELL);
    }
  }
  const vHeight = (i, j) => verts[clamp(j, 0, GRID) * (GRID + 1) + clamp(i, 0, GRID)];

  return { ctx, canvas, verts, vHeight };
}

function cellColor(h, slope, ix, iz, dusk) {
  const v = hash2(ix, iz);
  let r, g, b;
  if (h <= 5.0) { r = 58; g = 108; b = 176; }
  else if (h > 165) { r = 232; g = 237; b = 242; }
  else if (h > 110) { r = 139; g = 133; b = 120; }
  else if (h > 42) { r = 74; g = 122; b = 62; }
  else { r = 106; g = 154; b = 78; }
  let f = 0.90 + v * 0.18 - slope * 0.30;
  if (dusk) { r = Math.round(r * 1.08); g = Math.round(g * 0.82); b = Math.round(b * 0.72); f *= 0.92; }
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

export function renderWorld(r, state, time) {
  const { ctx, canvas } = r;
  const W = canvas.width, H = canvas.height;
  const p = state.plane;
  const dusk = state.dusk;

  // --- sky ---
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  if (dusk) {
    sky.addColorStop(0, '#2c2a55'); sky.addColorStop(0.55, '#c96a4a'); sky.addColorStop(1, '#e8a06a');
  } else {
    sky.addColorStop(0, '#2f6fb8'); sky.addColorStop(0.55, '#7fb2dd'); sky.addColorStop(1, '#cfe4ef');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // --- camera ---
  const hRad = (p.heading * Math.PI) / 180;
  const pRad = (p.pitch * Math.PI) / 180;
  const fwd = {
    x: Math.sin(hRad) * Math.cos(pRad),
    y: Math.sin(pRad),
    z: -Math.cos(hRad) * Math.cos(pRad),
  };
  const right = { x: Math.cos(hRad), y: 0, z: Math.sin(hRad) };
  const up = {
    x: -Math.sin(hRad) * Math.sin(pRad),
    y: Math.cos(pRad),
    z: Math.cos(hRad) * Math.sin(pRad),
  };
  const cam = { x: 0, y: 0, z: 0 };
  if (state.camera === 'cockpit') {
    cam.x = p.x + fwd.x * 1.5; cam.y = p.y + 0.9; cam.z = p.z + fwd.z * 1.5;
  } else {
    cam.x = p.x - fwd.x * 17 + up.x * 0 + 0;
    cam.y = p.y - fwd.y * 17 + 4.6;
    cam.z = p.z - fwd.z * 17;
  }
  const f = (H / 2) / Math.tan(FOV / 2);
  const cx = W / 2, cy = H * 0.46;

  function project(x, y, z) {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    const depth = dx * fwd.x + dy * fwd.y + dz * fwd.z;
    if (depth < 0.6) return null;
    const rx = dx * right.x + dy * right.y + dz * right.z;
    const uy = dx * up.x + dy * up.y + dz * up.z;
    return { x: cx + (f * rx) / depth, y: cy - (f * uy) / depth, d: depth };
  }

  // --- sun ---
  const sunDir = dusk ? { x: -0.75, y: 0.10, z: -0.4 } : { x: -0.55, y: 0.62, z: -0.35 };
  const sun = project(cam.x + sunDir.x * 3000, cam.y + sunDir.y * 3000, cam.z + sunDir.z * 3000);
  if (sun && sun.x > -100 && sun.x < W + 100 && sun.y > -100 && sun.y < H) {
    const g = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 90);
    g.addColorStop(0, dusk ? 'rgba(255,190,120,0.95)' : 'rgba(255,244,200,0.95)');
    g.addColorStop(0.25, dusk ? 'rgba(255,150,80,0.45)' : 'rgba(255,230,150,0.4)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sun.x - 95, sun.y - 95, 190, 190);
  }

  // --- terrain mesh: visible cells, far to near ---
  const quads = [];
  const ci = Math.floor((cam.x + 2048) / CELL);
  const cj = Math.floor((cam.z + 2048) / CELL);
  const R = 17; // cells of radius
  for (let j = cj - R; j <= cj + R; j++) {
    for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      const x0 = -2048 + i * CELL, z0 = -2048 + j * CELL;
      const mx = x0 + CELL / 2, mz = z0 + CELL / 2;
      const dx = mx - cam.x, dz = mz - cam.z;
      const depth = dx * fwd.x + dz * fwd.z;
      if (depth < -40 || depth > 1500) continue;
      const lat = Math.abs(dx * right.x + dz * right.z);
      if (lat > depth * 1.4 + 120) continue;
      quads.push({ i, j, depth });
    }
  }
  quads.sort((a, b) => b.depth - a.depth);

  for (const q of quads) {
    const x0 = -2048 + q.i * CELL, z0 = -2048 + q.j * CELL;
    const h00 = r.vHeight(q.i, q.j), h10 = r.vHeight(q.i + 1, q.j);
    const h01 = r.vHeight(q.i, q.j + 1), h11 = r.vHeight(q.i + 1, q.j + 1);
    const a = project(x0, h00, z0), b = project(x0 + CELL, h10, z0);
    const c = project(x0 + CELL, h11, z0 + CELL), d = project(x0, h01, z0 + CELL);
    if (!a || !b || !c || !d) continue;
    const hc = (h00 + h10 + h01 + h11) / 4;
    const slope = (Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11)) / CELL;
    const mx = x0 + CELL / 2, mz = z0 + CELL / 2;
    const strip = stripAt(mx, mz);
    ctx.fillStyle = strip ? '#3f434a' : cellColor(hc, slope, q.i, q.j, dusk);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }

  // --- runway centreline dashes ---
  ctx.fillStyle = '#f2f2ea';
  for (const s of STRIPS) {
    const rad = (s.heading * Math.PI) / 180;
    const sx = Math.sin(rad), sz = Math.cos(rad);
    const px = Math.cos(rad), pz = -Math.sin(rad);
    for (let along = -190; along <= 190; along += 26) {
      const x = s.x + sx * along, z = s.z + sz * along;
      const y = s.alt + 0.35;
      const pts = [
        project(x + px * 0.9 + sx * 5, y, z + pz * 0.9 + sz * 5),
        project(x - px * 0.9 + sx * 5, y, z - pz * 0.9 + sz * 5),
        project(x - px * 0.9 - sx * 5, y, z - pz * 0.9 - sz * 5),
        project(x + px * 0.9 - sx * 5, y, z + pz * 0.9 - sz * 5),
      ];
      if (pts.some((q) => !q)) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.closePath(); ctx.fill();
    }
  }

  // --- clouds (soft ellipses, after the terrain) ---
  for (const c of state.clouds) {
    const pr = project(c.x, c.y, c.z);
    if (!pr || pr.d > 2200) continue;
    const rx = (c.r * f) / pr.d, ry = rx * 0.36;
    if (rx < 4) continue;
    ctx.fillStyle = dusk ? 'rgba(255,190,160,0.55)' : 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(pr.x - rx * 0.4, pr.y + ry * 0.25, rx * 0.55, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- houses ---
  for (const hs of state.houses) {
    const pr = project(hs.x, hs.y, hs.z);
    if (!pr || pr.d > 900) continue;
    const s = (f * hs.w) / pr.d;
    if (s < 2) continue;
    const w2 = s / 2, hgt = (f * hs.h) / pr.d;
    ctx.fillStyle = '#e8ddc8';
    ctx.fillRect(pr.x - w2, pr.y - hgt, s, hgt);
    ctx.fillStyle = '#b5543a';
    ctx.beginPath();
    ctx.moveTo(pr.x - w2 - 1, pr.y - hgt);
    ctx.lineTo(pr.x, pr.y - hgt - hgt * 0.55);
    ctx.lineTo(pr.x + w2 + 1, pr.y - hgt);
    ctx.closePath(); ctx.fill();
  }

  // --- pine trees (nearest 260 in view) ---
  let drawn = 0;
  for (const t of state.trees) {
    if (drawn > 260) break;
    const dx = t.x - cam.x, dz = t.z - cam.z;
    const depth = dx * fwd.x + dz * fwd.z;
    if (depth < 2 || depth > 700) continue;
    const pr = project(t.x, t.y, t.z);
    if (!pr) continue;
    const hgt = (f * 13 * t.s) / pr.d;
    const wdt = hgt * 0.42;
    if (hgt < 2) continue;
    ctx.fillStyle = '#2d5a2a';
    ctx.beginPath();
    ctx.moveTo(pr.x - wdt, pr.y);
    ctx.lineTo(pr.x, pr.y - hgt);
    ctx.lineTo(pr.x + wdt, pr.y);
    ctx.closePath(); ctx.fill();
    drawn++;
  }

  // --- rings ---
  for (const ring of state.rings) {
    const dx = ring.x - cam.x, dz = ring.z - cam.z;
    const depth = dx * fwd.x + dz * fwd.z;
    if (depth < 2 || depth > 1400) continue;
    // Ring plane faces along the course: it holds the up vector and the
    // horizontal perpendicular to the course direction.
    const n = ring.normal;
    const cxv = -n.z, cyv = 0, czv = n.x;
    const vl = Math.hypot(cxv, cyv, czv) || 1;
    const vx2 = cxv / vl, vy2 = cyv / vl, vz2 = czv / vl;
    const passed = ring.passed;
    ctx.strokeStyle = passed ? 'rgba(120,200,120,0.9)' : 'rgba(255,196,66,0.95)';
    ctx.lineWidth = clamp(90 / depth, 2, 9);
    ctx.beginPath();
    let started = false;
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = ring.x + (Math.cos(a) * 0 + Math.sin(a) * vx2) * ring.r;
      const py = ring.y + Math.cos(a) * ring.r;
      const pz = ring.z + (Math.cos(a) * 0 + Math.sin(a) * vz2) * ring.r;
      const pr = project(px, py, pz);
      if (!pr) { started = false; continue; }
      if (!started) { ctx.moveTo(pr.x, pr.y); started = true; }
      else ctx.lineTo(pr.x, pr.y);
    }
    ctx.stroke();
    // Centre dot so a distant ring still reads.
    const cp = project(ring.x, ring.y, ring.z);
    if (cp) {
      ctx.fillStyle = passed ? 'rgba(120,200,120,0.9)' : 'rgba(255,196,66,0.9)';
      ctx.beginPath(); ctx.arc(cp.x, cp.y, clamp(60 / depth, 2, 6), 0, Math.PI * 2); ctx.fill();
    }
  }

  // --- the Kestrel (chase view only) ---
  if (state.camera !== 'cockpit' && !p.crashed) {
    const ahead = {
      x: p.x + fwd.x * 10, y: p.y + fwd.y * 10, z: p.z + fwd.z * 10,
    };
    const pp = project(ahead.x, ahead.y, ahead.z);
    if (pp) {
      const S = clamp((f * 3.4) / 17, 34, 150); // plane size on screen
      drawPlane(ctx, pp.x, pp.y + S * 0.18, S, p.roll, time, p.throttle);
    }
  }

  // --- cockpit frame ---
  if (state.camera === 'cockpit') {
    ctx.fillStyle = '#1c2126';
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, H * 0.82); ctx.lineTo(W * 0.30, H * 0.74);
    ctx.lineTo(W * 0.70, H * 0.74); ctx.lineTo(W, H * 0.82); ctx.lineTo(W, H);
    ctx.closePath(); ctx.fill();
    // Cowling nose at the bottom centre.
    ctx.fillStyle = '#8c2f26';
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.99, W * 0.16, H * 0.07, 0, Math.PI, 0);
    ctx.fill();
    // Window pillars.
    ctx.fillStyle = '#14181c';
    ctx.fillRect(W * 0.30, 0, 10, H * 0.74);
    ctx.fillRect(W * 0.70 - 10, 0, 10, H * 0.74);
  }
}

// A high-wing bush plane, rear three-quarter view, banking with the roll.
// Drawn entirely with canvas paths: cream fuselage, red trim, spinning prop.
function drawPlane(ctx, x, y, S, rollDeg, time, throttle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rollDeg * Math.PI) / 180);
  const u = S / 100;
  // Prop disc (spins with throttle).
  const propA = time * (4 + throttle * 30);
  ctx.strokeStyle = 'rgba(40,40,46,0.55)';
  ctx.lineWidth = 3 * u;
  ctx.beginPath();
  ctx.ellipse(0, -6 * u, 26 * u, 7 * u, propA % Math.PI, 0, Math.PI * 2);
  ctx.stroke();
  // Tailplane.
  ctx.fillStyle = '#8c2f26';
  ctx.beginPath();
  ctx.moveTo(-34 * u, -14 * u); ctx.lineTo(34 * u, -14 * u);
  ctx.lineTo(26 * u, -22 * u); ctx.lineTo(-26 * u, -22 * u);
  ctx.closePath(); ctx.fill();
  // Fin.
  ctx.beginPath();
  ctx.moveTo(-4 * u, -16 * u); ctx.lineTo(6 * u, -38 * u);
  ctx.lineTo(14 * u, -36 * u); ctx.lineTo(12 * u, -14 * u);
  ctx.closePath(); ctx.fill();
  // Fuselage.
  ctx.fillStyle = '#f3ead8';
  ctx.beginPath();
  ctx.moveTo(-14 * u, 10 * u);
  ctx.quadraticCurveTo(-16 * u, -14 * u, -6 * u, -20 * u);
  ctx.lineTo(8 * u, -20 * u);
  ctx.quadraticCurveTo(16 * u, -12 * u, 14 * u, 10 * u);
  ctx.quadraticCurveTo(0, 16 * u, -14 * u, 10 * u);
  ctx.closePath(); ctx.fill();
  // Red cheatline.
  ctx.fillStyle = '#a93226';
  ctx.fillRect(-15 * u, -2 * u, 30 * u, 4 * u);
  // Windows.
  ctx.fillStyle = '#22384a';
  ctx.beginPath();
  ctx.roundRect(-9 * u, -16 * u, 18 * u, 8 * u, 3 * u);
  ctx.fill();
  // High wing.
  ctx.fillStyle = '#e8dcc2';
  ctx.beginPath();
  ctx.moveTo(-52 * u, -8 * u); ctx.lineTo(52 * u, -8 * u);
  ctx.lineTo(46 * u, -18 * u); ctx.lineTo(-46 * u, -18 * u);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#a93226';
  ctx.fillRect(-52 * u, -10 * u, 104 * u, 2.5 * u);
  // Gear legs and wheels.
  ctx.strokeStyle = '#2c2f33';
  ctx.lineWidth = 2.5 * u;
  ctx.beginPath();
  ctx.moveTo(-8 * u, 12 * u); ctx.lineTo(-12 * u, 24 * u);
  ctx.moveTo(8 * u, 12 * u); ctx.lineTo(12 * u, 24 * u);
  ctx.stroke();
  ctx.fillStyle = '#1c1e20';
  ctx.beginPath(); ctx.arc(-12 * u, 26 * u, 4.5 * u, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(12 * u, 26 * u, 4.5 * u, 0, Math.PI * 2); ctx.fill();
  // Registration.
  ctx.fillStyle = '#333';
  ctx.font = `bold ${7 * u}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('N-77NW', 0, 7 * u);
  ctx.restore();
}
