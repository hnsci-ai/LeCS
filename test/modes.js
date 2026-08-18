// test/modes.js — 人质营救 + 军备竞赛 + 连杀播报
'use strict';
process.env.PORT = '8071';
process.env.ALLOW_DEV = '1';
require('../server/index');
const WebSocket = require('ws');
const URL = 'ws://127.0.0.1:8071';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor(name) {
    this.seq = 0; this.last = null; this.events = []; this.msgs = []; this.waits = [];
    this.ws = new WebSocket(URL);
    this.ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      this.msgs.push(m);
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
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, timeout, label) {
    for (const m of this.msgs) if (pred(m)) return Promise.resolve(m);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('超时: ' + label)), timeout || 8000);
      this.waits.push({ pred, resolve, timer });
    });
  }
  async join(team, code, mode) {
    await this.ready;
    this.send({ t: 'join', name: this.name, team, mode: mode || 'classic', code });
    const m = await this.wait(x => x.t === 'joined' || x.t === 'error', 5000, 'joined');
    if (m.t === 'error') throw new Error(m.text);
    this.code = m.code;
  }
  dev(cmd, extra) { this.send(Object.assign({ t: 'dev', cmd }, extra || {})); }
  me() { return this.last ? this.last.players.find(p => p[0] === this.id) : null; }
  use(hold) { this.send({ t: 'input', seq: ++this.seq, keys: { use: hold }, yaw: 0, pitch: 0, tClient: Date.now() }); }
}

(async () => {
  console.log('== 1. 人质营救模式 ==');
  const a = new Client('救援队长');   // CT
  const b = new Client('恐怖守卫');   // T
  await a.join('ct', null, 'hostage');
  await b.join('t', a.code, 'hostage');
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  check((a.last.hostages || []).length === 4, '4 名人质已刷新');

  // CT 走到每名人质旁按 E 带领
  const spots = [[-25, -30], [-17, -22], [25, 26], [20, 19]];
  let follows = 0;
  for (const [x, z] of spots) {
    a.dev('tp', { x: x + 1.2, z });
    await sleep(300);
    a.use(true); await sleep(300); a.use(false);
    await sleep(300);
    if (a.events.some(e => e.type === 'hostage' && e.event === 'follow')) follows++;
  }
  check(follows === 4, '4 名人质全部被带领（follow 事件×' + follows + '）');
  check((a.last.hostages || []).every(h => h[5] === 1), '人质均处于跟随状态');

  // 带人质回营救区（CT 出生区）→ 人质沿路径跟随后获救 → CT 胜
  a.dev('tp', { x: 26, z: -26 });
  // 人质寻路跟随，等待其走到营救区（最多 30 秒）
  let rescuedAt = 0;
  for (let i = 0; i < 60 && (a.last.hostages || []).length > 0; i++) {
    await sleep(500);
    if (a.last.rescued > rescuedAt) { rescuedAt = a.last.rescued; console.log('  已救出:', rescuedAt); }
  }
  check(a.last.rescued === 4, '4 名人质全部获救（' + a.last.rescued + '/4）');
  check((a.last.hostages || []).length === 0, '人质列表已清空');
  check(a.last.scores[1] >= 1, 'CT 方得分 +1（营救获胜）');

  console.log('== 2. 军备竞赛（枪王模式）==');
  const c = new Client('枪手甲'), d = new Client('枪手乙');
  await c.join('t', null, 'armsrace');
  await d.join('ct', c.code, 'armsrace');
  await c.wait(m => m.t === 'snap' && m.phase === 'live', 10000, 'live');
  await sleep(500);
  const lv0 = c.me()[30], w0 = c.me()[10];
  console.log('  起始等级:', lv0, '武器:', w0);
  check(lv0 === 0 && w0 === 'knife', '军备竞赛起始为匕首');

  // c 击杀 d → 升级到 glock
  c.dev('dmg', { id: d.id, amount: 1000 });
  await sleep(800);
  const lv1 = c.me()[30], w1 = c.me()[10];
  console.log('  击杀后等级:', lv1, '武器:', w1);
  check(lv1 === 1 && w1 === 'glock', '击杀升级 → Glock ✓');

  // 连续击杀直至登顶（25 级阶梯，最终刀战在 24 级）→ 夺冠重置
  let winSeen = false, tmpSeen = false;
  for (let i = 0; i < 30 && !winSeen; i++) {
    // 等待 d 复活（军备竞赛 2 秒复活）
    for (let k = 0; k < 30; k++) {
      const de = d.me();
      if (de && de[9] === 1) break;
      await sleep(200);
    }
    c.dev('dmg', { id: d.id, amount: 1000 });
    await sleep(600);
    // 第 8 杀后应是 MAC-10（新枪已入阶梯）
    if (i === 6) {
      const w7 = c.me()[10], lv7 = c.me()[30];
      console.log('  第8级:', lv7, w7);
      if (lv7 === 8 && w7 === 'mac10') tmpSeen = true;
    }
    if (c.events.some(e => e.type === 'armswin')) winSeen = true;
  }
  check(tmpSeen, '新枪已入阶梯（第 9 把为 MAC-10）✓ 关键修复');
  check(winSeen, '杀穿 25 级后触发夺冠（armswin 事件）');
  await sleep(800);
  const lvReset = c.me()[30];
  check(lvReset === 0, '夺冠后全员重置回匕首（等级 ' + lvReset + '）✓');

  console.log('== 3. 连杀播报 ==');
  const e = new Client('连杀王'), f = new Client('陪练');
  await e.join('t', null, 'classic');
  await f.join('ct', e.code, 'classic');
  await e.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  e.dev('god', {});
  const streakEvents = [];
  for (let i = 0; i < 3; i++) {
    await sleep(300);
    f.dev('revive', {});
    f.dev('hp', { hp: 100 });
    await sleep(300);
    e.dev('dmg', { id: f.id, amount: 1000 });
    await sleep(500);
    streakEvents.push(...e.events.filter(ev => ev.type === 'streak'));
  }
  const has3 = streakEvents.some(ev => ev.streak === 3);
  console.log('  连杀事件:', JSON.stringify(streakEvents.map(ev => ev.streak)));
  check(has3, '3 连杀触发播报 ✓');

  console.log(failures === 0 ? '\n=== 新模式测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
