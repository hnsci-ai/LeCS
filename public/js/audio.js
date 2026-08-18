// public/js/audio.js — WebAudio 合成音效（无需素材文件）
'use strict';
const Audio = (function () {
  let ctx = null;
  let master = null;
  let lastStep = 0;
  let stepSide = 1;
  let bombBeepAt = 0;

  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    } catch (e) { /* 不支持则静音 */ }
  }
  function resume() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function noiseBuffer(len) {
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // 通用噪声爆发
  function burst(opts) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * (opts.dur || 0.12));
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(len);
    const filt = ctx.createBiquadFilter();
    filt.type = opts.type || 'bandpass';
    filt.frequency.value = opts.freq || 800;
    filt.Q.value = opts.q || 0.8;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(opts.vol || 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (opts.dur || 0.12));
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t);
    if (opts.playback) src.playbackRate.value = opts.playback;
  }

  function tone(freq, dur, vol, type, when, slideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type || 'square';
    const t = ctx.currentTime + (when || 0);
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // 各武器枪声
  const GUN = {
    glock: { freq: 900, dur: 0.09, vol: 0.5 },
    usp: { freq: 1000, dur: 0.08, vol: 0.5 },
    deagle: { freq: 500, dur: 0.16, vol: 0.85 },
    mp5: { freq: 1100, dur: 0.07, vol: 0.45 },
    ak47: { freq: 420, dur: 0.14, vol: 0.9 },
    m4a1: { freq: 750, dur: 0.1, vol: 0.7 },
    awp: { freq: 300, dur: 0.28, vol: 1.0 },
    knife: { freq: 1600, dur: 0.06, vol: 0.2, type: 'highpass' }
  };
  function gunshot(weapon, distant) {
    if (!ctx) return;
    const g = GUN[weapon] || GUN.glock;
    const vol = distant ? g.vol * 0.25 : g.vol;
    const freq = distant ? g.freq * 0.6 : g.freq;
    burst({ freq, dur: g.dur * (distant ? 1.4 : 1), vol, type: g.type });
    // 低频“砰”
    if (!distant || weapon === 'awp') burst({ freq: 150, dur: 0.12, vol: vol * 0.6, type: 'lowpass' });
  }

  function footsteps(speed, crouch) {
    if (!ctx || speed < 0.5) return;
    const now = performance.now();
    const interval = crouch ? 420 : (speed > 3.6 ? 320 : 480);
    if (now - lastStep < interval) return;
    lastStep = now;
    burst({ freq: 260 + Math.random() * 120, dur: 0.05, vol: 0.12, type: 'lowpass' });
  }

  function reload() {
    tone(700, 0.04, 0.15, 'square');
    tone(520, 0.05, 0.15, 'square', 0.12);
    burst({ freq: 1800, dur: 0.05, vol: 0.15, type: 'highpass' });
  }

  function hit(head) {
    if (head) tone(1250, 0.09, 0.3, 'sine');
    else tone(850, 0.05, 0.18, 'sine');
  }

  function hurt() { burst({ freq: 220, dur: 0.12, vol: 0.4, type: 'lowpass' }); }

  function explosion() {
    if (!ctx) return;
    burst({ freq: 120, dur: 0.7, vol: 1.0, type: 'lowpass' });
    burst({ freq: 400, dur: 0.35, vol: 0.6, type: 'bandpass' });
    burst({ freq: 60, dur: 1.2, vol: 0.9, type: 'lowpass' });
  }

  function bombBeep(timeLeft) {
    if (timeLeft <= 0) return;
    const interval = 0.18 + (timeLeft / 45) * 0.9; // 越接近爆炸越急促
    const now = performance.now();
    if (now - bombBeepAt > interval * 1000) {
      bombBeepAt = now;
      tone(880, 0.07, 0.25, 'square');
    }
  }

  function roundEnd(winner) {
    if (winner === 't') { tone(330, 0.15, 0.3, 'square'); tone(262, 0.2, 0.3, 'square', 0.15); }
    else { tone(392, 0.15, 0.3, 'square'); tone(523, 0.25, 0.3, 'square', 0.15); }
  }

  function roundStart() { tone(523, 0.08, 0.25, 'square'); tone(659, 0.1, 0.25, 'square', 0.09); }

  function plantSound() { tone(440, 0.06, 0.2, 'square'); tone(440, 0.06, 0.2, 'square', 0.12); }

  function throwSound() { burst({ freq: 900, dur: 0.08, vol: 0.2, type: 'highpass' }); }
  function bounceSound() { burst({ freq: 700, dur: 0.04, vol: 0.12, type: 'highpass' }); }
  function buySound() { tone(880, 0.06, 0.2, 'sine'); tone(1174, 0.08, 0.2, 'sine', 0.06); }
  function denySound() { tone(220, 0.12, 0.2, 'square'); }
  function emptyClick() { burst({ freq: 2400, dur: 0.03, vol: 0.25, type: 'highpass' }); tone(1500, 0.025, 0.12, 'square'); }
  function scopeSound(inOut) {
    burst({ freq: inOut ? 3200 : 2600, dur: 0.045, vol: 0.3, type: 'highpass' });
    burst({ freq: 900, dur: 0.05, vol: 0.15, type: 'lowpass' });
  }

  return {
    ensure, resume, gunshot, footsteps, reload, hit, hurt, explosion,
    bombBeep, roundEnd, roundStart, plantSound, throwSound, bounceSound, buySound, denySound, emptyClick, scopeSound
  };
})();
