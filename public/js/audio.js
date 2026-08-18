// public/js/audio.js — WebAudio 合成音效（无需素材文件）
'use strict';
const Audio = (function () {
  let ctx = null;
  let master = null;
  let lastStep = 0;
  let stepSide = 1;
  let bombBeepAt = 0;
  let plays = 0; // 测试辅助：已调度播放的音效数

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

  let sharedNoise = null;
  function noiseBuffer(len) {
    // 共享噪声缓冲：避免每枪分配新 AudioBuffer（消除 GC 卡顿）
    const want = Math.max(len, Math.floor(ctx.sampleRate * 2.5));
    if (!sharedNoise || sharedNoise.length < want) {
      sharedNoise = ctx.createBuffer(1, want, ctx.sampleRate);
      const d = sharedNoise.getChannelData(0);
      for (let i = 0; i < want; i++) d[i] = Math.random() * 2 - 1;
    }
    return sharedNoise;
  }

  // 通用噪声爆发
  function burst(opts) {
    if (!ctx) return;
    plays++;
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
    src.connect(filt); filt.connect(g);
    let pn = null;
    if (opts.pan !== undefined && ctx.createStereoPanner) {
      pn = ctx.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(pn); pn.connect(master);
    } else {
      g.connect(master);
    }
    src.start(t);
    // 播放结束即断开全部节点（否则长期游戏音频图无限膨胀导致卡顿）
    src.onended = () => {
      try { src.disconnect(); filt.disconnect(); g.disconnect(); if (pn) pn.disconnect(); } catch (e) { /* 已断开 */ }
    };
    if (opts.playback) src.playbackRate.value = opts.playback;
  }

  function tone(freq, dur, vol, type, when, slideTo) {
    if (!ctx) return;
    plays++;
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
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* 已断开 */ } };
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
    knife: { freq: 1600, dur: 0.06, vol: 0.2, type: 'highpass' },
    p228: { freq: 820, dur: 0.09, vol: 0.5 },
    fiveseven: { freq: 860, dur: 0.08, vol: 0.48 },
    elites: { freq: 950, dur: 0.08, vol: 0.55 },
    tmp: { freq: 1300, dur: 0.06, vol: 0.35 },
    mac10: { freq: 720, dur: 0.08, vol: 0.55 },
    ump45: { freq: 620, dur: 0.09, vol: 0.6 },
    p90: { freq: 1050, dur: 0.07, vol: 0.5 },
    galil: { freq: 460, dur: 0.12, vol: 0.8 },
    famas: { freq: 800, dur: 0.09, vol: 0.7 },
    sg552: { freq: 700, dur: 0.1, vol: 0.75 },
    aug: { freq: 750, dur: 0.1, vol: 0.7 },
    scout: { freq: 380, dur: 0.2, vol: 0.8 },
    g3sg1: { freq: 340, dur: 0.22, vol: 0.9 },
    sg550: { freq: 350, dur: 0.22, vol: 0.85 },
    m249: { freq: 300, dur: 0.13, vol: 0.9 }
  };
  function gunshot(weapon, distant, pan, dist) {
    if (!ctx) return;
    const g = GUN[weapon] || GUN.glock;
    let vol = distant ? g.vol * 0.25 : g.vol;
    if (dist !== undefined && dist > 0) vol *= Math.max(0.04, 1 / (1 + dist * 0.12)); // 距离衰减
    const freq = distant ? g.freq * 0.6 : g.freq;
    burst({ freq, dur: g.dur * (distant ? 1.4 : 1), vol, type: g.type, pan });
    if (!distant || weapon === 'awp') burst({ freq: 150, dur: 0.12, vol: vol * 0.6, type: 'lowpass', pan });
  }

  // 他人脚步声（按距离/方位）
  function footstepDistant(pan, dist) {
    if (!ctx) return;
    const vol = 0.16 * Math.max(0.05, 1 / (1 + dist * 0.25));
    burst({ freq: 240 + Math.random() * 100, dur: 0.05, vol, type: 'lowpass', pan });
  }

  function land() { burst({ freq: 130, dur: 0.12, vol: 0.28, type: 'lowpass' }); }
  function shellTink() { burst({ freq: 2600, dur: 0.03, vol: 0.1, type: 'highpass' }); tone(1900, 0.02, 0.05, 'sine'); }
  function nadeBounce(pan, dist) {
    const vol = 0.2 * Math.max(0.05, 1 / (1 + dist * 0.2));
    burst({ freq: 700, dur: 0.04, vol, type: 'highpass', pan });
  }
  let windSrc = null, windGain = null;
  function startWind() {
    if (!ctx || windSrc) return;
    windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(ctx.sampleRate * 3);
    windSrc.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 320;
    windGain = ctx.createGain(); windGain.gain.value = 0.045;
    windSrc.connect(f); f.connect(windGain); windGain.connect(master);
    windSrc.start();
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
  function knifeSwing(distant, heavy) {
    // 匕首挥砍嗖声：轻击短促高频，重击低沉有力
    if (heavy) {
      burst({ freq: 700, dur: 0.16, vol: distant ? 0.16 : 0.4, type: 'bandpass' });
      tone(300, 0.15, distant ? 0.1 : 0.22, 'sine', 0, 1400);
    } else {
      burst({ freq: 2600, dur: 0.09, vol: distant ? 0.12 : 0.32, type: 'bandpass' });
      tone(1100, 0.08, distant ? 0.08 : 0.18, 'sine', 0, 3200);
    }
  }
  function knifeHit(heavy) {
    // 刀命中肉体声：轻击短促、重击闷响
    burst({ freq: heavy ? 500 : 900, dur: heavy ? 0.09 : 0.06, vol: 0.35, type: 'lowpass' });
    tone(heavy ? 180 : 260, heavy ? 0.12 : 0.07, 0.3, 'sine', 0, heavy ? 90 : 140);
  }
  function streakSound() {
    tone(523, 0.09, 0.25, 'square');
    tone(659, 0.09, 0.25, 'square', 0.1);
    tone(784, 0.16, 0.3, 'square', 0.2);
  }
  function lootSound() {
    tone(500, 0.06, 0.2, 'square');
    tone(700, 0.06, 0.2, 'square', 0.07);
    tone(1000, 0.09, 0.22, 'sine', 0.14);
  }
  function rescueSound() {
    tone(660, 0.08, 0.22, 'sine');
    tone(880, 0.12, 0.24, 'sine', 0.08);
  }
  function flashSound() {
    // 闪光弹：高频耳鸣般的尖鸣
    tone(1800, 1.2, 0.35, 'sine', 0, 4200);
    tone(2400, 1.0, 0.2, 'sine', 0.05, 5200);
    burst({ freq: 3000, dur: 0.2, vol: 0.3, type: 'highpass' });
  }
  function smokeSound() {
    // 烟雾弹：闷响出烟声
    burst({ freq: 500, dur: 0.5, vol: 0.4, type: 'lowpass' });
    burst({ freq: 900, dur: 0.8, vol: 0.25, type: 'bandpass' });
  }

  return {
    ensure, resume, gunshot, footsteps, reload, hit, hurt, explosion,
    bombBeep, roundEnd, roundStart, plantSound, throwSound, bounceSound, buySound, denySound, emptyClick, scopeSound,
    knifeSwing, knifeHit, flashSound, smokeSound, streakSound, rescueSound, lootSound, footstepDistant, land, shellTink, nadeBounce, startWind,
    // 测试辅助
    _debugState: () => ({ created: !!ctx, state: ctx ? ctx.state : 'none', plays })
  };
})();
