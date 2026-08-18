// shared/movement.js — 玩家移动物理（UMD，服务器权威 + 客户端预测共用）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mapdata').MAPDATA, require('./constants'));
  else root.MOVEMENT = factory(root.MAPDATA, root.GAMECONST);
})(typeof self !== 'undefined' ? self : this, function (MAP, C) {
  'use strict';

  // p: {x,y,z,vx,vy,vz,yaw,onGround,crouch,h,eye}
  // input: {f,b,l,r,walk,crouch,jump}（jump 为边沿触发，由调用方消费）
  // walls: 可选，指定地图墙体（多地图支持）；缺省用默认地图 MAP.walls
  function step(p, input, dt, walls) {
    var ws = walls || MAP.walls;
    // 蹲伏高度过渡
    var targetH = input.crouch ? C.CROUCH_H : C.PLAYER_H;
    if (targetH < p.h) p.h = Math.max(targetH, p.h - 10 * dt);
    else if (targetH > p.h) p.h = Math.min(targetH, p.h + 10 * dt);
    p.eye = p.h - 0.1;

    // 期望方向（相对视角）
    var fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw); // yaw=0 → -z 前方
    var rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    var wx = 0, wz = 0;
    if (input.f) { wx += fx; wz += fz; }
    if (input.b) { wx -= fx; wz -= fz; }
    if (input.l) { wx -= rx; wz -= rz; } // A = 左移（-右向量）
    if (input.r) { wx += rx; wz += rz; } // D = 右移（+右向量）
    var wl = Math.sqrt(wx * wx + wz * wz);
    if (wl > 1e-6) { wx /= wl; wz /= wl; }

    var maxSpeed = input.walk ? C.WALK_SPEED : (input.crouch ? C.CROUCH_SPEED : C.RUN_SPEED);

    if (p.onGround) {
      var accel = wl > 0 ? C.GROUND_ACCEL : C.STOP_ACCEL;
      var tvx = wx * maxSpeed, tvz = wz * maxSpeed;
      p.vx = approach(p.vx, tvx, accel * dt);
      p.vz = approach(p.vz, tvz, accel * dt);
      if (input.jump) {
        p.vy = C.JUMP_VEL;
        p.onGround = false;
      }
    } else {
      var air = C.AIR_ACCEL;
      var sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
      // 空中仅允许小幅修正
      p.vx = approach(p.vx, wx * Math.max(maxSpeed, sp), air * dt);
      p.vz = approach(p.vz, wz * Math.max(maxSpeed, sp), air * dt);
    }

    // 重力
    p.vy -= C.GRAVITY * dt;
    if (p.vy < -40) p.vy = -40;

    var R = C.PLAYER_R;
    // 分轴移动 + 碰撞
    var nx = p.x + p.vx * dt;
    if (moveAxis(p, 'x', nx, ws)) { p.x = nx; } else { p.vx = 0; }
    var nz = p.z + p.vz * dt;
    if (moveAxis(p, 'z', nz, ws)) { p.z = nz; } else { p.vz = 0; }
    var ny = p.y + p.vy * dt;
    if (ny <= 0) { p.y = 0; if (p.vy < 0) p.vy = 0; if (!p.onGround) { p.onGround = true; } }
    else {
      // 顶部（箱子）站立检测
      var support = findSupport(p, ny, ws);
      if (support !== null) {
        p.y = support;
        if (p.vy < 0) p.vy = 0;
        if (!p.onGround) p.onGround = true;
      } else {
        p.y = ny;
        p.onGround = false;
      }
    }
    return p;
  }

  function approach(v, target, delta) {
    if (v < target) return Math.min(v + delta, target);
    if (v > target) return Math.max(v - delta, target);
    return v;
  }

  function overlaps(x, y, z, r, h, b) {
    return x + r > b.x1 && x - r < b.x2 && y + h > b.y1 && y < b.y2 && z + r > b.z1 && z - r < b.z2;
  }

  function moveAxis(p, axis, nv, ws) {
    var R = C.PLAYER_R;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      var stepable = w.y2 <= 1.1;
      // 低掩体可踩踏（跳上站顶）：顶面 ≤1.1m 的箱子/沙袋，脚部接近顶面时放行碰撞，
      // 跳起后越过顶面由 findSupport 接住；高箱子（>1.1m）仍然挡住
      if (stepable && p.y > w.y2 - 0.35) continue;
      var x = axis === 'x' ? nv : p.x;
      var z = axis === 'z' ? nv : p.z;
      if (overlaps(x, p.y, z, R, p.h, w)) {
        // 脱困：跳跃落空卡进低掩体占地内时（贴地且在箱内），允许朝离开箱体的方向移动走出来
        if (stepable && p.y < w.y2) {
          const cx = (w.x1 + w.x2) / 2, cz = (w.z1 + w.z2) / 2;
          if (axis === 'x') {
            if (Math.abs(p.x - cx) < 0.01 || (p.x > cx ? nv > p.x : nv < p.x)) continue;
          } else {
            if (Math.abs(p.z - cz) < 0.01 || (p.z > cz ? nv > p.z : nv < p.z)) continue;
          }
        }
        return false;
      }
    }
    return true;
  }

  // 站在箱子顶部时返回支撑高度，否则 null
  function findSupport(p, ny, ws) {
    var R = C.PLAYER_R, best = null;
    for (var i = 0; i < ws.length; i++) {
      var w = ws[i];
      if (p.x + R > w.x1 && p.x - R < w.x2 && p.z + R > w.z1 && p.z - R < w.z2) {
        // 落顶吸附：下落中距顶面 0.25m 内即吸附站上（防止起跳高度刚好擦边时落进箱内卡住）
        if (p.y >= w.y2 - 0.25 && ny >= w.y2 - 0.5 && ny <= w.y2 + 0.3) {
          if (best === null || w.y2 < best) best = w.y2;
        }
      }
    }
    return best;
  }

  return { step: step, overlaps: overlaps };
});
