// test/bot-reload.js — Bot 换弹验证：打空弹匣后自动换弹
'use strict';
process.env.PORT = '8082';
process.env.ALLOW_DEV = '1';
require('../server/index');
const WebSocket = require('ws');
const URL = 'ws://127.0.0.1:8082';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor() {
    this.seq = 0; this.last = null; this.msgs = []; this.waits = [];
    this.ws = new WebSocket(URL);
    this.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
      if (m.t === 'snap') this.last = m;
      if (m.t === 'joined') this.id = m.id;
      for (let i = this.waits.length - 1; i >= 0; i--) {
        const w = this.waits[i];
        if (w.pred(m)) { this.waits.splice(i, 1); clearTimeout(w.timer); w.resolve(m); }
      }
    });
    this.ready = new Promise(res => this.ws.on('open', res));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, timeout, label) {
    for (const m of this.msgs) if (pred(m)) return Promise.resolve(m);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('超时: ' + label)), timeout || 8000);
      this.waits.push({ pred, resolve, timer });
    });
  }
  async join(team) {
    await this.ready;
    this.send({ t: 'join', name: '观察员', team, mode: 'classic' });
    await this.wait(m => m.t === 'joined', 5000, 'joined');
  }
  botIds() {
    if (!this.last) return [];
    return this.last.players.filter(p => p[18] === 1).map(p => p[0]);
  }
}

(async () => {
  console.log('== Bot 换弹测试 ==');
  const obs = new Client();
  await obs.join('t');
  obs.send({ t: 'addbot', diff: 'normal' });
  obs.send({ t: 'addbot', diff: 'normal' });
  await sleep(800);
  const bots = obs.botIds();
  check(bots.length === 2, '2 个 Bot 已加入');

  await obs.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  // 两个 bot 发 Glock（20 发）+ 双方无敌 + 12 米面对面互射：
  // 谁也打不死谁 → 持续开火打空弹匣 → 必然触发换弹
  for (const id of bots) {
    obs.send({ t: 'dev', cmd: 'give', id, weapon: 'glock' });
    obs.send({ t: 'dev', cmd: 'armor', id, armor: 100, helmet: true });
    obs.send({ t: 'dev', cmd: 'god', id });
  }
  obs.send({ t: 'dev', cmd: 'tp', id: bots[0], x: -10, z: 4 });
  obs.send({ t: 'dev', cmd: 'tp', id: bots[1], x: 2, z: 4 });
  await sleep(300);

  // 观察 60 秒：任一 bot 出现 reloading 状态（弹匣 0 → 换弹）
  let sawReload = false;
  let sawLowMag = false;
  for (let i = 0; i < 120 && !sawReload; i++) {
    await sleep(500);
    if (!obs.last) continue;
    for (const p of obs.last.players) {
      if (p[18] === 1) {
        if (p[19] === 1) sawReload = true;   // 换弹中
        if (p[11] === 0) sawLowMag = true;   // 打空
      }
    }
  }
  console.log('  观察到打空弹匣:', sawLowMag, '· 观察到换弹:', sawReload);
  check(sawLowMag, 'Bot 会持续开火直到打空弹匣');
  check(sawReload, 'Bot 打空后自动换弹 ✓ 关键修复');

  console.log(failures === 0 ? '\n=== Bot 换弹测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
