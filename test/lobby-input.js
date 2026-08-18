// test/lobby-input.js — 大厅输入框可正常打字（修复：游戏按键监听不再吞输入框按键）
'use strict';
process.env.PORT = '8074';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8074', { waitUntil: 'networkidle' });

  // 昵称框输入：包含所有被游戏占用的键（WASD、R、E、B、数字 1-5、Shift/Tab 组合避开）
  await page.fill('#nick', '');
  await page.click('#nick');
  await page.keyboard.type('WASD12345REB');
  const nick = await page.inputValue('#nick');
  console.log('  昵称输入结果:', JSON.stringify(nick));
  check(nick === 'WASD12345REB', '昵称框完整输入 WASD12345REB（不被游戏按键拦截）✓ 关键修复');

  // 房间码框输入数字+字母
  await page.click('#code');
  await page.keyboard.type('AB12');
  const code = await page.inputValue('#code');
  console.log('  房间码输入结果:', JSON.stringify(code));
  check(code === 'AB12', '房间码框完整输入 AB12（数字可输入）');

  // 下拉框仍可交互
  await page.selectOption('#team', 'ct');
  const team = await page.inputValue('#team');
  check(team === 'ct', '阵营下拉框正常选择');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  console.log(failures === 0 ? '\n=== 大厅输入测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
