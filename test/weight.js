// test/weight.js — 武器负重：刀最快、重机枪/大狙慢（CS 1.6 移速规则）
'use strict';
process.env.PORT = '8086';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { WebSocket } = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ws = new WebSocket('ws://127.0.0.1:8086');
  let code = '', z = 0;
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'snap') {
      const me = (m.players || []).find(q => q[0] === myId);
      if (me) z = me[3];
    }
  });
  let myId = 0, seq = 1;
  ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') myId = m.id; });
  await new Promise(res => ws.on('open', () => { ws.send(JSON.stringify({ t: 'join', name: '测速', team: 't', mode: 'test' })); res(); }));
  await sleep(600);
  ws.send(JSON.stringify({ t: 'dev', cmd: 'revive' }));
  await sleep(300);

  // 持某武器从 (0,0) 向前（-z）跑 1.2 秒，返回移动距离
  async function measure(weaponId) {
    ws.send(JSON.stringify({ t: 'dev', cmd: 'give', weapon: weaponId }));
    await sleep(250);
    ws.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: 0 }));
    await sleep(250);
    const z0 = z;
    ws.send(JSON.stringify({ t: 'input', seq: seq++, keys: { f: true }, yaw: 0, pitch: 0, tClient: Date.now() }));
    await sleep(1200);
    ws.send(JSON.stringify({ t: 'input', seq: seq++, keys: {}, yaw: 0, pitch: 0, tClient: Date.now() }));
    await sleep(200);
    return -(z - z0);
  }

  const dKnife = await measure('knife');
  const dUsp = await measure('usp');
  const dM249 = await measure('m249');
  const dAwp = await measure('awp');
  console.log('  移动距离（1.2 秒）：刀', dKnife.toFixed(2), '· USP', dUsp.toFixed(2),
    '· M249', dM249.toFixed(2), '· AWP', dAwp.toFixed(2));

  check(dKnife > dAwp * 1.08, '刀最快：比 AWP 快 8% 以上（' + dKnife.toFixed(2) + ' vs ' + dAwp.toFixed(2) + '）');
  check(Math.abs(dKnife - dUsp) / dKnife < 0.05, '手枪与刀同速（' + dKnife.toFixed(2) + ' vs ' + dUsp.toFixed(2) + '）');
  check(dM249 > dAwp * 1.02, 'M249 略快于 AWP（CS 规则 220 vs 210）');
  check(dKnife > dM249 * 1.08, '重机枪明显慢于刀（' + dKnife.toFixed(2) + ' vs ' + dM249.toFixed(2) + '）');

  ws.close();
  console.log(failures === 0 ? '\n=== 武器负重测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
