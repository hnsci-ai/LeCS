// test/effects.js — 特效专项测试：曳光/火花/血雾/爆炸/抛壳 API 调用无崩溃
'use strict';
process.env.PORT = '8087';
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
  await page.goto('http://127.0.0.1:8087', { waitUntil: 'networkidle' });
  await page.fill('#nick', '特效测试');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);

  // 直接调用特效 API
  const r = await page.evaluate(() => {
    try {
      Render.tracer({ x: 0, y: 1.5, z: 0 }, { x: 14, y: 1.8, z: 0 });
      Render.tracer({ x: 0, y: 1.5, z: 2 }, { x: -12, y: 2.2, z: 2 });
      Render.impact(5, 1.6, 0, 1);   // 墙面火花
      Render.impact(5, 1.6, 1, 2);   // 血雾
      Render.muzzleFlash(0, 1.5, 0, 0, 0);
      Render.explosion(-5, 0, -5);
      Render.shell(0, 1.6, 0, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
      // 死亡血泊
      const cam = Render.getCamera();
      return { ok: true, hasCam: !!cam };
    } catch (e) { return { ok: false, err: String(e).slice(0, 150) }; }
  });
  check(r.ok && r.hasCam, '特效 API 调用无异常');

  // 渲染数秒让特效动画跑起来
  await sleep(2500);
  const alive = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const px = new Uint8Array(4 * 200);
    gl.readPixels(300, Math.floor(c.height / 2), 200, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) n++;
    return n;
  });
  check(alive > 50, '渲染循环持续正常（像素 ' + alive + '）');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  // 实战路径：bot 交战产生的曳光/命中事件处理
  await sleep(20000);
  check(errors.length === 0, '20 秒 Bot 交战后仍无 JS 错误');

  await browser.close();
  console.log(failures === 0 ? '\n=== 特效测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
