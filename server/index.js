// server/index.js — LeCS 服务器：HTTP 静态服务 + WebSocket 房间管理
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Game = require('./game');
const C = require('../shared/constants');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SHARED_DIR = path.join(__dirname, '..', 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ---------- 静态服务 ----------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let base = PUBLIC_DIR;
  if (urlPath.startsWith('/shared/')) { base = SHARED_DIR; urlPath = urlPath.slice('/shared/'.length - 1); } // 共享数据（地图/武器/常量）
  // 安全：限制在允许目录内
  const filePath = path.normalize(path.join(base, urlPath));
  if (!filePath.startsWith(base)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not Found: ' + urlPath);
      return;
    }
    const headers = { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' };
    if (urlPath.startsWith('/shared/') || urlPath.startsWith('/js/') || urlPath.endsWith('.html')) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
});

// ---------- 房间管理 ----------
const rooms = new Map(); // code -> Game
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}
function createRoom(mode) {
  const code = newCode();
  const game = new Game(code, mode);
  rooms.set(code, game);
  game.start();
  console.log(`[房间] 创建 ${code} (${mode})`);
  return game;
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let player = null;
  let game = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || !msg.t) return;

    if (msg.t === 'join') {
      if (player) return;
      const name = String(msg.name || '玩家').slice(0, 16);
      const mode = msg.mode === 'dm' ? 'dm' : 'classic';
      let room = msg.code ? rooms.get(String(msg.code).toUpperCase()) : null;
      if (room && room.mode !== mode) {
        ws.send(JSON.stringify({ t: 'error', text: '该房间模式不匹配（' + room.mode + '）' }));
        return;
      }
      if (room && room.players.size >= C.MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'error', text: '房间已满（最多 ' + C.MAX_PLAYERS + ' 人）' }));
        return;
      }
      if (!room) room = createRoom(mode);
      game = room;
      player = game.addPlayer(ws, name, msg.team || 'auto');
      ws.send(JSON.stringify({
        t: 'joined', id: player.id, code: room.code, mode: room.mode,
        team: player.team, round: room.round, phase: room.phase
      }));
      ws.send(JSON.stringify({ t: 'roster', players: room.roster() }));
      console.log(`[加入] ${name} → 房间 ${room.code} (${room.players.size}人)`);
      return;
    }

    if (!player || !game) return;
    game.onMessage(player, msg);
  });

  ws.on('close', () => {
    if (player && game) {
      game.removePlayer(player.id);
      console.log(`[离开] ${player.name} 离开房间 ${game.code} (${game.players.size}人)`);
      if (game.empty()) {
        game.stop();
        rooms.delete(game.code);
        console.log(`[房间] 关闭 ${game.code}`);
      }
    }
  });

  ws.on('error', () => { /* 忽略 */ });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('======================================');
  console.log('  LeCS — 网页版 CS 1.6 服务器已启动');
  console.log('  本机访问: http://localhost:' + PORT);
  console.log('  局域网:   http://<本机IP>:' + PORT);
  console.log('======================================');
});
