const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');
const { Chess } = require('./chess-lib.js');   // правила шахмат: chess.js, положен в проект целиком

// ---------- Telegram-бот: кнопка «Играть» по /start (через webhook) ----------
const TOKEN = process.env.BOT_TOKEN, APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
const tg = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).catch(() => {});

const KB_D = APP_URL ? { inline_keyboard: [[{ text: '🃏 Играть в дурака', web_app: { url: APP_URL } }], [{ text: '📖 Правила', callback_data: 'rules_durak' }]] } : undefined;
const KB_C = APP_URL ? { inline_keyboard: [[{ text: '♞ Играть в шахматы', web_app: { url: APP_URL + '/chess' } }], [{ text: '📖 Правила', callback_data: 'rules_chess' }]] } : undefined;
const WAIT = '<i>⏳ Первый вход может занять 30–60 секунд: сервер просыпается. Просто подождите, и игра откроется.</i>';
const CARD_D = `🃏 <b>ПОДКИДНОЙ ДУРАК</b>
𝗢𝗡𝗟𝗜𝗡𝗘 · 𝟮–𝟲 𝗣𝗟𝗔𝗬𝗘𝗥𝗦

<i>Классическая карточная игра с друзьями или ботами.</i>

<blockquote>🃏 Создайте комнату и отправьте код друзьям
🤖 Пустые места займут боты
💬 Чат, реакции и радио за столом
🏆 Рейтинг и ранги: от Новичка до Легенды</blockquote>

${WAIT}`;
const CARD_C = `♞ <b>ШАХМАТЫ</b>
𝗢𝗡𝗟𝗜𝗡𝗘 · 𝟭 𝗩𝗦 𝟭

<i>Партии с друзьями или против компьютера, с шахматными часами.</i>

<blockquote>⏱ Время на партию: 3, 5, 10 или 15 минут
🤖 Игра против компьютера
🤝 Сдача и ничья по согласию
🏅 Свой рейтинг и ранги: от Пешки до Короля</blockquote>

${WAIT}`;
const RULES_C = `📖 <b>ПРАВИЛА ШАХМАТ</b>
𝗖𝗛𝗘𝗦𝗦

<blockquote>♟ <b>Пешка:</b> вперед на 1 клетку (с исходной позиции можно на 2), бьет по диагонали вперед.
♞ <b>Конь:</b> ходит буквой «Г», перепрыгивает фигуры.
♝ <b>Слон:</b> по диагоналям.
♜ <b>Ладья:</b> по горизонталям и вертикалям.
♛ <b>Ферзь:</b> как ладья и слон вместе.
♚ <b>Король:</b> на 1 клетку в любую сторону.</blockquote>

<b>Особые ходы:</b> рокировка, взятие на проходе, превращение пешки (в ферзя, ладью, слона или коня).

<b>Конец партии</b>
⚠️ <b>Шах:</b> король под ударом, его нужно защитить.
🏆 <b>Мат:</b> шах, от которого не спастись: вы проиграли.
🤝 <b>Ничья:</b> пат, троекратное повторение, 50 ходов без взятий и ходов пешек, мало фигур или по согласию.
⏱ Закончилось время: поражение.

<b>Как играть:</b> нажмите на свою фигуру, затем на клетку с точкой. Кнопки внизу: 🏳 сдаться, 🤝 предложить ничью.

<b>Рейтинг</b> считается по системе Эло. Партии с компьютером и очень короткие рейтинг не меняют.`;
const RULES = `📖 <b>ПРАВИЛА ИГРЫ</b>
𝗣𝗢𝗗𝗞𝗜𝗗𝗡𝗢𝗬 𝗗𝗨𝗥𝗔𝗞

<blockquote>🃏 <b>Колода:</b> 36 карт, каждому по 6. Последняя карта колоды задает козырь.
🎯 <b>Первый ход:</b> у владельца младшего козыря.
⚔️ <b>Атака и защита:</b> побейте карту старшей картой той же масти или любым козырем.
➕ <b>Подкидывать</b> можно карты тех достоинств, что уже лежат на столе (не больше 6 и не больше, чем карт у защитника).</blockquote>

✅ Всё побито: нажмите <b>«Бито»</b>, ходит защитник.
🤲 Не можете побить: нажмите <b>«Взять»</b>.
🔄 После хода все добирают карты до 6.
🤡 Кто остался с картами последним, тот <b>дурак</b>.`;
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/api/')) {
    const json = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    (async () => {
      const gp = new URL(q.url, 'http://x').searchParams, g = gp.get('g') == 'chess' ? 'chess' : 'durak';
      if (q.url.startsWith('/api/top')) return json((await db.top(10, g)).map(u => ({ name: u.name, photo: u.photo, rating: u.rating, games: u.games, wins: u.wins })));
      if (q.url.startsWith('/api/me')) {
        const d = gp.get('d'), u = TOKEN && d && db.verify(d, TOKEN);
        return json(u ? await db.getUser('tg' + u.id, String(u.first_name || 'Игрок').slice(0, 24), PHOTO.test(u.photo_url || '') ? u.photo_url : '', g) : null);
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
        const msg = (chat, text, kb) => tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text, reply_markup: kb });
        if (cb) {
          tg('answerCallbackQuery', { callback_query_id: cb.id });
          const ch = cb.message.chat.id;
          if (cb.data == 'rules_chess') msg(ch, RULES_C, KB_C);
          else if (cb.data == 'rules_durak' || cb.data == 'rules') msg(ch, RULES, KB_D);
        } else if (m && m.text) {
          const t = m.text, id = m.chat.id;
          if (/^\/start/.test(t)) msg(id, CARD_D, KB_D).then(() => msg(id, CARD_C, KB_C));   // две отдельные карточки
          else if (/^\/durak/.test(t)) msg(id, CARD_D, KB_D);
          else if (/^\/chess/.test(t)) msg(id, CARD_C, KB_C);
          else if (/^\/(rules|help)/.test(t)) msg(id, RULES, KB_D).then(() => msg(id, RULES_C, KB_C));
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
// Радио: каждый телефон качает поток сам, через сервер трафик не идет. Список можно менять здесь, без правки приложения.
const STATIONS = [
  { id: 'hit', name: 'Hit FM', url: 'https://online.hitfm.ua/HitFM_HD' },
  { id: 'kiss', name: 'KISS FM', url: 'https://online.kissfm.ua/KissFM' },
  { id: 'nrj', name: 'NRJ (320 кбит/с)', url: 'https://cast.mediaonline.net.ua/nrj320' },
  { id: 'relax', name: 'Radio Relax', url: 'https://online.radiorelax.ua/RadioRelax_HD' },
  { id: 'lux', name: 'Lux FM', url: 'https://lux.radio.tvstitch.com/kyiv/lux_adv_sd' }
];
// Бездействие в свой ход: предупреждение, штраф рейтинга, исключение
const AFK_WARN = +process.env.AFK_WARN_MS || 50000, AFK_FINE = +process.env.AFK_FINE_MS || 80000,
  AFK_KICK = +process.env.AFK_KICK_MS || 180000, AFK_PEN = 10;
const GRACE = +process.env.GRACE_MS || 60000;
function sys(R, text) { R.log.push({ n: -1, name: '', text }); R.log = R.log.slice(-30); R.logN++; }
const PHOTO = /^https:\/\/[\w.\/-]+$/;
// Кто это: проверенный аккаунт Telegram (рейтинг ведется), иначе гость (без рейтинга)
async function auth(m, game) {
  if (TOKEN) {
    const u = m.initData && db.verify(m.initData, TOKEN);
    if (u) {
      const prof = await db.getUser('tg' + u.id, String(u.first_name || 'Игрок').slice(0, 24), PHOTO.test(u.photo_url || '') ? u.photo_url.slice(0, 300) : '', game);
      return { uid: prof.uid, prof };
    }
    return { uid: 'g' + String(m.uid || '').slice(0, 30), prof: null };
  }
  const uid = 'dev' + String(m.uid || '').slice(0, 30);   // локальная проверка без токена
  return { uid, prof: await db.getUser(uid, String(m.name || 'Игрок').slice(0, 24), '', game) };
}
// Рейтинг: с живыми соперниками ±18/−24, против одних ботов ±6/−8, серия побед +3
function settle(R) {
  R.result = [];
  if (R.loser < 0) return;
  const multi = R.players.filter(p => p.prof).length >= 2;
  R.players.forEach((p, i) => {
    if (!p.prof) return;
    const pr = p.prof, lost = i == R.loser || !!p.left;
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
function start(R) { R.mv++;
  R.players = R.players.filter(p => p.bot || (p.ws && !p.left));
  R.players.forEach(p => { p.off = false; clearTimeout(p.tm); });
  if (R.players.length < 2) { R.started = false; R.over = false; return; }
  R.deck = newDeck(); R.tc = R.deck[R.deck.length - 1]; R.trump = R.tc.s;
  R.table = []; R.over = false; R.loser = -1; R.result = null;
  for (const p of R.players) p.hand = R.deck.splice(0, 6);
  let best = 0, bw = 99;
  R.players.forEach((p, i) => p.hand.forEach(c => { if (c.s == R.trump && c.r < bw) { bw = c.r; best = i; } }));
  R.att = best; R.def = (best + 1) % R.players.length; R.started = true;
}
function endRound(R, took) { R.mv++;
  const n = R.players.length, d = R.players[R.def];
  if (took) for (const t of R.table) { d.hand.push(t.a); if (t.d) d.hand.push(t.d); }
  R.table = [];
  const ord = [];
  for (let k = 0; k < n; k++) { const j = (R.att + k) % n; if (j != R.def) ord.push(j); }
  ord.push(R.def);
  for (const j of ord) { const p = R.players[j]; if (p.left) continue; while (p.hand.length < 6 && R.deck.length) p.hand.push(R.deck.shift()); }
  const alive = R.players.filter(p => p.hand.length);
  if (alive.length <= 1) { R.over = true; R.loser = alive[0] ? R.players.indexOf(alive[0]) : -1; settle(R); return; }
  const a = took ? nxt(R, R.def) : (d.hand.length ? R.def : nxt(R, R.def));
  R.att = a; R.def = nxt(R, a);
}
const fin = R => { if (!open(R) && !R.players[R.def].hand.length) endRound(R, false); };
function attack(R, i, k) { R.mv++; const c = R.players[i].hand.splice(k, 1)[0]; R.table.push({ a: c }); fin(R); }
function defend(R, i, k, oi) { R.mv++; const c = R.players[i].hand.splice(k, 1)[0]; R.table[oi].d = c; fin(R); }
const take = (R, i) => endRound(R, true);

function drop(R, p) { R.mv++; if (R.game === 'chess') return chDrop(R, p);
  const i = R.players.indexOf(p); if (i < 0 || p.left) return;
  p.left = true; p.off = false; p.hand = [];
  sys(R, p.name + ' покинул игру');
  if (!R.started || R.over) return;
  const alive = R.players.filter(q => q.hand.length);
  if (alive.length <= 1) { R.over = true; R.loser = i; settle(R); return; }
  if (i == R.def || (i == R.att && R.table.length)) endRound(R, false);   // карты со стола уходят в отбой
  else if (i == R.att) { R.att = nxt(R, i); R.def = nxt(R, R.att); }
}

// кто сейчас должен ходить: без него партия стоит
const actor = R => !R.table.length ? R.att : (open(R) ? R.def : R.att);
const notify = (p, o) => { if (p.ws && p.ws.readyState == 1) p.ws.send(JSON.stringify(o)); };
function afkTick(R) {
  if (R.game === 'chess') return chTick(R);
  if (!R.started || R.over) { R.idleKey = null; return; }
  const i = actor(R), p = R.players[i], key = R.mv + ':' + i;
  if (R.idleKey !== key) { R.idleKey = key; R.idleSince = Date.now(); R.warned = R.fined = false; return; }
  if (!p || p.bot || p.left || p.off) return;   // боты ходят сами, у отключившегося свои правила
  const el = Date.now() - R.idleSince;
  if (el >= AFK_KICK) {
    sys(R, `🚪 ${p.name} исключен за бездействие`); notify(p, { ev: 'afk', stage: 'kick' }); drop(R, p); send(R);
  } else if (el >= AFK_FINE && !R.fined) {
    R.fined = true;
    let d = 0;
    if (p.prof && (p.fines || 0) < 2) { p.fines = (p.fines || 0) + 1; const b = p.prof.rating; p.prof.rating = Math.max(100, b - AFK_PEN); d = p.prof.rating - b; db.saveUser(p.prof); }
    sys(R, d ? `⚠️ ${p.name}: ${d} к рейтингу за бездействие` : `⚠️ ${p.name} все еще не ходит`);
    notify(p, { ev: 'afk', stage: 'fine', d }); send(R);
  } else if (el >= AFK_WARN && !R.warned) {
    R.warned = true; sys(R, `⏳ ${p.name} долго думает`); notify(p, { ev: 'afk', stage: 'warn' }); send(R);
  }
}

// ================= ШАХМАТЫ =================
const CH_TC = [3, 5, 10, 15], PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const chOther = c => (c == 'w' ? 'b' : 'w');
function chStart(R, tc) {
  const again = R.over;
  R.players = R.players.filter(p => p.bot || (p.ws && !p.left));
  R.players.forEach(p => { p.off = false; clearTimeout(p.tm); });
  if (R.players.length < 2) { R.started = false; R.over = false; return; }
  R.col = again && R.col ? [R.col[1], R.col[0]] : (Math.random() < .5 ? ['w', 'b'] : ['b', 'w']);
  const ms = (CH_TC.includes(tc) ? tc : 10) * 60000;
  R.ch = new Chess(); R.started = true; R.over = false; R.result = null; R.rres = null; R.draw = null; R.last = null;
  R.tc = ms / 60000; R.cl = { w: ms, b: ms, since: Date.now() }; R.mv++;
}
function chElo(R) {
  const [a, b] = R.players;
  if (!a.prof || !b.prof || a.bot || b.bot || R.ch.history().length < 4) return;
  const sa = !R.result.winner ? .5 : (R.col[0] == R.result.winner ? 1 : 0);
  const d = Math.round(32 * (sa - 1 / (1 + Math.pow(10, (b.prof.rating - a.prof.rating) / 400))));
  R.rres = [];
  [[a, 0, d, sa], [b, 1, -d, 1 - sa]].forEach(([p, i, dd, sc]) => {
    const pr = p.prof, before = pr.rating;
    pr.rating = Math.max(100, before + dd); pr.games++;
    if (sc == 1) pr.wins++; else if (sc == 0) pr.losses++; else pr.draws = (pr.draws || 0) + 1;
    db.saveUser(pr); R.rres.push({ i, d: pr.rating - before, before, after: pr.rating });
  });
}
function chEnd(R, res) { if (R.over) return; R.over = true; R.result = res; R.draw = null; chElo(R); }
function chMove(R, i, m) {
  const c = R.col[i]; if (R.ch.turn() !== c) return;
  const promo = ['q', 'r', 'b', 'n'].includes(m.promo) ? m.promo : undefined;
  let mv; try { mv = R.ch.move({ from: m.from, to: m.to, promotion: promo }); } catch { return; }
  const now = Date.now(); R.cl[c] -= now - R.cl.since; R.cl.since = now;
  if (R.cl[c] <= 0) { R.cl[c] = 0; return chEnd(R, { winner: chOther(c), reason: 'time' }); }
  R.last = { from: mv.from, to: mv.to }; R.draw = null; R.mv++;
  if (R.ch.isCheckmate()) chEnd(R, { winner: c, reason: 'mate' });
  else if (R.ch.isStalemate()) chEnd(R, { winner: null, reason: 'stalemate' });
  else if (R.ch.isThreefoldRepetition()) chEnd(R, { winner: null, reason: 'repetition' });
  else if (R.ch.isInsufficientMaterial()) chEnd(R, { winner: null, reason: 'insufficient' });
  else if (R.ch.isDraw()) chEnd(R, { winner: null, reason: 'fifty' });
}
function chDrop(R, p) {
  if (p.left) return; p.left = true; p.off = false;
  sys(R, p.name + ' покинул игру');
  if (R.started && !R.over) chEnd(R, { winner: chOther(R.col[R.players.indexOf(p)]), reason: 'leave' });
}
function chTick(R) {
  if (!R.started || R.over) return;
  const c = R.ch.turn();
  if (R.cl[c] - (Date.now() - R.cl.since) <= 0) { R.cl[c] = 0; chEnd(R, { winner: chOther(c), reason: 'time' }); send(R); }
}
function chMsg(R, i, m) {
  const playing = R.started && !R.over, c = R.col && R.col[i];
  if (m.t == 'bot') { if (!R.started && R.players.length < 2) R.players.push({ name: 'Компьютер', hand: [], bot: true, ws: null }); }
  else if (m.t == 'start') { if (!R.started && R.players.length >= 2) chStart(R, +m.tc); }
  else if (m.t == 'again') { if (R.over) chStart(R, R.tc); }
  else if (m.t == 'move') { if (playing) chMove(R, i, m); }
  else if (m.t == 'resign') { if (playing) chEnd(R, { winner: chOther(c), reason: 'resign' }); }
  else if (m.t == 'draw') {
    if (!playing) return;
    R.draw = i;
    const oi = 1 - i, op = R.players[oi];
    if (op.bot) {   // компьютер соглашается, если не выигрывает
      if (chEval(R.ch, R.col[oi]) <= 0) chEnd(R, { winner: null, reason: 'agreed' });
      else { R.draw = null; sys(R, 'Компьютер отклонил ничью'); }
    }
  }
  else if (m.t == 'accept') { if (playing && R.draw != null && R.draw !== i) chEnd(R, { winner: null, reason: 'agreed' }); }
  else if (m.t == 'decline') { if (playing && R.draw != null && R.draw !== i) { R.draw = null; sys(R, R.players[i].name + ' отклонил ничью'); } }
}
// Компьютер: перебор на 2 хода вперед по материалу (уровень «любитель»)
function chEval(ch, color) {
  let s = 0;
  const rows = ch.board();   // + небольшой бонус за центр для пешек и легких фигур: компьютер начинает осмысленнее
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const x = rows[r][c]; if (!x) continue;
    let pos = 0;
    if (x.type == 'p') pos = (x.color == 'w' ? 6 - r : r - 1) * (c == 3 || c == 4 ? 8 : (c == 2 || c == 5 ? 3 : 0));   // центральные пешки идут вперед
    else if (x.type == 'n' || x.type == 'b') pos = (7 - Math.abs(c - 3.5) - Math.abs(r - 3.5)) * 3;
    s += (x.color == color ? 1 : -1) * (PV[x.type] + pos);
  }
  return s;
}
function chBotPick(ch) {
  const color = ch.turn(); let best = -1e9, pick = null;
  for (const m of ch.moves({ verbose: true })) {
    ch.move(m); let sc;
    if (ch.isCheckmate()) sc = 1e6;
    else {
      const rs = ch.moves({ verbose: true }); let worst = 1e9;
      if (!rs.length) worst = 0;
      else for (const r of rs) { ch.move(r); let v = ch.isCheckmate() ? -1e6 : chEval(ch, color); ch.undo(); if (v < worst) worst = v; }
      sc = worst;
    }
    ch.undo(); sc += Math.random() * 15;
    if (sc > best) { best = sc; pick = m; }
  }
  return pick;
}
function chSchedule(R) {
  if (!R.started || R.over) return;
  const ti = R.col.indexOf(R.ch.turn());
  if (!R.players[ti] || !R.players[ti].bot) return;
  const key = R.mv;
  R.tm = setTimeout(() => {
    if (!R.started || R.over || R.mv !== key) return;
    const m = chBotPick(R.ch); if (!m) return;
    chMove(R, ti, { from: m.from, to: m.to, promo: m.promotion }); send(R);
  }, 700 + Math.random() * 700);
}
function chState(R, i) {
  const me = R.col ? R.col[i] : null, now = Date.now(), playing = R.started && !R.over;
  const moves = {}, promo = [];
  if (playing && R.ch.turn() === me) for (const m of R.ch.moves({ verbose: true })) {
    (moves[m.from] = moves[m.from] || []).push(m.to);
    if (m.promotion && !promo.includes(m.from + m.to)) promo.push(m.from + m.to);
  }
  const turn = R.ch ? R.ch.turn() : 'w';
  return {
    game: 'chess', room: R.code, you: i, host: true, started: R.started, over: R.over, status: playing ? 'play' : (R.over ? 'over' : 'lobby'),
    col: me, fen: R.ch ? R.ch.fen() : '', turn, check: R.ch ? R.ch.isCheck() : false, last: R.last || null,
    hist: R.ch ? R.ch.history() : [], moves, promo, draw: R.draw ?? null, tc: R.tc || 10,
    clk: R.cl ? { w: R.cl.w - (playing && turn == 'w' ? now - R.cl.since : 0), b: R.cl.b - (playing && turn == 'b' ? now - R.cl.since : 0), turn, run: playing } : null,
    result: R.result || null, win: R.result ? (R.result.winner ? R.col.indexOf(R.result.winner) : -1) : null, rres: R.rres || null,
    players: R.players.map((p, j) => ({
      name: p.name, bot: p.bot, photo: p.photo || '', off: !!p.off, left: !!p.left, col: R.col ? R.col[j] : null, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, draws: p.prof.draws || 0, streak: 0, since: p.prof.since } : null
    })),
    log: R.log.slice(-30), logN: R.logN, radio: R.radio || null, now
  };
}

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
  if (R.game === 'chess') return chState(R, i);
  return {
    game: 'durak', room: R.code, you: i, host: true, started: R.started, over: R.over, loser: R.loser,
    tc: R.tc, deck: R.deck.length, att: R.att, def: R.def, table: R.table,
    players: R.players.map(p => ({ name: p.name, n: p.hand.length, bot: p.bot, photo: p.photo || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - Date.now()) : 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak, since: p.prof.since } : null })),
    result: R.result, radio: R.radio || null, now: Date.now(),
    idle: R.started && !R.over && R.idleKey === R.mv + ':' + actor(R) ? { i: actor(R), ms: Date.now() - R.idleSince, warn: AFK_WARN, fine: AFK_FINE, kick: AFK_KICK } : null,
    log: R.log.slice(-30), logN: R.logN,
    hand: R.players[i].hand
  };
}
function send(R) {
  R.players.forEach(p => p.hand.sort((a, b) => w(R, a) - w(R, b) || a.s - b.s));
  R.players.forEach((p, i) => { if (p.ws && p.ws.readyState == 1) p.ws.send(JSON.stringify(stateFor(R, i))); });
  clearTimeout(R.tm);
  if (R.game === 'chess') return chSchedule(R);
  if (R.started && !R.over && R.players.some(p => p.bot))
    R.tm = setTimeout(() => { if (botStep(R)) send(R); }, 900);
}
const err = (ws, m) => ws.send(JSON.stringify({ err: m }));

