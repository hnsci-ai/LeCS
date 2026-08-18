// server/bots.js — Bot AI：感知、寻路、战斗、埋包/拆包
'use strict';
const C = require('../shared/constants');
const MAP = require('../shared/mapdata');
const WEAPONS = require('../shared/weapons');

const DIFF = {
  easy: { react: 0.6, aimSpeed: 4.5, aimErr: 0.11, viewRange: 30, burst: 0.35, headshot: false },
  normal: { react: 0.28, aimSpeed: 7.5, aimErr: 0.05, viewRange: 45, burst: 0.6, headshot: false },
  hard: { react: 0.12, aimSpeed: 13, aimErr: 0.012, viewRange: 60, burst: 0.85, headshot: true }
};

function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

class BotBrain {
  constructor(game, bot) {
    this.game = game;
    this.bot = bot;
    this.diff = DIFF.normal;
    this.thinkTimer = Math.random() * 0.2;
    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.target = null;         // 当前敌人
    this.seenTimer = 0;         // 锁定敌人后的反应计时
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.burstTimer = 0;
    this.lastEnemySpot = null;
    this.stuckTimer = 0;
    this.lastPos = null;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.goal = null;
    this.siteChoice = Math.random() < 0.5 ? 'a' : 'b';
    this.bought = false;
  }

  reset() {
    this.path = null; this.target = null; this.bought = false;
    this.lastEnemySpot = null; this.goal = null;
    this.siteChoice = Math.random() < 0.5 ? 'a' : 'b';
    this.aimYaw = this.bot.yaw; this.aimPitch = 0;
  }

  setDifficulty(d) { this.diff = DIFF[d] || DIFF.normal; }

