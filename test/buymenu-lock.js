// test/buymenu-lock.js — 回归测试：购买菜单 Esc 关闭后鼠标控制恢复（覆盖层可见/重锁请求）
'use strict';
process.env.PORT = '8086';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.log('  ✗ ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('http://127.0.0.1:8086', { waitUntil: 'networkidle' });
  await page.fill('#nick', '锁测试');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));

  // 进入游戏后正常状态：覆盖层可见（无头环境指针未锁定）
  await sleep(500);
  let blockVisible = await page.evaluate(() => !document.getElementById('click-block').classList.contains('hidden'));
  console.log('  进入游戏后覆盖层可见:', blockVisible);

  // 等待可购买（live 且出生点在购买区）——直接等 tc-phase 非冻结
  await page.waitForFunction(() => !document.getElementById('tc-phase').textContent.includes('冻结'), null, { timeout: 30000 });
  await sleep(500);

  // 关键断言：鼠标控制恢复 = 指针已锁定 或 覆盖层可见可点击
  const mouseOK = () => page.evaluate(() =>
    document.pointerLockElement !== null || !document.getElementById('click-block').classList.contains('hidden')
  );

  console.log('== 场景1: B 打开 → Esc 关闭 ==');
  await page.keyboard.press('KeyB');
  await sleep(400);
  let menuOpen = await page.evaluate(() => !document.getElementById('buymenu').classList.contains('hidden'));
  check(menuOpen, 'B 打开购买菜单');
  let blockHiddenWhileMenu = await page.evaluate(() => document.getElementById('click-block').classList.contains('hidden'));
  check(blockHiddenWhileMenu, '菜单打开时覆盖层隐藏（不遮挡鼠标点击购买）');
  // 购买一件（数字键 1）
  await page.keyboard.press('Digit1');
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(500);
  menuOpen = await page.evaluate(() => !document.getElementById('buymenu').classList.contains('hidden'));
  check(!menuOpen, 'Esc 关闭购买菜单');
  const escState = await page.evaluate(() => ({
    locked: document.pointerLockElement !== null,
    blockVisible: !document.getElementById('click-block').classList.contains('hidden')
  }));
  console.log(`  Esc 后: 指针锁定=${escState.locked} 覆盖层可见=${escState.blockVisible}`);
  check(await mouseOK(), 'Esc 后鼠标控制恢复（锁定或覆盖层可点击）✓ 关键修复');

  console.log('== 场景2: B 打开 → B 关闭 ==');
  await page.keyboard.press('KeyB');
  await sleep(400);
  await page.keyboard.press('KeyB');
  await sleep(500);
  menuOpen = await page.evaluate(() => !document.getElementById('buymenu').classList.contains('hidden'));
  check(!menuOpen, 'B 再次按下关闭菜单');
  check(await mouseOK(), 'B 关闭后鼠标控制同样恢复');

  console.log('== 场景3: 未锁定点击画布兜底 ==');
  // 手动隐藏覆盖层模拟异常状态，点击画布应重新显示（兜底路径触发 attemptRelock）
  await page.evaluate(() => document.getElementById('click-block').classList.add('hidden'));
  await page.mouse.click(640, 360);
  await sleep(400);

  console.log('== 控制台错误 ==');
  check(errors.length === 0, '无未捕获 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 120) : ''));

  await browser.close();
  console.log(failures === 0 ? '\n=== 指针锁定回归测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
