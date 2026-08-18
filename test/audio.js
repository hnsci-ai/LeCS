// test/audio.js — 音频初始化与播放验证（修复后：点击手势 → AudioContext running → 枪声可播）
'use strict';
process.env.PORT = '8075';
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
  await page.goto('http://127.0.0.1:8075', { waitUntil: 'networkidle' });

  // 大厅：未点击前应未创建
  const before = await page.evaluate(() => Audio._debugState());
  console.log('  大厅初始状态:', JSON.stringify(before));

  // 点击「单人对战电脑」→ 用户手势 → AudioContext 应创建并 running
  await page.fill('#nick', '听声测试');
  await page.fill('#botcount', '0');
  await page.click('#btn-practice');
  await sleep(500);
  const afterClick = await page.evaluate(() => Audio._debugState());
  console.log('  点击开始后:', JSON.stringify(afterClick));
  check(afterClick.created, '点击后 AudioContext 已创建 ✓ 关键修复');
  check(afterClick.state === 'running', 'AudioContext 状态 running（可发声）');

  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'give', weapon: 'ak47' }));
  await sleep(500);

  // 锁指针 + 开火 → 音效调度数应增加
  await page.mouse.click(640, 360);
  await sleep(400);
  const plays0 = (await page.evaluate(() => Audio._debugState())).plays;
  await page.mouse.down();
  await sleep(150);
  await page.mouse.up();
  await sleep(300);
  const afterFire = await page.evaluate(() => Audio._debugState());
  console.log('  开火后:', JSON.stringify(afterFire));
  check(afterFire.plays > plays0, '开火触发枪声音效调度（' + plays0 + ' → ' + afterFire.plays + '）');

  // 各种音效调用均能调度
  await page.evaluate(() => {
    Audio.reload();
    Audio.hit(true);
    Audio.hurt();
    Audio.buySound();
    Audio.scopeSound(true);
    Audio.emptyClick();
    Audio.bombBeep(30);
    Audio.explosion();
  });
  await sleep(200);
  const afterAll = await page.evaluate(() => Audio._debugState());
  console.log('  全部音效调用后 plays:', afterAll.plays);
  check(afterAll.plays > afterFire.plays + 5, '换弹/命中/受伤/购买/开镜/空仓/炸弹/爆炸音效全部可调度');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  console.log(failures === 0 ? '\n=== 音频测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
