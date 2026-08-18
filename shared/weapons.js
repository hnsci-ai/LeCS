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
    knife: { id: 'knife', name: '匕首', slot: 0, price: 0, dmg: 25, dmgAlt: 60, rate: 1.1, range: 1.6, spread: 0, mag: 0, reserve: 0, reload: 0, team: null, auto: false, armorPen: 0.5, rangeMod: 1, penetration: 1 },
    usp: { id: 'usp', name: 'USP', slot: 2, price: 500, dmg: 34, rate: 6.9, range: 999, spread: 0.012, spreadMove: 0.045, spreadJump: 0.12, mag: 12, reserve: 100, reload: 2.4, team: 1, auto: false, ammoPrice: 30, armorPen: 0.7, rangeMod: 0.79, penetration: 0.4 },
    glock: { id: 'glock', name: 'Glock18', slot: 2, price: 400, dmg: 25, rate: 9, range: 999, spread: 0.014, spreadMove: 0.05, spreadJump: 0.13, mag: 20, reserve: 120, reload: 2.2, team: 0, auto: false, ammoPrice: 30, armorPen: 0.5, rangeMod: 0.75, penetration: 0.35 },
    deagle: { id: 'deagle', name: '沙漠之鹰', slot: 2, price: 650, dmg: 54, rate: 4, range: 999, spread: 0.018, spreadMove: 0.07, spreadJump: 0.18, mag: 7, reserve: 35, reload: 2.2, team: null, auto: false, ammoPrice: 40, armorPen: 0.75, rangeMod: 0.81, penetration: 0.65 },
    mp5: { id: 'mp5', name: 'MP5', slot: 1, price: 1500, dmg: 26, rate: 13.3, range: 999, spread: 0.014, spreadMove: 0.035, spreadJump: 0.1, mag: 30, reserve: 90, reload: 2.8, team: null, auto: true, ammoPrice: 40, armorPen: 0.75, rangeMod: 0.84, penetration: 0.45 },
    ak47: { id: 'ak47', name: 'AK-47', slot: 1, price: 2500, dmg: 36, rate: 10, range: 999, spread: 0.013, spreadMove: 0.04, spreadJump: 0.11, mag: 30, reserve: 90, reload: 2.5, team: 0, auto: true, ammoPrice: 60, armorPen: 0.75, rangeMod: 0.98, penetration: 0.65 },
    m4a1: { id: 'm4a1', name: 'M4A1', slot: 1, price: 3100, dmg: 32, rate: 11.4, range: 999, spread: 0.011, spreadMove: 0.033, spreadJump: 0.09, mag: 30, reserve: 90, reload: 3.0, team: 1, auto: true, ammoPrice: 60, armorPen: 0.7, rangeMod: 0.97, penetration: 0.6 },
    awp: { id: 'awp', name: 'AWP', slot: 1, price: 4750, dmg: 115, rate: 0.74, range: 999, spread: 0.002, spreadMove: 0.09, spreadJump: 0.2, mag: 10, reserve: 30, reload: 3.6, team: null, auto: false, ammoPrice: 125, bolt: 1.0, armorPen: 0.99, rangeMod: 0.99, penetration: 0.7 },
    hegrenade: { id: 'hegrenade', name: '高爆手雷', slot: 3, price: 300, dmg: 98, rate: 0.5, range: 999, spread: 0, mag: 1, reserve: 0, reload: 0, team: null, auto: false, armorPen: 1, rangeMod: 1, blastRadius: 4.6 }
  };

  // 购买菜单（CS 1.6 风格分组）
  var menu = [
    { name: '手枪', items: ['usp', 'glock', 'deagle'] },
    { name: '冲锋枪', items: ['mp5'] },
    { name: '步枪', items: ['ak47', 'm4a1'] },
    { name: '狙击枪', items: ['awp'] },
    { name: '装备', items: ['kevlar', 'helmet', 'defuse', 'hegrenade'] },
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
