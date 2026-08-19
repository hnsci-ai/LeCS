// test/perf.js — 帧时间探测：4 Bot 乱斗 + 观战者开火 30 秒
'use strict';
process.env.PORT = '8061';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8061');
  let code = '', bots = [];
  let rb = null;
  const ready = new Promise(res => { rb = res; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') { const bs = m.players.filter(p => p.bot).map(p => p.id); if (bs.length >= 4 && !bots.length) { bots = bs; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic' })); res(); }));
  await sleep(700);
  for (let i = 0; i < 4; i++) ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await ready;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://127.0.0.1:8061', { waitUntil: 'networkidle' });
  await page.fill('#nick', '帧探');
  await page.click('#btn-join'); // 打开房间列表面板（大厅已无房间码输入框）
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page.fill('#rooms-code', code);
  await page.click('#rooms-join-code');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });

  // 装帧探针
  await page.evaluate(() => {
    window.__frames = [];
    const orig = window.requestAnimationFrame;
    let last = performance.now();
    const loop = (t) => {
      window.__frames.push(t - last);
      if (window.__frames.length > 3000) window.__frames.shift();
      last = t;
      orig(loop);
    };
    orig(loop);
  });

  // 乱斗：把 bots 两两传到一起互打，观战者持续开火（90 秒，检测渐进性能）
  for (let i = 0; i < 90; i++) {
    if (i % 2 === 0) {
      ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: bots[0], x: -6, z: 2 }));
      ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: bots[1], x: 2, z: 2 }));
      ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: bots[2], x: -6, z: 10 }));
      ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: bots[3], x: 2, z: 10 }));
      for (const b of bots) ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: b }));
    }
    await page.evaluate((bid) => {
      const snap = window.__lecsLastSnap;
      const t = snap.players.find(p => p[0] === bid);
      const my = snap.players.find(p => p[0] === Main.myId);
      if (t && my) {
        const dx = t[1] - my[1], dz = t[3] - my[3];
        window.__lecsSend({ t: 'input', seq: 1, keys: { fire: true }, yaw: Math.atan2(-dx, -dz), pitch: 0, tClient: Date.now() });
      }
    }, bots[0]);
    await sleep(1000);
  }

  const stats = await page.evaluate(() => {
    const all = window.__frames.slice(300);
    const win = (a, b) => {
      const seg = all.slice(a, b);
      seg.sort((x, y) => x - y);
      const avg = seg.reduce((s2, v) => s2 + v, 0) / seg.length;
      return { avg: +avg.toFixed(1), max: +seg[seg.length - 1].toFixed(1) };
    };
    const third = Math.floor(all.length / 3);
    return { w1: win(0, third), w2: win(third, third * 2), w3: win(third * 2, all.length) };
  });
  console.log('  帧时间(ms): 前段 平均 ' + stats.w1.avg + ' 最大 ' + stats.w1.max +
    ' · 中段 平均 ' + stats.w2.avg + ' 最大 ' + stats.w2.max +
    ' · 后段 平均 ' + stats.w3.avg + ' 最大 ' + stats.w3.max);

  ctl.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
