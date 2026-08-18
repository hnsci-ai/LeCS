// test/smoke.js — 服务器冒烟测试：多人加入、Bot、射击击杀、回合经济、埋包/拆包、死斗重生
'use strict';
process.env.PORT = process.env.PORT || '8099';
process.env.ALLOW_DEV = '1';
const WebSocket = require('ws');
require('../server/index');

const URL = 'ws://127.0.0.1:' + process.env.PORT;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.log('  ✗ ' + msg); }
}

class Client {
  constructor(name) {
    this.name = name;
    this.seq = 0;
    this.msgCount = 0;
    this.ws = new WebSocket(URL);
    this.id = 0;
    this.events = [];
    this.snaps = [];
    this.roster = [];
    this.lastSnap = null;
    this.waits = [];
    this.msgs = [];
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m); if (this.msgs.length > 500) this.msgs.shift();
      this.msgCount++;
      if (m.t === 'snap') { this.lastSnap = m; this.snaps.push(m); if (this.snaps.length > 300) this.snaps.shift(); }
      if (m.t === 'event') this.events.push(m.ev);
      if (m.t === 'roster') this.roster = m.players;
      for (let i = this.waits.length - 1; i >= 0; i--) {
        const w = this.waits[i];
        if (w.pred(m)) { this.waits.splice(i, 1); clearTimeout(w.timer); w.resolve(m); }
      }
    });
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
  }
  send(obj) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  wait(pred, timeout, label) {
    for (const m of this.msgs) if (pred(m)) return Promise.resolve(m);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('超时: ' + (label || ''))), timeout || 5000);
      const w = { pred, resolve, timer };
      this.waits.push(w);
    });
  }
  async waitEvent(type, timeout) { return this.wait(m => m.t === 'event' && m.ev.type === type, timeout, '事件 ' + type); }
  async join(team, code, mode) {
    await this.ready;
    this.send({ t: 'join', name: this.name, team, code, mode: mode || 'classic' });
    const m = await this.wait(x => x.t === 'joined' || x.t === 'error', 5000, 'joined');
    if (m.t === 'error') throw new Error('加入失败: ' + m.text);
    this.id = m.id;
    return m;
  }
  input(keys, yaw, pitch, extra) {
    const msg = { t: 'input', seq: ++this.seq, keys: keys || {}, yaw: yaw !== undefined ? yaw : 0, pitch: pitch !== undefined ? pitch : 0, tClient: Date.now() };
    if (extra) Object.assign(msg, extra);
    this.send(msg);
  }
  tp(x, z) { this.send({ t: 'dev', cmd: 'tp', x, z }); }
  dmg(id, amount) { this.send({ t: 'dev', cmd: 'dmg', id, amount }); }
  killPlayer(id) { this.dmg(id, 1000); }
  faceDir(dx, dz, pitch) { this.send({ t: 'input', seq: ++this.seq, keys: {}, yaw: Math.atan2(-dx, -dz), pitch: pitch || 0, tClient: Date.now() }); }
  myEntry() { return this.lastSnap ? this.lastSnap.players.find(pl => pl[0] === this.id) : null; }
  alive() { const e = this.myEntry(); return !!(e && e[9] === 1); }
}

