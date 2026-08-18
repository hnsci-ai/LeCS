// shared/constants.js — 服务器与客户端共用的常量（UMD）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAMECONST = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    TICK: 30,                 // 服务器逻辑帧率
    DT: 1 / 30,               // 固定步长
    GRAVITY: 15.2,            // 重力加速度 m/s²（CS 风格）
    RUN_SPEED: 4.7,           // 跑步速度
    WALK_SPEED: 2.35,         // 静步
    CROUCH_SPEED: 1.6,        // 蹲走
    JUMP_VEL: 5.7,            // 起跳速度（跳高约 1.07m，可上沙袋/油桶，木箱需借力）
    AIR_ACCEL: 12,            // 空中加速度
    GROUND_ACCEL: 60,         // 地面加速度
    STOP_ACCEL: 90,           // 减速
    PLAYER_R: 0.32,           // 玩家碰撞半径
    PLAYER_H: 1.72,           // 站立高度
    CROUCH_H: 1.2,            // 蹲下高度
    EYE_H: 1.62,              // 站立视角高度
    EYE_CROUCH: 1.12,         // 蹲下视角高度
    MAX_HP: 100,
    MAX_ARMOR: 100,
    MAX_MONEY: 16000,
    START_MONEY: 800,
    KILL_REWARD: 300,
    PLANT_REWARD: 800,
    ROUND_TIME: 120,          // 回合时间（秒）
    FREEZE_TIME: 6,           // 冻结时间
    BOMB_TIME: 45,            // C4 爆炸计时
    PLANT_TIME: 3,            // 埋包时间
    DEFUSE_TIME: 10,          // 拆包时间（无钳子）
    DEFUSE_TIME_KIT: 5,
    ROUND_END_TIME: 5,        // 回合结束展示时间
    MAX_ROUNDS: 999,
    WIN_REWARD: 3250,         // 获胜奖金
    LOSS_BONUS: [1400, 1900, 2400, 2900, 3400], // 连败补偿（1.6 风格）
    TEAM_T: 0,
    TEAM_CT: 1,
    STATE_FREEZE: 'freeze',
    STATE_LIVE: 'live',
    STATE_END: 'end',
    BOMB_HIDDEN: 'hidden',
    BOMB_CARRIED: 'carried',
    BOMB_DROPPED: 'dropped',
    BOMB_PLANTED: 'planted',
    MAX_PLAYERS: 10
  };
});
