// public/js/hud.js — HUD 显示：血量/弹药/金钱/雷达/击杀榜/购买菜单/记分板
'use strict';
const HUD = (function () {
  const el = {};
  let buyItems = [];
  let lastKillfeedKey = '';
  let bannerTimer = null;
  let msgTimers = [];

  function $(id) { return document.getElementById(id); }

  function init() {
    el.hpVal = $('hp-val'); el.hpFill = $('hp-fill');
    el.armorVal = $('armor-val'); el.armorFill = $('armor-fill');
    el.gearIcons = $('gear-icons');
    el.weaponName = $('weapon-name');
    el.ammoSpecial = $('ammo-special');
    el.ammoMag = $('ammo-mag'); el.ammoRes = $('ammo-res');
    el.money = $('money');
    el.scoreT = $('score-t'); el.scoreCt = $('score-ct');
    el.timer = $('tc-timer'); el.phase = $('tc-phase');
    el.radar = $('radar');
    el.killfeed = $('killfeed');
    el.crosshair = $('crosshair');
    el.hitmarker = $('hitmarker');
    el.scopeOverlay = $('scope-overlay');
    el.dmgInd = $('dmg-ind');
    el.msgCenter = $('msg-center');
    el.banner = $('banner');
    el.progressWrap = $('progress-wrap');
    el.progressBar = $('progress-bar');
    el.progressLabel = $('progress-label');
    el.deathScreen = $('death-screen');
    el.specBanner = $('spec-banner');
    el.roomCode = $('room-code');
    el.buymenu = $('buymenu');
    el.buySections = $('buy-sections');
    el.scoreboard = $('scoreboard');
    el.sbTable = $('sb-table');
    el.sbRound = $('sb-round');
    el.lootPrompt = $('loot-prompt');
    el.lootMenu = $('loot-menu'); el.lootItems = $('loot-items');
    el.fpsVal = $('fps-val'); el.fpsMeter = $('fps-meter'); el.fpsMode = $('fps-mode');
    buildBuyMenu();
  }

  // ---------- 购买菜单 ----------
  function buildBuyMenu() {
    let key = 1;
    const all = [];
    const menu = WEAPONS.menu.concat([]);
    // 弹药类别单独放最后
    for (const sec of menu) {
      const wrap = document.createElement('div');
      wrap.className = 'buy-sec';
      const name = document.createElement('div');
      name.className = 'buy-sec-name';
      name.textContent = sec.name;
      wrap.appendChild(name);
      for (const id of sec.items) {
        const def = WEAPONS.W[id] || WEAPONS.gear[id];
        if (!def) continue;
        const item = document.createElement('div');
        item.className = 'buy-item';
        item.dataset.id = id;
        const showPrice = id === 'ammo' ? '按武器' : '$' + def.price;
        item.innerHTML = `<span class="bi-key">${key}</span><span class="bi-name">${def.name}</span><span class="bi-price">${showPrice}</span>`;
        item.addEventListener('click', () => { Main.buy(id); });
        wrap.appendChild(item);
        all.push({ el: item, id, key: key++, price: def.price, def });
      }
      el.buySections.appendChild(wrap);
    }
    buyItems = all;
  }

  function refreshBuyMenu(myEntry, canBuy) {
    if (el.buymenu.classList.contains('hidden')) return;
    const team = myEntry ? myEntry[8] : -1;
    const money = myEntry ? myEntry[13] : 0;
    const weapon = myEntry ? myEntry[10] : '';
    for (const bi of buyItems) {
      const def = bi.def;
      let disabled = !canBuy;
      let owned = false;
      const cost = bi.id === 'ammo' ? (WEAPONS.W[weapon] ? WEAPONS.W[weapon].ammoPrice || 0 : 0) : bi.price;
      if (def.team !== null && def.team !== undefined && def.team !== team) disabled = true;
      if (def.slot === 1 && weapon === bi.id) owned = true;
      if (def.slot === 2 && weapon === bi.id) owned = true;
      if (bi.id === 'kevlar' && myEntry && myEntry[7] >= 100) owned = true;
      if (bi.id === 'helmet' && myEntry && myEntry[20] === 1) owned = true;
      if (bi.id === 'defuse' && myEntry && myEntry[21] === 1) owned = true;
      if (bi.id === 'hegrenade' && myEntry && myEntry[10] === 'hegrenade') owned = true;
      if (bi.id === 'ammo' && myEntry) {
        const wdef = WEAPONS.W[myEntry[10]];
        if (!wdef || !wdef.ammoPrice || myEntry[12] >= wdef.reserve) disabled = true; // 备弹已满
      }
      // 特殊子弹：同种显示已拥有
      if ((bi.id === 'ammo_incendiary' || bi.id === 'ammo_ap' || bi.id === 'ammo_limb')
        && myEntry && myEntry[30] === bi.id.slice(5)) owned = true;
      if (money < cost) disabled = true;
      bi.el.classList.toggle('disabled', disabled);
      bi.el.classList.toggle('owned', owned);
    }
  }

  function buyKey(n) {
    const bi = buyItems.find(b => b.key === n);
    if (bi && !bi.el.classList.contains('disabled')) Main.buy(bi.id);
  }

  function showBuyMenu(open) {
    el.buymenu.classList.toggle('hidden', !open);
  }
  function buyOpen() { return !!el.buymenu && !el.buymenu.classList.contains('hidden'); }

  // ---------- 记分板 ----------
  function showScoreboard(open, roster, snap) {
    el.scoreboard.classList.toggle('hidden', !open);
    if (!open) return;
    if (snap) el.sbRound.textContent = `第 ${snap.round} 回合 · ${snap.mode === 'dm' ? '死斗' : '经典'}`;
    el.sbTable.innerHTML = '';
    const tRow = document.createElement('div');
    tRow.className = 'sb-row';
    tRow.innerHTML = `<span class="sb-num">阵营</span><span>恐怖分子 T</span><span class="sb-kd" id="sbt-kd">${snap ? snap.scores[0] : 0}</span><span>反恐精英 CT</span><span class="sb-kd">${snap ? snap.scores[1] : 0}</span>`;
    el.sbTable.appendChild(tRow);
    roster.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'sb-row ' + (p.team === 0 ? 't' : 'ct') + (p.id === Main.myId ? ' me' : '');
      const snapP = snap ? snap.players.find(x => x[0] === p.id) : null;
      const k = snapP ? snapP[14] : (p.kills || 0);
      const d = snapP ? snapP[15] : (p.deaths || 0);
      row.innerHTML = `<span class="sb-num">${i + 1}</span><span>${esc(p.name)}${p.bot ? '<span class="sb-bot">BOT</span>' : ''}${p.alive === false ? '<span class="sb-bot" style="color:#888">阵亡</span>' : ''}</span><span class="sb-kd">${k}</span><span class="sb-kd">${d}</span><span class="sb-ping">${p.latency !== undefined ? p.latency : '-'}ms</span>`;
      el.sbTable.appendChild(row);
    });
  }

  function esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

  // ---------- 每帧更新 ----------
  function updateGame(ui) {
    const my = ui.my;
    if (my) {
      el.hpVal.textContent = my[6];
      el.hpFill.style.width = Math.max(0, Math.min(100, my[6])) + '%';
      el.hpFill.style.background = my[6] > 40 ? '' : 'linear-gradient(90deg,#c0392b,#e74c3c)';
      el.armorVal.textContent = my[7];
      el.armorFill.style.width = Math.max(0, Math.min(100, my[7])) + '%';
      el.gearIcons.textContent = (my[20] ? '⛑' : '') + (my[21] ? '🛠' : '') + (my[22] ? '💣' : '') + (ui.dogHp > 0 ? '🐕' + ui.dogHp : '');
      const wname = my[10] ? (WEAPONS.W[my[10]] ? WEAPONS.W[my[10]].name : my[10]) : '';
      // 武器负重提示：重枪显示移速百分比（刀/手枪/冲锋枪不显示）
      const wdef2 = my[10] ? WEAPONS.W[my[10]] : null;
      const speedTag = (wdef2 && wdef2.moveSpeed && wdef2.moveSpeed < 0.99)
        ? '　移速 ' + Math.round(wdef2.moveSpeed * 100) + '%' : '';
      el.weaponName.textContent = wname + speedTag + (my[19] ? '（换弹中…）' : '');
      // 当前特殊子弹徽章（醒目显示：名称+剩余发数+颜色区分）
      const ammoNames = { incendiary: '🔥 燃烧子弹', ap: '🛡 穿甲弹', limb: '🦴 破肢弹' };
      if (el.ammoSpecial) {
        if (my[30] && ammoNames[my[30]]) {
          el.ammoSpecial.textContent = ammoNames[my[30]] + ' ×' + (my[31] || 0);
          el.ammoSpecial.className = 'ammo-' + my[30];
          el.ammoSpecial.classList.remove('hidden');
        } else {
          el.ammoSpecial.classList.add('hidden');
        }
      }
      el.ammoMag.textContent = my[11];
      el.ammoRes.textContent = my[12];
      el.money.textContent = '$' + my[13];
      const scoped = my[29] > 0;
      el.crosshair.style.opacity = my[9] === 1 && !scoped ? 1 : 0;
      el.scopeOverlay.classList.toggle('hidden', !(my[9] === 1 && scoped));

      // 埋包/拆包进度
      const planting = my[23], defusing = my[24];
      if (planting > 0 || defusing > 0) {
        el.progressWrap.classList.remove('hidden');
        const isPlant = planting > 0;
        const pct = isPlant ? planting / GAMECONST.PLANT_TIME : defusing / (my[21] ? GAMECONST.DEFUSE_TIME_KIT : GAMECONST.DEFUSE_TIME);
        el.progressBar.style.setProperty('--p', Math.min(100, pct * 100) + '%');
        el.progressLabel.textContent = isPlant ? '正在安放 C4…' : '正在拆除 C4…';
      } else {
        el.progressWrap.classList.add('hidden');
      }

      // 死亡/观战（ui.dead=真实阵亡；HUD 数值已切换为观战目标）
      const dead = !!ui.dead;
      el.deathScreen.classList.toggle('hidden', !dead);
      el.specBanner.classList.toggle('hidden', !(dead && !!ui.spectator));
    }
    // 比分与计时
    el.scoreT.textContent = ui.scores ? ui.scores[0] : 0;
    el.scoreCt.textContent = ui.scores ? ui.scores[1] : 0;
    const bombPlanted = ui.bomb && ui.bomb[0] === 'planted';
    if (ui.mode === 'dm' && my) {
      el.timer.textContent = '击杀 ' + my[14] + ' · 死亡 ' + my[15];
      el.timer.style.color = '';
    } else if (bombPlanted) {
      const t = Math.max(0, ui.bomb[4]);
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      el.timer.textContent = '💣 ' + m + ':' + String(s).padStart(2, '0');
      el.timer.style.color = '#ff5f4d';
    } else {
      const t = Math.max(0, ui.timeLeft || 0);
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      el.timer.textContent = m + ':' + String(s).padStart(2, '0');
      el.timer.style.color = '';
    }
    if (ui.phase === 'freeze') el.phase.textContent = '❄ 冻结时间 — 按 B 购买装备';
    else if (ui.phase === 'end') el.phase.textContent = '回合结束';
    else if (ui.phase === 'live' && ui.mode === 'dm') el.phase.textContent = '死斗模式';
    else if (ui.phase === 'live' && ui.mode === 'test') el.phase.textContent = '🧪 测试靶场 — Bot 静止 · 尸体保留';
    else if (ui.phase === 'live' && ui.mode === 'hostage') {
      const teamTxt = ui.my ? (ui.my[8] === 0 ? '你是恐怖分子 T · 阻止营救' : '你是反恐精英 CT · 救回人质') : '';
      el.phase.textContent = '人质 ' + (ui.rescued || 0) + '/4 · ' + teamTxt;
    } else if (ui.phase === 'live' && ui.mode === 'armsrace' && ui.my) {
      const lv = ui.my[30] || 0;
      const ladder = (ui.armsLadder || []).map(id => id === 'knife' ? '最终刀战' : (WEAPONS.W[id] ? WEAPONS.W[id].name : id));
      if (!ladder.length) { el.phase.textContent = '军备竞赛'; }
      else if (lv >= ladder.length - 1) {
        el.phase.textContent = '🔪 最终刀战！击杀即夺冠';
      } else {
        const cur = WEAPONS.W[ui.my[10]] ? WEAPONS.W[ui.my[10]].name : ladder[lv];
        el.phase.textContent = '军备竞赛 ' + (lv + 1) + '/' + ladder.length + ' · 当前: ' + cur + ' · 下一把: ' + (ladder[lv + 1] || '冠军');
      }
    }
    else el.phase.textContent = ui.my ? (ui.my[8] === 0 ? '你是恐怖分子 T' : '你是反恐精英 CT') : '';
    el.phase.style.display = el.phase.textContent ? '' : 'none';
  }

  // ---------- 雷达 ----------
  let lastRadarIds = [];
  function updateRadar(myPos, myYaw, players, bomb, hostages) {
    lastRadarIds = players.map(p => p.id); // 测试辅助：雷达实际绘制的人员
    const ctx = el.radar.getContext('2d');
    const S = 170, R = S / 2;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-myYaw);
    const sc = (R - 10) / Math.max(1, MAPDATA.bounds.max + 1); // 像素/米（小地图自动放大）
    // 墙壁
    ctx.fillStyle = 'rgba(210,220,228,0.5)';
    for (const w of MAPDATA.walls) {
      const x = (w.x1 + w.x2) / 2, z = (w.z1 + w.z2) / 2;
      const dx = (w.x2 - w.x1) * sc, dz = (w.z2 - w.z1) * sc;
      if (Math.abs(x) > 34 || Math.abs(z) > 34) continue;
      ctx.fillRect(x * sc - dx / 2, z * sc - dz / 2, dx, dz);
    }
    // 埋包点
    ctx.fillStyle = 'rgba(255,60,40,0.55)';
    for (const key of ['a', 'b']) {
      const s = MAPDATA.sites[key];
      ctx.beginPath();
      ctx.arc(s.plant.x * sc, s.plant.z * sc, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // 玩家
    players.forEach(p => {
      if (p.id === Main.myId) return;
      ctx.fillStyle = p.team === 0 ? '#ffb347' : '#6db4f0';
      ctx.beginPath();
      ctx.arc(p.x * sc, p.z * sc, 3.4, 0, Math.PI * 2);
      ctx.fill();
    });
    // 人质（白点）
    if (hostages) {
      ctx.fillStyle = '#ffffff';
      for (const h of hostages) {
        ctx.beginPath();
        ctx.arc(h[1] * sc, h[3] * sc, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 炸弹
    if (bomb && (bomb[0] === 'dropped' || bomb[0] === 'planted')) {
      const blink = Math.floor(performance.now() / 300) % 2 === 0;
      ctx.fillStyle = blink ? '#ff3b2f' : '#ffc1bc';
      ctx.beginPath();
      ctx.arc(bomb[1] * sc, bomb[3] * sc, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // 自己（中心）
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(R, R, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R - 3.4, R + 5);
    ctx.lineTo(R + 3.4, R + 5);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- 击杀榜 ----------
  function setKillfeed(kf) {
    if (!kf) return;
    const key = kf.map(e => e.k + e.v + e.w + e.h).join('|');
    if (key === lastKillfeedKey) return;
    lastKillfeedKey = key;
    el.killfeed.innerHTML = '';
    kf.forEach(e => {
      const div = document.createElement('div');
      div.className = 'kf-entry ' + (e.kt === 0 ? 't' : 'ct');
      const wn = WEAPONS.W[e.w] ? WEAPONS.W[e.w].name : e.w;
      div.innerHTML = `<span>${esc(e.kn)}</span> <span class="kw">[${esc(wn)}]</span> <span>${esc(e.vn)}</span>${e.h ? ' <span class="hs">☠爆头</span>' : ''}`;
      el.killfeed.appendChild(div);
      while (el.killfeed.children.length > 6) el.killfeed.removeChild(el.killfeed.firstChild);
    });
  }

  // ---------- 反馈 ----------
  function showHit(head) {
    el.hitmarker.classList.remove('show', 'head');
    void el.hitmarker.offsetWidth;
    el.hitmarker.classList.add(head ? 'head' : 'show');
  }

  function showDamage(rel) {
    el.dmgInd.style.opacity = '1';
    el.dmgInd.style.transform = 'rotate(' + ((Math.PI - rel) * 180 / Math.PI) + 'deg)';
    setTimeout(() => { el.dmgInd.style.opacity = '0'; }, 120);
  }

  function showMessage(text, color) {
    const d = document.createElement('div');
    d.className = 'm';
    d.textContent = text;
    d.style.color = color || '';
    el.msgCenter.appendChild(d);
    while (el.msgCenter.children.length > 4) el.msgCenter.removeChild(el.msgCenter.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 4000);
  }

  function showBanner(text, team) {
    el.banner.textContent = text;
    el.banner.className = team === 't' ? 'show t' : 'show ct';
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.banner.className = ''; }, 3200);
  }

  function setRoomCode(code, map) {
    const mapName = map === 'dust2' ? '沙漠二' : (map === 'arms' ? '军备竞技场' : (map === 'test' ? '测试靶场' : (map === 'cross' ? '十字路口' : (map === 'lanes' ? '双道突袭' : '仓库'))));
    el.roomCode.textContent = (code || '----') + (map ? ' · ' + mapName : '');
  }

  function updateLootPrompt(text) {
    if (!el.lootPrompt) return;
    if (text) {
      el.lootPrompt.classList.remove('hidden');
      el.lootPrompt.innerHTML = '按 <b>F</b> 查看战利品 — ' + esc(text);
    } else {
      el.lootPrompt.classList.add('hidden');
    }
  }

  // ---------- 舔包对话框 ----------
  let lootPickCb = null;
  let lootLastKey = '';
  function initLoot(cb) { lootPickCb = cb; }
  function lootOpen() { return !!el.lootMenu && !el.lootMenu.classList.contains('hidden'); }

  function buildLootRows(crate) {
    const rows = [];
    const w1 = crate[4], w2 = crate[5];
    const gids = crate[6] ? String(crate[6]).split(',').filter(Boolean) : [];
    const money = crate[7] || 0;
    if (w1) rows.push({ item: 'w1', name: WEAPONS.W[w1] ? WEAPONS.W[w1].name : w1, sub: '主武器' });
    if (w2) rows.push({ item: 'w2', name: WEAPONS.W[w2] ? WEAPONS.W[w2].name : w2, sub: '副武器' });
    for (const g of gids) rows.push({ item: 'g:' + g, name: WEAPONS.W[g] ? WEAPONS.W[g].name : g, sub: '手雷' });
    if (money > 0) rows.push({ item: 'money', name: '$' + money, sub: '金钱', money: true });
    return rows;
  }

  function renderLoot(crate) {
    if (!el.lootItems) return;
    const key = crate.slice(4).join('|');
    if (key === lootLastKey) return;
    lootLastKey = key;
    const rows = buildLootRows(crate);
    el.lootItems.innerHTML = '';
    if (!rows.length) {
      const d = document.createElement('div');
      d.className = 'lm-empty';
      d.textContent = '箱子已空';
      el.lootItems.appendChild(d);
      return;
    }
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = 'lm-item' + (r.money ? ' lm-money' : '');
      const name = document.createElement('span');
      name.className = 'lm-name';
      name.textContent = r.name;
      const sub = document.createElement('span');
      sub.className = 'lm-sub';
      sub.textContent = r.sub;
      d.appendChild(name); d.appendChild(sub);
      d.addEventListener('dblclick', () => { if (lootPickCb) lootPickCb(r.item); });
      el.lootItems.appendChild(d);
    }
  }

  function openLootMenu(crate) {
    if (!el.lootMenu || !crate) return;
    lootLastKey = '';
    el.lootMenu.classList.remove('hidden');
    renderLoot(crate);
  }
  function updateLootMenu(crate) { if (lootOpen()) renderLoot(crate); }
  function closeLootMenu() {
    if (el.lootMenu) el.lootMenu.classList.add('hidden');
    lootLastKey = '';
  }

  // 每秒更新一次的帧率显示（low = 低画质；manual = null 自动 / true/false 手动档）
  function updateFps(fps, low, manual) {
    if (!el.fpsVal) return;
    el.fpsVal.textContent = fps;
    el.fpsMeter.classList.toggle('low', fps < 30);
    el.fpsMode.textContent = manual !== null ? (low ? '· 低画质' : '· 高画质') : (low ? '· 自动低画质' : '');
  }

  return {
    _debugRadar: () => lastRadarIds.slice(),
    init, updateGame, updateRadar, setKillfeed, showHit, showDamage,
    showMessage, showBanner, setRoomCode, showBuyMenu, refreshBuyMenu,
    buyOpen, buyKey, showScoreboard, updateLootPrompt, updateFps,
    initLoot, lootOpen, openLootMenu, updateLootMenu, closeLootMenu
  };
})();
