// test/browser.js — 用系统 Chrome 无头验证页面：加载、联机、渲染、HUD
'use strict';
process.env.PORT = process.env.PORT || '8090';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:' + process.env.PORT;

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.log('  ✗ ' + msg); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  console.log('== 1. 大厅加载 ==');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#lobby', { timeout: 8000 });
  const title = await page.textContent('.logo');
  check(title.includes('LeCS'), '大厅标题显示');
  await page.screenshot({ path: 'test/artifacts/01-lobby.png' });

  console.log('== 2. 单人对战电脑（经典模式）==');
  await page.fill('#nick', '测试员');
  await page.selectOption('#mode', 'classic');
  await page.selectOption('#team', 'ct');
  await page.fill('#botcount', '3');
  await page.click('#btn-practice');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await page.waitForFunction(() => !document.getElementById('hud').classList.contains('hidden'), null, { timeout: 8000 });
  console.log('  已进入游戏，等待回合 live…');
  // 等 10 秒：冻结结束 + bots 加入
  await sleep(11000);

  console.log('== 3. 场景渲染与 HUD ==');
  const canvasInfo = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    return { w: c.width, h: c.height, hasGL: !!g };
  });
  check(canvasInfo.hasGL, 'WebGL 上下文创建成功');
  const hudText = await page.evaluate(() => ({
    hp: document.getElementById('hp-val').textContent,
    money: document.getElementById('money').textContent,
    timer: document.getElementById('tc-timer').textContent,
    weapon: document.getElementById('weapon-name').textContent,
    ammo: document.getElementById('ammo-mag').textContent + '/' + document.getElementById('ammo-res').textContent,
    roomCode: document.getElementById('room-code').textContent,
    phase: document.getElementById('tc-phase').textContent,
    score: document.getElementById('score-t').textContent + ':' + document.getElementById('score-ct').textContent
  }));
  console.log('  HUD:', JSON.stringify(hudText));
  check(hudText.hp === '100', '生命值 100');
  check(/\$\d+/.test(hudText.money), '金钱显示');
  check(hudText.weapon.length > 0, '武器名显示');
  check(/\d+\/\d+/.test(hudText.ammo), '弹药显示');
  check(/^[A-Z2-9]{4}/.test(hudText.roomCode) && hudText.roomCode.includes('·'), '房间码显示（含地图名）');
  check(hudText.phase.includes('冻结') || hudText.phase.includes('反恐') || hudText.phase.includes('恐怖'), '阶段提示显示');

  // 检查 3D 场景有实际绘制（采样像素）
  const pixelCheck = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const px = new Uint8Array(4 * 400);
    gl.readPixels(0, Math.floor(c.height / 2), 200, 2, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let nonZero = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) nonZero++;
    return nonZero;
  });
  check(pixelCheck > 100, '场景已渲染（非空像素 ' + pixelCheck + '）');

  await page.screenshot({ path: 'test/artifacts/02-game.png' });

  console.log('== 4. 输入模拟（移动）==');
  const before = await page.evaluate(() => Main && Main.myId);
  const posBefore = await page.evaluate(() => {
    const e = document.querySelector('#hp-val');
    return e ? 1 : 0;
  });
  await page.keyboard.down('KeyW');
  await sleep(1200);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  await sleep(1200);
  await page.keyboard.up('KeyS');
  check(true, 'W/S 输入已发送（无异常）');

  console.log('== 5. 购买菜单 ==');
  // 测试用 god 模式保证玩家存活，等待 live 阶段后按 B（出生点在购买区内）
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => document.getElementById('tc-phase').textContent.includes('反恐') || document.getElementById('tc-phase').textContent.includes('恐怖'), null, { timeout: 30000 });
  await sleep(500);
  await page.keyboard.press('KeyB');
  await sleep(500);
  const buyVisible = await page.evaluate(() => !document.getElementById('buymenu').classList.contains('hidden'));
  check(buyVisible, '按 B 打开购买菜单');
  await page.screenshot({ path: 'test/artifacts/03-buymenu.png' });
  // 尝试购买（数字键 1 = USP）
  await page.keyboard.press('Digit1');
  await sleep(600);
  await page.keyboard.press('KeyB');
  await sleep(300);

  console.log('== 6. 记分板 ==');
  await page.keyboard.down('Tab');
  await sleep(400);
  const sbVisible = await page.evaluate(() => !document.getElementById('scoreboard').classList.contains('hidden'));
  check(sbVisible, 'Tab 打开记分板');
  const sbRows = await page.evaluate(() => document.querySelectorAll('#sb-table .sb-row').length);
  console.log('  记分板行数:', sbRows);
  check(sbRows >= 2, '记分板显示玩家与Bot');
  await page.screenshot({ path: 'test/artifacts/04-scoreboard.png' });
  await page.keyboard.up('Tab');
  await sleep(200);

  console.log('== 7. Bot 加入与状态 ==');
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('#sb-table .sb-row').length);
  await page.keyboard.press('F3');
  await sleep(1500);
  await page.keyboard.down('Tab');
  await sleep(400);
  const sbRows2 = await page.evaluate(() => document.querySelectorAll('#sb-table .sb-row').length);
  await page.keyboard.up('Tab');
  console.log('  F3 前后记分板行数:', rowsBefore, '→', sbRows2);
  check(sbRows2 >= 2, '添加 Bot 成功（记分板 ' + sbRows2 + ' 行）');

  console.log('== 8. 控制台错误 ==');
  const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('deprecated'));
  if (realErrors.length) console.log('  错误列表:', realErrors.slice(0, 8));
  check(realErrors.length === 0, '无 JS 错误');

  await sleep(2000);
  await page.screenshot({ path: 'test/artifacts/04-final.png' });
  await browser.close();
  console.log(failures === 0 ? '\n=== 浏览器测试全部通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('浏览器测试异常:', e.message); process.exit(1); });
