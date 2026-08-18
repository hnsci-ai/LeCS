// test/quality.js — 画质校准与 F6 手动档测试：无 60 帧上限、按屏幕刷新率自适应
'use strict';
process.env.PORT = '8083';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8083', { waitUntil: 'networkidle' });
  await page.fill('#nick', '画质测试');
  await page.fill('#botcount', '2');
  await page.click('#btn-practice');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });

  // 1. 开场校准：前 2 秒低画质测本机最高帧率，然后自动恢复高画质
  let calib = null;
  for (let i = 0; i < 14; i++) { // 最多等 7 秒
    await sleep(500);
    calib = await page.evaluate(() => window.__lecsQuality());
    if (calib.calibDone) break;
  }
  console.log('  校准结果:', JSON.stringify(calib));
  check(calib.calibDone === true, '开场校准完成（低画质测上限 → 恢复高画质）');
  check(calib.manual === null, '校准后处于自动模式');
  check(calib.refreshEst >= 60, '测得本机最高帧率 ≥ 60（' + calib.refreshEst + '）');

  // 2. F6 手动切换（正反两个方向，阴影开关与档位一致）
  const before = await page.evaluate(() => ({ q: window.__lecsQuality(), shadow: Render._debugShadowOn() }));
  await page.keyboard.press('F6');
  await sleep(1200);
  const after = await page.evaluate(() => ({ q: window.__lecsQuality(), shadow: Render._debugShadowOn(), mode: document.getElementById('fps-mode').textContent }));
  console.log('  F6 第一次:', JSON.stringify(after));
  check(after.q.manual !== null, 'F6 进入手动档');
  check(after.q.low === !before.q.low, 'F6 切换画质档');
  check(after.shadow === !after.q.low, '阴影开关与画质档一致');
  check(after.mode.includes(after.q.low ? '低画质' : '高画质'), '左上角显示画质档标识');

  await page.keyboard.press('F6');
  await sleep(1200);
  const after2 = await page.evaluate(() => ({ q: window.__lecsQuality(), shadow: Render._debugShadowOn() }));
  console.log('  F6 第二次:', JSON.stringify(after2));
  check(after2.q.low === !after.q.low, '再次 F6 切回');
  check(after2.shadow === !after2.q.low, '切回后阴影开关一致');

  check(errors.length === 0, '全程无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  console.log(failures === 0 ? '\n=== 画质校准测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