wss.on('connection', ws => {
  ws.send(JSON.stringify({ ev: 'stations', list: STATIONS }));
  ws.on('message', async raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t == 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 8);
      if (!code) return err(ws, 'Введите код комнаты');
      if (rooms[code] && rooms[code].game !== (m.game == 'chess' ? 'chess' : 'durak')) return err(ws, rooms[code].game == 'chess' ? 'Это комната для шахмат' : 'Это комната для дурака');
      const R = rooms[code] || (rooms[code] = { code, players: [], started: false, over: false, table: [], deck: [], loser: -1, log: [], logN: 0, mv: 0, game: m.game == 'chess' ? 'chess' : 'durak' });
      const A = await auth(m, R.game), uid = A.uid;
      const old = uid && R.players.find(p => p.uid == uid);
      if (old) {
        if (old.left) return err(ws, 'Вы покинули эту партию. Дождитесь ее окончания.');
        const o = old.ws; old.ws = ws; ws.p = old; ws.R = R; clearTimeout(R.gc); R.idleKey = null;
        if (old.off) { clearTimeout(old.tm); old.off = false; sys(R, old.name + ' вернулся'); }
        if (o && o !== ws) o.close();
        return send(R);
      }
      if (R.started) return err(ws, 'Игра уже идет');
      if (R.players.length >= (R.game == 'chess' ? 2 : 6)) return err(ws, 'Комната заполнена');
      const photo = /^https:\/\/[\w.\/-]+$/.test(m.photo || '') ? m.photo.slice(0, 300) : '';
      ws.p = { name: String(m.name || 'Игрок').slice(0, 12), uid, photo: A.prof ? A.prof.photo : '', prof: A.prof, hand: [], bot: false, ws };
      ws.R = R; R.players.push(ws.p);
      return send(R);
    }
    const R = ws.R; if (!R) return;
    const i = R.players.indexOf(ws.p); if (i < 0) return;
    if (m.t == 'radio') {   // любой игрок включает/меняет/выключает радио для всей комнаты
      const now = Date.now(); if (now - (ws.p.rt || 0) < 2000) return; ws.p.rt = now;
      const stn = STATIONS.find(x => x.id == m.id);
      if (m.id && !stn) return;
      R.radio = stn ? { id: stn.id, by: R.players[i].name, t0: Date.now() } : null;
      sys(R, stn ? `🎵 Радио: ${stn.name} (запустил ${R.players[i].name})` : `🔇 Радио выключено (${R.players[i].name})`);
      return send(R);
    }
    if (m.t == 'chat') {
      const tx = String(m.text || '').trim().slice(0, 80);
      if (tx) { R.log.push({ n: i, name: R.players[i].name, text: tx }); R.log = R.log.slice(-30); R.logN++; }
      return send(R);
    }
    if (m.t == 'react') { if (EMO.includes(m.e)) bcast(R, { ev: 'react', from: i, e: m.e }); return; }
    if (R.game === 'chess') { chMsg(R, i, m); return send(R); }
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
    const R = ws.R, p = ws.p; if (!R || !p || p.ws !== ws) return;
    const i = R.players.indexOf(p); if (i < 0) return;
    p.ws = null;
    if (!R.started) R.players.splice(i, 1);
    else if (!R.over && !p.left) {
      p.off = true; p.offUntil = Date.now() + GRACE; sys(R, p.name + ' потерял связь');
      p.tm = setTimeout(() => { if (p.off && !p.ws) { drop(R, p); send(R); } }, GRACE);
    }
    if (!R.players.some(q => q.ws)) {
      clearTimeout(R.tm);
      if (!R.started || R.over) delete rooms[R.code];
      else R.gc = setTimeout(() => { if (!R.players.some(q => q.ws)) { clearTimeout(R.tm); delete rooms[R.code]; } }, GRACE + 30000);
    } else send(R);
  });
});

setInterval(() => Object.values(rooms).forEach(afkTick), 1000);
srv.listen(process.env.PORT || 3000, () => {
  console.log('Дурак запущен на порту', process.env.PORT || 3000);
  if (TOKEN && APP_URL) {
    tg('setWebhook', { url: APP_URL + '/tg/' + TOKEN });
    tg('setMyCommands', { commands: [{ command: 'start', description: 'Выбрать игру' }, { command: 'durak', description: 'Подкидной дурак' }, { command: 'chess', description: 'Шахматы' }, { command: 'rules', description: 'Правила игр' }] });
    tg('setMyDescription', { description: `♠️ Игровой клуб: подкидной дурак и шахматы онлайн

Играйте с друзьями или ботами прямо в Telegram: чат, реакции, радио за столом, рейтинг с рангами от Новичка до Легенды.

Нажмите Start и выберите игру.

⏳ Первый вход может занять 30–60 секунд: сервер просыпается. Просто подождите, и игра откроется.` });
    tg('setMyShortDescription', { short_description: 'Дурак и шахматы онлайн: друзья, боты, чат, рейтинг. Первый вход до 60 сек ⏳' });
    tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: APP_URL } } });
  }
});
