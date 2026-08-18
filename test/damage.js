// test/damage.js — CS 1.6 真实伤害数值验证
// 场景：4 米面对面，命中部位可控（爆头 / 腿 / 身体），护甲开关
'use strict';
process.env.PORT = '8083';
process.env.ALLOW_DEV = '1';
require('../server/index');
const WebSocket = require('ws');
const URL = 'ws://127.0.0.1:8083';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor(name) {
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
  async join(team, code) {
    await this.ready;
    this.send({ t: 'join', name: this.name, team, mode: 'classic', code });
    const m = await this.wait(m2 => m2.t === 'joined', 5000, 'joined');
    this.code = m.code;
  }
  dev(cmd, extra) { this.send(Object.assign({ t: 'dev', cmd }, extra || {})); }
  me() { return this.last.players.find(p => p[0] === this.id); }
  async fire(pitch, holdMs) {
    const h = holdMs === undefined ? 80 : holdMs;
    this.send({ t: 'input', seq: ++this.seq, keys: { fire: true }, yaw: Math.atan2(-4, 0), pitch: pitch || 0, tClient: Date.now() });
    await sleep(h);
    this.send({ t: 'input', seq: ++this.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: pitch || 0, tClient: Date.now() });
  }
}

// 摆放：射手 (-6,-2) 目标 (-2,-2)，yaw=-π/2 朝 +x；pitch 决定命中部位
const PITCH_HEAD = 0;        // 1.62m 眼睛线 → 头部
const PITCH_LEG = -0.4;      // 4m 处 y≈0.06 → 腿部

async function setup(gun) {
  const a = new Client('枪手'), b = new Client('靶子');
  await a.join('t');
  await b.join('ct', a.code);
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  a.dev('give', { weapon: gun });
  a.dev('tp', { x: -6, z: -2 });
  b.dev('tp', { x: -2, z: -2 });
  b.dev('hp', { hp: 100 });
  await sleep(400);
  return { a, b };
}

