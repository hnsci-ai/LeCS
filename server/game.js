// server/game.js — 游戏房间：权威状态、命中判定、回合、经济、炸弹、Bot 接入
'use strict';
const C = require('../shared/constants');
const MAP = require('../shared/mapdata');
const MOV = require('../shared/movement');
const WPN = require('../shared/weapons');
const BotBrain = require('./bots');

const W = WPN.W;
let NEXT_ID = 1;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

// 军备竞赛（枪王）武器阶梯：从匕首一路杀到最终刀战
const ARMS_LADDER = [
  'knife', 'glock', 'usp', 'p228', 'fiveseven', 'deagle', 'elites',   // 手枪段
  'tmp', 'mac10', 'mp5', 'ump45', 'p90',                             // 冲锋枪段
  'galil', 'famas', 'ak47', 'm4a1', 'sg552', 'aug',                  // 步枪段
  'scout', 'sg550', 'g3sg1', 'awp', 'm249',                          // 狙击/机枪段
  'hegrenade', 'knife'                                               // 手雷 → 最终刀战
];
const STREAK_MSGS = { 3: '3 连杀', 5: '5 连杀 · 势不可挡', 7: '7 连杀 · 无人能挡' };

function angDiffWrap(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 线段 (ax,az)-(bx,bz) 到圆心 (cx,cz) 的最短距离
function segCircleDist(ax, az, bx, bz, cx, cz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(cx - (ax + dx * t), cz - (az + dz * t));
}

class Game {
  constructor(code, mode) {
    this.code = code;
    this.mode = mode; // 'classic' | 'dm'
    this.players = new Map(); // id -> player
    this.tickCount = 0;
    this.phase = C.STATE_FREEZE;
    this.timeLeft = C.FREEZE_TIME;
    this.round = 0;
    this.scores = { t: 0, ct: 0 };
    this.lossStreak = { t: 0, ct: 0 };
    this.bomb = { state: C.BOMB_HIDDEN, carrier: null, x: 0, y: 0, z: 0, site: null, timeLeft: C.BOMB_TIME };
    this.nades = [];
    this.smokes = [];    // 烟雾弹烟团 [{x,y,z,r,born,life,growUntil}]
    this.hostages = [];  // 人质营救模式 [{id,x,y,z,yaw,state:'idle'|'follow',leader}]
    this.rescued = 0;
    this.crates = [];    // 死亡战利品箱 [{id,x,y,z,weapons,grenades,money}]
    this.shots = [];      // 本 tick 的枪声事件
    this.killfeed = [];   // 最近 6 条
    this.events = [];     // 待广播事件（每 tick 清空）
    this.spawnIdx = { t: 0, ct: 0 };
    this.lastTickTime = Date.now();
    this._timer = null;
  }

  // ---------- 生命周期 ----------
  start() {
    if (this._timer) return;
    this.lastTickTime = Date.now();
    this._timer = setInterval(() => this.tick(), 1000 / C.TICK);
    this.startRound();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  empty() { return this.players.size === 0; }

  humanCount() { let n = 0; this.players.forEach(p => { if (!p.bot) n++; }); return n; }

  // ---------- 玩家 ----------
  addPlayer(ws, name, teamChoice) {
    const id = NEXT_ID++;
    const p = {
      id, name: String(name || '玩家').slice(0, 16), ws, bot: null, brain: null,
      team: teamChoice === 'ct' ? C.TEAM_CT : (teamChoice === 't' ? C.TEAM_T : this.pickTeam()),
      alive: false, spectator: true, hp: C.MAX_HP, armor: 0, helmet: false, defuseKit: false,
      money: C.START_MONEY, kills: 0, deaths: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, h: C.PLAYER_H, eye: C.EYE_H,
      onGround: true, crouch: false,
      weapons: {}, curSlot: 1,
      grenades: [], // 手雷背包（hegrenade/flashbang/smokegrenade，每种最多一颗）
      blindUntil: 0,
      armsLevel: 0, // 军备竞赛当前阶梯等级
      streak: 0,    // 连杀数
      nextFire: 0, reloadEnd: 0, reloading: false,
      in: { f: false, b: false, l: false, r: false, walk: false, crouch: false, jump: false, use: false, fire: false, fireAlt: false, reload: false, slot: 0 },
      firePressed: false, fireAltPressed: false, fireWasDown: false, lootPressed: false,
      scoped: 0, // AWP 开镜档位 0/1/2
      ackSeq: 0, latency: 0,
      planting: 0, plantX: 0, plantZ: 0, defusing: 0,
      respawnAt: 0, survived: false,
      history: [], // 位置历史（延迟补偿）
      diedAt: 0, spectateTarget: null
    };
    this.players.set(id, p);
    this.giveDefault(p); // 基础装备（DM/军备竞赛稍后覆盖）
    if (this.mode === 'dm' || this.mode === 'armsrace') {
      if (this.mode === 'dm') this.giveDMLoadout(p);
      else this.giveArmsLoadout(p);
      this.spawnPlayer(p);
      this.broadcastRoster();
      return p;
    }
    // 房间第一人：立即重开回合（避免刚建房间就长时间观战）
    if (this.players.size === 1 && this.phase !== C.STATE_FREEZE) {
      this.startRound();
      this.broadcastRoster();
      return p;
    }
    // 经典模式：中途加入先观战
    if (this.phase === C.STATE_LIVE) {
      p.spectator = true;
      this.emitEvent({ type: 'message', text: `${p.name} 加入，将于下一回合参战` });
    } else {
      this.spawnPlayer(p);
    }
    // 冻结期补发 C4（回合开始时还没有 T 的情况）
    if (this.mode === 'classic' && this.phase === C.STATE_FREEZE && p.team === C.TEAM_T && !this.bomb.carrier) {
      this.assignBomb();
    }
    this.broadcastRoster();
    return p;
  }

  // 把 C4 随机分配给一名存活的 T
  assignBomb() {
    const aliveTs = [];
    this.players.forEach(p => { if (p.team === C.TEAM_T && p.alive) aliveTs.push(p); });
    if (!aliveTs.length) return;
    const carrier = aliveTs[Math.floor(Math.random() * aliveTs.length)];
    this.bomb.state = C.BOMB_CARRIED;
    this.bomb.carrier = carrier;
    carrier.weapons[5] = { id: 'bomb', mag: 1, reserve: 0 };
    this.emitEvent({ type: 'bomb', event: 'assign', carrier: carrier.id, name: carrier.name });
  }

  addBot(difficulty) {
    const p = this.addPlayer(null, 'Bot-' + String(NEXT_ID).slice(-3), 'auto');
    if (!p) return null;
    p.bot = difficulty || 'normal';
    p.brain = new BotBrain(this, p);
    if (this.mode === 'classic' && this.phase !== C.STATE_LIVE) this.spawnPlayer(p);
    else if (this.mode === 'classic') { p.spectator = true; }
    this.broadcastRoster();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.bomb.carrier === p) this.dropBomb(p);
    this.players.delete(id);
    this.broadcastRoster();
    this.emitEvent({ type: 'leave', id, name: p.name });
  }

  pickTeam() {
    let t = 0, ct = 0;
    this.players.forEach(p => { if (!p.spectator || p.team !== null) { if (p.team === C.TEAM_T) t++; else ct++; } });
    return ct < t ? C.TEAM_CT : C.TEAM_T;
  }

  teamSize(team) { let n = 0; this.players.forEach(p => { if (p.team === team) n++; }); return n; }

  // ---------- 消息处理 ----------
  onMessage(p, msg) {
    if (!p || !msg) return;
    switch (msg.t) {
      case 'input': this.handleInput(p, msg); break;
      case 'buy': this.buy(p, msg.id); break;
      case 'addbot': if (this.humanCount() > 0) this.addBot(msg.diff || 'normal'); break;
      case 'removebot': this.removeOneBot(); break;
      case 'ping': p.ws && this.send(p.ws, { t: 'pong', time: msg.time, srv: Date.now() }); break;
      case 'chat': this.emitEvent({ type: 'chat', id: p.id, name: p.name, text: String(msg.text || '').slice(0, 100) }); break;
      case 'dev': if (process.env.ALLOW_DEV === '1') this.devCmd(p, msg); break;
    }
  }

  removeOneBot() {
    for (const [id, p] of this.players) if (p.bot) { this.removePlayer(id); return; }
  }

  // 仅供测试环境（ALLOW_DEV=1）
  devCmd(p, msg) {
    const target = msg.id ? this.players.get(msg.id) : p;
    if (!target) return;
    if (msg.cmd === 'tp') {
      target.x = msg.x; target.y = msg.y || 0; target.z = msg.z;
      target.vx = target.vy = target.vz = 0;
      target.history = [];
    } else if (msg.cmd === 'dmg') {
      this.applyDamage(target, p, { dmg: msg.amount || 1000 }, msg.mul || 1, 1, 1, 'dev');
    } else if (msg.cmd === 'hp') {
      target.hp = clamp(msg.hp || 100, 1, C.MAX_HP);
    } else if (msg.cmd === 'god') {
      target.god = true;
    } else if (msg.cmd === 'armor') {
      target.armor = msg.armor !== undefined ? msg.armor : 100;
      target.helmet = !!msg.helmet;
    } else if (msg.cmd === 'revive') {
      target.alive = true; target.hp = C.MAX_HP; target.spectator = false;
      target.vx = target.vy = target.vz = 0;
    } else if (msg.cmd === 'give') {
      const def = W[msg.weapon];
      if (def) {
        if (msg.weapon === 'knife') {
          target.weapons[3] = { id: 'knife', mag: 1, reserve: 0 };
          target.curSlot = 3;
        } else if (def.slot === 3) {
          if (!target.grenades) target.grenades = [];
          if (!target.grenades.includes(msg.weapon)) target.grenades.push(msg.weapon);
          target.weapons[4] = { id: msg.weapon, mag: 1, reserve: 0 };
          target.curSlot = 4;
        } else {
          target.weapons[def.slot] = { id: msg.weapon, mag: def.mag, reserve: def.reserve };
          target.curSlot = def.slot;
        }
      }
    } else if (msg.cmd === 'money') {
      target.money = clamp(msg.amount || 0, 0, C.MAX_MONEY);
    }
  }

  handleInput(p, msg) {
    if (!p.alive && !p.spectator) return;
    if (msg.seq !== undefined) p.ackSeq = Math.max(p.ackSeq, msg.seq);
    const inp = p.in;
    if (msg.keys) {
      inp.f = !!msg.keys.f; inp.b = !!msg.keys.b; inp.l = !!msg.keys.l; inp.r = !!msg.keys.r;
      inp.walk = !!msg.keys.walk; inp.crouch = !!msg.keys.crouch;
      inp.use = !!msg.keys.use; inp.fire = !!msg.keys.fire; inp.fireAlt = !!msg.keys.fireAlt;
      // 击发边沿锁存：半自动枪一次点击一发（按住不连发）
      if (msg.keys.fire && !p.fireWasDown) p.firePressed = true;
      p.fireWasDown = !!msg.keys.fire;
      if (msg.keys.fireAlt) p.fireAltPressed = true;
      if (msg.keys.loot) p.lootPressed = true;
      if (msg.keys.jump) inp.jump = true;
      if (msg.keys.reload) inp.reload = true;
    }
    if (msg.yaw !== undefined) { p.yaw = msg.yaw; if (p.pitch === undefined) p.pitch = 0; }
    if (msg.pitch !== undefined) p.pitch = clamp(msg.pitch, -1.55, 1.55);
    if (msg.slot) inp.slot = msg.slot;
    if (msg.tClient) {
      const est = Date.now() - msg.tClient;
      p.latency = clamp(est < 0 ? 0 : est, 0, 300);
    }
  }

  // ---------- 回合 ----------
  startRound() {
    this.round++;
    const instantLive = this.mode === 'dm' || this.mode === 'armsrace';
    this.phase = instantLive ? C.STATE_LIVE : C.STATE_FREEZE;
    this.timeLeft = instantLive ? 86400 : C.FREEZE_TIME;
    this.bomb = { state: C.BOMB_HIDDEN, carrier: null, x: 0, y: 0, z: 0, site: null, timeLeft: C.BOMB_TIME };
    this.nades = [];
    this.smokes = [];
    this.crates = [];
    // 人质营救：刷新 4 名人质
    this.hostages = [];
    this.rescued = 0;
    if (this.mode === 'hostage') {
      (MAP.hostageSpots || []).forEach((sp, i) => {
        this.hostages.push({ id: 9000 + i, x: sp.x, y: 0, z: sp.z, yaw: 0, state: 'idle', leader: null });
      });
    }
    const aliveTs = [];
    this.players.forEach(p => {
      p.history = [];
      if (p.bot && p.brain) p.brain.reset();
      // 死亡玩家重置装备，幸存者保留并补满弹药
      if (!p.survived) {
        p.weapons = {};
        this.giveDefault(p);
        p.armor = 0; p.helmet = false; p.defuseKit = false;
      } else {
        for (const slot in p.weapons) {
          const w = p.weapons[slot];
          const def = W[w.id];
          if (def && def.mag) { w.mag = def.mag; w.reserve = def.reserve; }
        }
      }
      delete p.weapons[5];
      p.survived = false;
      this.spawnPlayer(p);
      if (p.team === C.TEAM_T) aliveTs.push(p);
      p.planting = 0; p.defusing = 0;
    });
    // 分配 C4
    if (this.mode === 'classic') this.assignBomb();
    this.emitEvent({ type: 'round', event: 'start', round: this.round, phase: this.phase });
    this.broadcastRoster();
  }

  endRound(winner, reason) {
    if (this.phase === C.STATE_END) return;
    this.phase = C.STATE_END;
    this.timeLeft = C.ROUND_END_TIME;
    if (winner === 't') this.scores.t++; else this.scores.ct++;
    // 经济
    const wTeam = winner === 't' ? C.TEAM_T : C.TEAM_CT;
    const lTeam = winner === 't' ? C.TEAM_CT : C.TEAM_T;
    this.lossStreak[lTeam === C.TEAM_T ? 't' : 'ct']++;
    this.lossStreak[wTeam === C.TEAM_T ? 't' : 'ct'] = 0;
    const lossBonus = C.LOSS_BONUS[Math.min(this.lossStreak[lTeam === C.TEAM_T ? 't' : 'ct'] - 1, C.LOSS_BONUS.length - 1)];
    this.players.forEach(p => {
      if (p.team === wTeam) this.addMoney(p, C.WIN_REWARD);
      else this.addMoney(p, lossBonus);
      if (p.alive) p.survived = true;
    });
    // 拆弹奖励
    this.emitEvent({
      type: 'round', event: 'end', winner, reason, round: this.round,
      scores: { t: this.scores.t, ct: this.scores.ct }
    });
    this.emitEvent({ type: 'message', text: roundEndText(winner, reason) });
    // 下回合自动开始
    setTimeout(() => { if (this.phase === C.STATE_END) this.startRound(); }, C.ROUND_END_TIME * 1000);
  }

  spawnPlayer(p) {
    const list = p.team === C.TEAM_T ? MAP.spawns.t : MAP.spawns.ct;
    const sp = list[this.spawnIdx[p.team === C.TEAM_T ? 't' : 'ct']++ % list.length];
    p.x = sp.x; p.y = 0; p.z = sp.z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.yaw = sp.yaw; p.pitch = 0;
    p.alive = true; p.spectator = false;
    p.hp = C.MAX_HP;
    p.h = p.crouch ? C.CROUCH_H : C.PLAYER_H;
    p.eye = p.h - 0.1;
    p.onGround = true;
    p.nextFire = 0; p.reloading = false; p.reloadEnd = 0;
    p.planting = 0; p.defusing = 0; p.respawnAt = 0;
    p.scoped = 0;
    this.historyPush(p);
  }

  giveDefault(p) {
    const pistol = p.team === C.TEAM_T ? 'glock' : 'usp';
    p.weapons = { 2: { id: pistol, mag: W[pistol].mag, reserve: W[pistol].reserve }, 3: { id: 'knife', mag: 1, reserve: 0 } };
    p.grenades = [];
    p.curSlot = 2;
  }

  giveDMLoadout(p) {
    const rifle = p.team === C.TEAM_T ? 'ak47' : 'm4a1';
    p.weapons = {
      1: { id: rifle, mag: W[rifle].mag, reserve: W[rifle].reserve },
      2: { id: 'deagle', mag: W.deagle.mag, reserve: W.deagle.reserve },
      3: { id: 'knife', mag: 1, reserve: 0 },
      4: { id: 'hegrenade', mag: 1, reserve: 0 }
    };
    p.grenades = ['hegrenade', 'flashbang', 'smokegrenade'];
    p.curSlot = 1;
    p.armor = C.MAX_ARMOR; p.helmet = true;
    if (p.team === C.TEAM_CT) p.defuseKit = true;
    p.money = 16000;
  }

  addMoney(p, amt) { p.money = clamp(p.money + amt, 0, C.MAX_MONEY); }

  // 军备竞赛：按当前等级发放武器
  giveArmsLoadout(p) {
    const wid = ARMS_LADDER[clamp(p.armsLevel || 0, 0, ARMS_LADDER.length - 1)];
    const def = W[wid];
    if (!def) return;
    p.weapons = { 3: { id: 'knife', mag: 1, reserve: 0 } };
    if (def.slot === 1) p.weapons[1] = { id: wid, mag: def.mag, reserve: def.reserve };
    if (def.slot === 2) p.weapons[2] = { id: wid, mag: def.mag, reserve: def.reserve };
    if (def.slot === 3 && wid !== 'knife') {
      if (!p.grenades) p.grenades = [];
      if (!p.grenades.includes(wid)) p.grenades.push(wid);
      p.weapons[4] = { id: wid, mag: 1, reserve: 0 };
    }
    p.curSlot = def.slot === 1 ? 1 : (def.slot === 2 ? 2 : (def.slot === 3 && wid !== 'knife' ? 4 : 3));
    p.armor = C.MAX_ARMOR; p.helmet = true;
    p.money = 16000;
  }

  // 人质状态更新与营救判定
  tickHostages(dt) {
    if (this.mode !== 'hostage') return;
    const bz = MAP.buyZones.ct; // 营救区 = CT 出生区
    for (const h of this.hostages) {
      if (h.state !== 'follow' || !h.leader) continue;
      const L = h.leader;
      if (!L.alive) {
        h.state = 'idle'; h.leader = null;
        this.emitEvent({ type: 'hostage', event: 'drop', id: h.id, x: +h.x.toFixed(1), z: +h.z.toFixed(1) });
        continue;
      }
      // 寻路跟随：沿 A* 路径追领导者（会绕墙），每 1.5 秒重算
      h.repathT = (h.repathT || 0) - dt;
      const dLead = Math.hypot(L.x - h.x, L.z - h.z);
      if (dLead > 3) {
        if (!h.path || h.repathT <= 0) {
          h.repathT = 1.5;
          h.path = MAP.findPathSmooth(h.x, h.z, L.x, L.z);
          h.pathIdx = 0;
        }
        if (h.path && h.pathIdx < h.path.length) {
          const wp = h.path[h.pathIdx];
          const dx = wp.x - h.x, dz = wp.z - h.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.7) { h.pathIdx++; }
          else {
            const sp = Math.min(d, 4.2 * dt);
            h.x += dx / d * sp;
            h.z += dz / d * sp;
            h.yaw = Math.atan2(-dx, -dz);
          }
        }
      } else {
        h.yaw = L.yaw;
      }
      // 到达营救区 → 获救
      if (h.x >= bz.x1 && h.x <= bz.x2 && h.z >= bz.z1 && h.z <= bz.z2) {
        this.rescued++;
        this.addMoney(L, 1000);
        this.emitEvent({ type: 'hostage', event: 'rescue', id: h.id, name: L.name, rescued: this.rescued });
        const idx = this.hostages.indexOf(h);
        if (idx >= 0) this.hostages.splice(idx, 1);
        if (this.hostages.length === 0) this.endRound('ct', '人质全部获救');
      }
    }
  }

  // 舔包：靠近战利品箱按 F，取走武器/手雷/金钱（换下的武器留在箱内）
  tryLoot(p) {
    if (!p.alive) return;
    let idx = -1;
    for (let i = 0; i < this.crates.length; i++) {
      if (Math.hypot(this.crates[i].x - p.x, this.crates[i].z - p.z) < 1.8) { idx = i; break; }
    }
    if (idx < 0) return;
    const c = this.crates[idx];
    const got = [];
    if (c.weapons[1]) {
      const w = c.weapons[1];
      c.weapons[1] = p.weapons[1] || null;
      p.weapons[1] = w;
      got.push(W[w.id] ? W[w.id].name : w.id);
    }
    if (c.weapons[2]) {
      const w = c.weapons[2];
      c.weapons[2] = p.weapons[2] || null;
      p.weapons[2] = w;
      got.push(W[w.id] ? W[w.id].name : w.id);
    }
    if (!p.grenades) p.grenades = [];
    for (const gid of c.grenades.slice()) {
      if (p.grenades.length < 3 && !p.grenades.includes(gid)) {
        p.grenades.push(gid);
        c.grenades.splice(c.grenades.indexOf(gid), 1);
        if (!p.weapons[4]) p.weapons[4] = { id: gid, mag: 1, reserve: 0 };
        got.push(W[gid] ? W[gid].name : gid);
      }
    }
    const cash = c.money;
    this.addMoney(p, cash);
    c.money = 0;
    const empty = !c.weapons[1] && !c.weapons[2] && !c.grenades.length;
    if (empty) this.crates.splice(idx, 1);
    this.emitEvent({ type: 'loot', name: p.name, got: got.join('、'), money: cash });
  }

  // 人质交互：CT 按 E 带领人质
  tryLeadHostage(p) {
    if (this.mode !== 'hostage' || p.team !== C.TEAM_CT) return;
    for (const h of this.hostages) {
      if (h.state !== 'idle') continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d < 2.2) {
        h.state = 'follow';
        h.leader = p;
        this.emitEvent({ type: 'hostage', event: 'follow', id: h.id, name: p.name });
        return;
      }
    }
  }

  // ---------- 购买 ----------
  buy(p, id) {
    const res = this.validateBuy(p, id);
    if (!res.ok) { this.sendEvent(p, { type: 'buy', ok: false, id, reason: res.reason, money: p.money }); return; }
    this.applyBuy(p, id);
    this.sendEvent(p, { type: 'buy', ok: true, id, money: p.money, slot: p.curSlot });
  }

  validateBuy(p, id) {
    if (this.mode === 'armsrace') return { ok: false, reason: '军备竞赛无需购买' };
    if (this.mode !== 'dm' && this.phase === C.STATE_END) return { ok: false, reason: '回合已结束' };
    if (this.mode === 'dm') return { ok: true };
    if (!p.alive) return { ok: false, reason: '已阵亡' };
    if (this.phase === C.STATE_LIVE) {
      const bz = p.team === C.TEAM_T ? MAP.buyZones.t : MAP.buyZones.ct;
      if (!(p.x >= bz.x1 && p.x <= bz.x2 && p.z >= bz.z1 && p.z <= bz.z2)) return { ok: false, reason: '需在购买区购买' };
    }
    let cost = null;
    if (id === 'ammo') {
      const w = p.weapons[p.curSlot];
      if (!w || !W[w.id] || !W[w.id].ammoPrice) return { ok: false, reason: '当前武器无弹药可买' };
      if (w.reserve >= W[w.id].reserve) return { ok: false, reason: '弹药已满' };
      cost = W[w.id].ammoPrice;
    } else if (W[id]) {
      const w = W[id];
      if (w.team !== null && w.team !== p.team) return { ok: false, reason: '本阵营无法购买' };
      if (w.slot === 1 && p.weapons[1] && p.weapons[1].id === id) return { ok: false, reason: '已拥有该武器' };
      if (w.slot === 2 && p.weapons[2] && p.weapons[2].id === id) return { ok: false, reason: '已拥有该武器' };
      if (w.slot === 3) {
        // 手雷：每种最多一颗，共 3 颗
        if (!p.grenades) p.grenades = [];
        if (p.grenades.includes(id)) return { ok: false, reason: '已有该手雷' };
        if (p.grenades.length >= 3) return { ok: false, reason: '手雷已满（最多3颗）' };
      }
      cost = w.price;
    } else if (WPN.gear[id]) {
      const g = WPN.gear[id];
      if (g.team !== null && g.team !== p.team) return { ok: false, reason: '本阵营无法购买' };
      if (id === 'kevlar' && p.armor >= C.MAX_ARMOR) return { ok: false, reason: '已有防弹衣' };
      if (id === 'helmet' && p.helmet) return { ok: false, reason: '已有头盔' };
      if (id === 'helmet' && p.armor <= 0) return { ok: false, reason: '需先购买防弹衣' };
      if (id === 'defuse' && p.defuseKit) return { ok: false, reason: '已有拆弹器' };
      cost = g.price;
    } else {
      return { ok: false, reason: '未知物品' };
    }
    // 余额校验（修复钱包负数：先看钱再扣款）
    if (p.money < cost) return { ok: false, reason: '金钱不足（需 $' + cost + '）' };
    return { ok: true, cost };
  }

  applyBuy(p, id) {
    if (this.mode === 'dm') { // 死斗免费补满
      this.giveDMLoadout(p); return;
    }
    let cost = 0;
    if (id === 'ammo') {
      const w = p.weapons[p.curSlot];
      const def = W[w.id];
      w.reserve = def.reserve; cost = def.ammoPrice;
    } else if (W[id]) {
      const def = W[id];
      if (def.slot === 3) {
        // 手雷入背包（不覆盖匕首！），并激活为当前手雷
        if (!p.grenades) p.grenades = [];
        if (!p.grenades.includes(id)) p.grenades.push(id);
        p.weapons[4] = { id, mag: 1, reserve: 0 };
      } else {
        p.weapons[def.slot] = { id, mag: def.mag, reserve: def.reserve };
        if (def.slot === 1 || def.slot === 2) p.curSlot = def.slot;
      }
      cost = def.price;
    } else if (WPN.gear[id]) {
      cost = WPN.gear[id].price;
      if (id === 'kevlar') p.armor = C.MAX_ARMOR;
      if (id === 'helmet') p.helmet = true;
      if (id === 'defuse') p.defuseKit = true;
    }
    p.money = clamp(p.money - cost, 0, C.MAX_MONEY); // 双保险：扣款不越界
  }

  // ---------- 主循环 ----------
  tick() {
    const now = Date.now();
    const dt = C.DT;
    this.tickCount++;
    this.shots = [];
    this.events = [];

    if (this.phase === C.STATE_FREEZE) {
      this.timeLeft -= dt;
      this.players.forEach(p => {
        if (p.alive) { this.applyLook(p); this.historyPush(p); }
        p.in.jump = false;
        if (p.bot && p.brain) p.brain.update(dt);
      });
      this.processActions();
      if (this.timeLeft <= 0) {
        this.phase = C.STATE_LIVE;
        this.timeLeft = C.ROUND_TIME;
        this.emitEvent({ type: 'round', event: 'live', phase: this.phase, timeLeft: this.timeLeft });
      }
    } else if (this.phase === C.STATE_LIVE) {
      this.timeLeft -= dt;
      this.players.forEach(p => {
        if (p.alive) {
          if (p.bot && p.brain) p.brain.update(dt);
          else this.applyLook(p);
          MOV.step(p, p.in, dt);
          p.in.jump = false;
          this.historyPush(p);
          this.checkPickup(p);
        } else if ((this.mode === 'dm' || this.mode === 'armsrace') && !p.spectator && now >= p.respawnAt) {
          this.spawnPlayer(p);
          if (this.mode === 'armsrace') this.giveArmsLoadout(p);
        }
        // 观战
        if (!p.alive && p.spectator && !p.bot) {
          if (!p.spectateTarget || !this.players.get(p.spectateTarget) || !this.players.get(p.spectateTarget).alive) {
            p.spectateTarget = this.findSpectateTarget(p);
          }
        }
      });
      this.processActions();
      this.tickBomb(dt);
      this.tickNades(dt);
      this.tickSmokes(dt);
      this.tickHostages(dt);
      // 战利品箱 30 秒后过期消失（避免整回合残留）
      if (this.crates.length) {
        const now2 = Date.now();
        this.crates = this.crates.filter(c => now2 - c.born < 30000);
      }
      this.checkRoundEnd();
      if (this.timeLeft <= 0) {
        // 经典/军备：CT 胜；人质营救：时间到 T 胜（人质未获救）
        this.endRound(this.mode === 'hostage' ? 't' : 'ct', '时间到');
      }
    } else if (this.phase === C.STATE_END) {
      this.timeLeft -= dt;
      this.players.forEach(p => {
        if (p.alive) { MOV.step(p, p.in, dt); this.historyPush(p); }
        if (p.bot && p.brain) p.brain.update(dt);
      });
      this.tickNades(dt);
      this.tickSmokes(dt);
      this.processActions();
    }

    this.broadcastSnapshot();
    this.flushEvents();
  }

  applyLook(p) {
    // 人类玩家视角在 handleInput 中已更新；此处仅同步蹲伏状态
    p.crouch = !!p.in.crouch;
  }

  historyPush(p) {
    p.history.push({ t: this.tickCount, x: p.x, y: p.y, z: p.z, h: p.h });
    if (p.history.length > 40) p.history.shift();
  }

  // 处理边沿触发动作（射击/换弹/切枪）
  processActions() {
    const now = Date.now();
    this.players.forEach(p => {
      if (!p.alive) { this.clearEdges(p); return; }
      const inp = p.in;
      if (p.lootPressed) { this.tryLoot(p); p.lootPressed = false; }
      // 人质营救：按 E 带领人质
      if (inp.use && this.mode === 'hostage') this.tryLeadHostage(p);
      if (inp.slot) {
        const s = inp.slot;
        if (s === 4) {
          // 手雷：按 4 切换到手雷；连按在手雷间循环（高爆→闪光→烟雾）
          if (p.grenades && p.grenades.length) {
            if (p.weapons[4] && p.curSlot === 4) p.grenades.push(p.grenades.shift());
            p.weapons[4] = { id: p.grenades[0], mag: 1, reserve: 0 };
            p.curSlot = 4;
          }
        } else if (s >= 1 && s <= 5 && (p.weapons[s] || s === 3)) {
          p.curSlot = s;
        }
        p.scoped = 0; // 切枪收镜
        inp.slot = 0;
      }
      if (inp.reload) {
        this.startReload(p);
        inp.reload = false;
      }
      if (p.reloading && now >= p.reloadEnd) {
        const w = p.weapons[p.curSlot];
        if (w && W[w.id]) {
          const def = W[w.id];
          const need = def.mag - w.mag;
          const take = Math.min(need, w.reserve);
          w.mag += take; w.reserve -= take;
        }
        p.reloading = false;
      }
      const w = p.weapons[p.curSlot];
      if (!w) { p.firePressed = false; p.fireAltPressed = false; return; }
      if (p.fireAltPressed || inp.fireAlt) {
        // 右键：刀重击 / AWP 开镜切换；其他武器无动作（CS 风格）
        if (w.id === 'knife') this.fireWeapon(p, true);
        else if (w.id === 'awp' || (W[w.id] && W[w.id].scopeLevels)) this.toggleScope(p, W[w.id] ? W[w.id].scopeLevels : 2);
        p.fireAltPressed = false; inp.fireAlt = false;
        return;
      }
      const def = W[w.id];
      if (def && def.auto) {
        // 自动武器：按住连发
        if (inp.fire) this.fireWeapon(p, false);
        p.firePressed = false;
      } else {
        // 半自动：人类由击发边沿触发（一次点击一发）；Bot 由按住状态驱动（冷却限速）
        if (p.firePressed || (p.bot && inp.fire)) this.fireWeapon(p, false);
        p.firePressed = false;
      }
    });
  }

  clearEdges(p) {
    p.in.jump = false; p.in.reload = false; p.in.slot = 0; p.in.fire = false; p.in.fireAlt = false;
    p.firePressed = false; p.fireAltPressed = false; p.lootPressed = false;
  }

  startReload(p) {
    const w = p.weapons[p.curSlot];
    if (!w || w.id === 'knife' || w.id === 'bomb' || w.id === 'hegrenade') return;
    if (p.reloading) return;
    if (w.mag >= W[w.id].mag) return;
    if (w.reserve <= 0) return;
    p.reloading = true;
    p.reloadEnd = Date.now() + W[w.id].reload * 1000;
  }

  // ---------- 射击 ----------
  fireWeapon(p, alt) {
    const now = Date.now();
    if (this.phase === C.STATE_FREEZE || this.phase === C.STATE_END) return;
    if (!p.alive || p.reloading) return;
    const w = p.weapons[p.curSlot];
    if (!w) return;
    if (now < p.nextFire) return;
    if (w.id === 'knife') { this.knifeAttack(p, alt); return; }
    if (w.id === 'bomb') return;
    if (w.id === 'hegrenade' || w.id === 'flashbang' || w.id === 'smokegrenade') { this.throwNade(p); return; }
    const def = W[w.id];
    if (w.mag <= 0) return;
    w.mag--;
    p.nextFire = now + (1000 / def.rate);
    const hit = this.hitscan(p, w.id, def);
    // 曳光弹数据：[起点x,y,z, 武器, 阵营, yaw, pitch, 命中x,y,z, 命中类型 0空/1墙/2玩家, 受害者id]
    this.shots.push([
      +p.x.toFixed(2), +p.eye.toFixed(2), +p.z.toFixed(2),
      w.id, p.team, +p.yaw.toFixed(3), +p.pitch.toFixed(3),
      +hit.x.toFixed(1), +hit.y.toFixed(1), +hit.z.toFixed(1), hit.kind,
      hit.victim || 0
    ]);
  }

  aimDir(p, spread) {
    const yaw = p.yaw + (Math.random() - 0.5) * 2 * spread;
    const pitch = p.pitch + (Math.random() - 0.5) * 2 * spread;
    return {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch)
    };
  }

  hitscan(p, wid, def) {
    const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    const moveFrac = speed / C.RUN_SPEED;
    const jumpPen = p.onGround ? 0 : (def.spreadJump - def.spread);
    const bloom = Math.min(0.05, (Date.now() - (p.lastShot || 0) < 350 ? 0.012 : 0));
    let spread = def.spread + def.spreadMove * moveFrac + jumpPen + bloom + (p.in.crouch ? -0.003 : 0);
    if (p.scoped > 0 && (wid === 'awp' || (def.scopeLevels && def.scopeSpread !== undefined))) {
      spread = def.scopeSpread !== undefined ? def.scopeSpread : 0.0004; // 开镜精度拉满
    }
    p.lastShot = Date.now();
    const dir = this.aimDir(p, Math.max(0.001, spread));
    const ox = p.x, oy = p.eye, oz = p.z;
    const RANGE = 200;

    // 收集所有可能命中
    const hits = [];
    const now = this.tickCount;
    this.players.forEach(v => {
      if (v === p || !v.alive) return;
      const vt = now - Math.min(p.latency, 200) / (1000 / C.TICK);
      const pos = this.historyAt(v, vt);
      const parts = hitParts(pos, pos.h);
      let bestT = -1, bestPart = null;
      for (const part of parts) {
        const t = MAP.segBox(ox, oy, oz, dir.x, dir.y, dir.z, part);
        if (t >= 0 && t <= RANGE && (bestT < 0 || t < bestT)) { bestT = t; bestPart = part; }
      }
      if (bestT < 0) return;
      hits.push({ p: v, dist: bestT, part: bestPart });
    });
    hits.sort((a, b) => a.dist - b.dist);

    let result = null;
    for (const h of hits) {
      // 墙体穿透检测
      const wallHits = [];
      for (const wbox of MAP.walls) {
        const t = MAP.segBox(ox, oy, oz, dir.x, dir.y, dir.z, {
          x1: wbox.x1, y1: wbox.y1, z1: wbox.z1, x2: wbox.x2, y2: wbox.y2, z2: wbox.z2
        });
        if (t >= 0 && t < h.dist - 0.2) wallHits.push(t);
      }
      if (wallHits.length > 1) {
        // 被多面墙挡住：命中最近墙面
        wallHits.sort((a, b) => a - b);
        const t = wallHits[0];
        result = { x: ox + dir.x * t, y: oy + dir.y * t, z: oz + dir.z * t, kind: 1 };
        break;
      }
      const wallBang = wallHits.length === 1 ? (def.penetration !== undefined ? def.penetration : 0.55) : 1;
      this.applyDamage(h.p, p, def, h.part.mul, h.dist, wallBang, wid);
      result = { x: ox + dir.x * h.dist, y: oy + dir.y * h.dist, z: oz + dir.z * h.dist, kind: 2, victim: h.p.id };
      break; // 子弹只命中一人
    }
    if (!result) {
      // 未命中任何目标：找命中墙面或射程终点
      const rc = MAP.raycast(ox, oy, oz, dir.x, dir.y, dir.z, 60, 0.02);
      if (rc.blocked) {
        result = { x: ox + dir.x * rc.dist, y: oy + dir.y * rc.dist, z: oz + dir.z * rc.dist, kind: 1 };
      } else {
        result = { x: ox + dir.x * 60, y: oy + dir.y * 60, z: oz + dir.z * 60, kind: 0 };
      }
    }
    return result;
  }

  historyAt(p, tick) {
    const h = p.history;
    if (!h.length) return { x: p.x, y: p.y, z: p.z, h: p.h };
    let best = h[0];
    for (const e of h) if (Math.abs(e.t - tick) < Math.abs(best.t - tick)) best = e;
    return best;
  }

  // 开镜循环：2 档镜 0→1→2→0；1 档镜（AUG/G3/SG550）0↔1
  toggleScope(p, levels) {
    if (levels === 1) p.scoped = p.scoped ? 0 : 1;
    else p.scoped = (p.scoped + 1) % 3;
  }

  knifeAttack(p, alt) {
    const now = Date.now();
    const dmg = alt ? W.knife.dmgAlt : W.knife.dmg;
    p.nextFire = now + 1000 / W.knife.rate * (alt ? 1.4 : 1);
    const dir = this.aimDir(p, 0.02);
    let best = null, bestD = W.knife.range;
    this.players.forEach(v => {
      if (v === p || !v.alive) return;
      const dx = v.x - p.x, dy = (v.eye - p.eye), dz = v.z - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > bestD) return;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < 0.5) return;
      if (d < bestD) { bestD = d; best = v; }
    });
    if (best) {
      this.shots.push([p.x, p.eye, p.z, 'knife', p.team, +p.yaw.toFixed(3)]);
      this.applyDamage(best, p, W.knife, 1, bestD, 1, 'knife');
    }
  }

  applyDamage(victim, attacker, def, partMul, dist, wallBang, wid) {
    if (!victim.alive || victim.god) return;
    // CS 1.6 伤害模型：
    // 伤害 = 基础 × 距离衰减(rangeMod 每 9.525m) × 部位倍率 × 护甲穿透 × 穿墙系数
    let dmg = def.dmg * partMul;
    if (def.rangeMod && def.rangeMod !== 1) dmg *= Math.pow(def.rangeMod, dist / 9.525);
    if (wallBang < 1) dmg *= wallBang;
    const isHead = partMul >= 3.9;
    const isLegs = partMul <= 0.8;
    // 护甲：腿不吃护甲；头盔 = 头部命中同样受武器穿甲系数影响（1.6 模型）
    const armored = !isLegs && victim.armor > 0 && (!isHead || victim.helmet);
    if (armored) {
      const before = dmg;
      const pen = def.armorPen !== undefined ? def.armorPen : 0.5;
      dmg *= pen;
      const absorbed = before - dmg;
      victim.armor = Math.max(0, victim.armor - absorbed * 0.5);
    }
    dmg = Math.max(1, Math.round(dmg));
    victim.hp -= dmg;

    // 事件：命中者反馈
    if (attacker.ws) this.sendEvent(attacker, { type: 'hit', target: victim.id, dmg, head: isHead, weapon: wid });
    // 事件：受击反馈
    if (victim.ws) {
      const dx = victim.x - attacker.x, dz = victim.z - attacker.z;
      let ang = Math.atan2(dx, dz);
      const rel = ang - victim.yaw;
      this.sendEvent(victim, { type: 'damage', attacker: attacker.id, dmg, dir: rel, head: isHead });
    }
    if (victim.hp <= 0) this.kill(victim, attacker, wid, isHead);
  }

  kill(victim, killer, wid, headshot) {
    victim.alive = false;
    victim.deaths++;
    victim.in.fire = false;
    victim.planting = 0;
    if (victim.defusing > 0) victim.defusing = 0;
    killer.kills++;
    const teamKill = victim.team === killer.team;
    if (!teamKill) this.addMoney(killer, C.KILL_REWARD);
    else this.addMoney(killer, -C.KILL_REWARD);
    // C4 掉落
    if (this.bomb.carrier === victim) this.dropBomb(victim);
    // 掉落主武器状态保持，死亡失去武器（下回合重置）
    this.killfeed.unshift({ k: killer.id, kn: killer.name, v: victim.id, vn: victim.name, w: wid, h: headshot ? 1 : 0, kt: killer.team, vt: victim.team });
    if (this.killfeed.length > 6) this.killfeed.pop();
    this.emitEvent({ type: 'kill', killer: killer.id, victim: victim.id, weapon: wid, headshot: !!headshot, teamkill: teamKill });

    if (this.mode === 'dm' || this.mode === 'armsrace') {
      victim.respawnAt = Date.now() + (victim.bot ? 1500 : 2000);
    }
    // 连杀播报
    killer.streak = (killer.streak || 0) + 1;
    victim.streak = 0;
    if (STREAK_MSGS[killer.streak] && !teamKill) {
      this.emitEvent({ type: 'streak', id: killer.id, name: killer.name, streak: killer.streak });
    }
    // 死亡掉落战利品箱（经典/人质模式，3 秒后尸体位置生成）
    if ((this.mode === 'classic' || this.mode === 'hostage') && !teamKill) {
      const crateWeapons = {};
      if (victim.weapons[1]) { crateWeapons[1] = { id: victim.weapons[1].id, mag: victim.weapons[1].mag, reserve: victim.weapons[1].reserve }; }
      if (victim.weapons[2]) { crateWeapons[2] = { id: victim.weapons[2].id, mag: victim.weapons[2].mag, reserve: victim.weapons[2].reserve }; }
      const crateGrenades = (victim.grenades || []).slice();
      const crateMoney = victim.money;
      victim.money = 0;
      victim.weapons = {};
      const cx = victim.x, cz = victim.z;
      const g = this;
      setTimeout(() => {
        if (g.phase === C.STATE_END || g.phase === C.STATE_FREEZE) return; // 回合已结束不再生成
        g.crates.push({ id: NEXT_ID++, x: cx, y: 0, z: cz, weapons: crateWeapons, grenades: crateGrenades, money: crateMoney, born: Date.now() });
        g.emitEvent({ type: 'crate', event: 'drop', x: +cx.toFixed(1), z: +cz.toFixed(1) });
      }, 3000);
    }
    // 军备竞赛：击杀升级，匕首击杀降级对方，登顶夺冠
    if (this.mode === 'armsrace' && !teamKill) {
      killer.armsLevel = Math.min(ARMS_LADDER.length - 1, (killer.armsLevel || 0) + 1);
      if (wid === 'knife' && victim.armsLevel > 0) {
        victim.armsLevel = (victim.armsLevel || 0) - 1;
        this.giveArmsLoadout(victim);
      }
      if (killer.armsLevel >= ARMS_LADDER.length - 1) {
        this.emitEvent({ type: 'armswin', name: killer.name, id: killer.id });
        this.players.forEach(q => { q.armsLevel = 0; q.alive = true; q.spectator = false; this.spawnPlayer(q); this.giveArmsLoadout(q); });
      } else {
        this.giveArmsLoadout(killer);
      }
    }
  }

  // ---------- 手雷 ----------
  throwNade(p) {
    const w = p.weapons[4];
    const wid = w ? w.id : 'hegrenade';
    const dir = this.aimDir(p, 0);
    const sp = 13;
    this.nades.push({
      id: NEXT_ID++, type: wid,
      x: p.x + dir.x * 0.3, y: p.eye + dir.y * 0.3, z: p.z + dir.z * 0.3,
      vx: dir.x * sp + p.vx * 0.5, vy: dir.y * sp + 2.5, vz: dir.z * sp + p.vz * 0.5,
      fuse: 2.0, owner: p, team: p.team
    });
    // 消耗当前手雷，切换到下一颗（或收回武器）
    if (!p.grenades) p.grenades = [];
    p.grenades = p.grenades.filter(g => g !== wid);
    if (p.grenades.length) p.weapons[4] = { id: p.grenades[0], mag: 1, reserve: 0 };
    else delete p.weapons[4];
    p.curSlot = p.weapons[1] ? 1 : 2;
    p.scoped = 0;
    this.emitEvent({ type: 'nade', event: 'throw', owner: p.id, nadeType: wid });
  }

  tickNades(dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.fuse -= dt;
      n.vy -= C.GRAVITY * 0.55 * dt;
      // 移动与反弹
      for (let axis = 0; axis < 3; axis++) {
        const ax = ['x', 'y', 'z'][axis];
        n[ax] += n['v' + ax] * dt;
        for (const w of MAP.walls) {
          if (n.x > w.x1 - 0.08 && n.x < w.x2 + 0.08 && n.y > w.y1 - 0.08 && n.y < w.y2 + 0.08 && n.z > w.z1 - 0.08 && n.z < w.z2 + 0.08) {
            const v = 'v' + ax;
            n[v] = -n[v] * 0.45;
            if (axis === 1 && Math.abs(n.vy) < 2) n.vy = 0;
          }
        }
      }
      if (n.y < 0.06) { n.y = 0.06; n.vy = -n.vy * 0.4; n.vx *= 0.7; n.vz *= 0.7; if (Math.abs(n.vy) < 1) n.vy = 0; }
      if (n.fuse <= 0) {
        this.explode(n);
        this.nades.splice(i, 1);
      }
    }
  }

  explode(n) {
    this.emitEvent({ type: 'nade', event: 'explode', x: n.x, y: n.y, z: n.z, nadeType: n.type || 'hegrenade' });
    if (n.type === 'flashbang') { this.flashExplode(n); return; }
    if (n.type === 'smokegrenade') { this.smokeExplode(n); return; }
    // 高爆手雷
    const radius = W.hegrenade.blastRadius || 4.6;
    this.players.forEach(v => {
      if (!v.alive) return;
      const dx = v.x - n.x, dy = v.eye - n.y, dz = v.z - n.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) return;
      const los = MAP.losClear(n.x, n.y, n.z, v.x, v.eye, v.z, 0.15);
      let dmg = W.hegrenade.dmg * (1 - d / radius) * (los ? 1 : 0.45);
      dmg = Math.round(dmg);
      if (dmg <= 0) return;
      // CS 1.6：手雷无视护甲
      this.applyDamage(v, n.owner, { dmg: dmg, armorPen: 1 }, 1, d, 1, 'hegrenade');
    });
  }

  // 闪光弹：正对闪光且无遮挡的玩家致盲（视野白屏 + Bot 无法索敌）
  flashExplode(n) {
    const radius = W.flashbang.blastRadius || 12;
    const maxTime = W.flashbang.flashTime || 4;
    this.players.forEach(v => {
      if (!v.alive) return;
      const dx = v.x - n.x, dz = v.z - n.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > radius) return;
      if (!MAP.losClear(n.x, n.y, n.z, v.x, v.eye, v.z, 0.15)) return;
      // 面向角度：正对闪光 = 1，背对 = 0
      const facing = Math.atan2(-dx, -dz);
      const facingFactor = Math.max(0, Math.cos(angDiffWrap(v.yaw, facing)));
      const distFactor = Math.max(0, 1 - d / radius);
      const dur = 0.7 + maxTime * 0.75 * facingFactor * distFactor;
      if (dur < 0.35) return;
      v.blindUntil = Date.now() + dur * 1000;
      if (v.ws) this.sendEvent(v, { type: 'flash', duration: +dur.toFixed(1) });
    });
  }

  // 烟雾弹：生成烟团（阻挡 Bot 视线，持续约 14 秒）
  smokeExplode(n) {
    this.smokes.push({
      x: n.x, y: n.y, z: n.z,
      r: 1.2, maxR: W.smokegrenade.blastRadius || 4.2,
      born: Date.now(), life: (W.smokegrenade.smokeTime || 14) * 1000,
      growUntil: Date.now() + 2500
    });
  }

  // 烟雾是否阻挡两点间视线（Bot 感知用；子弹照常穿过）
  smokeBlocks(x1, y1, z1, x2, y2, z2) {
    for (const s of this.smokes) {
      if (segCircleDist(x1, z1, x2, z2, s.x, s.z) < s.r && Math.min(y1, y2) < 3.4) return true;
    }
    return false;
  }

  tickSmokes(dt) {
    const now = Date.now();
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      if (now - s.born > s.life) { this.smokes.splice(i, 1); continue; }
      if (now < s.growUntil) {
        const p = (now - s.born) / (s.growUntil - s.born);
        s.r = 1.2 + (s.maxR - 1.2) * Math.min(1, p);
      }
      // 轻微漂移
      s.x += Math.sin(now / 900 + i) * 0.002;
      s.z += Math.cos(now / 1100 + i) * 0.002;
    }
  }

  // ---------- C4 ----------
  checkPickup(p) {
    if (this.bomb.state !== C.BOMB_DROPPED) return;
    if (p.team !== C.TEAM_T) return;
    const dx = p.x - this.bomb.x, dz = p.z - this.bomb.z;
    if (dx * dx + dz * dz < 1.2 * 1.2) {
      this.bomb.state = C.BOMB_CARRIED;
      this.bomb.carrier = p;
      p.weapons[5] = { id: 'bomb', mag: 1, reserve: 0 };
      this.emitEvent({ type: 'bomb', event: 'pickup', carrier: p.id, name: p.name });
    }
  }

  dropBomb(p) {
    this.bomb.state = C.BOMB_DROPPED;
    this.bomb.carrier = null;
    this.bomb.x = p.x; this.bomb.y = 0; this.bomb.z = p.z;
    delete p.weapons[5];
    this.emitEvent({ type: 'bomb', event: 'drop', x: p.x, y: 0, z: p.z });
  }

  inSite(p) {
    for (const key of ['a', 'b']) {
      const s = MAP.sites[key];
      const dx = p.x - s.plant.x, dz = p.z - s.plant.z;
      if (dx * dx + dz * dz <= s.radius * s.radius) return s;
    }
    return null;
  }

  tickBomb(dt) {
    // 埋包/拆包进度
    this.players.forEach(p => {
      if (!p.alive) return;
      if (p.in.use) {
        if (p.team === C.TEAM_T && this.bomb.state === C.BOMB_CARRIED && this.bomb.carrier === p) {
          const s = this.inSite(p);
          if (s && this.phase === C.STATE_LIVE) {
            if (p.planting === 0) { p.plantX = p.x; p.plantZ = p.z; }
            const moved = (p.x - p.plantX) * (p.x - p.plantX) + (p.z - p.plantZ) * (p.z - p.plantZ) > 0.4;
            if (moved) p.planting = 0;
            else {
              p.planting += dt;
              if (p.planting >= C.PLANT_TIME) {
                this.bomb.state = C.BOMB_PLANTED;
                this.bomb.carrier = null;
                this.bomb.x = p.x; this.bomb.y = 0; this.bomb.z = p.z;
                this.bomb.site = s.letter;
                this.bomb.timeLeft = C.BOMB_TIME;
                delete p.weapons[5];
                this.addMoney(p, C.PLANT_REWARD);
                this.emitEvent({ type: 'bomb', event: 'plant', site: s.letter, planter: p.id, name: p.name });
              }
            }
          }
        } else if (p.team === C.TEAM_CT && this.bomb.state === C.BOMB_PLANTED) {
          const dx = p.x - this.bomb.x, dz = p.z - this.bomb.z;
          if (dx * dx + dz * dz < 1.7 * 1.7) {
            const need = p.defuseKit ? C.DEFUSE_TIME_KIT : C.DEFUSE_TIME;
            p.defusing += dt;
            if (p.defusing >= need) {
              this.bomb.state = C.BOMB_HIDDEN;
              this.addMoney(p, C.KILL_REWARD);
              this.emitEvent({ type: 'bomb', event: 'defuse', defuser: p.id, name: p.name });
              this.endRound('ct', 'C4 已拆除');
            }
          } else p.defusing = 0;
        }
      } else {
        if (p.planting > 0) p.planting = 0;
        if (p.defusing > 0) p.defusing = 0;
      }
    });
    // 爆炸倒计时
    if (this.bomb.state === C.BOMB_PLANTED) {
      this.bomb.timeLeft -= dt;
      if (this.bomb.timeLeft <= 0) {
        this.bomb.state = C.BOMB_HIDDEN;
        this.emitEvent({ type: 'bomb', event: 'explode', x: this.bomb.x, y: 0, z: this.bomb.z });
        // 爆炸伤害
        this.players.forEach(v => {
          if (!v.alive) return;
          const dx = v.x - this.bomb.x, dz = v.z - this.bomb.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < 14) {
            const los = MAP.losClear(this.bomb.x, 1, this.bomb.z, v.x, v.eye, v.z, 0.15);
            const dmg = Math.round(220 * (1 - d / 14) * (los ? 1 : 0.4));
            if (dmg > 0) this.applyDamage(v, { id: 0, name: 'C4', team: C.TEAM_T, ws: null }, { dmg: dmg, armorPen: 1 }, 1, d, 1, 'bomb');
          }
        });
        this.endRound('t', 'C4 爆炸');
      }
    }
  }

  checkRoundEnd() {
    if (this.mode !== 'classic' && this.mode !== 'hostage') return;
    let tAlive = 0, ctAlive = 0, tMembers = 0, ctMembers = 0;
    this.players.forEach(p => {
      if (p.team === C.TEAM_T) { tMembers++; if (p.alive) tAlive++; }
      else { ctMembers++; if (p.alive) ctAlive++; }
    });
    // 某一方完全没有玩家时不判负（等待加入/Bot）
    if (tMembers === 0 || ctMembers === 0) return;
    if (this.mode === 'hostage') {
      // 人质营救：CT 全灭 → T 胜（人质获救由 tickHostages 判定）
      if (ctAlive === 0) this.endRound('t', 'CT 全灭');
      return;
    }
    if (this.bomb.state === C.BOMB_PLANTED) {
      if (ctAlive === 0) this.endRound('t', 'CT 全灭');
      return;
    }
    if (tAlive === 0) this.endRound('ct', 'T 全灭');
    else if (ctAlive === 0) this.endRound('t', 'CT 全灭');
  }

  findSpectateTarget(p) {
    let best = null;
    this.players.forEach(v => { if (v.alive && v.team === p.team) best = v; });
    if (!best) this.players.forEach(v => { if (v.alive) best = v; });
    return best ? best.id : null;
  }

  // ---------- 网络 ----------
  send(ws, obj) {
    if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ } }
  }

  sendEvent(p, ev) { if (p && p.ws) this.send(p.ws, { t: 'event', ev }); }

  emitEvent(ev) { this.players.forEach(p => { if (p.ws) this.send(p.ws, { t: 'event', ev }); }); }

  flushEvents() { this.events = []; }

  roster() {
    const list = [];
    this.players.forEach(p => list.push({
      id: p.id, name: p.name, team: p.team, bot: !!p.bot, kills: p.kills, deaths: p.deaths,
      alive: p.alive, latency: Math.round(p.latency)
    }));
    return list;
  }

  broadcastRoster() {
    this.players.forEach(p => { if (p.ws) this.send(p.ws, { t: 'roster', players: this.roster() }); });
  }

  snapshot() {
    const pl = [];
    this.players.forEach(p => {
      const w = p.weapons[p.curSlot];
      pl.push([
        p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2),
        +p.yaw.toFixed(3), +p.pitch.toFixed(3),
        p.hp, Math.round(p.armor), p.team, p.alive ? 1 : 0,
        w ? w.id : '', w ? w.mag : 0, w ? w.reserve : 0,
        p.money, p.kills, p.deaths, p.name,
        p.crouch ? 1 : 0, p.bot ? 1 : 0, p.reloading ? 1 : 0,
        p.helmet ? 1 : 0, p.defuseKit ? 1 : 0,
        this.bomb.state === C.BOMB_CARRIED && this.bomb.carrier === p ? 1 : 0,
        +p.planting.toFixed(2), +p.defusing.toFixed(2),
        p.ackSeq, +p.vx.toFixed(2), +p.vz.toFixed(2), p.spectator ? 1 : 0, p.scoped || 0,
        this.mode === 'armsrace' ? (p.armsLevel || 0) : 0
      ]);
    });
    return {
      t: 'snap', tick: this.tickCount, phase: this.phase, timeLeft: +this.timeLeft.toFixed(1),
      round: this.round, scores: [this.scores.t, this.scores.ct], mode: this.mode,
      players: pl,
      bomb: [this.bomb.state, +this.bomb.x.toFixed(1), +this.bomb.y.toFixed(1), +this.bomb.z.toFixed(1),
        this.bomb.timeLeft !== null ? +this.bomb.timeLeft.toFixed(1) : C.BOMB_TIME,
        this.bomb.site || '', this.bomb.carrier ? this.bomb.carrier.id : 0],
      nades: this.nades.map(n => [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2), n.type || 'hegrenade']),
      smokes: this.smokes.map(s => [+s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1), +s.r.toFixed(1)]),
      hostages: this.hostages.map(h => [h.id, +h.x.toFixed(1), 0, +h.z.toFixed(1), +h.yaw.toFixed(2), h.state === 'follow' ? 1 : 0, h.leader ? h.leader.id : 0]),
      rescued: this.rescued,
      armsLadder: ARMS_LADDER,
      crates: this.crates.map(c => [c.id, +c.x.toFixed(1), 0, +c.z.toFixed(1),
        c.weapons[1] ? c.weapons[1].id : '', c.weapons[2] ? c.weapons[2].id : '',
        c.grenades.length, c.money]),
      shots: this.shots,
      killfeed: this.killfeed
    };
  }

  broadcastSnapshot() {
    const snap = this.snapshot();
    this.players.forEach(p => {
      if (p.ws) this.send(p.ws, snap);
    });
  }
}

function roundEndText(winner, reason) {
  if (winner === 't') return '回合结束：恐怖分子获胜（' + reason + '）';
  return '回合结束：反恐精英获胜（' + reason + '）';
}

// 命中部位盒子：返回 [box, ...] 每个带 mul
function hitParts(pos, h) {
  const r = C.PLAYER_R;
  const scale = h / C.PLAYER_H;
  return [
    { mul: 4, x1: pos.x - r, y1: pos.y + 1.44 * scale, z1: pos.z - r, x2: pos.x + r, y2: pos.y + h, z2: pos.z + r },
    { mul: 1.25, x1: pos.x - r, y1: pos.y + 1.0 * scale, z1: pos.z - r, x2: pos.x + r, y2: pos.y + 1.44 * scale, z2: pos.z + r },
    { mul: 1, x1: pos.x - r, y1: pos.y + 0.58 * scale, z1: pos.z - r, x2: pos.x + r, y2: pos.y + 1.0 * scale, z2: pos.z + r },
    { mul: 0.75, x1: pos.x - r, y1: pos.y, z1: pos.z - r, x2: pos.x + r, y2: pos.y + 0.58 * scale, z2: pos.z + r }
  ];
}

module.exports = Game;
