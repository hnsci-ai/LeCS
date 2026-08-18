// test/play.js — 「真人模拟器」：走真实输入通道完整打一局人机对战
// 模拟人类玩家：买枪 → 索敌 → 走位 → 开枪 → 埋包，与 Bot 真刀真枪打几回合
'use strict';
const WebSocket = require('ws');
const URL = process.env.URL || 'ws://127.0.0.1:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TEAM_NAMES = ['T(恐怖分子)', 'CT(反恐精英)'];
const WNAME = { knife: '匕首', usp: 'USP', glock: 'Glock', deagle: '沙鹰', mp5: 'MP5', ak47: 'AK-47', m4a1: 'M4A1', awp: 'AWP', hegrenade: '手雷', bomb: 'C4' };

class Player {
  constructor(name, team) {
    this.seq = 0;
    this.last = null;
    this.events = [];
    this.kills = 0;
    this.deaths = 0;
    this.roundEnds = 0;
    this.boughtRound = 0;
    this.reloading = false;
    this.ws = new WebSocket(URL);
    this.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'snap') this.last = m;
      if (m.t === 'event') this.events.push(m.ev);
      if (m.t === 'joined') this.id = m.id;
      if (m.t === 'roster') this.roster = m.players;
    });
    this.ready = new Promise(res => this.ws.on('open', res));
    this.team = team;
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  input(keys, yaw, pitch) {
    this.send({ t: 'input', seq: ++this.seq, keys, yaw, pitch, tClient: Date.now() });
  }
  me() { return this.last ? this.last.players.find(p => p[0] === this.id) : null; }
  alive() { const m = this.me(); return !!(m && m[9] === 1); }
  buy(id) { this.send({ t: 'buy', id }); }

  // 瞄准目标（目标位置 → 视角）
  aimAt(tx, tz, ty) {
    const m = this.me();
    if (!m) return;
    const dx = tx - m[1], dz = tz - m[3];
    const yaw = Math.atan2(-dx, -dz);
    const dist = Math.sqrt(dx * dx + dz * dz);
    const pitch = Math.atan2((ty || 1.5) - (m[2] + 1.62), dist);
    return { yaw, pitch, dist };
  }
}

