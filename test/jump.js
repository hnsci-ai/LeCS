// test/jump.js — 掩体跳跃：低沙袋(0.8m)可跳上站顶、站顶可自由走动、卡箱可脱困、高木箱跳不上
'use strict';
const MOV = require('../shared/movement');

let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

const BAG = { x1: -1.2, y1: 0, z1: -1.2, x2: 1.2, y2: 0.8, z2: 1.2 };   // 沙袋
const CRATE = { x1: -1.2, y1: 0, z1: -1.2, x2: 1.2, y2: 1.3, z2: 1.2 }; // 高木箱

function mkPlayer(x, y, z, yaw) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: yaw === undefined ? -Math.PI / 2 : yaw, onGround: true, crouch: false, h: 1.72, eye: 1.62 };
}

function run(wall, label, p, frames, mover) {
  const dt = 1 / 60;
  let stoodTop = false;
  for (let i = 0; i < frames; i++) {
    const inp = mover(i) || {};
    MOV.step(p, inp, dt, [wall]);
    if (p.onGround && p.y > 0.7) stoodTop = true;
  }
  console.log(`  ${label}: 最终 x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} 曾站顶=${stoodTop}`);
  return { p, stoodTop };
}

// 1. 助跑跳跃上沙袋
{
  let jumped = false;
  const r = run(BAG, '跳上沙袋(0.8m)', mkPlayer(-3, 0, 0), 180, (i) => {
    if (i > 5 && !jumped) { jumped = true; return { f: true, jump: true }; }
    return { f: true };
  });
  check(r.stoodTop, '沙袋可跳上并站顶');
  check(r.p.x > 1.2, '站顶后可持续前进越过沙袋');
}

// 2. 站在沙袋顶上自由来回走动（不会卡住、不会掉下）
{
  const p = mkPlayer(0, 0.8, 0, -Math.PI / 2); // 已在顶上
  let dir = 1, t = 0, maxAbsX = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 160; i++) {
    t++;
    if (t % 20 === 0) dir = -dir; // 每次只走 0.7 米左右，保持在箱顶范围内
    const inp = dir > 0 ? { f: true, walk: true } : { b: true, walk: true };
    MOV.step(p, inp, dt, [BAG]);
    maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
  }
  console.log(`  沙袋顶来回走动: 最终 x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} 最大|位移|=${maxAbsX.toFixed(2)}`);
  check(p.y >= 0.75, '顶面来回走动不掉下（y=' + p.y.toFixed(2) + '）');
  check(maxAbsX > 0.3, '顶面可自由来回移动（最大位移=' + maxAbsX.toFixed(2) + 'm）');
}

// 3. 卡进箱内（落地在占地内）可走脱困
{
  const r = run(BAG, '卡箱脱困', mkPlayer(0, 0, 0), 120, () => ({ f: true }));
  check(r.p.x > 1.6, '卡在箱内时能走出来（x=' + r.p.x.toFixed(2) + '）');
  check(r.p.y === 0, '脱困后回到地面（y=' + r.p.y.toFixed(2) + '）');
}

// 3.5 提高跳跃高度后：油桶(1.05m)也能跳上
{
  let jumped = false;
  const r = run({ x1: -1.2, y1: 0, z1: -1.2, x2: 1.2, y2: 1.05, z2: 1.2 }, '油桶(1.05m)', mkPlayer(-3, 0, 0), 180, (i) => {
    if (i > 5 && !jumped) { jumped = true; return { f: true, jump: true }; }
    return { f: true };
  });
  check(r.stoodTop, '跳高提高后可跳上油桶站顶');
}

// 4. 高木箱跳不上去
{
  let jumped = false;
  const r = run(CRATE, '高木箱(1.3m)', mkPlayer(-3, 0, 0), 180, (i) => {
    if (i > 5 && !jumped) { jumped = true; return { f: true, jump: true }; }
    return { f: true };
  });
  check(!r.stoodTop, '高木箱跳不上去（无法站顶）');
  check(r.p.x < 0, '被高木箱挡住（x=' + r.p.x.toFixed(2) + '）');
}

console.log(failures === 0 ? '\n=== 跳跃测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
process.exit(failures === 0 ? 0 : 1);
