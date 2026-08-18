// test/loot.js — 死亡掉盒 + 舔包对话框 + 双击拾取 + 队友尸体也可舔
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
  lootItem(id, item) { this.send({ t: 'loot', id, item }); }
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
  b.dev('give', { weapon: 'hegrenade' });
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
  check(crates[0][6] === 'hegrenade', '箱内包含手雷（grenade 列表）');
  check(crates[0][7] === 5000, '箱内包含 $5000');
  const bMoney = a.last.players.find(p => p[0] === b.id)[13];
  check(bMoney === 0, '死者金钱清零（转入箱子）');

  console.log('== 2. 队友死亡同样掉箱（可舔队友的包） ==');
  b.dev('revive', {});
  await sleep(600);
  c.dev('dmg', { id: b.id, amount: 1000 }); // c 击杀队友 b（团队击杀）
  await sleep(3800);
  const crates2 = a.last.crates || [];
  console.log('  团队击杀后箱子数:', crates2.length);
  check(crates2.length === 2, '队友（团队击杀）死亡也生成战利品箱 ✓');

  console.log('== 3. 舔包对话框协议：按条目拾取 ==');
  const m0 = a.me()[13];
  a.dev('tp', { x: crates[0][1], z: crates[0][3] });
  await sleep(400);
  a.lootItem(crates[0][0], 'money');
  await sleep(500);
  const money1 = a.me()[13];
  console.log('  捡钱后余额: $' + m0 + ' → $' + money1);
  check(money1 === m0 + 5000, '双击金钱 → 获得 $5000 ✓');

  a.lootItem(crates[0][0], 'w1');
  await sleep(500);
  a.lootItem(crates[0][0], 'w2');
  await sleep(500);
  a.lootItem(crates[0][0], 'g:hegrenade');
  await sleep(600);
  const after = a.last.crates || [];
  const c1 = after.find(x => x[0] === crates[0][0]);
  console.log('  交换后箱子:', JSON.stringify(c1));
  check(c1 && c1[4] === '' && c1[5] === 'glock', '拾取为交换机制：换下的 Glock 留在箱内（T 无主武器，副武器 Glock）✓');
  check(c1 && c1[6] === '' && c1[7] === 0, '箱内手雷与金钱已取空 ✓');
  // 切主武器验证拿到了 AK
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: 0, pitch: 0, slot: 1, tClient: Date.now() });
  await sleep(400);
  check(a.me()[10] === 'ak47', '拾取获得 AK-47 ✓');
  // 舔包播报事件
  check(a.events.filter(e => e.type === 'loot').length >= 3, '舔包播报事件触发 ✓');

  console.log('== 4. 浏览器端：F 开箱对话框 + 双击拾取 ==');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8064', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观箱员');
  await page.selectOption('#team', 't'); // 与 a 同队，保证 a 死后回合不结束
  await page.fill('#code', a.code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(500);

  // 让 a 再死一次（带钱），生成新箱子；先把 a 挪到空旷处，避免与旧箱子同点
  a.dev('money', { amount: 1234 });
  a.dev('give', { weapon: 'awp' });
  a.dev('tp', { x: 28, z: -28 });
  await sleep(400);
  // 先复活观箱员（T 存活 → a 的死不会结束回合，避免回合重启清掉箱子）
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(500);
  b.dev('revive', {});
  await sleep(400);
  b.dev('dmg', { id: a.id, amount: 1000 }); // b 复活后反杀 a
  await sleep(3800);
  const crateCount = await page.evaluate(() => Render._debugCrates());
  console.log('  客户端箱子模型数:', crateCount);
  check(crateCount >= 1, '客户端渲染箱子模型 ✓');
  // 观箱员传送到箱子旁
  const cPos = await page.evaluate(() => (window.__lecsLastSnap.crates || []).filter(c => c[4] === 'awp')[0]);
  check(!!cPos, '找到含 AWP 的箱子 ✓');
  if (cPos) {
    await page.evaluate(([x, z]) => window.__lecsSend({ t: 'dev', cmd: 'tp', x: x + 1, z }), [cPos[1], cPos[3]]);
    await sleep(600);
    const promptText = await page.evaluate(() => document.getElementById('loot-prompt').textContent);
    console.log('  提示:', promptText);
    check(promptText.includes('F') && promptText.includes('查看战利品'), '靠近箱子显示「按 F 查看战利品」提示 ✓');

    // 按 F 打开对话框
    await page.keyboard.press('KeyF');
    await sleep(400);
    const dlg = await page.evaluate(() => ({
      open: !document.getElementById('loot-menu').classList.contains('hidden'),
      items: Array.from(document.querySelectorAll('#loot-items .lm-item .lm-name')).map(x => x.textContent)
    }));
    console.log('  对话框:', JSON.stringify(dlg));
    check(dlg.open, '按 F 打开舔包对话框 ✓');
    check(dlg.items.some(x => x.includes('AWP')), '对话框显示 AWP ✓');
    check(dlg.items.some(x => x.includes('1234')), '对话框显示金钱 $1234 ✓');

    // 双击金钱 → 拾取
    const moneyBefore = await page.evaluate(() => {
      const me = window.__lecsLastSnap.players.find(p => p[16] === '观箱员');
      return me ? me[13] : -1;
    });
    await page.dblclick('#loot-items .lm-money');
    await sleep(700);
    const moneyAfter = await page.evaluate(() => {
      const me = window.__lecsLastSnap.players.find(p => p[16] === '观箱员');
      return me ? me[13] : -1;
    });
    console.log('  双击金钱后余额: $' + moneyBefore + ' → $' + moneyAfter);
    check(moneyAfter === moneyBefore + 1234, '双击金钱拾取 ✓');
    const moneyRowGone = await page.evaluate(() => !document.querySelector('#loot-items .lm-money'));
    check(moneyRowGone, '对话框刷新：金钱条目消失 ✓');

    // Esc 关闭对话框
    await page.keyboard.press('Escape');
    await sleep(300);
    const closed = await page.evaluate(() => document.getElementById('loot-menu').classList.contains('hidden'));
    check(closed, 'Esc 关闭舔包对话框 ✓');
  }
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  console.log('== 5. 杀最后一人：立即掉箱，回合结束期可舔 ==');
  const a2 = new Client('末杀T');
  const b2 = new Client('末杀CT');
  await a2.join('t'); await b2.join('ct', a2.code);
  await a2.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live2');
  b2.dev('money', { amount: 777 });
  await sleep(500);
  a2.dev('dmg', { id: b2.id, amount: 1000 }); // 1v1：杀掉最后一个 CT
  await sleep(800);
  const endCrates = a2.last.crates || [];
  console.log('  末杀后立即箱子:', JSON.stringify(endCrates), '· phase:', a2.last.phase);
  check(endCrates.length === 1 && endCrates[0][7] === 777, '最后一杀立即生成战利品箱 ✓');
  check(a2.last.phase === 'end', '回合进入结束阶段 ✓');
  // 结束阶段内舔包（金钱）
  const mEnd0 = a2.me()[13];
  a2.dev('tp', { x: endCrates[0][1], z: endCrates[0][3] });
  await sleep(400);
  a2.lootItem(endCrates[0][0], 'money');
  await sleep(500);
  const mEnd1 = a2.me()[13];
  console.log('  结束阶段舔包余额: $' + mEnd0 + ' → $' + mEnd1);
  check(mEnd1 === mEnd0 + 777, '回合结束展示期仍可舔包 ✓');

  console.log('== 6. 箱子 30 秒过期 ==');
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    await sleep(1000);
    const n = (a.last.crates || []).length;
    if (n === 0) break;
  }
  const left = (a.last.crates || []).length;
  console.log('  45 秒后剩余箱子:', left);
  check(left === 0, '未捡取的箱子 30 秒后自动消失 ✓');

  await browser.close();
  console.log(failures === 0 ? '\n=== 舔包测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