function findNearestEnemy(me, snap) {
  let best = null, bd = 1e9;
  for (const p of snap.players) {
    if (p[0] === me.id || p[9] !== 1 || p[8] === me.team) continue;
    const d = Math.hypot(p[1] - me.x, p[3] - me.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

(async () => {
  console.log('════════ 人机对战 · 现场战报 ════════');
  console.log('玩家「我」加入恐怖分子阵营，3 个 Bot 陪练\n');
  const me = new Player('我', 't');
  await me.ready;
  me.send({ t: 'join', name: '我', team: 't', mode: 'classic' });
  await sleep(800);
  me.send({ t: 'addbot', diff: 'normal' });
  me.send({ t: 'addbot', diff: 'easy' });
  me.send({ t: 'addbot', diff: 'hard' });
  await sleep(800);
  console.log('房间人数:', me.roster ? me.roster.length : '?', '（我 + 3 Bot）');

  // 处理事件日志
  let lastEvCount = 0;
  function drainEvents() {
    const fresh = me.events.slice(lastEvCount);
    lastEvCount = me.events.length;
    for (const ev of fresh) {
      if (ev.type === 'kill' && ev.killer === me.id) {
        const w = WNAME[ev.weapon] || ev.weapon;
        console.log(`  ☠ 我击杀了 ${ev.victim === me.id ? '自己' : '敌人'}（${w}${ev.headshot ? ' 爆头' : ''}）`);
        me.kills++;
      }
      if (ev.type === 'kill' && ev.victim === me.id) {
        console.log(`  ✝ 我被击杀了`);
        me.deaths++;
      }
      if (ev.type === 'round' && ev.event === 'end') {
        me.roundEnds++;
        console.log(`  🏁 回合${ev.round}结束: ${ev.winner === 't' ? 'T 胜' : 'CT 胜'}（${ev.reason}）比分 ${ev.scores.t}:${ev.scores.ct}`);
      }
      if (ev.type === 'bomb' && ev.event === 'plant') console.log('  💣 C4 已安放！');
      if (ev.type === 'bomb' && ev.event === 'explode') console.log('  💥 C4 爆炸！');
      if (ev.type === 'bomb' && ev.event === 'defuse') console.log('  🛠 C4 被拆除');
    }
  }

  const start = Date.now();
  let strafeDir = 1, strafeFlip = 0, plantSite = 'a';
  const SITE = { a: { x: -23, z: -24 }, b: { x: 23, z: 24 } };

  while (Date.now() - start < 180000 && me.roundEnds < 3) {
    await sleep(120);
    const snap = me.last;
    if (!snap || !me.id) continue;
    drainEvents();
    const m = snap.players.find(p => p[0] === me.id);
    if (!m) continue;
    const myState = { x: m[1], z: m[3], hp: m[6], alive: m[9] === 1, mag: m[11], weapon: m[10], money: m[13], hasBomb: m[22] === 1, team: m[8], crouch: m[17] === 1, reloading: m[19] === 1 };

    // 冻结期：买装备
    if (snap.phase === 'freeze' && myState.alive && me.boughtRound !== snap.round) {
      me.boughtRound = snap.round;
      const plan = [];
      if (myState.money >= 650) plan.push('kevlar');
      if (myState.money >= 1000) plan.push('helmet');
      if (myState.money >= 2500) plan.push('ak47');
      else if (myState.money >= 1500) plan.push('mp5');
      else if (myState.money >= 400) plan.push('deagle');
      plan.push('ammo');
      for (const id of plan) { me.buy(id); await sleep(150); }
      me.send({ t: 'input', seq: ++me.seq, keys: {}, yaw: 0, pitch: 0, slot: 1, tClient: Date.now() });
      console.log(`  🛒 回合${snap.round} 购买: ${plan.join(', ')}（余额 $${myState.money}）`);
      continue;
    }
    if (!myState.alive) continue;

    // 换弹
    if (!myState.reloading && myState.mag <= 5 && myState.weapon !== 'knife') {
      me.input({ reload: true }, 0, 0);
      await sleep(1200);
      continue;
    }

    const enemy = findNearestEnemy(m, snap);
    let keys = {};
    let yaw = 0, pitch = 0;

    if (myState.hasBomb) {
      // 带包：直奔 A 点埋包
      const s = SITE[plantSite];
      const a = me.aimAt(s.x, s.z, 1.5);
      const dx = s.x - myState.x, dz = s.z - myState.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 3.5) {
        keys = { use: true }; // 埋包
      } else {
        keys = { f: true };
        if (enemy && a.dist < 20) keys.fire = true; // 路上见敌就打
      }
      yaw = a.yaw; pitch = a.pitch;
    } else if (enemy) {
      // 索敌 → 走位 → 开火
      const a = me.aimAt(enemy[1], enemy[3], 1.5);
      yaw = a.yaw; pitch = a.pitch;
      if (a.dist < 25) {
        keys.f = true;
        if (a.dist < 18 && !myState.reloading) keys.fire = true;
        // 蛇形走位
        strafeFlip++;
        if (strafeFlip % 7 === 0) strafeDir *= -1;
        keys[strafeDir === 1 ? 'r' : 'l'] = true;
      } else {
        keys.f = true;
      }
    } else {
      // 无敌人：向 A 点游走
      const s = SITE[plantSite];
      const a = me.aimAt(s.x, s.z, 1.5);
      keys = { f: true };
      yaw = a.yaw; pitch = 0;
    }
    me.input(keys, yaw, pitch);
  }

  drainEvents();
  const final = me.last;
  const m = final ? final.players.find(p => p[0] === me.id) : null;
  console.log('\n════════ 战报总结 ════════');
  console.log('我的战绩:', m ? `击杀 ${m[14]} / 死亡 ${m[15]}` : `${me.kills} / ${me.deaths}`, '· 金钱', m ? '$' + m[13] : '-');
  console.log('比分: T', final ? final.scores[0] : 0, ':', final ? final.scores[1] : 0, 'CT');
  console.log('当前回合:', final ? final.round : '-', final ? (final.phase === 'live' ? '交战中' : final.phase) : '');
  const bots = final ? final.players.filter(p => p[18] === 1) : [];
  if (bots.length) {
    console.log('Bot 战绩:');
    for (const b of bots) console.log(`  ${b[16]}: 击杀 ${b[14]} / 死亡 ${b[15]}`);
  }
  process.exit(0);
})().catch(e => { console.error('对局异常:', e); process.exit(1); });
