// test/empty-mag.js — 空仓不开火特效 + 半自动一次点击一发 + 火光贴图
'use strict';
process.env.PORT = '8089';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8089', { waitUntil: 'networkidle' });
  await page.fill('#nick', '空仓测试');
  await page.fill('#botcount', '0');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));

  // 等 live
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  // 发一把沙鹰（7 发）
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'give', weapon: 'deagle' }));
  await sleep(500);

  // 锁定指针（点击覆盖层 → 无头环境可授予锁定）
  await page.mouse.click(640, 360);
  await sleep(400);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  console.log('  指针锁定:', locked);

  // 开火 10 次（沙鹰半自动：一次点击一发；7 发打完后 3 次应为空仓）
  const clickFire = async () => {
    await page.mouse.down();
    await sleep(60);
    await page.mouse.up();
    await sleep(280);
  };
  for (let i = 0; i < 7; i++) await clickFire();
  await sleep(600); // 等快照同步弹匣状态
  const after7 = await page.evaluate(() => ({
    tracers: Render._debugTracerTotal(),
    mag: window.__lecsLastSnap.players.find(p => p[0] === Main.myId)[11]
  }));
  console.log('  7 次点击后: 曳光=' + after7.tracers + ' 弹匣=' + after7.mag);
  check(after7.tracers === 7, '半自动 7 次点击 = 7 条曳光（一次点击一发）');
  check(after7.mag === 0, '7 发子弹打空');

  // 空仓再点 3 次：不应产生新曳光/枪声
  for (let i = 0; i < 3; i++) await clickFire();
  await sleep(500);
  const after10 = await page.evaluate(() => Render._debugTracerTotal());
  console.log('  10 次点击后: 曳光=' + after10);
  check(after10 === 7, '空仓点击不再产生曳光（' + after10 + '/7）✓ 关键修复');

  // 枪口火光贴图（不再是纯色方块）
  const flashOk = await page.evaluate(() => Render._debugMuzzleHasTex());
  check(flashOk, '枪口火光使用星芒贴图（Sprite）');

  // 手动调用火光验证 sprite 正常工作
  await page.evaluate(() => {
    Render.muzzleFlash(2, 1.6, 2, 0, 0);
    Render.muzzleFlash(2, 1.6, 4, 1, 0);
  });
  await sleep(300);
  check(errors.length === 0, '火光渲染无 JS 错误');

  await browser.close();
  console.log(failures === 0 ? '\n=== 空仓/半自动测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