  // ---------- 每 tick ----------
  update(dt) {
    if (!this.bot.alive) {
      this.bot.in.f = this.bot.in.b = this.bot.in.l = this.bot.in.r = false;
      this.bot.in.use = false; this.bot.in.fire = false;
      return;
    }
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.15 + Math.random() * 0.1;
      this.think();
    }
    this.act(dt);
  }

  think() {
    const p = this.bot;
    // 买装备（冻结期）
    if (this.game.phase === C.STATE_FREEZE && !this.bought && this.game.mode === 'classic') {
      this.bought = true;
      this.autoBuy();
    }
    // 感知：找最近可见敌人
    this.target = null;
    let bestD = this.diff.viewRange;
    this.game.players.forEach(v => {
      if (v === p || !v.alive || v.team === p.team) return;
      const dx = v.x - p.x, dz = v.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > bestD) return;
      if (!MAP.losClear(p.x, p.eye, p.z, v.x, v.eye, v.z, 0.2)) return;
      // 视野角
      const ang = Math.atan2(-dx, -dz);
      const fov = Math.abs(angDiff(ang, p.yaw));
      if (fov > 1.2 && d > 14) return;
      bestD = d;
      this.target = v;
    });
    if (this.target && this.target !== this._lastT) { this.seenTimer = this.diff.react; this._lastT = this.target; }
    if (this.target) this.lastEnemySpot = { x: this.target.x, z: this.target.z, t: Date.now() };
    else this._lastT = null;

    // 选择目标点
    this.goal = this.chooseGoal();
    this.repathTimer -= 0.15;
    if (!this.path || this.repathTimer <= 0) {
      this.repathTimer = 0.8 + Math.random() * 0.5;
      this.path = MAP.findPathSmooth(p.x, p.z, this.goal.x, this.goal.z);
      this.pathIdx = 0;
    }
  }

  chooseGoal() {
    const p = this.bot;
    const g = this.game;
    const site = g.mode === 'classic' ? MAP.sites[this.siteChoice] : MAP.sites[Math.random() < 0.5 ? 'a' : 'b'];

    if (g.mode === 'dm') {
      if (this.lastEnemySpot && Date.now() - this.lastEnemySpot.t < 6000) return { x: this.lastEnemySpot.x, z: this.lastEnemySpot.z };
      const s = MAP.sites[Math.random() < 0.5 ? 'a' : 'b'];
      return { x: s.plant.x + (Math.random() - 0.5) * 8, z: s.plant.z + (Math.random() - 0.5) * 8 };
    }

    if (p.team === C.TEAM_T) {
      const bomb = g.bomb;
      if (bomb.state === C.BOMB_CARRIED && bomb.carrier === p) {
        return { x: site.plant.x + (Math.random() - 0.5) * 3, z: site.plant.z + (Math.random() - 0.5) * 3 };
      }
      if (bomb.state === C.BOMB_CARRIED && bomb.carrier && bomb.carrier !== p) {
        return { x: bomb.carrier.x + (Math.random() - 0.5) * 6, z: bomb.carrier.z + (Math.random() - 0.5) * 6 };
      }
      if (bomb.state === C.BOMB_DROPPED) {
        return { x: bomb.x, z: bomb.z };
      }
      if (bomb.state === C.BOMB_PLANTED) {
        return { x: bomb.x + (Math.random() - 0.5) * 8, z: bomb.z + (Math.random() - 0.5) * 8 };
      }
      // 无 C4 信息：进攻站点
      return { x: site.plant.x + (Math.random() - 0.5) * 8, z: site.plant.z + (Math.random() - 0.5) * 8 };
    }
    // CT
    if (g.bomb.state === C.BOMB_PLANTED) {
      // 最近的 CT 去拆弹，其他人掩护
      let nearest = null, nd = 1e9;
      g.players.forEach(v => {
        if (v.team !== C.TEAM_CT || !v.alive) return;
        const d = (v.x - g.bomb.x) ** 2 + (v.z - g.bomb.z) ** 2;
        if (d < nd) { nd = d; nearest = v; }
      });
      if (nearest === p) return { x: g.bomb.x, z: g.bomb.z };
      return { x: g.bomb.x + (Math.random() - 0.5) * 10, z: g.bomb.z + (Math.random() - 0.5) * 10 };
    }
    // 防守：围绕所选站点巡逻
    const s = site;
    return {
      x: s.plant.x + (Math.random() - 0.5) * 14,
      z: s.plant.z + (Math.random() - 0.5) * 14
    };
  }

  autoBuy() {
    const p = this.bot;
    const g = this.game;
    const tryBuy = (id) => { if (g.validateBuy(p, id).ok) g.applyBuy(p, id); };
    const rifle = p.team === C.TEAM_T ? 'ak47' : 'm4a1';
    tryBuy('kevlar');
    tryBuy('helmet');
    if (p.money >= 2500) tryBuy(rifle);
    else if (p.money >= 1500) tryBuy('mp5');
    if (p.team === C.TEAM_CT && p.money >= 200) tryBuy('defuse');
    if (p.money >= 300 && !p.weapons[4]) tryBuy('hegrenade');
    tryBuy('ammo');
  }

  // ---------- 动作 ----------
  act(dt) {
    const p = this.bot;
    const inp = p.in;
    inp.use = false; inp.fire = false; inp.f = false; inp.b = false; inp.l = false; inp.r = false;
    inp.walk = false;

    const t = this.target;
    if (t) {
      // 朝向目标
      const aimPt = this.diff.headshot ? { y: t.y + 1.58 * (t.h / C.PLAYER_H) } : { y: t.y + 1.05 };
      const dy = aimPt.y - p.eye;
      const dx = t.x - p.x, dz = t.z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(dy, dist);
      const err = this.diff.aimErr + Math.sin(Date.now() / 300 + p.id) * 0.008;
      const ey = angDiff(wantYaw, this.aimYaw);
      const ep = (wantPitch - this.aimPitch);
      const maxTurn = this.diff.aimSpeed * dt;
      this.aimYaw += clampMag(ey, maxTurn);
      this.aimPitch += clampMag(ep, maxTurn);
      p.yaw = this.aimYaw;
      p.pitch = clampMag(this.aimPitch, 1.5);

      // 瞄准误差内开火（反应延迟后）
      this.seenTimer -= dt;
      const aimOk = Math.abs(angDiff(this.aimYaw, wantYaw)) < err && Math.abs(this.aimPitch - wantPitch) < err + 0.02;
      if (aimOk && this.seenTimer <= 0 && dist < 55 && Date.now() >= p.nextFire) {
        this.burstTimer += dt;
        if (this.burstTimer < this.diff.burst + Math.random() * 0.3) {
          const w = p.weapons[p.curSlot];
          const wdef = w && WEAPONS.W[w.id];
          if (wdef && !wdef.auto) {
            inp.fire = Math.floor(Date.now() / 150) % 2 === 0; // 半自动：脉冲点击产生击发边沿
          } else {
            inp.fire = true;
          }
        } else { inp.fire = false; }
        if (this.burstTimer > this.diff.burst + 0.6) this.burstTimer = 0;
      }
      // 移动：横向走位
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 0.6 + Math.random() * 0.7;
        this.strafeDir *= -1;
      }
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const wantDist = 8;
      let mx = 0, mz = 0;
      if (dist > wantDist + 4) { mx += fx; mz += fz; }
      else if (dist < wantDist - 4) { mx -= fx; mz -= fz; }
      mx += rx * this.strafeDir; mz += rz * this.strafeDir;
      this.moveToward(mx, mz);
    } else if (this.path && this.pathIdx < this.path.length) {
      // 沿路径走
      const wp = this.path[this.pathIdx];
      const dx = wp.x - p.x, dz = wp.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.7) this.pathIdx++;
      else {
        // 平稳转向
        const wantYaw = Math.atan2(-dx, -dz);
        this.aimYaw += clampMag(angDiff(wantYaw, this.aimYaw), this.diff.aimSpeed * 1.5 * dt);
        p.yaw = this.aimYaw;
        this.moveToward(dx / d, dz / d);
      }
    } else if (this.goal) {
      // 路径走完后的末端逼近（直冲目标，避免停在目标外圈）
      const dx = this.goal.x - p.x, dz = this.goal.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 0.35) {
        const wantYaw = Math.atan2(-dx, -dz);
        this.aimYaw += clampMag(angDiff(wantYaw, this.aimYaw), this.diff.aimSpeed * 1.5 * dt);
        p.yaw = this.aimYaw;
        this.moveToward(dx / d, dz / d);
      }
    }
    // 分离：避免与其他单位重叠
    this.game.players.forEach(v => {
      if (v === p || !v.alive) return;
      const dx = p.x - v.x, dz = p.z - v.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.9 && d > 0.001) {
        const push = (0.9 - d) * 2;
        this.moveToward(dx / d * push, dz / d * push, 0.8);
      }
    });
    // 卡住检测：长时间位移小 → 重新寻路
    const now = Date.now();
    if (this.lastPos && now - this._lastStuckCheck > 1000) {
      const moved = (p.x - this.lastPos.x) ** 2 + (p.z - this.lastPos.z) ** 2;
      if (moved < 0.25 && (inp.f || inp.b || inp.l || inp.r)) {
        this.stuckTimer++;
        if (this.stuckTimer > 2) { this.path = null; this.stuckTimer = 0; this.repathTimer = 0; }
      } else this.stuckTimer = 0;
      this.lastPos = { x: p.x, z: p.z };
      this._lastStuckCheck = now;
    }
    if (!this.lastPos) { this.lastPos = { x: p.x, z: p.z }; this._lastStuckCheck = now; }

    // 换弹：打空必换；低弹且无目标时概率换弹（修复 Bot 不换弹 bug）
    const bw = p.weapons[p.curSlot];
    if (bw && WEAPONS.W[bw.id]) {
      const bdef = WEAPONS.W[bw.id];
      const lowAmmo = bw.mag <= Math.min(5, Math.floor(bdef.mag * 0.2));
      const mustReload = !p.reloading && bw.mag <= 0 && bw.reserve > 0;
      const tactical = !p.reloading && !t && lowAmmo && bw.reserve > 0 && Math.random() < 0.03;
      if (mustReload || tactical) inp.reload = true;
    }

    // 埋包/拆包
    if (this.game.mode === 'classic') {
      if (p.team === C.TEAM_T && this.game.bomb.state === C.BOMB_CARRIED && this.game.bomb.carrier === p && this.game.inSite(p)) {
        inp.use = true; inp.f = inp.b = inp.l = inp.r = false;
      }
      if (p.team === C.TEAM_CT && this.game.bomb.state === C.BOMB_PLANTED) {
        const dx = p.x - this.game.bomb.x, dz = p.z - this.game.bomb.z;
        if (dx * dx + dz * dz < 1.6 * 1.6) { inp.use = true; inp.f = inp.b = inp.l = inp.r = false; }
      }
    }
  }

  moveToward(dx, dz, gain) {
    const p = this.bot;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const f = dx * fx + dz * fz;
    const r = dx * rx + dz * rz;
    const g = gain || 1;
    if (f > 0.15) p.in.f = true;
    else if (f < -0.15) p.in.b = true;
    if (r > 0.15) p.in.r = true;
    else if (r < -0.15) p.in.l = true;
  }
}

function clampMag(v, m) { return v > m ? m : (v < -m ? -m : v); }

module.exports = BotBrain;
