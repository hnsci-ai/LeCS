// test/buy-economy.js — 购买余额校验（钱包不为负）+ 幸存者回合开始自动补弹
'use strict';
process.env.PORT = '8085';
process.env.ALLOW_DEV = '1';
require('../server/index');
const WebSocket = require('ws');
const URL = 'ws://127.0.0.1:8085';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor(name) {
    this.seq = 0;
    this.last = null;
    this.events = [];
    this.waits = [];
    this.msgs = [];
    this.ws = new WebSocket(URL);
    this.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m); if (this.msgs.length > 400) this.msgs.shift();
      if (m.t === 'snap') this.last = m;
      if (m.t === 'event') this.events.push(m.ev);
      if (m.t === 'joined') this.id = m.id;
      for (let i = this.waits.length - 1; i >= 0; i--) {
        const w = this.waits[i];
        if (w.pred(m)) { this.waits.splice(i, 1); clearTimeout(w.timer); w.resolve(m); }
      }
    });
    this.ready = new Promise(res => this.ws.on('open', res));
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  wait(pred, timeout, label) {
    for (const m of this.msgs) if (pred(m)) return Promise.resolve(m);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('超时: ' + (label || ''))), timeout || 8000);
      this.waits.push({ pred, resolve, timer });
    });
  }
  async join(team, code) {
    await this.ready;
    this.send({ t: 'join', name: this.name || '买家', team, mode: 'classic', code });
    const m = await this.wait(x => x.t === 'joined' || x.t === 'error', 5000, 'joined');
    if (m.t === 'error') throw new Error(m.text);
    this.id = m.id;
    this.code = m.code;
    return m;
  }
  buy(id) { this.send({ t: 'buy', id }); }
  dev(cmd, extra) { this.send(Object.assign({ t: 'dev', cmd }, extra || {})); }
  me() { return this.last ? this.last.players.find(p => p[0] === this.id) : null; }
}

(async () => {
  console.log('== 1. 购买余额校验 ==');
  const a = new Client('买家A');
  await a.join('t');
  await sleep(400);
  // b 在冻结期加入（正常出生，避免中途观战干扰回合判定）
  const b = new Client('买家B');
  await b.join('ct', a.code);
  await sleep(400);
  const money0 = a.me()[13];
  console.log('  初始金钱: $' + money0);

  // 买防弹衣 650 → 剩 150
  a.buy('kevlar'); await sleep(300);
  const m1 = a.me()[13];
  check(m1 === money0 - 650, '防弹衣扣款正确（$' + m1 + '）');

  // 钱不够买沙鹰（650）：应拒绝且余额不变
  a.buy('deagle'); await sleep(300);
  let me = a.me();
  check(me[13] === m1 && me[10] !== 'deagle', '余额不足拒绝购买（余额 $' + me[13] + ' 不变）');

  // 弹药已满时购买被拒绝（出生时备弹全满）
  a.buy('ammo'); await sleep(300);
  me = a.me();
  check(me[13] === m1, '弹药已满时购买被拒绝（余额 $' + me[13] + ' 不变）');

  // 等 live：打 1 发 + 换弹消耗备弹，再买弹药应扣款 30
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: 0, pitch: 0, tClient: Date.now() });
  await sleep(150);
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() });
  await sleep(400);
  a.send({ t: 'input', seq: ++a.seq, keys: { reload: true }, yaw: 0, pitch: 0, tClient: Date.now() });
  await sleep(2800); // glock 换弹 2.2s
  a.buy('ammo'); await sleep(300);
  me = a.me();
  console.log('  消耗备弹后买弹药: 余额 $' + me[13] + ' 备弹 ' + me[12]);
  check(me[13] === m1 - 30 && me[12] === 120, '备弹不足时购买弹药扣款 $30 并补满');

  console.log('== 2. 大额购买 + 刷单不产生负数 ==');
  a.dev('money', { amount: 16000 });
  await sleep(300);
  // 疯狂连买 25 件
  const items = ['kevlar', 'helmet', 'ak47', 'awp', 'ak47', 'awp', 'deagle', 'hegrenade', 'ammo', 'm4a1', 'kevlar', 'helmet', 'ammo'];
  for (let round = 0; round < 2; round++) for (const id of items) { a.buy(id); await sleep(60); }
  await sleep(500);
  me = a.me();
  console.log('  连买后余额: $' + me[13]);
  check(me[13] >= 0, '钱包不为负（$' + me[13] + '）✓ 关键修复');
  // T 不能买 m4a1
  check(me[10] !== 'm4a1', '阵营限制有效（T 买不到 M4A1）');

  console.log('== 3. 幸存者回合开始自动补弹 ==');
  // 给 a 发沙鹰（7 发弹匣）
  a.dev('give', { weapon: 'deagle' });
  await sleep(400);
  // 等 live 开 3 枪（弹匣 7→4）
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  for (let i = 0; i < 3; i++) {
    a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: 0, pitch: 0, tClient: Date.now() });
    await sleep(150);
    a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() });
    await sleep(200);
  }
  await sleep(400);
  let meA = a.me();
  console.log('  开 3 枪后弹匣: ' + meA[11] + '（应为 4）');
  check(meA[11] === 4, '沙鹰 7-3=4 发');
  // 击杀 b → 回合结束（a 幸存）
  a.dev('dmg', { id: b.id, amount: 1000 });
  await sleep(600);
  // 等第 2 回合 freeze
  await a.wait(m => m.t === 'snap' && m.round >= 2 && m.phase === 'freeze', 15000, '回合2');
  await sleep(500);
  meA = a.me();
  console.log('  回合2 a 的武器: ' + meA[10] + ' 弹匣: ' + meA[11] + ' 备弹: ' + meA[12]);
  check(meA[10] === 'deagle' && meA[11] === 7 && meA[12] === 35, '幸存者回合开始自动补满弹药 ✓ 关键修复');

  // 阵亡者 b 应重置为默认手枪
  const bMe = b.me();
  check(bMe[10] === 'usp' && bMe[11] === 12, '阵亡者重置为默认 USP 满弹匣');

  console.log(failures === 0 ? '\n=== 购买/补弹测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
