const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');

// ---------- Telegram-бот: кнопка «Играть» по /start (через webhook) ----------
const TOKEN = process.env.BOT_TOKEN, APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
const tg = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).catch(() => {});

const PLAY = APP_URL ? { inline_keyboard: [[{ text: '🃏 Играть', web_app: { url: APP_URL } }], [{ text: '📖 Правила', callback_data: 'rules' }]] } : undefined;
const HELLO = '♠️ <b>Подкидной дурак</b> ♥️\n\nПартии онлайн на 2–6 игроков прямо в Telegram.\n\n🃏 создайте комнату и отправьте код друзьям\n🤖 пустые места займут боты\n💬 чат и реакции за столом\n\nНажмите «Играть» 👇';
const RULES = '📖 <b>Правила</b>\n\n• Колода 36 карт, каждому по 6. Последняя карта колоды задает козырь.\n• Первым ходит владелец младшего козыря.\n• Атакующий кладет карту, защитник бьет её старшей картой той же масти или любым козырем.\n• Подкидывать можно карты тех достоинств, что уже на столе (не больше 6 и не больше, чем карт у защитника).\n• Побили всё: нажмите «Бито», ходит защитник. Не смогли: «Взять».\n• После хода все добирают до 6 карт.\n• Кто остался с картами последним, тот дурак.';
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/api/')) {
    const json = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    (async () => {
      if (q.url.startsWith('/api/top')) return json((await db.top(10)).map(u => ({ name: u.name, photo: u.photo, rating: u.rating, games: u.games, wins: u.wins })));
      if (q.url.startsWith('/api/me')) {
        const d = new URL(q.url, 'http://x').searchParams.get('d'), u = TOKEN && d && db.verify(d, TOKEN);
        return json(u ? await db.getUser('tg' + u.id, String(u.first_name || 'Игрок').slice(0, 24), PHOTO.test(u.photo_url || '') ? u.photo_url : '') : null);
      }
      json(null);
    })().catch(() => { r.writeHead(500); r.end('null'); });
    return;
  }
  if (TOKEN && q.method === 'POST' && q.url === '/tg/' + TOKEN) {
    let s = ''; q.on('data', d => s += d);
    q.on('end', () => {
      r.end('ok');
      try {
        const u = JSON.parse(s), m = u.message, cb = u.callback_query;
        if (cb) {
          tg('answerCallbackQuery', { callback_query_id: cb.id });
          if (cb.data == 'rules') tg('sendMessage', { chat_id: cb.message.chat.id, parse_mode: 'HTML', text: RULES, reply_markup: PLAY });
        } else if (m && m.text && /^\/(start|play|help|rules)/.test(m.text)) {
          const rules = /^\/(help|rules)/.test(m.text);
          tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: rules ? RULES : HELLO, reply_markup: PLAY });
        }
      } catch {}
    });
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  r.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
const wss = new WebSocketServer({ server: srv });
const rooms = {};
const PHOTO = /^https:\/\/[\w.\/-]+$/;
// Кто это: проверенный аккаунт Telegram (рейтинг ведется), иначе гость (без рейтинга)
async function auth(m) {
  if (TOKEN) {
    const u = m.initData && db.verify(m.initData, TOKEN);
    if (u) {
      const prof = await db.getUser('tg' + u.id, String(u.first_name || 'Игрок').slice(0, 24), PHOTO.test(u.photo_url || '') ? u.photo_url.slice(0, 300) : '');
      return { uid: prof.uid, prof };
    }
    return { uid: 'g' + String(m.uid || '').slice(0, 30), prof: null };
  }
  const uid = 'dev' + String(m.uid || '').slice(0, 30);   // локальная проверка без токена
  return { uid, prof: await db.getUser(uid, String(m.name || 'Игрок').slice(0, 24), '') };
}
// Рейтинг: с живыми соперниками ±18/−24, против одних ботов ±6/−8, серия побед +3
function settle(R) {
  R.result = [];
  if (R.loser < 0) return;
  const multi = R.players.filter(p => p.prof).length >= 2;
  R.players.forEach((p, i) => {
    if (!p.prof) return;
    const pr = p.prof, lost = i == R.loser;
    let d = multi ? (lost ? -24 : 18) : (lost ? -8 : 6);
    if (!lost && pr.streak >= 2) d += 3;
    const before = pr.rating; pr.rating = Math.max(100, pr.rating + d);
    pr.games++; if (lost) { pr.losses++; pr.streak = 0; } else { pr.wins++; pr.streak++; }
    db.saveUser(pr);
    R.result.push({ i, d: pr.rating - before, before, after: pr.rating });
  });
}
const BOTN = ['Шулер', 'Профессор', 'Гусар', 'Барон', 'Лиса', 'Граф'];
const EMO = ['👍', '😂', '😮', '😡', '🔥', '👏', '😎', '🤝'];
function bcast(R, o) { R.players.forEach(p => { if (p.ws && p.ws.readyState == 1) p.ws.send(JSON.stringify(o)); }); }

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
  R.table = []; R.over = false; R.loser = -1; R.result = null;
  for (const p of R.players) p.hand = R.deck.splice(0, 6);
  let best = 0, bw = 99;
  R.players.forEach((p, i) => p.hand.forEach(c => { if (c.s == R.trump && c.r < bw) { bw = c.r; best = i; } }));
  R.att = best; R.def = (best + 1) % R.players.length; R.started = true;
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
  if (alive.length <= 1) { R.over = true; R.loser = alive[0] ? R.players.indexOf(alive[0]) : -1; settle(R); return; }
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
      if (o.length) { defend(R, i, o[0], oi); if (Math.random() < .15) bcast(R, { ev: 'react', from: i, e: '😎' }); }
      else { bcast(R, { ev: 'react', from: i, e: '😅' }); take(R, i); }
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
    room: R.code, you: i, host: true, started: R.started, over: R.over, loser: R.loser,
    tc: R.tc, deck: R.deck.length, att: R.att, def: R.def, table: R.table,
    players: R.players.map(p => ({ name: p.name, n: p.hand.length, bot: p.bot, photo: p.photo || '',
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak, since: p.prof.since } : null })),
    result: R.result,
    log: R.log.slice(-30), logN: R.logN,
    hand: R.players[i].hand
  };
}
function send(R) {
  R.players.forEach(p => p.hand.sort((a, b) => w(R, a) - w(R, b) || a.s - b.s));
  R.players.forEach((p, i) => { if (p.ws && p.ws.readyState == 1) p.ws.send(JSON.stringify(stateFor(R, i))); });
  clearTimeout(R.tm);
  if (R.started && !R.over && R.players.some(p => p.bot))
    R.tm = setTimeout(() => { if (botStep(R)) send(R); }, 900);
}
const err = (ws, m) => ws.send(JSON.stringify({ err: m }));

