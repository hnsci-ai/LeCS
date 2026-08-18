// test/newguns.js — 新增 15 把武器的购买、阵营限制、伤害与开镜
'use strict';
process.env.PORT = '8070';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor(name) {
    this.seq = 0; this.last = null; this.msgs = []; this.waits = [];
    this.ws = new WebSocket('ws://127.0.0.1:8070');
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
    const m = await this.wait(x => x.t === 'joined', 5000, 'joined');
    this.code = m.code;
  }
  dev(cmd, extra) { this.send(Object.assign({ t: 'dev', cmd }, extra || {})); }
  me() { return this.last ? this.last.players.find(p => p[0] === this.id) : null; }
  fireAlt() {
    this.send({ t: 'input', seq: ++this.seq, keys: { fireAlt: true }, yaw: 0, pitch: 0, tClient: Date.now() });
    this.send({ t: 'input', seq: ++this.seq, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() });
  }
}

(async () => {
  console.log('== 1. 武器定义完整性 ==');
  const W = require('../shared/weapons').W;
  const NEW_GUNS = ['p228', 'fiveseven', 'elites', 'tmp', 'mac10', 'ump45', 'p90', 'galil', 'famas', 'sg552', 'aug', 'scout', 'g3sg1', 'sg550', 'm249'];
  const allOk = NEW_GUNS.every(id => W[id] && W[id].dmg > 0 && W[id].mag > 0 && W[id].price > 0);
  check(allOk, '15 把新武器定义完整（伤害/弹匣/价格）');

  console.log('== 2. 购买与阵营限制 ==');
  const t = new Client('T军火商');
  await t.join('t');
  await t.wait(m => m.t === 'snap' && m.phase === 'freeze', 20000, 'freeze');
  t.dev('money', { amount: 16000 });
  await sleep(300);
  // T 能买：galil / sg552 / g3sg1 / m249 / p228 / scout / p90 / ump45 / elites / mac10
  const tOk = ['galil', 'sg552', 'g3sg1', 'm249', 'p228', 'scout', 'p90', 'ump45', 'elites', 'mac10'];
  for (const g of tOk) { t.send({ t: 'buy', id: g }); await sleep(120); }
  t.send({ t: 'buy', id: 'famas' }); await sleep(300);  // CT 专属 → 拒绝
  t.send({ t: 'buy', id: 'fiveseven' }); await sleep(300); // CT 专属 → 拒绝
  const tMe = t.me();
  console.log('  T 购买后余额: $' + tMe[13] + ' 主武器: ' + tMe[10]);
  check(tMe[13] >= 0 && tMe[13] < 3000, 'T 购买新武器成功且扣款（余额 $' + tMe[13] + '）');
  check(tMe[10] !== 'famas' && tMe[10] !== 'fiveseven', '阵营限制有效（T 买不到 FAMAS/Five-SeveN）');

  // CT 专属可买
  const ct = new Client('CT军火商');
  await ct.join('ct', t.code);
  await sleep(400);
  ct.dev('money', { amount: 16000 });
  await sleep(300);
  for (const g of ['famas', 'aug', 'sg550', 'fiveseven', 'tmp']) { ct.send({ t: 'buy', id: g }); await sleep(120); }
  const ctMe = ct.me();
  check(ctMe[10] === 'tmp' || ctMe[10] === 'sg550' || ctMe[10] === 'aug' || ctMe[10] === 'famas', 'CT 专属武器可购买');

  console.log('== 3. 新枪伤害抽查 ==');
  await t.wait(m => m.t === 'snap' && m.phase === 'live', 30000, 'live');
  // scout 打身体：75 → 剩 25 血
  t.dev('give', { weapon: 'scout' });
  ct.dev('tp', { x: -2, z: -2 });
  t.dev('tp', { x: -6, z: -2 });
  ct.dev('hp', { hp: 100 });
  await sleep(500);
  t.send({ t: 'input', seq: ++t.seq, keys: { fire: true }, yaw: Math.atan2(-4, 0), pitch: -0.18, tClient: Date.now() });
  await sleep(120);
  t.send({ t: 'input', seq: ++t.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: -0.18, tClient: Date.now() });
  await sleep(600);
  const hpS = ct.me()[6];
  console.log('  Scout 身体: hp=' + hpS);
  check(hpS >= 24 && hpS <= 27, 'Scout 身体 ~74 伤害（剩 ' + hpS + ' 血，含距离衰减）');

  // m249 打身体（无甲）4 发击杀：32×4=128
  ct.dev('hp', { hp: 100 });
  ct.dev('tp', { x: -2, z: -2 });
  t.dev('give', { weapon: 'm249' });
  await sleep(400);
  for (let i = 0; i < 4; i++) {
    t.send({ t: 'input', seq: ++t.seq, keys: { fire: true }, yaw: Math.atan2(-4, 0), pitch: -0.12, tClient: Date.now() });
    await sleep(140);
    t.send({ t: 'input', seq: ++t.seq, keys: {}, yaw: Math.atan2(-4, 0), pitch: -0.12, tClient: Date.now() });
    await sleep(200);
  }
  const aliveM = ct.me()[9];
  console.log('  M249 4 发后存活:', aliveM);
  check(aliveM === 0, 'M249 4 发身体击杀（32×4）');

  console.log('== 4. 新枪开镜档位 ==');
  ct.dev('revive', {});
  await t.wait(m => m.t === 'snap' && m.phase === 'live' && m.round >= 2, 20000, '回合2 live');
  await sleep(500);
  t.dev('give', { weapon: 'aug' });
  await sleep(400);
  t.fireAlt(); await sleep(300);
  const aug1 = t.me()[29];
  t.fireAlt(); await sleep(300);
  const aug2 = t.me()[29];
  console.log('  AUG 开镜: 1档=' + aug1 + ' 再按=' + aug2);
  check(aug1 === 1 && aug2 === 0, 'AUG 单档镜：0→1→0 ✓');

  t.dev('give', { weapon: 'scout' });
  await sleep(400);
  t.fireAlt(); await sleep(300);
  const sc1 = t.me()[29];
  t.fireAlt(); await sleep(300);
  const sc2 = t.me()[29];
  console.log('  Scout 开镜: 1档=' + sc1 + ' 2档=' + sc2);
  check(sc1 === 1 && sc2 === 2, 'Scout 双档镜：0→1→2 ✓');

  console.log('== 5. 购买菜单显示（浏览器）==');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8070', { waitUntil: 'networkidle' });
  await page.fill('#nick', '菜单检查');
  await page.fill('#botcount', '0');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1200);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(500);
  await page.keyboard.press('KeyB');
  await sleep(500);
  const menuInfo = await page.evaluate(() => ({
    sections: document.querySelectorAll('.buy-sec').length,
    items: document.querySelectorAll('.buy-item').length
  }));
  console.log('  购买菜单: ' + menuInfo.sections + ' 个分类 / ' + menuInfo.items + ' 个物品');
  check(menuInfo.sections >= 7 && menuInfo.items >= 28, '菜单包含全部新武器分类与物品（' + menuInfo.sections + '类/' + menuInfo.items + '件）✓');
  check(errors.length === 0, '无 JS 错误');
  await browser.close();

  console.log(failures === 0 ? '\n=== 新枪测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
