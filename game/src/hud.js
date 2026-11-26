// The HUD: live instruments drawn over the 3D view. Every number is a real
// value from the flight model — airspeed, altitude, vertical speed, heading
// tape, attitude ball, throttle, fuel and damage — so the instruments are
// flown, not painted on.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(10,16,24,0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function label(ctx, text, x, y, size = 11, color = '#9fb4c8') {
  ctx.fillStyle = color;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function value(ctx, text, x, y, size = 26, color = '#ffffff') {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function bar(ctx, x, y, w, h, frac, color, labelText) {
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(x, y, w, h);
  label(ctx, labelText, x, y - 4, 10);
}

export function drawHud(ctx, W, H, state) {
  const p = state.plane;
  const m = state.mission.def;
  const kt = Math.round(p.speed * 1.944);
  const ft = Math.round(p.y * 3.281);
  const vsFpm = Math.round(p.vs * 196.85);
  const hdg = Math.round(((p.heading % 360) + 360) % 360);

  // --- top-left: airspeed, altitude, vertical speed ---
  panel(ctx, 12, 12, 196, 108);
  label(ctx, 'AIRSPEED', 22, 32);
  value(ctx, `${kt}`, 22, 62);
  label(ctx, 'KT', 96, 62, 13, '#ffffff');
  label(ctx, 'ALTITUDE', 22, 84);
  value(ctx, `${ft}`, 22, 108, 20);
  label(ctx, 'FT', 92, 108, 12, '#ffffff');
  label(ctx, `VS ${vsFpm >= 0 ? '+' : ''}${vsFpm} FPM`, 128, 108, 11, vsFpm < -500 ? '#ff9a7a' : '#9fb4c8');

  // --- top-centre: heading compass tape ---
  const tapeW = 320, tapeX = W / 2 - tapeW / 2;
  panel(ctx, tapeX, 12, tapeW, 44);
  ctx.save();
  ctx.beginPath(); ctx.rect(tapeX, 12, tapeW, 44); ctx.clip();
  const pxPerDeg = 3.2;
  for (let d = -60; d <= 60; d += 5) {
    const hd = ((hdg + d) % 360 + 360) % 360;
    const x = W / 2 + d * pxPerDeg;
    const major = hd % 30 === 0;
    ctx.strokeStyle = major ? '#ffffff' : 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(x, 18); ctx.lineTo(x, major ? 34 : 28);
    ctx.stroke();
    if (major) {
      const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(names[hd] ?? String(hd / 10).padStart(2, '0'), x, 50);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#ffc442';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 6, 12); ctx.lineTo(W / 2 + 6, 12); ctx.lineTo(W / 2, 22);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(hdg).padStart(3, '0') + '°', W / 2, 66);

  // --- top-right: mission objective and timer ---
  panel(ctx, W - 268, 12, 256, 108);
  label(ctx, m.name.toUpperCase(), W - 256, 32, 12, '#ffc442');
  const obj = state.objectiveText;
  ctx.fillStyle = '#ffffff';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'left';
  wrapText(ctx, obj, W - 256, 52, 232, 16);
  const tLeft = Math.max(0, state.timeLeft);
  const mm = Math.floor(tLeft / 60), ss = Math.floor(tLeft % 60);
  value(ctx, `${mm}:${String(ss).padStart(2, '0')}`, W - 256, 108, 20, tLeft < 60 ? '#ff9a7a' : '#ffffff');
  label(ctx, 'SCORE ' + state.score, W - 160, 108, 12, '#ffffff');

  // --- bottom-left: attitude indicator ---
  const ax = 62, ay = H - 62, ar = 44;
  ctx.save();
  ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.clip();
  ctx.translate(ax, ay);
  ctx.rotate((-p.roll * Math.PI) / 180);
  ctx.translate(0, (p.pitch * Math.PI) / 180 * ar * 1.1);
  ctx.fillStyle = '#3a7bd5'; ctx.fillRect(-ar, -ar * 2, ar * 2, ar * 2);
  ctx.fillStyle = '#8a6a42'; ctx.fillRect(-ar, 0, ar * 2, ar * 2);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-ar, 0); ctx.lineTo(ar, 0); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffc442';
  ctx.beginPath();
  ctx.moveTo(ax - 14, ay); ctx.lineTo(ax - 4, ay); ctx.lineTo(ax, ay - 4);
  ctx.lineTo(ax + 4, ay); ctx.lineTo(ax + 14, ay); ctx.lineTo(ax + 4, ay + 2);
  ctx.lineTo(ax - 4, ay + 2);
  ctx.closePath(); ctx.fill();
  label(ctx, 'ATTITUDE', ax - 26, ay + ar + 16, 10);

  // --- bottom-centre: throttle / fuel / damage ---
  const bx = W / 2 - 150, by = H - 56;
  bar(ctx, bx, by, 140, 10, p.throttle, '#7fd07f', `THR ${Math.round(p.throttle * 100)}%`);
  bar(ctx, bx + 160, by, 140, 10, p.fuel / 100, p.fuel < 25 ? '#ff7a5a' : '#6ab8ff', `FUEL ${Math.round(p.fuel)}% · ${Math.round(p.fuel * 1.2)} L`);
  bar(ctx, bx + 320, by, 140, 10, p.damage / 100, p.damage > 60 ? '#ff5a4a' : '#ffb84d', `DMG ${Math.round(p.damage)}%`);

  // --- bottom-right: gear and flaps ---
  panel(ctx, W - 168, H - 72, 156, 60);
  label(ctx, 'GEAR', W - 156, H - 50, 11);
  value(ctx, p.gear ? 'DOWN' : 'UP', W - 108, H - 50, 14, p.gear ? '#7fd07f' : '#ff9a7a');
  label(ctx, 'FLAPS', W - 156, H - 28, 11);
  value(ctx, p.flaps ? 'DOWN' : 'UP', W - 108, H - 28, 14, p.flaps ? '#7fd07f' : '#ffffff');

  // --- warnings ---
  const warnings = [];
  if (!p.crashed && p.speed < (p.flaps ? 18 : 24) && !p.onGround) warnings.push('STALL');
  if (p.fuel < 25 && p.fuel > 0) warnings.push('LOW FUEL');
  if (p.fuel === 0) warnings.push('FUEL EMPTY — GLIDING');
  if (!p.gear && p.y - state.groundBelow < 60 && !p.onGround) warnings.push('GEAR UP — LOW');
  if (warnings.length) {
    ctx.fillStyle = '#ff5a4a';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(warnings.join('  ·  '), W / 2, H - 84);
  }

  // --- centre message (objective updates, crash reason) ---
  if (state.banner) {
    ctx.fillStyle = 'rgba(10,16,24,0.7)';
    const bw = ctx.measureText(state.banner).width + 36;
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, H * 0.30, bw, 40, 8);
    ctx.fill();
    ctx.fillStyle = '#ffc442';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.banner, W / 2, H * 0.30 + 26);
  }
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}