wss.on('connection', ws => {
  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t == 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 8);
      if (!code) return err(ws, 'Введите код комнаты');
      const R = rooms[code] || (rooms[code] = { code, players: [], started: false, over: false, table: [], deck: [], loser: -1, log: [], logN: 0 });
      const A = await auth(m), uid = A.uid;
      const old = uid && R.players.find(p => p.uid == uid);
      if (old) { const o = old.ws; old.ws = ws; old.bot = false; ws.p = old; ws.R = R; if (o && o !== ws) o.close(); return send(R); }
      if (R.started) return err(ws, 'Игра уже идет');
      if (R.players.length >= 6) return err(ws, 'Комната заполнена (максимум 6)');
      const photo = /^https:\/\/[\w.\/-]+$/.test(m.photo || '') ? m.photo.slice(0, 300) : '';
      ws.p = { name: String(m.name || 'Игрок').slice(0, 12), uid, photo: A.prof ? A.prof.photo : '', prof: A.prof, hand: [], bot: false, ws };
      ws.R = R; R.players.push(ws.p);
      return send(R);
    }
    const R = ws.R; if (!R) return;
    const i = R.players.indexOf(ws.p); if (i < 0) return;
    if (m.t == 'chat') {
      const tx = String(m.text || '').trim().slice(0, 80);
      if (tx) { R.log.push({ n: i, name: R.players[i].name, text: tx }); R.log = R.log.slice(-30); R.logN++; }
      return send(R);
    }
    if (m.t == 'react') { if (EMO.includes(m.e)) bcast(R, { ev: 'react', from: i, e: m.e }); return; }
    if (m.t == 'bot' && !R.started && R.players.length < 6)
      R.players.push({ name: BOTN[R.players.length % BOTN.length], hand: [], bot: true, ws: null });
    else if (m.t == 'start' && !R.started && R.players.length >= 2) start(R);
    else if (m.t == 'again' && R.over) start(R);
    else if (R.started && !R.over) {
      if (m.t == 'play') {
        const c = R.players[i].hand[m.i]; if (!c) return;
        if (i == R.def) {
          const oi = (R.table[m.to] && !R.table[m.to].d && beats(R, R.table[m.to].a, c)) ? m.to : R.table.findIndex(t => !t.d && beats(R, t.a, c));
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
    if (ws.p.ws !== ws) return;
    if (R.started) { ws.p.bot = true; ws.p.ws = null; }
    else R.players.splice(i, 1);
    if (!R.players.some(p => p.ws)) { clearTimeout(R.tm); delete rooms[R.code]; }
    else send(R);
  });
});

srv.listen(process.env.PORT || 3000, () => {
  console.log('Дурак запущен на порту', process.env.PORT || 3000);
  if (TOKEN && APP_URL) {
    tg('setWebhook', { url: APP_URL + '/tg/' + TOKEN });
    tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть игру' }, { command: 'rules', description: 'Правила дурака' }] });
    tg('setMyDescription', { description: 'Подкидной дурак онлайн: 2–6 игроков, боты, чат и реакции. Нажмите Start, чтобы играть.' });
    tg('setMyShortDescription', { short_description: 'Подкидной дурак онлайн с друзьями' });
    tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: APP_URL } } });
  }
});
