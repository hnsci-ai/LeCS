// test/knife.js — 匕首效果：挥砍无火光、无曳光、无抛壳（修复匕首显示枪效果）
'use strict';
process.env.PORT = '8072';
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
  await page.goto('http://127.0.0.1:8072', { waitUntil: 'networkidle' });
  await page.fill('#nick', '刀客');
  await page.fill('#botcount', '0');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await page.mouse.click(640, 360);
  await sleep(400);

  // 切匕首
  await page.keyboard.press('Digit3');
  await sleep(600);
  const knifeEquipped = await page.evaluate(() => {
    const my = window.__lecsLastSnap.players.find(p => p[0] === Main.myId);
    return my ? my[10] : '';
  });
  check(knifeEquipped === 'knife', '已切到匕首');

  // 左键挥砍 3 次
  const tracerBefore = await page.evaluate(() => Render._debugTracerTotal());
  for (let i = 0; i < 3; i++) {
    await page.mouse.down();
    await sleep(80);
    const muzzleOn = await page.evaluate(() => VM._debugMuzzleOn());
    if (i === 0) check(!muzzleOn, '匕首挥砍无枪口火光 ✓ 关键修复');
    await page.mouse.up();
    await sleep(500);
  }
  const tracerAfter = await page.evaluate(() => Render._debugTracerTotal());
  console.log('  挥砍前后曳光数:', tracerBefore, '→', tracerAfter);
  check(tracerAfter === tracerBefore, '匕首攻击不产生曳光弹轨迹 ✓ 关键修复');

  // 换 AK 对比：开火应产生曳光（枪械特效路径正常）
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'give', weapon: 'ak47' }));
  await sleep(600);
  const t0 = await page.evaluate(() => Render._debugTracerTotal());
  await page.mouse.down();
  await sleep(150);
  await page.mouse.up();
  await sleep(300);
  const t1 = await page.evaluate(() => Render._debugTracerTotal());
  console.log('  AK 开火曳光数:', t0, '→', t1);
  check(t1 > t0, '对比验证：AK 开火有曳光（枪械特效路径正常）');

  // 切枪显示回归：3→匕首、2→手枪、1→AK（修复新旧枪叠加）
  await page.keyboard.press('Digit3');
  await sleep(700);
  const vm3 = await page.evaluate(() => VM.weaponId());
  await page.keyboard.press('Digit2');
  await sleep(700);
  const vm2 = await page.evaluate(() => VM.weaponId());
  await page.keyboard.press('Digit1');
  await sleep(700);
  const vm1 = await page.evaluate(() => VM.weaponId());
  const pistols = ['usp', 'glock', 'deagle', 'p228', 'fiveseven', 'elites'];
  console.log('  切枪显示: 3→' + vm3 + ' 2→' + vm2 + ' 1→' + vm1);
  check(vm3 === 'knife' && pistols.includes(vm2) && vm1 === 'ak47',
    '切枪后显示模型正确变化 ✓ 关键修复');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  console.log(failures === 0 ? '\n=== 匕首效果测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
