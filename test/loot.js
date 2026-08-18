// test/loot.js — 死亡掉盒 + F 键舔包
'use strict';
process.env.PORT = '8064';
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
    this.ws = new WebSocket('ws://127.0.0.1:8064');
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
  loot() {
    this.send({ t: 'input', seq: ++this.seq, keys: { loot: true }, yaw: 0, pitch: 0, tClient: Date.now() });
    this.send({ t: 'input', seq: ++this.seq, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() });
  }
}

(async () => {
  console.log('== 1. 击杀掉落战利品箱 ==');
  const a = new Client('舔包王');
  const b = new Client('运输大队');
  await a.join('t'); await b.join('ct', a.code);
  await sleep(400);
  const c = new Client('补位CT'); // 第三个 CT 客户端：保证击杀 b 后回合不结束
  await c.join('ct', a.code);
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  // b 带好装备与钱
  b.dev('give', { weapon: 'ak47' });
  b.dev('give', { weapon: 'deagle' });
  b.dev('money', { amount: 5000 });
  b.dev('tp', { x: -6, z: -2 });
  await sleep(600);

  // 击杀 b
  a.dev('dmg', { id: b.id, amount: 1000 });
  await sleep(3800);
  const crates = a.last.crates || [];
  console.log('  箱子:', JSON.stringify(crates));
  check(crates.length === 1, '死亡 3 秒后生成战利品箱 ✓');
  check(crates[0][4] === 'ak47' && crates[0][5] === 'deagle', '箱内包含 AK-47 与沙鹰');
  check(crates[0][7] === 5000, '箱内包含 $5000');
  const bMoney = a.last.players.find(p => p[0] === b.id)[13];
  check(bMoney === 0, '死者金钱清零（转入箱子）');

  console.log('== 2. F 键舔包 ==');
  const m0 = a.me()[13];
  a.dev('tp', { x: crates[0][1], z: crates[0][3] });
  await sleep(400);
  a.loot();
  await sleep(600);
  const after = a.last.crates || [];
  const money1 = a.me()[13];
  console.log('  舔包后余额: $' + m0 + ' → $' + money1 + ' · 箱子数: ' + after.length);
  check(money1 === m0 + 5000, '舔包获得 $5000 ✓');
  check(after.length === 1 && after[0][5] === 'glock' && after[0][7] === 0,
    '舔包为交换机制：旧 Glock 留在箱内、箱内金钱已取空 ✓');
  // 切主武器验证拿到了 AK
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: 0, pitch: 0, slot: 1, tClient: Date.now() });
  await sleep(400);
  check(a.me()[10] === 'ak47', '舔包获得 AK-47 ✓');
  // 舔包播报事件
  check(a.events.some(e => e.type === 'loot'), '舔包播报事件触发');

  console.log('== 3. 浏览器端：箱子模型与提示 ==');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8064', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观箱员');
  await page.fill('#code', a.code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(500);

  // 击杀观察员自己附近的 a？改为：让 a 再死一次（带钱），生成第二个箱子
  a.dev('money', { amount: 1234 });
  a.dev('give', { weapon: 'awp' });
  await sleep(400);
  b.dev('revive', {});
  await sleep(400);
  b.dev('dmg', { id: a.id, amount: 1000 }); // b 复活后反杀 a
  await sleep(3800);
  const crateCount = await page.evaluate(() => Render._debugCrates());
  console.log('  客户端箱子模型数:', crateCount);
  check(crateCount >= 1, '客户端渲染箱子模型 ✓');
  // 把观箱员传送到箱子旁 → 提示显示
  const cPos = await page.evaluate(() => (window.__lecsLastSnap.crates || [])[0]);
  if (cPos) {
    // 观箱员是中途观战者：先复活再传送
    await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
    await sleep(500);
    await page.evaluate(([x, z]) => window.__lecsSend({ t: 'dev', cmd: 'tp', x: x + 1, z }), [cPos[1], cPos[3]]);
    await sleep(600);
    const promptVisible = await page.evaluate(() => !document.getElementById('loot-prompt').classList.contains('hidden'));
    const promptText = await page.evaluate(() => document.getElementById('loot-prompt').textContent);
    console.log('  提示:', promptText);
    check(promptVisible && promptText.includes('F'), '靠近箱子显示「按 F 舔包」提示 ✓');
  }
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  console.log('== 4. 箱子 30 秒过期 ==');
  // 第 3 节生成的箱子（含换下的 Glock）应在 30 秒后消失
  const t0 = Date.now();
  while (Date.now() - t0 < 33000) {
    await sleep(1000);
    const n = (a.last.crates || []).length;
    if (n === 0) break;
  }
  const left = (a.last.crates || []).length;
  console.log('  30 秒后剩余箱子:', left);
  check(left === 0, '未捡取的箱子 30 秒后自动消失 ✓');

  await browser.close();
  console.log(failures === 0 ? '\n=== 舔包测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
