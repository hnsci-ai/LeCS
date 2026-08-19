// test/bomb-model.js — C4 安放后场上出现模型：军绿炸药砖可见 + 安放后红灯闪烁 + 拆除后隐藏
'use strict';
process.env.PORT = '8074';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8074');
  let code = '';
  ctl.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') code = m.code; });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '掷弹员', team: 't', mode: 'test' })); res(); }));
  await sleep(500);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8074', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观察员');
  await page.selectOption('#mode', 'test');
  await page.click('#btn-join'); // 打开房间列表面板（大厅已无房间码输入框）
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page.fill('#rooms-code', code);
  await page.click('#rooms-join-code');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  // 观察员站到 (0,-1)，C4 将安放在前方 4 米 (0,-5)
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(400);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 0, z: -1 }));
  await sleep(600);

  // 扫描目标区域（C4 砖在屏幕上的大致范围：地面 4 米处 → 中心下方 y≈150-195）内军绿色像素
  const scanOlive = () => page.evaluate(() => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return -1;
    const buf = new Uint8Array(4);
    let n = 0;
    for (let y = 140; y <= 205; y += 2) {
      for (let x = 590; x <= 690; x += 2) {
        ctx.readPixels(x, y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
        const r = buf[0], g = buf[1], b = buf[2];
        // 军绿/橄榄色：绿通道 ≥ 红通道且红明显大于蓝，亮度中等
        if (g >= r && r > b + 3 && r + g + b > 60 && r + g + b < 400) n++;
      }
    }
    return n;
  });

  console.log('== 1. 未安放：场上无 C4 模型 ==');
  const before = await scanOlive();
  check(before === 0, '未安放时目标区域无军绿色像素（n=' + before + '）');

  console.log('== 2. 安放后：C4 模型出现在安放点 ==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'plant', x: 0, z: -5 }));
  await sleep(1000);
  const dbg1 = await page.evaluate(() => Render._debugBomb());
  const after = await scanOlive();
  console.log('  军绿色像素数:', after, '· debug:', JSON.stringify(dbg1));
  if (process.env.DIAG === '1') {
    // 诊断：把目标区域网格打出来（每格 "r,g,b"），确认模型实际位置与颜色
    const map = await page.evaluate(() => {
      const c = document.getElementById('gl');
      const ctx = c.getContext('webgl2') || c.getContext('webgl');
      if (!ctx) return 'no-gl';
      const buf = new Uint8Array(4);
      const rows = [];
      for (let y = 260; y >= 100; y -= 10) {
        const row = [];
        for (let x = 560; x <= 720; x += 10) {
          ctx.readPixels(x, y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
          row.push(buf[0] + ',' + buf[1] + ',' + buf[2]);
        }
        rows.push(row.join(' '));
      }
      return rows.join('\n');
    });
    console.log(map);
  }
  check(dbg1 && dbg1.visible && dbg1.planted, 'C4 模型可见且处于已安放状态');
  check(after > 3, '安放后目标区域出现军绿炸药砖像素（n=' + after + '）');
  await page.screenshot({ path: 'test/artifacts/bomb-planted.png' });

  console.log('== 3. 红灯闪烁（约 2.2Hz）==');
  const leds = [];
  for (let i = 0; i < 7; i++) { leds.push(await page.evaluate(() => Render._debugBombLed())); await sleep(140); }
  console.log('  LED 采样:', JSON.stringify(leds));
  check(leds.some(v => v) && leds.some(v => !v), '红灯交替亮灭（闪烁）');

  console.log('== 4. 拆除/隐藏后模型消失 ==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'unplant' }));
  await sleep(600);
  const dbg2 = await page.evaluate(() => Render._debugBomb());
  check(!dbg2.visible, 'unplant 后 C4 模型隐藏');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== C4 模型测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