(async () => {
  console.log('== CS 1.6 伤害模型验证（4 米距离）==');

  // 1. AK 爆头无头盔：36×4 = 144 → 秒杀
  {
    const { a, b } = await setup('ak47');
    await a.fire(PITCH_HEAD);
    await sleep(400);
    const hp = b.me()[6], alive = b.me()[9];
    console.log(`  AK 爆头(无盔): hp=${hp} 存活=${alive}`);
    check(!alive, 'AK 爆头无头盔 = 144 → 一枪击杀 ✓');
    a.dev('dmg', { id: b.id, amount: 0 }); // no-op 保持连接
  }

  // 2. AK 爆头有头盔：36×4×0.75 = 108 → 仍秒杀
  {
    const { a, b } = await setup('ak47');
    b.dev('armor', { armor: 100, helmet: true });
    await sleep(300);
    await a.fire(PITCH_HEAD);
    await sleep(400);
    const hp = b.me()[6], alive = b.me()[9];
    console.log(`  AK 爆头(头盔): hp=${hp} 存活=${alive}`);
    check(!alive, 'AK 爆头戴头盔 = 108 → 一枪击杀 ✓');
  }

  // 3. M4 爆头有头盔：32×4×0.7 = 90 → 不死（剩 10）
  {
    const { a, b } = await setup('m4a1');
    b.dev('armor', { armor: 100, helmet: true });
    await sleep(300);
    await a.fire(PITCH_HEAD);
    await sleep(400);
    const hp = b.me()[6], alive = b.me()[9];
    console.log(`  M4 爆头(头盔): hp=${hp} 存活=${alive}`);
    check(alive && hp >= 8 && hp <= 12, 'M4 爆头戴头盔 ≈ 90 → 需两枪 ✓');
  }

  // 4. 沙鹰 爆头有头盔：54×4×0.75 = 162 → 秒杀
  {
    const { a, b } = await setup('deagle');
    b.dev('armor', { armor: 100, helmet: true });
    await sleep(300);
    await a.fire(PITCH_HEAD);
    await sleep(400);
    check(!b.me()[9], '沙鹰爆头戴头盔 = 162 → 秒杀 ✓');
  }

  // 5. AWP 打身体（护甲）：115×0.99 ≈ 114 → 秒杀
  {
    const { a, b } = await setup('awp');
    b.dev('armor', { armor: 100, helmet: true });
    await sleep(300);
    await a.fire(0.18); // 故意打头顶放空第一枪
    await sleep(400);
    // AWP 拉栓冷却 1.35s，等待后补一发打胸口
    await sleep(1400);
    b.dev('hp', { hp: 100 });
    await a.fire(-0.12);
    await sleep(400);
    const hp = b.me()[6], alive = b.me()[9];
    console.log(`  AWP 身体(护甲): hp=${hp} 存活=${alive}`);
    check(!alive, 'AWP 打身体穿护甲 ≈ 114 → 一枪击杀 ✓');
  }

  // 6. AWP 打腿：115×0.75 ≈ 86 → 不死
  {
    const { a, b } = await setup('awp');
    await a.fire(PITCH_LEG);
    await sleep(400);
    const hp = b.me()[6], alive = b.me()[9];
    console.log(`  AWP 打腿: hp=${hp} 存活=${alive}`);
    check(alive && hp >= 12 && hp <= 18, 'AWP 打腿 ≈ 86 → 剩血不死 ✓');
  }

  // 7. Glock 打身体有护甲：25×0.5 ≈ 12-13/枪 → 4 枪 50 血左右
  {
    const { a, b } = await setup('glock');
    b.dev('armor', { armor: 100, helmet: false });
    await sleep(300);
    for (let i = 0; i < 4; i++) { await a.fire(-0.12); await sleep(300); }
    const hp = b.me()[6];
    console.log(`  Glock 4 枪(护甲): hp=${hp}`);
    check(hp >= 44 && hp <= 54, 'Glock 身体穿甲 ≈ 13/枪 → 4 枪约 48 ✓');
  }

  // 8. 匕首伤害（轻击 25 / 重击 50，冷却不同：轻 0.5s / 重 1s）
  {
    const { a, b } = await setup('knife');
    a.dev('tp', { x: -6, z: -2 });
    b.dev('tp', { x: -4.6, z: -2 }); // 1.4m 贴身
    await sleep(300);
    // 左键轻击：25 伤害 → 剩 75 血存活
    a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(100);
    a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(400);
    const hp1 = b.me()[6], alive1 = b.me()[9];
    console.log(`  匕首轻击: hp=${hp1} 存活=${alive1}`);
    check(alive1 === 1 && hp1 === 75, '左键轻击 25 伤害（剩 75 血）');
    await sleep(700); // 轻击冷却 0.5s / 重击冷却 1s 均已过
    // 右键重击：50 伤害 → 75-50=25 存活
    a.send({ t: 'input', seq: ++a.seq, keys: { fireAlt: true }, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(100);
    a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(500);
    const hp2 = b.me()[6], alive2 = b.me()[9];
    console.log(`  匕首重击: hp=${hp2} 存活=${alive2}`);
    check(alive2 === 1 && hp2 === 25, '右键重击 50 伤害（半血，剩 25 血）');
    // 再补一刀轻击击杀（25 → 0）
    await sleep(700);
    a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(100);
    a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(500);
    const alive3 = b.me()[9];
    console.log(`  补刀后存活=${alive3}`);
    check(alive3 === 0, '轻击补刀击杀 ✓');
  }

  // 9. 匕首无视护甲（CS 1.6 规则：刀伤不吃护甲减伤，穿甲也恒定 25/50）
  {
    const { a, b } = await setup('knife');
    a.dev('tp', { x: -6, z: -2 });
    b.dev('tp', { x: -4.6, z: -2 });
    b.dev('armor', { armor: 100, helmet: true });
    b.dev('hp', { hp: 100 });
    await sleep(300);
    a.send({ t: 'input', seq: ++a.seq, keys: { fireAlt: true }, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(100);
    a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: 0, tClient: Date.now() });
    await sleep(500);
    const hp = b.me()[6], armorLeft = b.me()[7];
    console.log(`  重击(穿防弹衣): hp=${hp} 护甲=${armorLeft}`);
    check(hp === 50, '重击无视护甲 = 50 伤害（穿防弹衣也是半血）');
    check(armorLeft === 100, '刀伤不消耗护甲耐久');
  }

  console.log(failures === 0 ? '\n=== 伤害数值测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
