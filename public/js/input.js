// public/js/input.js — 键盘/鼠标输入与指针锁定
'use strict';
const Input = (function () {
  const keys = {};         // 按住状态
  const edges = {};        // 边沿触发（消费一次）
  let locked = false;
  let yaw = 0, pitch = 0;
  let sensScale = 1;       // 开镜时降低灵敏度

  const SENS = 0.0022;

  const KEYMAP = {
    KeyW: 'f', ArrowUp: 'f',
    KeyS: 'b', ArrowDown: 'b',
    KeyA: 'l', ArrowLeft: 'l',
    KeyD: 'r', ArrowRight: 'r',
    ShiftLeft: 'walk', ShiftRight: 'walk',
    ControlLeft: 'crouch', ControlRight: 'crouch',
    Space: 'jump',
    KeyR: 'reload',
    KeyE: 'use',
    KeyF: 'loot',
    KeyB: 'buymenu',
    Tab: 'scoreboard',
    Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5',
    F3: 'addbot', F4: 'removebot',
    F6: 'quality'   // 手动切换画质档（高/低）
  };

  let fire = false;
  let fireAltEdge = false;

  // 正在输入框/下拉框打字时，不拦截按键（修复大厅昵称/房间码无法输入 1-5 与部分字母）
  function isTypingTarget(e) {
    const t = e.target;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e)) return;
    const act = KEYMAP[e.code];
    if (act) {
      e.preventDefault();
      if (act.startsWith('slot')) { edges.slot = parseInt(act.slice(4), 10); return; }
      if (act === 'jump' && !keys.jump) edges.jump = true;
      if (act === 'reload' && !keys.reload) edges.reload = true;
      if (act === 'buymenu') edges.buymenu = true;
      if (act === 'scoreboard' && !keys.scoreboard) edges.scoreboardOn = true;
      if (act === 'addbot') edges.addbot = true;
      if (act === 'removebot') edges.removebot = true;
      if (act === 'quality') edges.quality = true;
      keys[act] = true;
    }
  });
  document.addEventListener('keyup', (e) => {
    if (isTypingTarget(e)) return;
    const act = KEYMAP[e.code];
    if (act) {
      e.preventDefault();
      if (act === 'scoreboard') edges.scoreboardOff = true;
      keys[act] = false;
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) fire = true;
    if (e.button === 2) fireAltEdge = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) fire = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    yaw -= e.movementX * SENS * sensScale;
    pitch -= e.movementY * SENS * sensScale;
    pitch = Math.max(-1.55, Math.min(1.55, pitch));
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement !== null;
    if (!locked) { clearAll(); }
  });

  function clearAll() {
    for (const k in keys) keys[k] = false;
    fire = false;
  }

  function takeEdge(name) { const v = edges[name]; edges[name] = false; return !!v; }

  // 取武器槽位数字（1-5）——不能用 takeEdge（会转布尔丢失数值）
  function takeSlot() { const v = edges.slot; edges.slot = 0; return v || 0; }

  // 构建一次发送的按键对象
  function snapshot() {
    const fa = fireAltEdge;
    fireAltEdge = false;
    return {
      f: !!keys.f, b: !!keys.b, l: !!keys.l, r: !!keys.r,
      walk: !!keys.walk, crouch: !!keys.crouch,
      jump: takeEdge('jump'),
      use: !!keys.use,
      fire: fire,
      fireAlt: fa,
      reload: takeEdge('reload'),
      loot: takeEdge('loot')
    };
  }

  return {
    yaw: () => yaw,
    pitch: () => pitch,
    setYaw: (v) => { yaw = v; },
    setPitch: (v) => { pitch = v; },
    setSensScale: (v) => { sensScale = v; },
    locked: () => locked,
    snapshot,
    takeEdge,
    takeSlot,
    clearAll
  };
})();
