// test/recoil.js — 服务器权威后坐力：连射枪口爬升、停火回落、换枪重置
'use strict';
process.env.PORT = '8074';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { WebSocket } = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor(name) {
    this.seq = 0; this.msgs = [];
    this.ws = new WebSocket('ws://127.0.0.1:8074');
    this.ws.on('message', raw => { try { this.msgs.push(JSON.parse(raw.toString())); } catch (e) { /* ignore */ } });
    this.ready = new Promise(res => this.ws.on('open', res));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  dev(cmd, extra) { this.send(Object.assign({ t: 'dev', cmd }, extra || {})); }
  async join(team, code) {
    await this.ready;
    this.send({ t: 'join', name: this.name, team, mode: 'classic', code });
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      await sleep(200);
      const j = this.msgs.find(m => m.t === 'joined');
      if (j) return j;
    }
    throw new Error('join 超时');
  }
  hyOf(wid) {
    return this.msgs.filter(m => m.t === 'snap')
      .flatMap(m => (m.shots || []).filter(s => s[3] === wid).map(s => s[8]));
  }
}

(async () => {
  const a = new Client('枪手'), b = new Client('靶子');
  const ja = await a.join('t');
  await b.join('ct', ja.code);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    await sleep(300);
    if (a.msgs.some(m => m.t === 'snap' && m.phase === 'live')) break;
  }
  a.dev('give', { weapon: 'ak47' });
  b.dev('god', {});
  a.dev('tp', { x: -12, z: -2 });
  b.dev('tp', { x: -6, z: -2 }); // 6 米正前方
  await sleep(500);

  console.log('== 1. 连射爬升 ==');
  const t1 = Date.now();
  while (Date.now() - t1 < 650) { // AK 9.1 发/秒 → 约 6 发
    a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
    await sleep(30);
  }
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(400);
  const hys = a.hyOf('ak47');
  console.log('  命中高度序列:', hys.map(v => v.toFixed(2)).join(', '));
  const raw = a.msgs.filter(m => m.t === 'snap').flatMap(m => (m.shots || []).filter(s => s[3] === 'ak47'));
  console.log('  原始 shots:', raw.map(s => 'y=' + s[8] + ' pitch=' + s[6] + ' kind=' + s[10]).join(' | '));
  check(hys.length >= 4, '连射产生 ≥4 发命中（' + hys.length + '）');
  check(hys[hys.length - 1] > hys[0] + 0.05, '连射后期弹着点明显爬升（' + hys[0].toFixed(2) + ' → ' + hys[hys.length - 1].toFixed(2) + '）');

  console.log('== 2. 停火回落 ==');
  await sleep(2200); // 后坐力 1.6/s 衰减
  a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(60);
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(400);
  const hys2 = a.hyOf('ak47');
  const lastHy = hys2[hys2.length - 1];
  console.log('  停火后单发高度:', lastHy.toFixed(2), '（首发射高', hys[0].toFixed(2), '）');
  check(Math.abs(lastHy - hys[0]) < 0.06, '停火 2 秒后枪口回落到初始高度');

  console.log('== 3. 换枪重置 ==');
  a.dev('give', { weapon: 'usp' });
  await sleep(300);
  a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(60);
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(400);
  const uspHys = a.hyOf('usp');
  console.log('  换枪后 USP 首发高度:', (uspHys[0] || 0).toFixed(2));
  check(uspHys.length >= 1 && Math.abs(uspHys[0] - 1.62) < 0.1, '换枪后 USP 首发回到基准高度（无残留爬升）');

  console.log(failures === 0 ? '\n=== 后坐力测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
