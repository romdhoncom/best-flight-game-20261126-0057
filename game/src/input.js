// Keyboard and mouse input: one object the flight model and the screens read.
// Keys are tracked by code (ArrowUp, KeyW, ...) so layouts never matter.
// The mouse steers: holding the left button points the nose toward the pointer.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered: consumed by takePressed()
  const mouse = { x: 0, y: 0, down: false, active: false };

  const down = (e) => {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space') e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  };
  const up = (e) => keys.delete(e.code);

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = (e.clientY - r.top) / r.height;
    mouse.active = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    mouse.down = true;
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = (e.clientY - r.top) / r.height;
    mouse.active = true;
  });
  window.addEventListener('pointerup', () => { mouse.down = false; });

  return {
    keys,
    mouse,
    isDown(code) { return keys.has(code); },
    // True once for the frame the key went down; callers consume it.
    takePressed(code) {
      if (pressed.has(code)) { pressed.delete(code); return true; }
      return false;
    },
    endFrame() { pressed.clear(); },
  };
}
