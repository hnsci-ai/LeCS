// test/dog.js — 哈基狗：购买跟随、30 米内索敌撕咬（2-5 血/口）、可被枪杀、主人死亡狗死亡
// 用 dust 图 + 3 个真人 WebSocket（无 Bot），全部确定性
'use strict';
process.env.PORT = '8085';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  // 主人（T）+ 枪手（CT，撕咬目标）+ 射手（CT，打狗）
  const ctl = new WebSocket('ws://127.0.0.1:8085');
  let code = '', ctlId = 0;
  ctl.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') { code = m.code; ctlId = m.id; } });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '主人', team: 't', mode: 'dm', map: 'dust' })); res(); }));
  await sleep(400);

  let gunHp = -1;
  const gun = new WebSocket('ws://127.0.0.1:8085');
  gun.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'snap') {
      const me = (m.players || []).find(q => q[0] === gunId);
      if (me) gunHp = me[6];
    }
  });
  let gunId = 0;
  gun.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') gunId = m.id; });
  await new Promise(res => gun.on('open', () => { gun.send(JSON.stringify({ t: 'join', name: '枪手', team: 'ct', mode: 'dm', map: 'dust', code })); res(); }));
  await sleep(400);

  const shooter = new WebSocket('ws://127.0.0.1:8085');
  await new Promise(res => shooter.on('open', () => { shooter.send(JSON.stringify({ t: 'join', name: '射手', team: 'ct', mode: 'dm', map: 'dust', code })); res(); }));
  await sleep(500);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8085', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观察员');
  await page.click('#btn-join');
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page.fill('#rooms-code', code);
  await page.click('#rooms-join-code');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1200);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(300);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 12, z: -6 })); // 观察员旁观
  const dogs = () => page.evaluate(() => (window.__lecsLastSnap && window.__lecsLastSnap.dogs) || []);

  console.log('== 1. 摆位后购买哈基狗（死斗免费，出生在主人身边）==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: -10, z: 0 }));
  gun.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: -30, z: -30 })); // 40 米外
  shooter.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: -30, z: 30 })); // 42 米外
  await sleep(600);
  ctl.send(JSON.stringify({ t: 'buy', id: 'hachiko' }));
  await sleep(1000);
  let ds = await dogs();
  console.log('  狗快照:', JSON.stringify(ds));
  check(ds.length === 1 && ds[0][0] === ctlId && ds[0][5] === 40, '购买后生成哈基狗（40 血，归属主人）');

  console.log('== 2. 跟随主人（敌人 40 米外，狗停在主人身边）==');
  await sleep(1200);
  ds = await dogs();
  console.log('  狗位置:', JSON.stringify(ds[0] || null));
  check(ds.length === 1 && Math.abs(ds[0][1] + 10) < 1.0 && Math.abs(ds[0][2]) < 1.8, '狗守在主人身边（x≈-10, z≈0）');
  check(ds[0][4] === 0, '无可见敌人时跟随状态（不追击）');

  console.log('== 3. 敌人开枪打死狗（狗停在主人身后 1.3 米；烟隔断视线防追击；射击线避开主人）==');
  await sleep(1500); // 等狗走到主人身后跟随点 (-10,1.3)
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'smoke', x: -13.5, z: 1.3 })); // 烟隔在狗与射手之间
  shooter.send(JSON.stringify({ t: 'dev', cmd: 'give', weapon: 'ak47' }));
  shooter.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: -17, z: 1.3 })); // 同房间 7 米，z 对齐狗、避开主人
  await sleep(800);
  ds = await dogs();
  console.log('  射击前狗位置:', JSON.stringify(ds[0] || null), '（烟挡住视线，应仍停主人身后）');
  // 按狗的实际位置动态瞄准（射手在 (-17,1.3)）
  const aim = await page.evaluate(() => {
    const d = (window.__lecsLastSnap.dogs || [])[0];
    const sx = -17, sz = 1.3;
    const dx = d[1] - sx, dz = d[2] - sz;
    const dist = Math.hypot(dx, dz) || 1;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan((0.3 - 1.6) / dist) };
  });
  for (let i = 0; i < 4; i++) {
    shooter.send(JSON.stringify({ t: 'input', seq: 50 + i, keys: { fire: true }, yaw: aim.yaw, pitch: aim.pitch, tClient: Date.now() }));
    await sleep(120);
    shooter.send(JSON.stringify({ t: 'input', seq: 60 + i, keys: {}, yaw: aim.yaw, pitch: aim.pitch, tClient: Date.now() }));
    await sleep(350);
  }
  await sleep(1000);
  ds = await dogs();
  console.log('  枪击后狗快照:', JSON.stringify(ds));
  check(ds.length === 0, '狗被打死（快照中消失）');

  console.log('== 4. 重新购买 → 30 米内索敌撕咬（每口 2-5 血）==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'smokeclear' })); // 清掉步骤 3 的烟
  ctl.send(JSON.stringify({ t: 'buy', id: 'hachiko' }));
  await sleep(800);
  gun.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: 8 })); // 枪手 13 米外、视线可见
  shooter.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: -30, z: 30 })); // 射手远离
  await sleep(600);
  ds = await dogs();
  console.log('  枪手 HP:', gunHp, '· 狗状态:', JSON.stringify(ds[0] || null));
  check(ds.length === 1 && ds[0][4] === 1, '30 米内可见敌人 → 狗进入追击状态');
  await sleep(2800); // 跑 13 米 + 咬第一口
  const h1 = gunHp;
  await sleep(1050);
  const h2 = gunHp;
  await sleep(1050);
  const h3 = gunHp;
  console.log('  枪手 HP 变化: ? →', h1, '→', h2, '→', h3);
  const d1 = h1 === -1 ? -1 : (h1 >= 100 ? 0 : 100 - h1); // 初始 100
  check(h2 - h1 <= -2 && h2 - h1 >= -5, '撕咬造成 2-5 伤害（一口 ' + (h1 - h2) + '）');
  check(h3 - h2 <= -2 && h3 - h2 >= -5, '撕咬持续造成 2-5 伤害（一口 ' + (h2 - h3) + '）');

  console.log('== 5. 主人死亡 → 狗直接死亡 ==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', amount: 1000 }));
  await sleep(800);
  ds = await dogs();
  check(ds.length === 0, '主人死亡后狗直接死亡（快照中消失）');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  shooter.close(); gun.close(); ctl.close();
  console.log(failures === 0 ? '\n=== 哈基狗测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
