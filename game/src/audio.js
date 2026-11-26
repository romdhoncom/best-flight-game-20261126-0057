// Synthesised sound: no audio files, everything is WebAudio.
// Engine hum follows the throttle, wind noise follows the airspeed, and a
// two-note chime marks a completed objective.

export function createAudio() {
  let ctx = null;
  let engineOsc = null, engineGain = null;
  let windSrc = null, windGain = null, windFilter = null;
  let started = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    } catch {
      return false;
    }
    // Engine: a sawtooth through a low-pass, pitch and loudness by throttle.
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(ctx.destination);
    engineOsc.start();

    // Wind: looped white noise through a band-pass.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    windSrc = ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(ctx.destination);
    windSrc.start();
    return true;
  }

  return {
    // Call from a user gesture (key/click) so the browser allows audio.
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
      started = true;
    },
    update(throttle, speed, flying) {
      if (!ctx || !started) return;
      const t = ctx.currentTime;
      engineOsc.frequency.setTargetAtTime(48 + throttle * 95, t, 0.1);
      engineGain.gain.setTargetAtTime(flying || throttle > 0.05 ? 0.035 + throttle * 0.05 : 0, t, 0.1);
      windGain.gain.setTargetAtTime(Math.min(0.12, (speed / 78) * 0.12), t, 0.2);
      windFilter.frequency.setTargetAtTime(300 + speed * 9, t, 0.2);
    },
    chime() {
      if (!ctx || !started) return;
      const t = ctx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t + i * 0.12);
        g.gain.linearRampToValueAtTime(0.12, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.5);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.12);
        o.stop(t + i * 0.12 + 0.55);
      });
    },
    thud() {
      if (!ctx || !started) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.32);
    },
  };
}