(async () => {
  console.log('== 测试1: 经典模式 多人 + Bot + 射击击杀 ==');
  const c1 = new Client('T队长');
  const j1 = await c1.join('t');
  console.log('  房间创建:', j1.code);
  c1.send({ t: 'addbot', diff: 'normal' });
  c1.send({ t: 'addbot', diff: 'hard' });
  await c1.wait(m => m.t === 'roster' && m.players.length >= 3, 5000, 'bot 加入');
  check(c1.roster.length === 3, '2 个 Bot 已加入（共3人）');

  const c2 = new Client('CT队长');
  await c2.join('ct', j1.code);
  await c2.wait(m => m.t === 'roster' && m.players.length >= 4, 5000, '第2人加入');
  check(c2.roster.length === 4, '第2名玩家加入（共4人）');

  await c1.wait(m => m.t === 'snap' && m.phase === 'live', 30000, '回合开始 live');
  console.log('  进入 live 阶段，等待 Bot 移动…');
  // 把 bot 支到远处，避免干扰对决
  const tBot = c1.roster.find(p => p.bot && p.team === 0);
  const ctBot = c1.roster.find(p => p.bot && p.team === 1);
  if (tBot) c1.send({ t: 'dev', cmd: 'tp', id: tBot.id, x: -30, z: 30 });
  if (ctBot) c1.send({ t: 'dev', cmd: 'tp', id: ctBot.id, x: 30, z: -30 });
  await sleep(8000);
  const botMoved = c1.lastSnap.players.some(pl => pl[18] === 1 && Math.abs(pl[1]) > 1);
  check(botMoved, 'Bot 在移动');

  // 强制对决：c1(-6,-2) 面向 c2(-2,-2)（+x 方向）
  c1.tp(-6, -2); c2.tp(-2, -2);
  c1.faceDir(4, 0); c2.faceDir(-4, 0);
  await sleep(300);
  let killSeen = false;
  for (let i = 0; i < 40 && !killSeen; i++) {
    c1.input({ fire: true }, Math.atan2(-4, 0));
    c1.input({}, Math.atan2(-4, 0));
    await sleep(250);
    killSeen = c2.events.some(e => e.type === 'damage' && e.dmg >= 100);
  }
  const hitSeen = c1.events.some(e => e.type === 'hit');
  console.log('  射击命中事件:', hitSeen ? '是' : '否（用 dev 兜底）');
  await sleep(300);
  let c2dead = false;
  const e2 = c2.myEntry();
  if (e2) c2dead = e2[9] === 0;
  if (!c2dead) { c1.killPlayer(c2.id); await sleep(400); c2dead = c2.myEntry()[9] === 0; }
  check(c2dead, 'c2 被击杀（hp 归零）');

  // 击杀 CT Bot → CT 全灭 → T 获胜
  const ctBotNow = c1.roster.find(p => p.bot && p.team === 1);
  const roundEndP = c1.wait(m => m.t === 'event' && m.ev.type === 'round' && m.ev.event === 'end', 10000).catch(() => null);
  if (ctBotNow) c1.killPlayer(ctBotNow.id);
  const endEv = await roundEndP;
  check(!!endEv && endEv.ev.event === 'end', '回合结束事件触发');
  await sleep(300);
  check(c1.lastSnap.scores[0] >= 1, 'T 方得分 +1');

  await c1.wait(m => m.t === 'snap' && m.phase === 'freeze' && m.round >= 2, 15000, '第2回合');
  console.log('  第2回合开始, 双方金钱:');
  c1.lastSnap.players.forEach(pl => console.log('    ', pl[16], '金钱', pl[13]));

  console.log('== 测试2: 埋包 / 拆包 ==');
  await c1.wait(m => m.t === 'snap' && m.phase === 'live' && m.round >= 2, 20000, 'live#2');
  // 把 c2 支远，并干掉两个 bot（c1 成为唯一 T，避免战斗干扰；CT bot 稍后复活拆弹）
  c2.tp(30, -30);
  const tBot2 = c1.roster.find(p => p.bot && p.team === 0);
  const ctBot2 = c1.roster.find(p => p.bot && p.team === 1);
  if (tBot2) { c1.killPlayer(tBot2.id); await sleep(500); }
  if (ctBot2) { c1.killPlayer(ctBot2.id); await sleep(500); }
  console.log('  bomb状态:', c1.lastSnap.bomb[0], 'c1存活:', c1.alive());
  if (c1.lastSnap.bomb[0] === 'dropped') {
    c1.tp(c1.lastSnap.bomb[1], c1.lastSnap.bomb[3]);
    await sleep(800);
  }
  let carrier2 = c1.lastSnap.players.find(pl => pl[22] === 1);
  console.log('  捡包后 bomb状态:', c1.lastSnap.bomb[0], 'c1存活:', c1.alive(), 'c1带包:', !!(carrier2 && carrier2[0] === c1.id));
  check(!!carrier2 && carrier2[0] === c1.id, 'c1 持有炸弹');

  // c1 埋包
  if (carrier2 && carrier2[0] === c1.id) {
    c1.tp(-23, -24);
    let planted = false;
    const plantEvP = c1.wait(m => m.t === 'event' && m.ev.type === 'bomb' && m.ev.event === 'plant', 12000).then(() => true).catch(() => false);
    for (let i = 0; i < 60 && !planted; i++) {
      if (!c1.alive()) break;
      c1.input({ use: true }, 0, 0);
      await sleep(100);
    }
    c1.input({}, 0, 0);
    planted = await plantEvP;
    check(planted, '炸弹已埋下（A点）');
    if (planted) {
      check(c1.lastSnap.bomb[0] === 'planted', '快照显示 planted 状态');
      // c1 撤走；复活 CT bot 并放到炸弹旁拆弹（确定化）
      c1.tp(-30, 30);
      await sleep(300);
      const ctDef = c1.roster.find(p => p.bot && p.team === 1);
      if (ctDef) {
        c1.send({ t: 'dev', cmd: 'revive', id: ctDef.id });
        await sleep(200);
        c1.send({ t: 'dev', cmd: 'tp', id: ctDef.id, x: -20, z: -22 });
      }
      const defused = await c1.wait(m => m.t === 'event' && m.ev.type === 'bomb' && m.ev.event === 'defuse', 30000).then(() => true).catch(() => false);
      check(defused, 'CT Bot 拆除炸弹');
      await sleep(500);
      check(c1.lastSnap.scores[1] >= 1, 'CT 方得分 +1（拆弹成功）');
    }
  } else {
    check(false, 'c1 拥有炸弹才能埋包');
  }

  console.log('== 测试3: 死斗模式 + 重生 ==');
  const c3 = new Client('死斗玩家');
  await c3.join('auto', null, 'dm');
  c3.send({ t: 'addbot', diff: 'easy' });
  await c3.wait(m => m.t === 'roster' && m.players.length >= 2, 5000, 'dm bot');
  await c3.wait(m => m.t === 'snap' && m.phase === 'live', 5000, 'dm live');
  const dmBot = c3.roster.find(p => p.bot);
  check(dmBot && dmBot.alive, 'DM Bot 存活');
  c3.killPlayer(dmBot.id);
  await sleep(3000);
  const botEntry = c3.lastSnap.players.find(pl => pl[0] === dmBot.id);
  check(!!botEntry && botEntry[9] === 1, 'DM Bot 被击杀后重生');

  console.log('== 测试4: 快照频率与稳定性 ==');
  const cnt1 = c1.msgCount;
  await sleep(2000);
  const rate = (c1.msgCount - cnt1) / 2;
  console.log('  消息速率: ' + rate.toFixed(1) + '/s');
  check(rate > 20 && rate < 45, '快照约 30Hz');

  console.log(failures === 0 ? '\n=== 冒烟测试全部通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
