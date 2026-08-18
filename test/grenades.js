// test/grenades.js — 手雷系统：三种手雷购买/背包、4 键循环切换、闪光致盲、烟雾生成、键盘切枪
'use strict';
process.env.PORT = '8073';
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
    this.seq = 0; this.last = null; this.events = []; this.msgs = []; this.waits = [];
    this.ws = new WebSocket('ws://127.0.0.1:8073');
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
  async join(team, code) {
    await this.ready;
    this.send({ t: 'join', name: this.name, team, mode: 'classic', code });
    const m = await this.wait(x => x.t === 'joined', 5000, 'joined');
    this.code = m.code;
  }
  dev(cmd, extra) { this.send(Object.assign({ t: 'dev', cmd }, extra || {})); }
  me() { return this.last ? this.last.players.find(p => p[0] === this.id) : null; }
  slot(s) { this.send({ t: 'input', seq: ++this.seq, keys: {}, yaw: 0, pitch: 0, slot: s, tClient: Date.now() }); }
}

(async () => {
  console.log('== 1. 三种手雷购买与背包 ==');
  const a = new Client('掷弹手'), b = new Client('目标');
  await a.join('t'); await b.join('ct', a.code);
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  a.dev('money', { amount: 16000 });
  await sleep(300);
  for (const g of ['hegrenade', 'flashbang', 'smokegrenade']) { a.send({ t: 'buy', id: g }); await sleep(250); }
  a.send({ t: 'buy', id: 'flashbang' }); await sleep(300); // 重复购买应被拒
  const money = a.me()[13];
  console.log('  三颗手雷购买后余额: $' + money);
  check(money === 16000 - 300 - 200 - 300, '三颗手雷扣款正确（重复购买被拒）');

  // 匕首仍在（修复高爆覆盖匕首的 bug）
  a.slot(3); await sleep(400);
  check(a.me()[10] === 'knife', '按 3 切匕首正常（手雷不覆盖匕首）✓');

  console.log('== 2. 按 4 在手雷间循环 ==');
  const seq = [];
  for (let i = 0; i < 5; i++) { a.slot(4); await sleep(350); seq.push(a.me()[10]); }
  console.log('  按4序列:', JSON.stringify(seq));
  check(seq[0] === 'hegrenade' && seq[1] === 'flashbang' && seq[2] === 'smokegrenade' && seq[3] === 'hegrenade' && seq[4] === 'flashbang',
    '4 键循环切换手雷（高爆→闪光→烟雾→…）✓');

  console.log('== 3. 闪光弹致盲 ==');
  // 摆位：a(-4,0) 面向 b(0,0)，b 面向 a
  a.dev('tp', { x: -4, z: 0 });
  b.dev('tp', { x: 0, z: 0 });
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  b.send({ t: 'input', seq: ++b.seq, keys: {}, yaw: Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(300);
  // 切到闪光弹（当前循环位置在 flashbang 或继续按直到）
  for (let i = 0; i < 4 && a.me()[10] !== 'flashbang'; i++) { a.slot(4); await sleep(350); }
  check(a.me()[10] === 'flashbang', '当前手持闪光弹');
  // 向下低抛（pitch -0.9）：雷在目标面前 1-3 米落地爆炸，目标正对闪光
  b.events = [];
  a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: -Math.PI / 2, pitch: -0.9, tClient: Date.now() });
  await sleep(100);
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: -Math.PI / 2, pitch: -0.9, tClient: Date.now() });
  await sleep(3500);
  const flashEv = b.events.find(e => e.type === 'flash');
  console.log('  闪光事件:', JSON.stringify(flashEv));
  check(!!flashEv && flashEv.duration > 0.3, '正对闪光的玩家被致盲（' + (flashEv ? flashEv.duration + 's' : '无') + '）✓');

  console.log('== 4. 烟雾弹生成烟团 ==');
  for (let i = 0; i < 4 && a.me()[10] !== 'smokegrenade'; i++) { a.slot(4); await sleep(350); }
  a.send({ t: 'input', seq: ++a.seq, keys: { fire: true }, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(100);
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: -Math.PI / 2, pitch: 0, tClient: Date.now() });
  await sleep(4000);
  const smokes = a.last.smokes || [];
  console.log('  烟团:', JSON.stringify(smokes));
  check(smokes.length > 0 && smokes[0][3] > 1.5, '烟雾弹生成烟团并扩散（r=' + (smokes[0] ? smokes[0][3] : 0) + '）✓');
  // 烟雾阻挡 Bot 视线由 bot 测试覆盖；这里验证烟团持续存在
  await sleep(2000);
  check((a.last.smokes || []).length > 0, '烟团持续存在（~14 秒）');

  console.log('== 5. 键盘 1-5 切枪（浏览器端）==');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8073', { waitUntil: 'networkidle' });
  await page.fill('#nick', '切枪测试');
  await page.fill('#botcount', '0');
  await page.selectOption('#team', 'ct');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'give', weapon: 'ak47' }));
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'give', weapon: 'hegrenade' }));
  await sleep(600);
  await page.mouse.click(640, 360);
  await sleep(400);
  const weapon = () => page.evaluate(() => {
    const my = window.__lecsLastSnap.players.find(p => p[0] === Main.myId);
    return my ? my[10] : '';
  });
  await page.keyboard.press('Digit2'); await sleep(500);
  const w2 = await weapon();
  await page.keyboard.press('Digit3'); await sleep(500);
  const w3 = await weapon();
  await page.keyboard.press('Digit1'); await sleep(500);
  const w1 = await weapon();
  await page.keyboard.press('Digit4'); await sleep(500);
  const w4 = await weapon();
  console.log('  键盘切枪: 2→' + w2 + ' 3→' + w3 + ' 1→' + w1 + ' 4→' + w4);
  check(w2 === 'usp', '按 2 切手枪（' + w2 + '）✓ 关键修复');
  check(w3 === 'knife', '按 3 切匕首');
  check(w1 === 'ak47', '按 1 切主武器');
  check(w4 === 'hegrenade', '按 4 切手雷');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();

  console.log(failures === 0 ? '\n=== 手雷/切枪测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
