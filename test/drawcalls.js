// test/drawcalls.js — 测量渲染 draw call / 三角形数（对比不同构建）
// 用法: LABEL=xxx BOTS=6 PORT=8097 node test/drawcalls.js
'use strict';
process.env.PORT = process.env.PORT || '8097';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('[PAGEERROR]', String(e)));
  await page.goto('http://127.0.0.1:' + process.env.PORT, { waitUntil: 'networkidle' });
  await page.fill('#nick', '测帧');
  await page.fill('#botcount', process.env.BOTS || '6');
  await page.click('#btn-practice');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await sleep(2000);
    samples.push(await page.evaluate(() => ({
      calls: Render._debugDrawCalls ? Render._debugDrawCalls() : -1,
      tris: Render._debugTriangles ? Render._debugTriangles() : -1,
      shadow: Render._debugShadowOn ? Render._debugShadowOn() : -1,
      fps: (document.getElementById('fps-val') || {}).textContent || '--'
    })));
  }
  const max = samples.reduce((a, b) => b.calls > a.calls ? b : a, samples[0]);
  console.log('RESULT ' + (process.env.LABEL || '?') + ' BOTS=' + (process.env.BOTS || '6') + ' max=' + JSON.stringify(max) + ' all=' + JSON.stringify(samples));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
