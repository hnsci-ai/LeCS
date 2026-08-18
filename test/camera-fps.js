// test/camera-fps.js — 验证自己游玩时镜头转向是否每渲染帧更新（60Hz+），而不是 30Hz 跳变
'use strict';
process.env.PORT = process.env.PORT || '8093';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (c, m) => { if (c) console.log('  ✓ ' + m); else { failures++; console.log('  ✗ ' + m); } };
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('[PAGEERROR]', String(e)));
  await page.goto('http://127.0.0.1:' + process.env.PORT, { waitUntil: 'networkidle' });
  await page.fill('#nick', '镜头测试');
  await page.fill('#botcount', '2');
  await page.click('#btn-practice');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  await sleep(2500); // 等 live
  // 点击画布触发 requestPointerLock（真实点击 = 用户手势）
  await page.mouse.click(640, 360);
  await sleep(400);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  console.log('  pointerLock:', locked);
  const ys = [];
  let mx = 640, my = 360;
  for (let i = 0; i < 14; i++) {
    mx += 9; my = 360;
    await page.mouse.move(mx, my);
    ys.push(await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(Render.getCamera().rotation.y)))));
  }
  const distinct = new Set(ys.map(v => v.toFixed(5))).size;
  console.log('  yaw 采样:', ys.map(v => v.toFixed(4)).join(','));
  console.log('  14 帧内不同 yaw 值:', distinct);
  check(distinct >= 10, '镜头朝向每渲染帧都在更新（60Hz 级）');
  await browser.close();
  console.log(failures === 0 ? '=== 镜头帧率测试通过 ✓ ===' : '=== 镜头帧率测试失败 ✗ ===');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
