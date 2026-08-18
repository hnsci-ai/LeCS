// test/scope.js — AWP 开镜专项测试：档位循环、跑动收镜、切枪收镜、浏览器变焦 UI
'use strict';
process.env.PORT = '8084';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

class Client {
  constructor() {
    this.seq = 0; this.last = null; this.msgs = []; this.waits = [];
    this.ws = new WebSocket('ws://127.0.0.1:8084');
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
    this.send({ t: 'join', name: '狙击手', team, mode: 'classic' });
    await this.wait(m => m.t === 'joined', 5000, 'joined');
  }
  me() { return this.last.players.find(p => p[0] === this.id); }
  fireAlt() {
    this.send({ t: 'input', seq: ++this.seq, keys: { fireAlt: true }, yaw: 0, pitch: 0, tClient: Date.now() });
    this.send({ t: 'input', seq: ++this.seq, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() });
  }
}

(async () => {
  console.log('== 1. 服务器开镜档位循环 ==');
  const a = new Client();
  await a.join('t');
  await a.wait(m => m.t === 'snap' && m.phase === 'live', 20000, 'live');
  a.send({ t: 'dev', cmd: 'give', weapon: 'awp' });
  await sleep(400);
  check(a.me()[10] === 'awp', '手持 AWP');

  a.fireAlt(); await sleep(400);
  check(a.me()[29] === 1, '右键一次 → 开镜 1 档（' + a.me()[29] + '）');
  a.fireAlt(); await sleep(400);
  check(a.me()[29] === 2, '右键两次 → 开镜 2 档');
  a.fireAlt(); await sleep(400);
  check(a.me()[29] === 0, '右键三次 → 关闭开镜');

  console.log('== 2. 移动保持开镜（新需求）==');
  a.fireAlt(); await sleep(400);
  check(a.me()[29] === 1, '再次开镜');
  // 按住 W 跑 1.5 秒
  for (let i = 0; i < 15; i++) {
    a.send({ t: 'input', seq: ++a.seq, keys: { f: true }, yaw: 0, pitch: 0, tClient: Date.now() });
    await sleep(100);
  }
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() });
  await sleep(300);
  check(a.me()[29] === 1, '跑动时保持开镜 ✓（移动不再自动收镜）');

  console.log('== 3. 切枪收镜 ==');
  a.fireAlt(); await sleep(300);
  a.send({ t: 'input', seq: ++a.seq, keys: {}, yaw: 0, pitch: 0, slot: 3, tClient: Date.now() });
  await sleep(400);
  check(a.me()[29] === 0, '切枪（3=刀）后收镜 ✓');

  console.log('== 4. 浏览器端：变焦 + 狙击镜 UI ==');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8084', { waitUntil: 'networkidle' });
  await page.fill('#nick', '镜测');
  await page.fill('#botcount', '0');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'give', weapon: 'awp' }));
  await sleep(600);
  // 锁定指针
  await page.mouse.click(640, 360);
  await sleep(400);

  const snap = () => page.evaluate(() => ({
    fov: +Render.getCamera().fov.toFixed(1),
    overlay: !document.getElementById('scope-overlay').classList.contains('hidden'),
    crosshair: document.getElementById('crosshair').style.opacity
  }));

  await page.mouse.click(640, 360, { button: 'right' });
  await sleep(700);
  let s = await snap();
  console.log('  右键1次: fov=' + s.fov + ' 镜UI=' + s.overlay + ' 准星透明度=' + s.crosshair);
  check(s.overlay && s.fov < 60, '开镜 1 档：狙击镜 UI 显示 + 变焦');

  await page.mouse.click(640, 360, { button: 'right' });
  await sleep(700);
  s = await snap();
  console.log('  右键2次: fov=' + s.fov);
  check(s.overlay && s.fov < 25, '开镜 2 档：进一步放大');

  await page.mouse.click(640, 360, { button: 'right' });
  await sleep(700);
  s = await snap();
  console.log('  右键3次: fov=' + s.fov + ' 镜UI=' + s.overlay + ' 准星透明度=' + s.crosshair);
  check(!s.overlay && s.fov > 60 && s.crosshair === '1', '关闭开镜：UI 隐藏 + 视野恢复 + 准星恢复');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();

  console.log(failures === 0 ? '\n=== AWP 开镜测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
