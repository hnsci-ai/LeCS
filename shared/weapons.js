// shared/weapons.js — 武器数值（UMD：服务器与客户端共用）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WEAPONS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // slot: 0 刀 1 主武器 2 手枪 3 手雷 4 C4
  // CS 1.6 真实伤害模型参数：
  //   dmg       = 基础伤害
  //   armorPen  = 护甲穿透系数（命中穿甲部位时伤害 × armorPen；头盔=头部也吃护甲）
  //   rangeMod  = 距离衰减系数（每 500 单位 ≈ 9.525 米伤害 × rangeMod）
  //   penetration = 穿墙伤害系数（单面墙）
  var W = {
    knife: { id: 'knife', name: '匕首', slot: 0, price: 0, dmg: 50, dmgAlt: 100, rate: 1.1, range: 1.6, spread: 0, mag: 0, reserve: 0, reload: 0, team: null, auto: false, armorPen: 0.5, rangeMod: 1, penetration: 1 },
    usp: { id: 'usp', name: 'USP', slot: 2, price: 500, dmg: 34, rate: 6.9, range: 999, spread: 0.012, spreadMove: 0.045, spreadJump: 0.12, mag: 12, reserve: 100, reload: 2.4, team: 1, auto: false, ammoPrice: 30, armorPen: 0.7, rangeMod: 0.79, penetration: 0.4 },
    glock: { id: 'glock', name: 'Glock18', slot: 2, price: 400, dmg: 25, rate: 9, range: 999, spread: 0.014, spreadMove: 0.05, spreadJump: 0.13, mag: 20, reserve: 120, reload: 2.2, team: 0, auto: false, ammoPrice: 30, armorPen: 0.5, rangeMod: 0.75, penetration: 0.35 },
    deagle: { id: 'deagle', name: '沙漠之鹰', slot: 2, price: 650, dmg: 54, rate: 4, range: 999, spread: 0.018, spreadMove: 0.07, spreadJump: 0.18, mag: 7, reserve: 35, reload: 2.2, team: null, auto: false, ammoPrice: 40, armorPen: 0.75, rangeMod: 0.81, penetration: 0.65 },
    mp5: { id: 'mp5', name: 'MP5', slot: 1, price: 1500, dmg: 26, rate: 13.3, range: 999, spread: 0.014, spreadMove: 0.035, spreadJump: 0.1, mag: 30, reserve: 90, reload: 2.8, team: null, auto: true, ammoPrice: 40, armorPen: 0.75, rangeMod: 0.84, penetration: 0.45 },
    ak47: { id: 'ak47', name: 'AK-47', slot: 1, price: 2500, dmg: 36, rate: 10, range: 999, spread: 0.013, spreadMove: 0.04, spreadJump: 0.11, mag: 30, reserve: 90, reload: 2.5, team: 0, auto: true, ammoPrice: 60, armorPen: 0.75, rangeMod: 0.98, penetration: 0.65 },
    m4a1: { id: 'm4a1', name: 'M4A1', slot: 1, price: 3100, dmg: 32, rate: 11.4, range: 999, spread: 0.011, spreadMove: 0.033, spreadJump: 0.09, mag: 30, reserve: 90, reload: 3.0, team: 1, auto: true, ammoPrice: 60, armorPen: 0.7, rangeMod: 0.97, penetration: 0.6 },
    awp: { id: 'awp', name: 'AWP', slot: 1, price: 4750, dmg: 115, rate: 0.74, range: 999, spread: 0.002, spreadMove: 0.09, spreadJump: 0.2, mag: 10, reserve: 30, reload: 3.6, team: null, auto: false, ammoPrice: 125, bolt: 1.0, armorPen: 0.99, rangeMod: 0.99, penetration: 0.7 },
    // ---- 新增手枪 ----
    p228: { id: 'p228', name: 'P228', slot: 2, price: 600, dmg: 32, rate: 6.7, range: 999, spread: 0.016, spreadMove: 0.05, spreadJump: 0.14, mag: 13, reserve: 52, reload: 2.4, team: null, auto: false, ammoPrice: 40, armorPen: 0.6, rangeMod: 0.81, penetration: 0.4 },
    fiveseven: { id: 'fiveseven', name: 'Five-SeveN', slot: 2, price: 750, dmg: 26, rate: 6.7, range: 999, spread: 0.014, spreadMove: 0.045, spreadJump: 0.13, mag: 20, reserve: 100, reload: 2.4, team: 1, auto: false, ammoPrice: 40, armorPen: 0.7, rangeMod: 0.81, penetration: 0.45 },
    elites: { id: 'elites', name: '双持贝雷塔', slot: 2, price: 800, dmg: 36, rate: 13, range: 999, spread: 0.03, spreadMove: 0.07, spreadJump: 0.2, mag: 30, reserve: 120, reload: 3.2, team: 0, auto: false, ammoPrice: 40, armorPen: 0.5, rangeMod: 0.78, penetration: 0.35 },
    // ---- 新增冲锋枪 ----
    tmp: { id: 'tmp', name: 'TMP 消音', slot: 1, price: 1250, dmg: 20, rate: 14.3, range: 999, spread: 0.012, spreadMove: 0.03, spreadJump: 0.09, mag: 30, reserve: 120, reload: 2.4, team: 1, auto: true, ammoPrice: 40, armorPen: 0.6, rangeMod: 0.85, penetration: 0.4 },
    mac10: { id: 'mac10', name: 'MAC-10', slot: 1, price: 1400, dmg: 25, rate: 14.3, range: 999, spread: 0.02, spreadMove: 0.045, spreadJump: 0.12, mag: 30, reserve: 100, reload: 2.9, team: 0, auto: true, ammoPrice: 40, armorPen: 0.5, rangeMod: 0.82, penetration: 0.4 },
    ump45: { id: 'ump45', name: 'UMP45', slot: 1, price: 1700, dmg: 30, rate: 11.1, range: 999, spread: 0.013, spreadMove: 0.032, spreadJump: 0.1, mag: 25, reserve: 100, reload: 3.0, team: null, auto: true, ammoPrice: 40, armorPen: 0.65, rangeMod: 0.82, penetration: 0.45 },
    p90: { id: 'p90', name: 'P90', slot: 1, price: 2350, dmg: 21, rate: 15, range: 999, spread: 0.014, spreadMove: 0.03, spreadJump: 0.09, mag: 50, reserve: 100, reload: 3.2, team: null, auto: true, ammoPrice: 40, armorPen: 0.6, rangeMod: 0.85, penetration: 0.45 },
    // ---- 新增步枪 ----
    galil: { id: 'galil', name: '加利尔', slot: 1, price: 2000, dmg: 30, rate: 11.1, range: 999, spread: 0.012, spreadMove: 0.04, spreadJump: 0.11, mag: 35, reserve: 90, reload: 3.4, team: 0, auto: true, ammoPrice: 60, armorPen: 0.75, rangeMod: 0.98, penetration: 0.6 },
    famas: { id: 'famas', name: 'FAMAS', slot: 1, price: 2250, dmg: 30, rate: 10, range: 999, spread: 0.012, spreadMove: 0.038, spreadJump: 0.1, mag: 25, reserve: 90, reload: 3.2, team: 1, auto: true, ammoPrice: 60, armorPen: 0.75, rangeMod: 0.96, penetration: 0.6 },
    sg552: { id: 'sg552', name: 'SG552', slot: 1, price: 3500, dmg: 33, rate: 11.1, range: 999, spread: 0.011, spreadMove: 0.035, spreadJump: 0.1, mag: 30, reserve: 90, reload: 3.2, team: 0, auto: true, ammoPrice: 60, armorPen: 0.75, rangeMod: 0.96, penetration: 0.6 },
    aug: { id: 'aug', name: 'AUG 突击', slot: 1, price: 3500, dmg: 32, rate: 11.1, range: 999, spread: 0.01, spreadMove: 0.033, spreadJump: 0.09, mag: 30, reserve: 90, reload: 3.2, team: 1, auto: true, ammoPrice: 60, armorPen: 0.75, rangeMod: 0.96, penetration: 0.6, scopeLevels: 1, scopeFov: [40], scopeSpread: 0.004 },
    // ---- 新增狙击枪 ----
    scout: { id: 'scout', name: '轻狙 Scout', slot: 1, price: 2750, dmg: 75, rate: 0.8, range: 999, spread: 0.003, spreadMove: 0.07, spreadJump: 0.18, mag: 10, reserve: 30, reload: 2.7, team: null, auto: false, ammoPrice: 125, armorPen: 0.98, rangeMod: 0.98, penetration: 0.65, scopeLevels: 2, scopeFov: [32, 15], scopeSpread: 0.001 },
    g3sg1: { id: 'g3sg1', name: 'G3SG1 连狙', slot: 1, price: 5000, dmg: 80, rate: 4, range: 999, spread: 0.008, spreadMove: 0.06, spreadJump: 0.16, mag: 20, reserve: 60, reload: 4.2, team: 0, auto: true, ammoPrice: 125, armorPen: 0.9, rangeMod: 0.98, penetration: 0.7, scopeLevels: 1, scopeFov: [28], scopeSpread: 0.002 },
    sg550: { id: 'sg550', name: 'SG550 连狙', slot: 1, price: 4200, dmg: 70, rate: 4, range: 999, spread: 0.008, spreadMove: 0.06, spreadJump: 0.16, mag: 30, reserve: 90, reload: 4.0, team: 1, auto: true, ammoPrice: 125, armorPen: 0.9, rangeMod: 0.98, penetration: 0.7, scopeLevels: 1, scopeFov: [28], scopeSpread: 0.002 },
    // ---- 机枪 ----
    m249: { id: 'm249', name: 'M249 机枪', slot: 1, price: 5750, dmg: 32, rate: 12.5, range: 999, spread: 0.025, spreadMove: 0.05, spreadJump: 0.16, mag: 100, reserve: 200, reload: 5.0, team: null, auto: true, ammoPrice: 75, armorPen: 0.8, rangeMod: 0.97, penetration: 0.65 },
    hegrenade: { id: 'hegrenade', name: '高爆手雷', slot: 3, price: 300, dmg: 98, rate: 0.5, range: 999, spread: 0, mag: 1, reserve: 0, reload: 0, team: null, auto: false, armorPen: 1, rangeMod: 1, blastRadius: 4.6 },
    flashbang: { id: 'flashbang', name: '闪光弹', slot: 3, price: 200, dmg: 0, rate: 0.5, range: 999, spread: 0, mag: 1, reserve: 0, reload: 0, team: null, auto: false, armorPen: 1, rangeMod: 1, blastRadius: 12, flashTime: 4 },
    smokegrenade: { id: 'smokegrenade', name: '烟雾弹', slot: 3, price: 300, dmg: 0, rate: 0.5, range: 999, spread: 0, mag: 1, reserve: 0, reload: 0, team: null, auto: false, armorPen: 1, rangeMod: 1, blastRadius: 4.2, smokeTime: 14 }
  };

  // 购买菜单（CS 1.6 风格分组）
  var menu = [
    { name: '手枪', items: ['usp', 'glock', 'deagle', 'p228', 'fiveseven', 'elites'] },
    { name: '冲锋枪', items: ['mp5', 'tmp', 'mac10', 'ump45', 'p90'] },
    { name: '步枪', items: ['ak47', 'm4a1', 'galil', 'famas', 'sg552', 'aug'] },
    { name: '狙击枪', items: ['awp', 'scout', 'g3sg1', 'sg550'] },
    { name: '机枪', items: ['m249'] },
    { name: '装备', items: ['kevlar', 'helmet', 'defuse', 'hegrenade', 'flashbang', 'smokegrenade'] },
    { name: '弹药', items: ['ammo'] }
  ];

  var gear = {
    kevlar: { id: 'kevlar', name: '防弹衣', price: 650, team: null },
    helmet: { id: 'helmet', name: '头盔', price: 350, team: null },
    defuse: { id: 'defuse', name: '拆弹器', price: 200, team: 1 },
    ammo: { id: 'ammo', name: '弹药', price: 0, team: null }
  };

  return {
    W: W,
    menu: menu,
    gear: gear,
    get: function (id) { return W[id]; }
  };
});
