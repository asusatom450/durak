const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  r.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
const wss = new WebSocketServer({ server: srv });
const rooms = {};

// ---------- правила ----------
const w = (R, c) => (c.s == R.trump ? 20 : 0) + c.r;
const beats = (R, a, d) => (d.s == a.s ? d.r > a.r : d.s == R.trump);
const open = R => R.table.some(t => !t.d);
const nxt = (R, i) => {
  const n = R.players.length;
  for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (R.players[j].hand.length) return j; }
  return -1;
};
function newDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 6; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function canAtk(R, i, c) {
  if (i == R.def || !R.players[i].hand.length) return false;
  if (!R.table.length) return i == R.att;
  const unb = R.table.filter(t => !t.d).length;
  return R.table.length < 6 && unb < R.players[R.def].hand.length &&
    R.table.some(t => t.a.r == c.r || (t.d && t.d.r == c.r));
}
function start(R) {
  R.deck = newDeck(); R.tc = R.deck[R.deck.length - 1]; R.trump = R.tc.s;
  R.table = []; R.over = false; R.loser = -1;
  for (const p of R.players) p.hand = R.deck.splice(0, 6);
  R.att = 0; R.def = 1; R.started = true;
}
function endRound(R, took) {
  const n = R.players.length, d = R.players[R.def];
  if (took) for (const t of R.table) { d.hand.push(t.a); if (t.d) d.hand.push(t.d); }
  R.table = [];
  const ord = [];
  for (let k = 0; k < n; k++) { const j = (R.att + k) % n; if (j != R.def) ord.push(j); }
  ord.push(R.def);
  for (const j of ord) { const p = R.players[j]; while (p.hand.length < 6 && R.deck.length) p.hand.push(R.deck.shift()); }
  const alive = R.players.filter(p => p.hand.length);
  if (alive.length <= 1) { R.over = true; R.loser = alive[0] ? R.players.indexOf(alive[0]) : -1; return; }
  const a = took ? nxt(R, R.def) : (d.hand.length ? R.def : nxt(R, R.def));
  R.att = a; R.def = nxt(R, a);
}
const fin = R => { if (!open(R) && !R.players[R.def].hand.length) endRound(R, false); };
function attack(R, i, k) { const c = R.players[i].hand.splice(k, 1)[0]; R.table.push({ a: c }); fin(R); }
function defend(R, i, k, oi) { const c = R.players[i].hand.splice(k, 1)[0]; R.table[oi].d = c; fin(R); }
const take = (R, i) => endRound(R, true);

// ---------- бот (обычный алгоритм) ----------
function botStep(R) {
  for (let i = 0; i < R.players.length; i++) {
    const p = R.players[i]; if (!p.bot) continue;
    const byW = (x, y) => w(R, p.hand[x]) - w(R, p.hand[y]);
    if (i == R.def) {
      const oi = R.table.findIndex(t => !t.d); if (oi < 0) continue;
      const o = p.hand.map((_, k) => k).filter(k => beats(R, R.table[oi].a, p.hand[k])).sort(byW);
      if (o.length) defend(R, i, o[0], oi); else take(R, i);
      return true;
    }
    const c = p.hand.map((_, k) => k).filter(k => canAtk(R, i, p.hand[k])).sort(byW);
    if (c.length && (!R.table.length || p.hand[c[0]].s != R.trump || !R.deck.length)) { attack(R, i, c[0]); return true; }
    if (i == R.att && R.table.length && !open(R)) { endRound(R, false); return true; }
  }
  return false;
}

// ---------- сеть ----------
function stateFor(R, i) {
  return {
    room: R.code, you: i, host: i == 0, started: R.started, over: R.over, loser: R.loser,
    tc: R.tc, deck: R.deck.length, att: R.att, def: R.def, table: R.table,
    players: R.players.map(p => ({ name: p.name, n: p.hand.length, bot: p.bot })),
    hand: R.players[i].hand
  };
}
function send(R) {
  R.players.forEach((p, i) => { if (p.ws && p.ws.readyState == 1) p.ws.send(JSON.stringify(stateFor(R, i))); });
  clearTimeout(R.tm);
  if (R.started && !R.over && R.players.some(p => p.bot))
    R.tm = setTimeout(() => { if (botStep(R)) send(R); }, 900);
}
const err = (ws, m) => ws.send(JSON.stringify({ err: m }));

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t == 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 8);
      if (!code) return err(ws, 'Введите код комнаты');
      const R = rooms[code] || (rooms[code] = { code, players: [], started: false, over: false, table: [], deck: [], loser: -1 });
      if (R.started) return err(ws, 'Игра уже идет');
      if (R.players.length >= 6) return err(ws, 'Комната заполнена (максимум 6)');
      ws.p = { name: String(m.name || 'Игрок').slice(0, 12), hand: [], bot: false, ws };
      ws.R = R; R.players.push(ws.p);
      return send(R);
    }
    const R = ws.R; if (!R) return;
    const i = R.players.indexOf(ws.p); if (i < 0) return;
    if (m.t == 'bot' && i == 0 && !R.started && R.players.length < 6)
      R.players.push({ name: 'Бот ' + R.players.length, hand: [], bot: true, ws: null });
    else if (m.t == 'start' && i == 0 && !R.started && R.players.length >= 2) start(R);
    else if (m.t == 'again' && i == 0 && R.over) start(R);
    else if (R.started && !R.over) {
      if (m.t == 'play') {
        const c = R.players[i].hand[m.i]; if (!c) return;
        if (i == R.def) {
          const oi = R.table.findIndex(t => !t.d && beats(R, t.a, c));
          if (oi >= 0) defend(R, i, m.i, oi);
        } else if (canAtk(R, i, c)) attack(R, i, m.i);
      } else if (m.t == 'take' && i == R.def && open(R)) take(R, i);
      else if (m.t == 'done' && i != R.def && R.table.length && !open(R)) endRound(R, false);
    }
    send(R);
  });
  ws.on('close', () => {
    const R = ws.R; if (!R) return;
    const i = R.players.indexOf(ws.p); if (i < 0) return;
    if (R.started) { ws.p.bot = true; ws.p.ws = null; }
    else R.players.splice(i, 1);
    if (!R.players.some(p => p.ws)) { clearTimeout(R.tm); delete rooms[R.code]; }
    else send(R);
  });
});

srv.listen(process.env.PORT || 3000, () => console.log('Дурак запущен на порту', process.env.PORT || 3000));
