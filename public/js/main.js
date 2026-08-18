// public/js/main.js — 客户端主循环：大厅、网络、预测/插值、事件、输入
'use strict';
const Main = (function () {
  const C = GAMECONST;
  const S = {
    ws: null, myId: 0, code: '', mode: 'classic',
    snaps: [], lastSnap: null, roster: [],
    sim: null, simStates: [], seq: 0,
    prevSim: null, simAcc: 0,
    clockOffset: 0, rtt: 0, pingTimer: 0,
    botDiff: 'normal',
    wasReloading: false, wasAlive: false, hadFirstSnap: false,
    localNextFire: 0, prevFireHeld: false,
    scoped: 0,              // AWP 开镜档位（本地镜像，服务器权威）
    spectateId: 0,          // 观战目标 id
    inventory: {},          // slot -> weaponId（本地乐观切枪用）
    slotBuf: 0,
    joinState: 'idle'
  };

  // ---------- 大厅 ----------
  function initLobby() {
    // 音频初始化：浏览器要求 AudioContext 必须在用户手势中创建/恢复
    // （修复：此前从未调用 Audio.resume()，导致全程无声）
    document.addEventListener('click', () => Audio.resume());
    document.addEventListener('mousedown', () => Audio.resume());
    document.addEventListener('keydown', () => Audio.resume());
    document.getElementById('botcount').addEventListener('input', (e) => {
      document.getElementById('botcount-label').textContent = e.target.value;
    });
    document.getElementById('btn-practice').addEventListener('click', () => start({
      code: null,
      bots: parseInt(document.getElementById('botcount').value, 10),
      diff: document.getElementById('botdiff').value
    }));
    document.getElementById('btn-create').addEventListener('click', () => start({ code: null, bots: 0 }));
    document.getElementById('btn-join').addEventListener('click', () => {
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (!code) { lobbyMsg('请输入房间码'); return; }
      start({ code, bots: 0 });
    });
  }

  function lobbyMsg(text) { document.getElementById('lobby-msg').textContent = text; }

  function start(opts) {
    Audio.resume(); // 在按钮点击的手势中立即创建/恢复音频
    const name = document.getElementById('nick').value.trim() || '玩家';
    const mode = document.getElementById('mode').value;
    const team = document.getElementById('team').value;
    S.botDiff = opts.diff || 'normal';
    lobbyMsg('正在连接服务器…');
    connect(() => {
      S.mode = mode;
      send({ t: 'join', name, mode, team, code: opts.code || undefined });
      S.pendingBots = opts.bots || 0;
    });
  }

  function connect(onOpen) {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host);
    S.ws = ws;
    ws.onopen = () => onOpen && onOpen();
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { /* ignore */ } };
    ws.onclose = () => {
      document.getElementById('connlost').classList.remove('hidden');
      setTimeout(() => location.reload(), 3000);
    };
    ws.onerror = () => { lobbyMsg('无法连接服务器'); };
  }

  function send(obj) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj)); }
  window.__lecsSend = send; // 调试/测试辅助

  function onMessage(m) {
    switch (m.t) {
      case 'joined':
        S.myId = m.id; S.code = m.code; S.mode = m.mode;
        enterGame();
        if (S.pendingBots) {
          for (let i = 0; i < S.pendingBots; i++) send({ t: 'addbot', diff: S.botDiff });
          HUD.showMessage(`已添加 ${S.pendingBots} 个电脑玩家（${S.botDiff === 'easy' ? '简单' : S.botDiff === 'hard' ? '困难' : '普通'}）`);
        }
        break;
      case 'error':
        lobbyMsg(m.text || '出错了');
        S.joinState = 'idle';
        break;
      case 'snap': handleSnap(m); break;
      case 'event': handleEvent(m.ev); break;
      case 'roster': S.roster = m.players; break;
      case 'pong': {
        const recv = performance.now();
        S.rtt = recv - m.time;
        S.clockOffset = (m.srv + S.rtt / 2) - recv;
        break;
      }
    }
  }

  // ---------- 指针锁定管理（修复 Esc/B 关闭购买菜单后鼠标失联） ----------
  // 统一维护「点击进入」覆盖层：仅在未锁定且没有菜单/记分板时显示
  function updateLockUI() {
    const locked = Input.locked();
    const sbOpen = !document.getElementById('scoreboard').classList.contains('hidden');
    document.getElementById('click-block').classList.toggle('hidden', locked || HUD.buyOpen() || sbOpen);
  }

  // 请求重新锁定鼠标；浏览器在 exitPointerLock 后有约 1.3s 冷却期，
  // 失败时自动重试一次，仍失败则显示覆盖层让用户点击重入
  function attemptRelock(retried) {
    const c = document.getElementById('gl');
    let p = null;
    try { p = c.requestPointerLock(); } catch (e) { /* 同步拒绝 */ }
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        if (!retried) {
          setTimeout(() => {
            if (!Input.locked() && !HUD.buyOpen()) attemptRelock(true);
          }, 1300);
        }
        updateLockUI();
      });
    }
  }

  function openBuyMenu() {
    HUD.showBuyMenu(true);
    if (document.pointerLockElement) document.exitPointerLock();
    updateLockUI();
  }

  function closeBuyMenu() {
    HUD.showBuyMenu(false);
    updateLockUI();
    attemptRelock(false);
  }

  function enterGame() {
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    HUD.init();
    HUD.setRoomCode(S.code);
    const canvas = document.getElementById('gl');
    Render.init(canvas);
    VM.init(Render.getCamera());
    document.getElementById('click-block').addEventListener('click', () => attemptRelock(false));
    // 兜底：未锁定时点击画布也可重新锁定
    canvas.addEventListener('click', () => {
      if (!Input.locked() && !HUD.buyOpen()) attemptRelock(false);
    });
    document.addEventListener('pointerlockchange', () => {
      if (!Input.locked() && !HUD.buyOpen()) Input.clearAll();
      updateLockUI();
    });
    document.getElementById('copy-code').addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(S.code);
      HUD.showMessage('房间码已复制: ' + S.code);
    });
    document.getElementById('btn-addbot').addEventListener('click', () => send({ t: 'addbot', diff: S.botDiff }));
    document.getElementById('btn-removebot').addEventListener('click', () => send({ t: 'removebot' }));
    requestAnimationFrame(frame);
    setInterval(() => {
      if (S.ws && S.ws.readyState === 1) send({ t: 'ping', time: performance.now() });
    }, 2000);
  }

  // ---------- 快照处理 ----------
  function myEntry(snap) {
    if (!snap) return null;
    return snap.players.find(p => p[0] === S.myId) || null;
  }

  function handleSnap(snap) {
    S.snaps.push({ recv: performance.now(), data: snap });
    if (S.snaps.length > 40) S.snaps.shift();
    S.lastSnap = snap;
    window.__lecsLastSnap = snap; // 测试辅助
    const me = myEntry(snap);

    if (!S.sim && me) {
      S.sim = {
        x: me[1], y: me[2], z: me[3], vx: me[26], vy: 0, vz: me[27],
        yaw: me[4], pitch: me[5], h: me[17] ? C.CROUCH_H : C.PLAYER_H, eye: me[17] ? C.EYE_CROUCH : C.EYE_H,
        onGround: true, crouch: !!me[17]
      };
      Input.setYaw(me[4]);
      Input.setPitch(me[5]);
      S.prevSim = { ...S.sim };
    } else if (S.sim && me && me[9] === 1) {
      reconcile(me);
    }

    // 武器模型同步（服务器权威）
    if (me && me[9] === 1) {
      const wid = me[10];
      if (VM.weaponId() !== wid) VM.setWeapon(wid);
      if (wid) {
        const def = WEAPONS.W[wid];
        if (def && def.slot) S.inventory[def.slot] = wid;
        else if (wid === 'bomb') S.inventory[5] = 'bomb';
      }
      if (me[19] && !S.wasReloading) Audio.reload();
      S.wasReloading = !!me[19];
    }
    if (me) S.scoped = me[29] || 0; // 开镜档位（服务器权威，如跑动自动收镜）

    // 其他玩家枪声 + 曳光弹 + 命中特效
    if (snap.shots) {
      for (const sh of snap.shots) {
        const x = sh[0], y = sh[1], z = sh[2], wid = sh[3], yaw = sh[5], pitch = sh[6] || 0;
        const hx = sh[7], hy = sh[8], hz = sh[9], kind = sh[10];
        const d = S.sim ? Math.hypot(x - S.sim.x, z - S.sim.z) : 99;
        const own = d <= 2;
        if (!own) {
          Audio.gunshot(wid, true);
          // 3D 曳光轨迹：起点 → 服务器计算的真实命中点
          if (hx !== undefined && kind !== 0) {
            Render.tracer({ x, y, z }, { x: hx, y: hy, z: hz });
          } else {
            const dx = -Math.sin(yaw) * Math.cos(pitch);
            const dy = Math.sin(pitch);
            const dz = -Math.cos(yaw) * Math.cos(pitch);
            Render.tracer({ x, y, z }, { x: x + dx * 28, y: y + dy * 28, z: z + dz * 28 });
          }
          if (wid !== 'knife') Render.muzzleFlash(x, y, z, yaw, pitch);
          if (kind === 1 || kind === 2) Render.impact(hx, hy, hz, kind);
        } else if (hx !== undefined && (kind === 1 || kind === 2)) {
          // 自己的子弹：本地即时绘制曳光，服务器命中点补火花/血雾
          Render.impact(hx, hy, hz, kind);
        }
        // 记录命中受害者的子弹方向（布娃娃死亡冲量用）
        if (kind === 2 && sh[11]) {
          Ragdoll.registerHit(sh[11], { x: hx, y: hy, z: hz }, { x, y, z }, wid);
        }
        // 观战时：目标开火同步第一人称枪口动画
        if (S.spectateId && !own) {
          const sp = snap.players.find(q => q[0] === S.spectateId);
          if (sp && Math.hypot(sp[1] - x, sp[3] - z) < 3) VM.fire();
        }
      }
    }
    // 炸弹倒计时音
    if (snap.bomb && snap.bomb[0] === 'planted') Audio.bombBeep(snap.bomb[4]);

    // 手雷渲染
    if (snap.nades) Render.updateNades(snap.nades);

    HUD.setKillfeed(snap.killfeed);

    // 死亡/重生
    if (me) {
      const alive = me[9] === 1;
      if (S.wasAlive && !alive && S.hadFirstSnap) {
        Audio.hurt();
        VM.setVisible(false);
      }
      if (!S.wasAlive && alive && S.hadFirstSnap) VM.setVisible(true);
      S.wasAlive = alive;
      S.hadFirstSnap = true;
    }
  }

  function reconcile(me) {
    const ack = me[25];
    const sx = me[1], sy = me[2], sz = me[3], svx = me[26], svz = me[27];
    let idx = -1;
    for (let i = S.simStates.length - 1; i >= 0; i--) {
      if (S.simStates[i].seq === ack) { idx = i; break; }
    }
    if (idx < 0) {
      // 状态已过期：全部由服务器接管
      S.sim.x = sx; S.sim.y = sy; S.sim.z = sz;
      S.sim.vx = svx; S.sim.vz = svz;
      return;
    }
    const st = S.simStates[idx];
    const err = Math.hypot(st.x - sx, st.z - sz);
    if (err > 0.4) {
      S.sim.x = sx; S.sim.y = sy; S.sim.z = sz;
      S.sim.vx = svx; S.sim.vz = svz;
      S.sim.onGround = true;
      // 重放未确认输入
      for (let i = idx + 1; i < S.simStates.length; i++) {
        const s = S.simStates[i];
        if (!s.inp) continue;
        S.sim.yaw = s.yaw;
        MOVEMENT.step(S.sim, s.inp, C.DT);
      }
    }
  }

  // ---------- 模拟步进（30Hz） ----------
  function stepSim() {
    const me = myEntry(S.lastSnap);
    if (!S.sim || !me || me[9] !== 1) return;
    const inp = Input.snapshot();
    S.sim.yaw = Input.yaw();
    S.sim.pitch = Input.pitch();
    const movIn = {
      f: inp.f, b: inp.b, l: inp.l, r: inp.r,
      walk: inp.walk, crouch: inp.crouch, jump: inp.jump
    };
    S.prevSim = { x: S.sim.x, y: S.sim.y, z: S.sim.z, yaw: S.sim.yaw, pitch: S.sim.pitch };
    MOVEMENT.step(S.sim, movIn, C.DT);
    S.seq++;
    S.simStates.push({ seq: S.seq, x: S.sim.x, y: S.sim.y, z: S.sim.z, vx: S.sim.vx, vz: S.sim.vz, yaw: S.sim.yaw, pitch: S.sim.pitch, inp: movIn });
    if (S.simStates.length > 90) S.simStates.shift();
    // 发送输入
    send({
      t: 'input', seq: S.seq,
      keys: { f: inp.f, b: inp.b, l: inp.l, r: inp.r, walk: inp.walk, crouch: inp.crouch, jump: inp.jump, use: inp.use, fire: inp.fire, fireAlt: inp.fireAlt, reload: inp.reload },
      yaw: S.sim.yaw, pitch: S.sim.pitch,
      slot: S.slotBuf || undefined,
      tClient: performance.now() + S.clockOffset
    });
    S.slotBuf = 0;
    // 本地枪声与后坐力表现（空仓/换弹时不播枪声与曳光，只给空仓咔哒反馈）
    const fireEdge = inp.fire && !S.prevFireHeld;
    S.prevFireHeld = !!inp.fire;
    const wid = VM.weaponId();
    const def = wid && WEAPONS.W[wid];
    // 右键：AWP 开镜 / 刀重击（本地即时反馈，服务器权威确认）
    if (inp.fireAlt) {
      if (wid === 'awp') {
        S.scoped = (S.scoped + 1) % 3;
        Audio.scopeSound(S.scoped > 0);
      } else if (wid === 'knife' && performance.now() >= S.localNextFire) {
        S.localNextFire = performance.now() + 600;
        Audio.gunshot('knife', false);
        VM.fire();
      }
    }
    // 左键开火
    const wantFire = def && def.auto ? inp.fire : fireEdge;
    if (inp.fire && wantFire && def && performance.now() >= S.localNextFire) {
      const rate = def.rate || 6;
      S.localNextFire = performance.now() + 1000 / rate;
      const mag = me ? me[11] : 0;
      const reloading = me ? !!me[19] : false;
      const needsAmmo = wid !== 'knife' && wid !== 'hegrenade' && wid !== 'bomb';
      const empty = needsAmmo && mag <= 0;
      if (empty) {
        Audio.emptyClick(); // 空仓咔哒声，无枪声无曳光
      } else if (!reloading) {
        if (wid === 'hegrenade') Audio.throwSound();
        else Audio.gunshot(wid, false);
        VM.fire();
        // 自己的曳光弹（即时绘制，无需等服务器）+ 抛壳
        if (wid !== 'knife' && wid !== 'hegrenade') {
          const cam = Render.getCamera();
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          const muzzle = VM.getMuzzleWorld();
          const dist = 45;
          Render.tracer(muzzle, {
            x: muzzle.x + fwd.x * dist,
            y: muzzle.y + fwd.y * dist,
            z: muzzle.z + fwd.z * dist
          });
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
          const back = fwd.clone().negate();
          Render.shell(cam.position.x, cam.position.y, cam.position.z, right, up, back);
        }
      }
    }
  }

  // ---------- 事件 ----------
  function handleEvent(ev) {
    switch (ev.type) {
      case 'hit':
        Audio.hit(ev.head);
        HUD.showHit(ev.head);
        break;
      case 'damage':
        Audio.hurt();
        HUD.showDamage(ev.dir);
        break;
      case 'kill':
        if (ev.victim === S.myId) Audio.hurt();
        break;
      case 'round':
        if (ev.event === 'start') {
          HUD.showBanner('第 ' + ev.round + ' 回合', 'ct');
          Audio.roundStart();
        } else if (ev.event === 'live') {
          HUD.showBanner('行动开始！', 'ct');
          Audio.roundStart();
        } else if (ev.event === 'end') {
          HUD.showBanner(ev.winner === 't' ? '恐怖分子获胜' : '反恐精英获胜', ev.winner === 't' ? 't' : 'ct');
          HUD.showMessage(ev.reason || '');
          Audio.roundEnd(ev.winner);
        }
        break;
      case 'bomb':
        if (ev.event === 'assign' || ev.event === 'pickup') HUD.showMessage((ev.name || '?') + ' 携带 C4');
        if (ev.event === 'plant') { HUD.showBanner('C4 已安放！', 't'); Audio.plantSound(); }
        if (ev.event === 'defuse') { HUD.showBanner('C4 已拆除！', 'ct'); Audio.plantSound(); }
        if (ev.event === 'explode') {
          Audio.explosion();
          Render.explosion(ev.x, ev.y + 0.5, ev.z);
        }
        if (ev.event === 'drop') HUD.showMessage('C4 已掉落');
        break;
      case 'nade':
        if (ev.event === 'explode') {
          Audio.explosion();
          Render.explosion(ev.x, ev.y + 0.5, ev.z);
        }
        break;
      case 'buy':
        if (ev.ok) {
          Audio.buySound();
          HUD.showMessage('购买成功', '#ffce45');
          const def = WEAPONS.W[ev.id];
          if (def && def.slot) S.inventory[def.slot] = ev.id;
          if (ev.id === 'hegrenade') S.inventory[4] = 'hegrenade';
        } else { Audio.denySound(); HUD.showMessage('购买失败：' + (ev.reason || ''), '#ff7a6b'); }
        break;
      case 'message':
        HUD.showMessage(ev.text, '#9fd3ff');
        break;
      case 'join':
        HUD.showMessage(ev.name + ' 加入游戏', '#9fd3ff');
        break;
      case 'leave':
        HUD.showMessage(ev.name + ' 离开了游戏', '#9fd3ff');
        break;
    }
  }

  // ---------- 插值 ----------
  function interpolatePlayers() {
    const out = new Map();
    if (!S.snaps.length) return out;
    const renderT = performance.now() - 100;
    let i2 = S.snaps.length - 1;
    for (let i = 0; i < S.snaps.length; i++) {
      if (S.snaps[i].recv >= renderT) { i2 = i; break; }
    }
    const i1 = Math.max(0, i2 - 1);
    const s1 = S.snaps[i1], s2 = S.snaps[i2];
    const span = Math.max(1, s2.recv - s1.recv);
    const t = Math.min(1, Math.max(0, (renderT - s1.recv) / span));
    for (const e2 of s2.data.players) {
      const e1 = s1.data.players.find(x => x[0] === e2[0]);
      const a = e1 || e2;
      out.set(e2[0], {
        id: e2[0],
        x: a[1] + (e2[1] - a[1]) * t,
        y: a[2] + (e2[2] - a[2]) * t,
        z: a[3] + (e2[3] - a[3]) * t,
        yaw: lerpAngle(a[4], e2[4], t),
        crouch: !!e2[17],
        alive: e2[9] === 1,
        team: e2[8],
        vx: e2[26], vz: e2[27],
        weapon: e2[10],
        scoped: e2[29] || 0
      });
    }
    return out;
  }

  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // ---------- 主循环 ----------
  let lastT = performance.now();
  function frame(now) {
    const dtReal = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const me = myEntry(S.lastSnap);

    // 30Hz 模拟
    if (S.sim && me && me[9] === 1) {
      S.simAcc += dtReal;
      while (S.simAcc >= C.DT) { stepSim(); S.simAcc -= C.DT; }
    }

    // 购买菜单开关（B）
    if (Input.takeEdge('buymenu')) {
      if (HUD.buyOpen()) closeBuyMenu();
      else if (canBuy()) openBuyMenu();
      else HUD.showMessage('当前无法购买（需在购买区或回合开始）', '#ff7a6b');
    }
    // 购买菜单数字键
    if (HUD.buyOpen() && S.buyKeyBuf) {
      HUD.buyKey(S.buyKeyBuf);
      S.buyKeyBuf = 0;
    }

    // 记分板
    if (Input.takeEdge('scoreboardOn')) HUD.showScoreboard(true, S.roster, S.lastSnap);
    if (Input.takeEdge('scoreboardOff')) HUD.showScoreboard(false, S.roster, S.lastSnap);

    // 增删 Bot
    if (Input.takeEdge('addbot')) send({ t: 'addbot', diff: S.botDiff });
    if (Input.takeEdge('removebot')) send({ t: 'removebot' });

    // 切枪（本地乐观 + 服务器权威）
    const slot = Input.takeEdge('slot');
    if (slot) {
      S.slotBuf = slot;
      const wid = S.inventory[slot];
      if (wid) VM.setWeapon(wid);
    }

    // 视图
    const view = computeView(dtReal);
    const players = interpolatePlayers();
    Render.updatePlayers(players, S.myId);

    // 观战目标（死亡/等待时跟随队友，第一人称显示其武器与开镜）
    let specT = null;
    if (me && me[9] !== 1) {
      for (const p of players.values()) if (p.alive && p.team === me[8]) { specT = p; break; }
      if (!specT) for (const p of players.values()) if (p.alive) { specT = p; break; }
      S.spectateId = specT ? specT.id : 0;
      if (specT) {
        if (VM.weaponId() !== specT.weapon) VM.setWeapon(specT.weapon);
      }
    } else {
      S.spectateId = 0;
    }
    const effScoped = (me && me[9] === 1) ? (S.scoped > 0) : !!(specT && specT.scoped > 0);
    const effScopedLv = (me && me[9] === 1) ? S.scoped : (specT ? specT.scoped : 0);

    // AWP 开镜：FOV 平滑变焦 + 灵敏度缩放 + 隐藏持枪模型
    const targetFov = !effScoped ? 75 : (effScopedLv === 1 ? 32 : 15);
    const cam = Render.getCamera();
    cam.fov += (targetFov - cam.fov) * Math.min(1, dtReal * 11);
    cam.updateProjectionMatrix();
    Input.setSensScale(!effScoped ? 1 : (effScopedLv === 1 ? 0.55 : 0.25));
    const showGun = me && ((me[9] === 1 && !me[28]) || (me[9] !== 1 && specT)) && !effScoped;
    VM.setVisible(!!showGun);
    VM.update(dtReal, {
      speed: S.sim ? Math.hypot(S.sim.vx, S.sim.vz) : 0,
      reloading: !!(me && me[19]),
      reloadDur: (me && me[10] && WEAPONS.W[me[10]]) ? WEAPONS.W[me[10]].reload || 2 : 2.5
    });
    Render.renderFrame(view, dtReal);

    // 脚步声
    if (S.sim && me && me[9] === 1) {
      Audio.footsteps(Math.hypot(S.sim.vx, S.sim.vz), S.sim.crouch);
    }

    // HUD
    const snap = S.lastSnap;
    // 死亡/观战时：HUD 显示观战目标的信息（血量/弹药/开镜）
    let dispMe = me;
    if (snap && me && me[9] !== 1 && S.spectateId) {
      const t = snap.players.find(p => p[0] === S.spectateId);
      if (t) dispMe = t;
    }
    HUD.updateGame({
      my: dispMe,
      dead: !!(me && me[9] !== 1),
      spectator: !!(me && me[28] === 1),
      scores: snap ? snap.scores : [0, 0],
      timeLeft: snap ? snap.timeLeft : 0,
      phase: snap ? snap.phase : 'live',
      mode: snap ? snap.mode : S.mode,
      bomb: snap ? snap.bomb : null
    });
    if (HUD.buyOpen()) HUD.refreshBuyMenu(dispMe, canBuy());
    if (S.sim) {
      HUD.updateRadar(
        { x: S.sim.x, z: S.sim.z }, S.sim.yaw,
        Array.from(players.values()).filter(p => p.id !== S.myId),
        snap ? snap.bomb : null
      );
    }

    requestAnimationFrame(frame);
  }

  function computeView(dt) {
    const me = myEntry(S.lastSnap);
    const s = S.sim;
    if (!s) return { camX: 0, camY: 2, camZ: 0, yaw: 0, pitch: 0 };
    if (me && me[9] === 1) {
      // 第一人称（模拟状态 + 平滑插值）
      const f = S.prevSim && S.simAcc > 0 ? Math.min(1, S.simAcc / C.DT) : 0;
      const x = (S.prevSim ? S.prevSim.x : s.x) + (s.x - (S.prevSim ? S.prevSim.x : s.x)) * f;
      const y = (S.prevSim ? S.prevSim.y : s.y) + (s.y - (S.prevSim ? S.prevSim.y : s.y)) * f;
      const z = (S.prevSim ? S.prevSim.z : s.z) + (s.z - (S.prevSim ? S.prevSim.z : s.z)) * f;
      return { camX: x, camY: y + s.eye, camZ: z, yaw: Input.yaw(), pitch: Input.pitch() };
    }
    // 观战：跟随队友
    const players = interpolatePlayers();
    let target = null;
    for (const p of players.values()) {
      if (p.alive && p.team === (me ? me[8] : 1)) { target = p; break; }
    }
    if (!target) for (const p of players.values()) if (p.alive) { target = p; break; }
    if (target) {
      return { camX: target.x, camY: target.y + (target.crouch ? C.EYE_CROUCH : C.EYE_H), camZ: target.z, yaw: target.yaw, pitch: 0 };
    }
    return { camX: s.x, camY: s.y + 1.2, camZ: s.z, yaw: s.yaw, pitch: 0.2 };
  }

  function canBuy() {
    const snap = S.lastSnap;
    const me = myEntry(snap);
    if (!snap || !me) return false;
    if (snap.mode === 'dm') return true;
    if (snap.phase === 'freeze') return true;
    if (snap.phase !== 'live' || me[9] !== 1) return false;
    const bz = me[8] === 0 ? MAPDATA.buyZones.t : MAPDATA.buyZones.ct;
    return me[1] >= bz.x1 && me[1] <= bz.x2 && me[3] >= bz.z1 && me[3] <= bz.z2;
  }

  function buy(id) {
    send({ t: 'buy', id });
    // 立即刷新菜单可用性
    setTimeout(() => HUD.refreshBuyMenu(myEntry(S.lastSnap), canBuy()), 100);
  }

  // 键盘数字（购买菜单）+ Esc 关闭并恢复鼠标控制
  document.addEventListener('keydown', (e) => {
    if (!HUD.buyOpen()) return;
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      HUD.buyKey(parseInt(e.key, 10));
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBuyMenu();
    }
  });

  initLobby();
  return { buy, get myId() { return S.myId; } };
})();
