'use strict';
// Клуб: общий для всех игр профиль игрока.
// Фишки 🪙, ежедневные задания, серия входов, недельный зачёт, коллекция украшений, приглашения друзей,
// уведомления от бота и статистика для владельца.
// Хранение: профиль клуба в коллекции club (документ на игрока), неделя в weeks, статистика по дням в stats.
// Индексы в Firestore создавать не нужно.
const db = require('./db');

// ---------- время клуба: Москва ----------
const TZ = 3 * 3600e3;
const dayOf = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
const dayMs = d => Date.parse(d + 'T00:00:00Z') - TZ;   // начало дня по Москве
const dayAdd = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function weekOf(t = Date.now()) {   // неделя по ISO 8601: с понедельника, номер по четвергу
  const d = new Date(Date.parse(dayOf(t) + 'T00:00:00Z')), wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const y = d.getUTCFullYear();
  return y + '-W' + String(1 + Math.floor((d - Date.UTC(y, 0, 1)) / 6048e5)).padStart(2, '0');
}
function weekEnd(t = Date.now()) { const d = dayOf(t), wd = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; return dayMs(dayAdd(d, 7 - wd)); }
const hourMsk = (t = Date.now()) => new Date(t + TZ).getUTCHours();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const plural = (n, a, b, c) => { const k = Math.abs(n) % 100, j = k % 10; return k > 10 && k < 20 ? c : j === 1 ? a : j >= 2 && j <= 4 ? b : c; };

// ---------- экономика: всё, что легко подкрутить ----------
const START_CHIPS = 50;                          // каждому новичку
const STREAK = [10, 15, 20, 25, 30, 40, 80];     // награда за 1–7-й день серии входов, дальше по кругу
const QUEST_BONUS = 60;                          // за все три задания дня
const PTS = { win: 3, draw: 2, loss: 1 };        // очки недели за партию
const WEEK_PRIZE = [300, 200, 150], WEEK_TOP10 = 50;
const REF_BONUS = 100, REF_WELCOME = 50;         // пригласившему, когда друг сыграл первую партию; другу сразу
const CALLS_DAY = 15, CALLS_IN = 5;              // приглашений в комнату через бота: отправить и получить за день

// ---------- коллекция украшений ----------
// price: покупка за фишки; rank: рейтинг в своей игре; streak: серия входов; refs: приглашённые друзья; champ: тройка недели
const CAT = [
  { id: 'back_red', kind: 'back', game: 'durak', n: 'Классика', free: true },
  { id: 'back_navy', kind: 'back', game: 'durak', n: 'Морская', price: 150 },
  { id: 'back_emerald', kind: 'back', game: 'durak', n: 'Изумруд', price: 200 },
  { id: 'back_noir', kind: 'back', game: 'durak', n: 'Нуар', price: 350 },
  { id: 'back_royal', kind: 'back', game: 'durak', n: 'Королевская', rank: 400 },
  { id: 'board_ice', kind: 'board', game: 'chess', n: 'Лёд', free: true },
  { id: 'board_walnut', kind: 'board', game: 'chess', n: 'Орех', price: 150 },
  { id: 'board_malachite', kind: 'board', game: 'chess', n: 'Малахит', price: 250 },
  { id: 'board_night', kind: 'board', game: 'chess', n: 'Полночь', price: 350 },
  { id: 'board_tourney', kind: 'board', game: 'chess', n: 'Турнирная', rank: 400 },
  { id: 'cloth_blue', kind: 'cloth', game: 'billiards', n: 'Синее', free: true },
  { id: 'cloth_green', kind: 'cloth', game: 'billiards', n: 'Классика', price: 150 },
  { id: 'cloth_wine', kind: 'cloth', game: 'billiards', n: 'Бордо', price: 250 },
  { id: 'cloth_graphite', kind: 'cloth', game: 'billiards', n: 'Графит', price: 350 },
  { id: 'cloth_violet', kind: 'cloth', game: 'billiards', n: 'Фиалка', rank: 400 },
  { id: 'ball_6', kind: 'ball', game: 'bowling', n: 'Галактика', price: 300 },
  { id: 'ball_7', kind: 'ball', game: 'bowling', n: 'Золото', price: 450 },
  { id: 'ball_8', kind: 'ball', game: 'bowling', n: 'Ледник', rank: 400 },
  { id: 'tile_day', kind: 'tile', game: 'eye', n: 'Солнце', free: true },
  { id: 'tile_mint', kind: 'tile', game: 'eye', n: 'Мята', price: 150 },
  { id: 'tile_night', kind: 'tile', game: 'eye', n: 'Ночь', price: 250 },
  { id: 'tile_candy', kind: 'tile', game: 'eye', n: 'Карамель', price: 350 },
  { id: 'tile_gold', kind: 'tile', game: 'eye', n: 'Золото', rank: 400 },
  { id: 'frame_gold', kind: 'frame', n: 'Золотая', price: 250 },
  { id: 'frame_neon', kind: 'frame', n: 'Неон', price: 300 },
  { id: 'frame_fire', kind: 'frame', n: 'Пламя', price: 600 },
  { id: 'frame_streak', kind: 'frame', n: 'Неделя подряд', streak: 7 },
  { id: 'frame_friend', kind: 'frame', n: 'Душа компании', refs: 3 },
  { id: 'frame_champ', kind: 'frame', n: 'Чемпион недели', champ: true }
];
const KIND_N = { back: 'рубашка', board: 'доска', cloth: 'сукно', ball: 'шар', tile: 'карточки', frame: 'рамка' };
const DEF = { back: 'back_red', board: 'board_ice', cloth: 'cloth_blue', ball: '', tile: 'tile_day', frame: '' };
const item = id => CAT.find(x => x.id === id);
const has = (c, id) => { const it = item(id); return !!it && (!!it.free || c.own.includes(id)); };

// ---------- задания дня: три разные игры, у каждого игрока свой набор ----------
const QP = {
  durak: [{ k: 'play', t: 'Сыграйте 2 партии в дурака', need: 2, r: 25 }, { k: 'win', t: 'Не останьтесь дураком 2 раза', need: 2, r: 40 }],
  chess: [{ k: 'play', t: 'Сыграйте партию в шахматы', need: 1, r: 25 }, { k: 'win', t: 'Выиграйте партию в шахматы', need: 1, r: 45 }],
  mafia: [{ k: 'play', t: 'Сыграйте 2 партии в мафию', need: 2, r: 30 }, { k: 'win', t: 'Победите в мафии', need: 1, r: 40 }],
  billiards: [{ k: 'pot', t: 'Забейте 6 своих шаров в бильярде', need: 6, r: 30 }, { k: 'win', t: 'Выиграйте партию в бильярд', need: 1, r: 45 }],
  rainbow: [{ k: 'play', t: 'Сыграйте 2 партии в «Радугу»', need: 2, r: 25 }, { k: 'win', t: 'Победите в «Радуге»', need: 1, r: 40 }, { k: 'wild', t: 'Сыграйте 3 «радужные» карты', need: 3, r: 30 }],
  eye: [{ k: 'play', t: 'Сыграйте 2 партии в «Зоркий глаз»', need: 2, r: 25 }, { k: 'win', t: 'Победите в «Зорком глазе»', need: 1, r: 40 }, { k: 'catch', t: 'Заберите 25 карточек в «Зорком глазе»', need: 25, r: 30 }],
  bowling: [{ k: 'strike', t: 'Выбейте 3 страйка', need: 3, r: 30 }, { k: 'score', t: 'Наберите 120 очков в боулинге', need: 120, r: 40, max: true }, { k: 'play', t: 'Сыграйте партию в боулинг', need: 1, r: 25 }]
};
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function dailyQuests(uid, day) {
  const R = rng(hash(uid + '|' + day)), games = Object.keys(QP);
  for (let i = games.length - 1; i > 0; i--) { const j = R() * (i + 1) | 0; [games[i], games[j]] = [games[j], games[i]]; }
  return games.slice(0, 3).map(g => { const q = QP[g][R() * QP[g].length | 0]; return { id: g + ':' + q.k, g, k: q.k, t: q.t, need: q.need, r: q.r, max: !!q.max, n: 0, done: false }; });
}

// ---------- профиль клуба ----------
let O = { tg: null, push: () => {}, appUrl: '', link: () => '' };   // задаёт server.js через init()
const fresh = (uid, info) => ({
  uid, name: info.name || 'Игрок', photo: info.photo || '', chips: START_CHIPS, streak: 0, best: 0, last: '', seen: '',
  q: null, own: [], eq: { ...DEF }, gp: 0, at: Date.now(), ref: '', refOk: false, refs: 0, crowns: 0, champ: null, wres: null,
  recent: [], calls: null, inc: null, pm: true, mute: false, push: '', rk: 0,
  lg: 0, ach: {}, achd: [], gs: [], fr: [], frq: [], trophies: 0, ls: 0, dly: null, ares: null, dres: null
});
const C = new Map(), loading = new Map(), dirty = new Set(), active = new Map();
let flushT = null;
function adopt(raw) {   // документ из базы → профиль в памяти (новые поля получают значения по умолчанию)
  const c = { ...fresh(raw.uid, {}), ...raw }; c.eq = { ...DEF, ...(raw.eq || {}) }; c.own = raw.own || []; c.recent = raw.recent || []; c.ach = raw.ach || {}; c.achd = raw.achd || []; c.fr = raw.fr || []; c.frq = raw.frq || []; c.gs = raw.gs || [];
  C.set(c.uid, { c, t: Date.now() }); return c;
}
// info ({ name, photo }) передают при входе игрока: тогда профиль создаётся, если его ещё нет
async function get(uid, info) {
  if (!uid) return null;
  let e = C.get(uid);
  if (!e) {
    if (!loading.has(uid)) loading.set(uid, db.dget('club', uid).finally(() => loading.delete(uid)));
    const d = await loading.get(uid);
    e = C.get(uid);   // пока ждали базу, профиль мог появиться
    if (!e) {
      if (!d && !info) return null;
      if (d) adopt(d);
      else { C.set(uid, { c: fresh(uid, info), t: 0 }); stat('new'); save(C.get(uid).c); }
      e = C.get(uid);
    }
  }
  e.t = Date.now();
  const c = e.c;
  if (info) {
    if (info.name && c.name !== info.name) { c.name = info.name; save(c); }
    if (info.photo != null && c.photo !== info.photo) { c.photo = info.photo; save(c); }
  }
  return c;
}
const cached = uid => (C.get(uid) || {}).c || null;
function save(c) { dirty.add(c.uid); if (!flushT) flushT = setTimeout(flush, 1500); }
async function flush() {
  clearTimeout(flushT); flushT = null;
  const ids = [...dirty]; dirty.clear();
  await Promise.all(ids.map(uid => { const e = C.get(uid); return e && db.dset('club', uid, e.c).catch(err => { console.error('club save:', err.message); dirty.add(uid); }); }));
}
function unlock(c, id) { if (has(c, id)) return false; c.own.push(id); save(c); return true; }
function roll(c) {   // новый день: новые задания
  const d = dayOf();
  if (!c.q || c.q.day !== d) { c.q = { day: d, list: dailyQuests(c.uid, d), bonus: false }; save(c); }
}
function view(c) {
  roll(c);
  const d = dayOf();
  return {
    uid: c.uid, name: c.name, chips: c.chips, streak: c.last === d || c.last === dayAdd(d, -1) ? c.streak : 0, best: c.best, today: d, dayEnd: dayMs(dayAdd(d, 1)),
    q: c.q, qb: QUEST_BONUS, own: CAT.filter(x => has(c, x.id)).map(x => x.id), eq: c.eq, refs: c.refs, refR: REF_BONUS, crowns: c.crowns, champ: c.champ, wres: c.wres,
    mute: c.mute, recent: c.recent.slice(0, 10), streakR: STREAK,
    lg: c.lg || 0, ach: c.ach || {}, achd: c.achd || [], frn: (c.fr || []).length, frq: (c.frq || []).length, trophies: c.trophies || 0, ares: c.ares || null, dres: c.dres || null
  };
}
// Вход в клуб (экран игры открылся): серия входов, награда дня, приглашение
async function visit(uid, info, ref) {
  const c = await get(uid, info); roll(c);
  const d = dayOf(); let daily = null;
  active.set(uid, Date.now());
  if (c.seen !== d) { c.seen = d; stat('dau'); save(c); }
  if (c.last !== d) {
    c.streak = c.last === dayAdd(d, -1) ? c.streak + 1 : 1; c.last = d; c.best = Math.max(c.best, c.streak);
    const r = STREAK[(c.streak - 1) % 7]; c.chips += r; daily = { day: c.streak, r };
    if (c.streak >= 7) unlock(c, 'frame_streak');
    const out = []; achSet(c, 'streak_30', c.streak, 'max', out); if (out.length) daily.ach = out;
    save(c);
  }
  c.ls = Date.now();
  // приглашение засчитывается, только если человек новый: профиль клуба только что создан и раньше он не играл
  if (ref && /^tg\d+$/.test(ref) && ref !== uid && !c.ref && c.gp === 0 && Date.now() - c.at < 30 * 60e3) {
    const inv = await get(ref);
    if (inv && !(await db.played(uid))) { c.ref = ref; c.chips += REF_WELCOME; save(c); daily = { ...(daily || {}), welcome: REF_WELCOME, by: inv.name }; stat('refnew'); }
  }
  if (!c.rk) await rankScan(c);   // один раз: украшения за ранг тем, кто заслужил их до появления клуба
  return { c, daily };
}
async function rankScan(c) {
  c.rk = 1;
  for (const it of CAT.filter(x => x.rank && !has(c, x.id))) {
    try { const u = await db.peekRating(c.uid, it.game); if (u && u.rating >= it.rank) unlock(c, it.id); } catch {}
  }
  save(c);
}
async function buy(uid, id) {
  const c = await get(uid), it = item(id);
  if (!c || !it) return { err: 'Такого предмета нет' };
  if (has(c, id)) return { err: 'Уже в вашей коллекции' };
  if (!it.price) return { err: 'Этот предмет нельзя купить, его можно только заслужить' };
  if (c.chips < it.price) return { err: `Не хватает фишек: нужно ${it.price} 🪙` };
  c.chips -= it.price; c.own.push(id); c.eq[it.kind] = id; save(c); stat('buy');
  return { ok: true };
}
async function equip(uid, id, kind) {
  const c = await get(uid); if (!c) return { err: 'Профиль не найден' };
  if (!id) { if (!(kind in DEF)) return { err: 'Нечего снимать' }; c.eq[kind] = DEF[kind]; save(c); return { ok: true }; }
  const it = item(id); if (!it || !has(c, id)) return { err: 'Сначала получите этот предмет' };
  c.eq[it.kind] = id; save(c); return { ok: true };
}
async function setMute(uid, on) { const c = await get(uid); if (!c) return { err: 'Профиль не найден' }; c.mute = !!on; save(c); return { ok: true }; }
// личный чат с ботом открыт (человек нажал /start) или закрыт (бот заблокирован)
async function markPM(uid, ok, info) { const c = await get(uid, info); if (c && c.pm !== ok) { c.pm = ok; save(c); } }

// ---------- задания и конец партии ----------
function progress(c, g, add, out) {
  let ch = false;
  for (const q of c.q.list) {
    if (q.done || q.g !== g || !add[q.k]) continue;
    q.n = q.max ? Math.max(q.n, add[q.k]) : q.n + add[q.k]; ch = true;
    if (q.n >= q.need) { q.n = q.need; q.done = true; c.chips += q.r; stat('quest'); out.push({ t: '✅ Задание выполнено: ' + q.t, chips: q.r }); achSet(c, 'quests_30', 1, 'add', out); }
  }
  if (ch && !c.q.bonus && c.q.list.every(q => q.done)) { c.q.bonus = true; c.chips += QUEST_BONUS; out.push({ t: '🎁 Все задания дня выполнены', chips: QUEST_BONUS }); }
  return ch;
}
// событие посреди партии: страйк, забитый шар
async function ev(uid, g, add) {
  const c = cached(uid) || await get(uid); if (!c) return;
  roll(c); const out = [];
  if (progress(c, g, add, out)) { save(c); if (out.length) O.push(uid, { ev: 'club', toasts: out, me: view(c) }); }
}
// партия закончилась. r: { res: 'win' | 'loss' | 'draw', extra: { score }, rating }, others: люди за столом [{ uid, name }]
async function game(uid, g, r, others) {
  const c = cached(uid) || await get(uid); if (!c) return;
  roll(c); c.gp++; stat('pg');
  const out = [], pts = PTS[r.res] || 1;
  progress(c, g, { play: 1, win: r.res === 'win' ? 1 : 0, ...(r.extra || {}) }, out);
  addWeek(c, pts);
  const win = r.res === 'win', x = r.extra || {};
  achSet(c, 'games_50', 1, 'add', out);
  if (win) { achSet(c, 'first_win', 1, 'add', out); achSet(c, 'wins_10', 1, 'add', out); achSet(c, 'wins_100', 1, 'add', out); achSet(c, g + '_10', 1, 'add', out); }
  if (!c.gs.includes(g)) c.gs.push(g); achSet(c, 'all_games', c.gs.length, 'max', out);
  if (win && x.mate && x.mate <= 10) achSet(c, 'chess_fast', 1, 'add', out);
  if (win && x.role === 'sheriff') achSet(c, 'mafia_sheriff', 1, 'add', out);
  if (x.score >= 200) achSet(c, 'bowling_200', 1, 'add', out);
  if (x.fast && x.fast < 1000) achSet(c, 'eye_flash', 1, 'add', out);
  if (x.catches) achSet(c, 'rainbow_catch', x.catches, 'add', out);
  const ap = arenaGame(c, g, r.res, (others || []).length); if (ap) out.push({ t: `🏟 +${ap} ${plural(ap, 'очко', 'очка', 'очков')} в турнире выходных` });
  c.ls = Date.now();
  if (c.ref && !c.refOk) { c.refOk = true; rewardRef(c).catch(e => console.error('ref:', e.message)); }
  for (const o of others || []) if (o.uid && o.uid !== uid) c.recent = [{ u: o.uid, n: o.name, g, t: Date.now() }, ...c.recent.filter(x => x.u !== o.uid)].slice(0, 12);
  if (r.rating != null) for (const it of CAT) if (it.rank && it.game === g && r.rating >= it.rank && unlock(c, it.id)) out.push({ t: `🎁 За ранг открыт предмет: ${KIND_N[it.kind]} «${it.n}»` });
  save(c);
  O.push(uid, { ev: 'club', toasts: out, me: view(c), wk: pts });
}
async function rewardRef(c) {
  const inv = await get(c.ref); if (!inv) return;
  inv.chips += REF_BONUS; inv.refs++; stat('ref');
  const out = [{ t: `🤝 Первая партия по вашему приглашению: ${c.name}`, chips: REF_BONUS }], fr = inv.refs >= 3 && unlock(inv, 'frame_friend');
  if (fr) out.push({ t: '🎁 Открыта рамка «Душа компании»' });
  save(inv);
  O.push(inv.uid, { ev: 'club', toasts: out, me: view(inv) });
  if (!inv.mute) await sendPM(inv, `🤝 <b>${esc(c.name)}</b> сыграл(а) первую партию по вашему приглашению.\nНа ваш счёт: <b>+${REF_BONUS} 🪙</b>${fr ? '\n🎁 Три друга в клубе: открыта рамка «Душа компании».' : ''}`, kbOpen());
}

// ---------- неделя ----------
let WK = { id: weekOf(), pts: {}, done: false }, wkDirty = false;
function weekCheck() {
  const id = weekOf(); if (WK.id === id) return;
  const old = WK; WK = { id, pts: {}, done: false }; wkDirty = true;
  finalize(old).catch(e => console.error('week:', e.message));
}
function addWeek(c, n) {
  weekCheck();
  const e = WK.pts[c.uid] = WK.pts[c.uid] || { n: c.name, p: 0 };
  e.p += n; e.n = c.name; wkDirty = true;
  lgJoin(c);
}
const weekView = lgView;
// итоги недели по группам лиг: призы тройке и десятке, пятёрка поднимается, пятёрка опускается, первый в группе получает корону
async function finalize(W) {
  if (!W || W.done) return;
  W.done = true; await db.dset('weeks', W.id, W);   // сначала отметка, чтобы награды не выдались дважды
  if (!W.groups) { W.groups = { 0: [Object.keys(W.pts)] }; Object.values(W.pts).forEach(e => { e.lg = 0; e.gr = 0; }); }   // неделя до появления лиг
  let total = 0;
  for (const [t, gs] of Object.entries(W.groups)) for (const grp of gs) {
    const tier = +t, l = grp.filter(u => W.pts[u] && W.pts[u].p > 0).sort((x, y) => W.pts[y].p - W.pts[x].p), n = l.length, m = lgMult(tier);
    if (!n) continue; total += n;
    const head = l.slice(0, 3).map((u, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(W.pts[u].n)}: ${W.pts[u].p}`).join('\n');
    for (let i = 0; i < n; i++) {
      const uid = l[i], e = W.pts[uid]; let c = null;
      try { c = await get(uid); } catch {}
      if (!c) continue;
      const prize = i < 3 ? Math.round(LG_PRIZE[i] * m) : i < 10 ? Math.round(LG_TOP10 * m) : 0, out = [];
      const move = i < LG_UP && tier < LEAGUES.length - 1 ? 1 : tier > 0 && n >= 10 && i >= n - LG_DOWN ? -1 : 0;
      c.lg = tier + move; c.chips += prize;
      if (move > 0 && c.lg === LEAGUES.length - 1) achSet(c, 'league_top', 1, 'add', out);
      if (i === 0) { c.crowns++; c.champ = { wk: W.id, place: 1, lg: tier }; unlock(c, 'frame_champ'); }
      c.wres = { wk: W.id, place: i + 1, of: n, p: e.p, prize, lg: tier, to: c.lg, move };
      save(c);
      const L = LEAGUES[tier], N = LEAGUES[c.lg];
      const text = `🏆 <b>Итоги недели · ${L.i} ${L.n} лига</b>\n\nВы на <b>${i + 1} месте</b> из ${n} в своей группе: ${e.p} ${plural(e.p, 'очко', 'очка', 'очков')}.` +
        (prize ? `\nНаграда <b>+${prize} 🪙</b> уже на вашем счёте.` : '') +
        (move > 0 ? `\n⬆️ Вы поднимаетесь в ${N.i} ${N.n} лигу!` : move < 0 ? `\n⬇️ На этой неделе вы в ${N.i} ${N.n} лиге. Отыграйтесь!` : `\nВы остаётесь в ${L.i} ${L.n} лиге.`) +
        (i === 0 ? '\n👑 Первое место в группе: значок «Чемпион недели» и рамка с короной ваши.' : '') +
        `\n\n${head}\n\nНовая неделя началась, очки обнулились. Удачи!`;
      if (await notifyAuto(c, text)) await sleep(50);
    }
  }
  console.log(`Неделя ${W.id}: итоги лиг подведены, участников ${total}`);
}

// =====================================================================================
// ДОСТИЖЕНИЯ: медали за долгие цели, за каждую фишки
// =====================================================================================
const ACH = [
  { id: 'first_win', i: '🎉', n: 'Первая победа', d: 'Победите в любой игре', need: 1, r: 20 },
  { id: 'wins_10', i: '🏅', n: 'Победитель', d: '10 побед в любых играх', need: 10, r: 50 },
  { id: 'wins_100', i: '🏆', n: 'Легенда клуба', d: '100 побед в любых играх', need: 100, r: 300 },
  { id: 'games_50', i: '🎲', n: 'Завсегдатай', d: 'Сыграйте 50 партий', need: 50, r: 100 },
  { id: 'all_games', i: '🌍', n: 'Мастер на все руки', d: 'Сыграйте во все 7 игр клуба', need: 7, r: 100 },
  { id: 'durak_10', i: '🃏', n: 'Не дурак', d: '10 побед в дураке', need: 10, r: 60 },
  { id: 'chess_10', i: '♛', n: 'Гроссмейстер клуба', d: '10 побед в шахматах', need: 10, r: 60 },
  { id: 'chess_fast', i: '♞', n: 'Блиц-мат', d: 'Поставьте мат за 10 ходов или быстрее', need: 1, r: 80 },
  { id: 'mafia_10', i: '🔪', n: 'Крёстный отец', d: '10 побед в мафии', need: 10, r: 60 },
  { id: 'mafia_sheriff', i: '🕵️', n: 'Комиссар', d: 'Победите, играя комиссаром', need: 1, r: 50 },
  { id: 'billiards_10', i: '🎱', n: 'Король стола', d: '10 побед в бильярде', need: 10, r: 60 },
  { id: 'bowling_turkey', i: '🦃', n: 'Индейка', d: 'Три страйка подряд в боулинге', need: 1, r: 60 },
  { id: 'bowling_200', i: '🎳', n: 'Двести', d: 'Наберите 200 очков в боулинге', need: 1, r: 100 },
  { id: 'eye_10', i: '👀', n: 'Орлиный глаз', d: '10 побед в «Зорком глазе»', need: 10, r: 60 },
  { id: 'eye_flash', i: '⚡', n: 'Молния', d: 'Найдите пару быстрее чем за секунду', need: 1, r: 50 },
  { id: 'rainbow_10', i: '🌈', n: 'Радужный', d: '10 побед в «Радуге»', need: 10, r: 60 },
  { id: 'rainbow_catch', i: '🫵', n: 'Поймал!', d: 'Поймайте 5 забывчивых в «Радуге»', need: 5, r: 50 },
  { id: 'streak_30', i: '📅', n: 'Месяц подряд', d: 'Заходите в клуб 30 дней подряд', need: 30, r: 300 },
  { id: 'quests_30', i: '📋', n: 'Исполнитель', d: 'Выполните 30 заданий дня', need: 30, r: 150 },
  { id: 'friends_3', i: '🤝', n: 'Компанейский', d: 'Добавьте трёх друзей', need: 3, r: 50 },
  { id: 'daily_10', i: '🧩', n: 'Решатель', d: 'Пройдите 10 задач дня', need: 10, r: 100 },
  { id: 'arena_top', i: '🏟', n: 'Призёр турнира', d: 'Войдите в тройку турнира выходных', need: 1, r: 150 },
  { id: 'league_top', i: '💎', n: 'Алмазная лига', d: 'Поднимитесь в Алмазную лигу', need: 1, r: 200 }
];
// mode: 'add' прибавить, 'max' — прогресс равен значению (серия, число друзей)
function achSet(c, id, v, mode, out) {
  const a = ACH.find(x => x.id === id); if (!a || !v) return;
  c.ach = c.ach || {}; c.achd = c.achd || [];
  if (c.achd.includes(id)) return;
  const cur = c.ach[id] || 0, n = Math.min(a.need, mode === 'max' ? Math.max(cur, v) : cur + v);
  if (n === cur) return;
  c.ach[id] = n; save(c);
  if (n >= a.need) { c.achd.push(id); c.chips += a.r; stat('ach'); if (out) out.push({ t: `🏅 Достижение «${a.n}»`, chips: a.r }); }
}
// событие из игры (три страйка подряд): сразу показать в приложении
async function achEv(uid, id, v = 1) {
  const c = cached(uid) || await get(uid); if (!c) return;
  const out = []; achSet(c, id, v, 'add', out);
  if (out.length) O.push(uid, { ev: 'club', toasts: out, me: view(c) });
}

// =====================================================================================
// ЛИГИ НЕДЕЛИ: группы до 25 игроков одной лиги. Пятёрка лучших поднимается, пятёрка худших опускается.
// =====================================================================================
const LEAGUES = [{ n: 'Бронзовая', i: '🥉' }, { n: 'Серебряная', i: '🥈' }, { n: 'Золотая', i: '🥇' }, { n: 'Сапфировая', i: '🔷' }, { n: 'Рубиновая', i: '♦️' }, { n: 'Алмазная', i: '💎' }];
const LG_SIZE = 25, LG_UP = 5, LG_DOWN = 5, LG_PRIZE = [200, 120, 80], LG_TOP10 = 30;
const lgMult = t => 1 + t * .25;   // в лиге выше и призы выше
function lgJoin(c) {   // первые очки недели: место в группе своей лиги
  WK.groups = WK.groups || {};
  const e = WK.pts[c.uid]; if (e.lg != null) return;
  const t = Math.max(0, Math.min(LEAGUES.length - 1, c.lg || 0)), gs = WK.groups[t] = WK.groups[t] || [];
  let gi = gs.findIndex(g => g.length < LG_SIZE); if (gi < 0) { gs.push([]); gi = gs.length - 1; }
  gs[gi].push(c.uid); e.lg = t; e.gr = gi;
}
function lgGroup(W, e) { return ((W.groups || {})[e.lg] || [])[e.gr] || []; }
function lgView(uid) {
  weekCheck();
  const e = WK.pts[uid], c = cached(uid), tier = e && e.lg != null ? e.lg : (c ? c.lg || 0 : 0);
  const row = u => { const x = WK.pts[u] || { n: '?', p: 0 }; return { n: x.n, p: x.p, me: u === uid, fr: (cached(u) || { eq: {} }).eq.frame || '' }; };
  const grp = e && e.lg != null ? lgGroup(WK, e).slice().sort((a, b) => (WK.pts[b] || {}).p - (WK.pts[a] || {}).p) : [];
  const all = Object.entries(WK.pts).filter(([, x]) => x.p > 0).sort((a, b) => b[1].p - a[1].p);
  const m = lgMult(tier);
  return {
    id: WK.id, ends: weekEnd(), pts: PTS, tier, league: LEAGUES[tier], next: LEAGUES[tier + 1] || null, prev: LEAGUES[tier - 1] || null,
    group: grp.map(row), place: grp.indexOf(uid) + 1 || null, of: grp.length,
    up: tier < LEAGUES.length - 1 ? LG_UP : 0, down: tier > 0 && grp.length >= 10 ? LG_DOWN : 0,
    prize: LG_PRIZE.map(p => Math.round(p * m)), top10: Math.round(LG_TOP10 * m),
    global: all.slice(0, 10).map(([u]) => row(u)), gplace: all.findIndex(([u]) => u === uid) + 1 || null, gof: all.length,
    me: e ? { p: e.p } : null
  };
}

// =====================================================================================
// ДРУЗЬЯ: заявка тому, с кем уже играли; видно, кто где, и можно сесть за его стол
// =====================================================================================
const FR_MAX = 100, FR_DAY = 20;
async function friendAdd(uid, to) {
  const c = await get(uid); if (!c) return { err: 'Профиль не найден' };
  c.fr = c.fr || []; c.frq = c.frq || [];
  if (to === uid) return { err: 'Это вы' };
  if (c.fr.includes(to)) return { ok: true, already: true };
  if (c.frq.some(x => x.u === to)) return friendAnswer(uid, to, true);   // он уже звал вас: просто дружим
  if (!c.recent.some(r => r.u === to)) return { err: 'Добавить можно тех, с кем вы уже играли' };
  const d = dayOf(); if (!c.frd || c.frd.d !== d) c.frd = { d, n: 0 };
  if (c.frd.n >= FR_DAY) return { err: 'На сегодня заявок достаточно' };
  const f = await get(to); if (!f) return { err: 'Игрок не найден' };
  f.frq = f.frq || []; f.fr = f.fr || [];
  if (f.fr.length >= FR_MAX || c.fr.length >= FR_MAX) return { err: 'Список друзей заполнен' };
  if (!f.frq.some(x => x.u === uid)) { f.frq.unshift({ u: uid, n: c.name, t: Date.now() }); f.frq = f.frq.slice(0, 30); }
  c.frd.n++; save(c); save(f); stat('frreq');
  O.push(to, { ev: 'club', toasts: [{ t: `👥 ${c.name} хочет добавить вас в друзья` }], me: view(f) });
  if (!f.mute) sendPM(f, `👥 <b>${esc(c.name)}</b> хочет добавить вас в друзья в игровом клубе. Принять заявку можно в разделе «Друзья».`, kbOpen()).catch(() => {});
  return { ok: true, sent: true };
}
async function friendAnswer(uid, from, ok) {
  const c = await get(uid); if (!c) return { err: 'Профиль не найден' };
  c.frq = c.frq || []; c.fr = c.fr || [];
  const k = c.frq.findIndex(x => x.u === from); if (k < 0) return { err: 'Заявка не найдена' };
  c.frq.splice(k, 1); save(c);
  if (!ok) return { ok: true };
  const f = await get(from); if (!f) return { err: 'Игрок не найден' };
  f.fr = f.fr || [];
  if (!c.fr.includes(from)) c.fr.push(from);
  if (!f.fr.includes(uid)) f.fr.push(uid);
  const out1 = [], out2 = [];
  achSet(c, 'friends_3', c.fr.length, 'max', out1); achSet(f, 'friends_3', f.fr.length, 'max', out2);
  save(c); save(f); stat('friend');
  O.push(from, { ev: 'club', toasts: [{ t: `👥 ${c.name} теперь ваш друг` }, ...out2], me: view(f) });
  return { ok: true, toasts: out1 };
}
async function friendDel(uid, f) {
  const c = await get(uid), x = await get(f); if (!c) return { err: 'Профиль не найден' };
  c.fr = (c.fr || []).filter(u => u !== f); save(c);
  if (x) { x.fr = (x.fr || []).filter(u => u !== uid); save(x); }
  return { ok: true };
}
async function friendsView(uid) {
  const c = await get(uid); if (!c) return { list: [], req: [] };
  const now = Date.now(), list = [];
  for (const f of c.fr || []) {
    let x = null; try { x = await get(f); } catch {}
    if (!x) continue;
    const pr = O.presence ? O.presence(f) : null, act = active.get(f);
    list.push({ u: f, n: x.name, fr: x.eq.frame || '', ph: x.photo || '', at: pr, club: !pr && act && now - act < 5 * 60e3, ls: Math.max(x.ls || 0, act || 0) });
  }
  list.sort((a, b) => (!!b.at - !!a.at) || (!!b.club - !!a.club) || b.ls - a.ls);
  return { list, req: (c.frq || []).slice(0, 30), recent: c.recent.filter(r => !(c.fr || []).includes(r.u)).slice(0, 10) };
}

// =====================================================================================
// ТУРНИР ВЫХОДНЫХ (арена): суббота 19:00–20:00 по Москве, игра меняется каждую неделю.
// Любая доигранная партия этой игры в это время приносит очки: победа над людьми 3, над ботами 2, ничья 1,
// и +1 за каждую победу подряд после первой. Записаться можно заранее, тогда бот напомнит за полчаса.
// =====================================================================================
const AR_GAMES = ['durak', 'rainbow', 'chess', 'eye'], AR_HOUR = 19, AR_LEN = 60 * 60e3, AR_PRIZE = [500, 300, 200], AR_TOP10 = 100;
const AR_GN = { durak: 'Дурак', rainbow: 'Радуга', chess: 'Шахматы', eye: 'Зоркий глаз' };
function arenaOf(t = Date.now()) {
  const id = weekOf(t), n = +id.slice(-2), mon = weekEnd(t) - 7 * 864e5, start = mon + 5 * 864e5 + AR_HOUR * 3600e3;
  return { id, g: AR_GAMES[n % AR_GAMES.length], start, end: start + AR_LEN };
}
let AR = { ...arenaOf(), reg: {}, pts: {}, done: false, remind: false }, arDirty = false;
function arenaCheck() {
  const a = arenaOf(); if (AR.id === a.id) return;
  const old = AR; AR = { ...a, reg: {}, pts: {}, done: false, remind: false }; arDirty = true;
  arenaFinish(old).catch(e => console.error('arena:', e.message));
}
function arenaLive(t = Date.now()) { arenaCheck(); return t >= AR.start && t < AR.end; }
async function arenaReg(uid) {
  const c = await get(uid); if (!c) return { err: 'Турнир доступен игрокам из Telegram' };
  arenaCheck(); if (Date.now() >= AR.end) return { err: 'Турнир этой недели уже прошёл' };
  AR.reg[uid] = { n: c.name, t: Date.now() }; arDirty = true; stat('arreg');
  return { ok: true };
}
function arenaGame(c, g, res, people) {
  if (!arenaLive() || AR.g !== g) return 0;
  const e = AR.pts[c.uid] = AR.pts[c.uid] || { n: c.name, p: 0, gp: 0, w: 0, st: 0 };
  AR.reg[c.uid] = AR.reg[c.uid] || { n: c.name, t: Date.now() };
  let p = 0;
  if (res === 'win') { p = people > 1 ? 3 : 2; if (e.st > 0) p += 1; e.st++; e.w++; } else { if (res === 'draw') p = 1; e.st = 0; }
  e.p += p; e.gp++; e.n = c.name; arDirty = true;
  return p;
}
function arenaView(uid) {
  arenaCheck();
  const now = Date.now(), l = Object.entries(AR.pts).sort((a, b) => b[1].p - a[1].p || b[1].w - a[1].w), i = l.findIndex(([u]) => u === uid);
  return {
    id: AR.id, g: AR.g, gn: AR_GN[AR.g], start: AR.start, end: AR.end, now, state: now < AR.start ? 'soon' : now < AR.end ? 'live' : 'over',
    reg: !!AR.reg[uid], regs: Object.keys(AR.reg).length, prize: AR_PRIZE, top10: AR_TOP10,
    top: l.slice(0, 20).map(([u, e]) => ({ n: e.n, p: e.p, w: e.w, gp: e.gp, st: e.st, me: u === uid, fr: (cached(u) || { eq: {} }).eq.frame || '' })),
    me: i >= 0 ? { place: i + 1, ...AR.pts[uid] } : null, of: l.length
  };
}
async function arenaFinish(A) {
  if (!A || A.done) return;
  A.done = true; await db.dset('arena', A.id, A);
  const l = Object.entries(A.pts).filter(([, e]) => e.gp > 0).sort((a, b) => b[1].p - a[1].p || b[1].w - a[1].w);
  if (!l.length) return;
  console.log(`Турнир ${A.id}: итоги, участников ${l.length}`);
  const medal = ['🥇', '🥈', '🥉'], head = l.slice(0, 3).map(([, e], i) => `${medal[i]} ${esc(e.n)}: ${e.p}`).join('\n');
  for (let i = 0; i < l.length; i++) {
    const [uid, e] = l[i]; let c = null; try { c = await get(uid); } catch {}
    if (!c) continue;
    const prize = i < 3 ? AR_PRIZE[i] : i < 10 ? AR_TOP10 : 0, out = [];
    c.chips += prize; if (i < 3) { c.trophies = (c.trophies || 0) + 1; achSet(c, 'arena_top', 1, 'add', out); }
    c.ares = { id: A.id, g: A.g, place: i + 1, of: l.length, p: e.p, prize }; save(c);
    if (!c.mute) { await sendPM(c, `🏟 <b>Турнир выходных: ${AR_GN[A.g]}</b>\n\nВы на <b>${i + 1} месте</b> из ${l.length}: ${e.p} ${plural(e.p, 'очко', 'очка', 'очков')}, побед ${e.w}.` + (prize ? `\nНаграда <b>+${prize} 🪙</b> на вашем счёте.` : '') + (i < 3 ? '\n🏆 Кубок турнира в вашем профиле.' : '') + `\n\n${head}\n\nСледующий турнир в субботу в ${AR_HOUR}:00 по Москве.`, kbOpen()); await sleep(50); }
  }
}
async function arenaJob() {
  arenaCheck();
  const now = Date.now();
  if (!AR.remind && now >= AR.start - 35 * 60e3 && now < AR.start) {   // напоминание записавшимся за полчаса
    AR.remind = true; arDirty = true;
    for (const uid of Object.keys(AR.reg)) {
      const c = await get(uid).catch(() => null); if (!c || c.mute) continue;
      if (await sendPM(c, `🏟 <b>Турнир выходных через 30 минут!</b>\nИгра: ${AR_GN[AR.g]}. С ${AR_HOUR}:00 до ${AR_HOUR + 1}:00 по Москве каждая победа приносит очки, тройка получает кубок и до ${AR_PRIZE[0]} 🪙.`, kbOpen())) await sleep(50);
    }
  }
  if (!AR.done && now >= AR.end + 60e3) { const A = AR; await arenaFinish(A); arDirty = true; }
}

// =====================================================================================
// ЗАДАЧА ДНЯ: одна на весь клуб, одна попытка. По кругу: «Зоркий глаз», шахматы, боулинг, бильярд.
// =====================================================================================
const DAILY_T = ['eye', 'chess', 'bowling', 'billiards'], DAILY_R = 30, DAILY_PRIZE = [100, 60, 40];
const DAILY_TX = {
  eye: { t: 'Спринт: 15 пар на время', d: 'Найдите 15 пар как можно быстрее. Каждая ошибка добавляет 2 секунды.' },
  chess: { t: 'Мат в 2 хода', d: 'Найдите ход, после которого мат неизбежен, и поставьте мат вторым ходом. На решение 3 минуты.' },
  bowling: { t: '3 фрейма на максимум', d: 'Сыграйте три фрейма и наберите как можно больше очков.' },
  billiards: { t: '5 ударов', d: 'На столе 6 шаров. Забейте как можно больше за 5 ударов.' }
};
function dailyOf(d = dayOf()) {   // DAILY_TYPE задаёт вид задачи вручную (для проверки)
  const n = Math.floor(Date.parse(d + 'T00:00:00Z') / 864e5), type = DAILY_T.includes(process.env.DAILY_TYPE) ? process.env.DAILY_TYPE : DAILY_T[n % DAILY_T.length];
  return { day: d, n, type, seed: hash('daily|' + d), ...DAILY_TX[type] };
}
let DY = { ...dailyOf(), res: {}, done: false }, dyDirty = false;
function dailyCheck() {
  const d = dailyOf(); if (DY.day === d.day) return;
  const old = DY; DY = { ...d, res: {}, done: false }; dyDirty = true;
  dailyFinish(old).catch(e => console.error('daily:', e.message));
}
const dySort = () => Object.entries(DY.res).sort((a, b) => b[1].s - a[1].s || a[1].t - b[1].t);
async function dailyDoneBy(uid) { dailyCheck(); const c = await get(uid); return !!(DY.res[uid] || (c && c.dly && c.dly.day === DY.day)); }
// результат попытки: s — чем больше, тем лучше; m — подробности для показа
async function dailyResult(uid, s, m) {
  dailyCheck(); const c = await get(uid); if (!c) return null;
  if (DY.res[uid]) { const l = dySort(); return { place: l.findIndex(([u]) => u === uid) + 1, of: l.length, m: DY.res[uid].m, again: true }; }
  DY.res[uid] = { n: c.name, s, m, t: Date.now() }; dyDirty = true;
  const out = []; c.dly = { day: DY.day, s, m }; c.chips += DAILY_R; achSet(c, 'daily_10', 1, 'add', out); save(c); stat('daily');
  const l = dySort(), place = l.findIndex(([u]) => u === uid) + 1;
  O.push(uid, { ev: 'club', toasts: [{ t: '🧩 Задача дня пройдена', chips: DAILY_R }, ...out], me: view(c) });
  return { place, of: l.length, m };
}
function dailyView(uid) {
  dailyCheck();
  const l = dySort(), i = l.findIndex(([u]) => u === uid), c = cached(uid);
  return { day: DY.day, type: DY.type, t: DY.t, d: DY.d, ends: dayMs(dayAdd(DY.day, 1)), prize: DY_PRIZE_VIEW, reward: DAILY_R,
    done: i >= 0 ? { place: i + 1, ...DY.res[uid] } : (c && c.dly && c.dly.day === DY.day ? c.dly : null),
    top: l.slice(0, 10).map(([u, e]) => ({ n: e.n, m: e.m, me: u === uid })), of: l.length };
}
const DY_PRIZE_VIEW = DAILY_PRIZE;
async function dailyFinish(D) {
  if (!D || D.done) return;
  D.done = true; await db.dset('daily', D.day, D);
  const l = Object.entries(D.res).sort((a, b) => b[1].s - a[1].s || a[1].t - b[1].t).slice(0, 3);
  for (let i = 0; i < l.length; i++) { const c = await get(l[i][0]).catch(() => null); if (!c) continue; c.chips += DAILY_PRIZE[i]; c.dres = { day: D.day, place: i + 1, prize: DAILY_PRIZE[i] }; save(c); }
}

// ---------- сообщения от бота ----------
const kbOpen = () => ({ inline_keyboard: [...(O.appUrl ? [[{ text: '🎮 Открыть клуб', web_app: { url: O.appUrl } }]] : []), [{ text: '🔕 Не присылать', callback_data: 'mute' }]] });
async function sendPM(c, text, kb) {
  if (!O.tg || !/^tg\d+$/.test(c.uid) || c.pm === false) return false;
  const r = await O.tg('sendMessage', { chat_id: c.uid.slice(2), parse_mode: 'HTML', text, reply_markup: kb, disable_web_page_preview: true });
  if (r && r.ok) return true;
  if (r && (r.error_code === 403 || r.error_code === 400)) { c.pm = false; save(c); }   // бот заблокирован или чат не начат
  return false;
}
// автоматические сообщения: не чаще одного в день и только тем, кто их не отключил
async function notifyAuto(c, text) {
  const d = dayOf(); if (c.mute || c.push === d) return false;
  const ok = await sendPM(c, text, kbOpen());
  if (ok) { c.push = d; save(c); stat('push'); }
  return ok;
}
// позвать в комнату того, с кем уже играли
const GV = { durak: 'в дурака', chess: 'в шахматы', mafia: 'в мафию', billiards: 'в бильярд', bowling: 'в боулинг', eye: 'в «Зоркий глаз»', rainbow: 'в «Радугу»' };
async function call(uid, to, x) {
  const c = await get(uid); if (!c) return { err: 'Звать друзей могут игроки из Telegram' };
  if (!c.recent.some(r => r.u === to)) return { err: 'Позвать можно только тех, с кем вы уже играли' };
  const d = dayOf(); if (!c.calls || c.calls.d !== d) c.calls = { d, n: 0, t: 0 };
  if (Date.now() - c.calls.t < 20000) return { err: 'Подождите немного перед следующим приглашением' };
  if (c.calls.n >= CALLS_DAY) return { err: 'На сегодня приглашений достаточно' };
  const f = await get(to); if (!f) return { err: 'Игрок не найден' };
  if (f.mute) return { err: 'Этот игрок отключил приглашения' };
  if (!f.inc || f.inc.d !== d) f.inc = { d, n: 0 };
  if (f.inc.n >= CALLS_IN) return { err: 'Этого игрока сегодня уже звали много раз' };
  c.calls.n++; c.calls.t = Date.now(); save(c);
  const ok = await sendPM(f, `🎲 <b>${esc(c.name)}</b> зовёт вас сыграть ${GV[x.game] || ''}.\nКомната <b>${esc(x.room)}</b>, за столом уже ждут.`,
    { inline_keyboard: [[{ text: '▶️ Сесть за стол', url: O.link(x.game, x.room) }], [{ text: '🔕 Не присылать', callback_data: 'mute' }]] });
  if (!ok) return { err: 'Не получилось: игрок не открывал чат с ботом' };
  f.inc.n++; save(f); stat('call');
  return { ok: true };
}
// вечером напоминаем тем, у кого сгорает серия входов
let jobs = {};
async function streakJob() {
  const d = dayOf(), h = hourMsk();
  if (h < 18 || h >= 22 || jobs.streak === d) return;
  jobs.streak = d; await db.dset('meta', 'jobs', jobs);
  const y = dayAdd(d, -1), list = await db.dfind('club', 'last', y, 2000);
  let n = 0;
  for (const raw of list) {
    if ((raw.streak || 0) < 2 || raw.mute) continue;
    const c = cached(raw.uid) || adopt(raw);
    if (c.last !== y) continue;
    const next = STREAK[c.streak % 7];
    if (await notifyAuto(c, `🔥 Серия входов: <b>${c.streak} ${plural(c.streak, 'день', 'дня', 'дней')} подряд</b>.\nЗагляните в клуб сегодня, иначе серия сгорит. Награда за ${c.streak + 1}-й день: <b>+${next} 🪙</b>`)) { n++; await sleep(50); }
  }
  if (n) console.log('Напоминаний о серии отправлено:', n);
}

// ---------- статистика для владельца ----------
let ST = { d: dayOf(), f: {} };
function stat(k, n = 1) { const d = dayOf(); if (ST.d !== d) { flushStats(); ST = { d, f: {} }; } ST.f[k] = (ST.f[k] || 0) + n; }
function flushStats() {
  const s = ST; if (!Object.keys(s.f).length) return Promise.resolve();
  ST = { d: s.d, f: {} };
  return Promise.resolve(db.dinc('stats', s.d, s.f)).catch(e => console.error('stats:', e.message));
}
const GI = { durak: '🃏', chess: '♞', mafia: '🔪', billiards: '🎱', bowling: '🎳', eye: '👀', rainbow: '🌈' };
async function statsText(onl) {
  await flushStats();
  const d = dayOf(), days = [...Array(7)].map((_, i) => dayAdd(d, -i));
  const S = await Promise.all(days.map(x => db.dget('stats', x).catch(() => null)));
  const games = s => db.GAMES.reduce((a, g) => a + ((s && s['g_' + g]) || 0), 0);
  const line = s => s ? `игроков <b>${s.dau || 0}</b>, новых <b>${s.new || 0}</b>, партий <b>${games(s)}</b>` : 'нет данных';
  const per = s => db.GAMES.map(g => `${GI[g]} ${(s && s['g_' + g]) || 0}`).join(' · ');
  const sum = k => S.reduce((a, s) => a + ((s && s[k]) || 0), 0), t = S[0] || {};
  const total = await db.dcount('club').catch(() => null);
  return `📊 <b>Статистика клуба</b>\n\n` +
    `🟢 Сейчас: в клубе <b>${onl.all}</b>, за столами ${onl.play}, ищут соперника ${onl.queue}, комнат ${onl.rooms}\n` +
    (onl.all ? db.GAMES.filter(g => onl.g[g]).map(g => `${GI[g]} ${onl.g[g]}`).join(' · ') + '\n' : '') +
    `\n<b>Сегодня</b>: ${line(S[0])}\n${per(S[0])}\n` +
    `⚡ быстрых игр ${t.quick || 0} (с компьютером ${t.quickbot || 0}) · ✅ заданий ${t.quest || 0} · 📤 поделились ${t.share || 0}\n` +
    `🤝 пришли по приглашению ${t.refnew || 0} · 🎲 позвали в комнату ${t.call || 0} · 🛍 покупок ${t.buy || 0}\n` +
    `🧩 задачу дня прошли ${t.daily || 0} (начали ${t.dailytry || 0}) · 🏟 записались на турнир ${t.arreg || 0} · 👥 новых дружб ${t.friend || 0} · 🏅 медалей ${t.ach || 0}\n` +
    `\n<b>Вчера</b>: ${line(S[1])}\n${per(S[1])}\n` +
    `\n<b>7 дней</b>: входов ${sum('dau')} (сумма по дням), новых ${sum('new')}, партий ${S.reduce((a, s) => a + games(s), 0)}\n` +
    (total != null ? `\nВсего профилей в клубе: <b>${total}</b>` : '');
}
// сколько людей в клубе прямо сейчас (открыли приложение за последние 5 минут)
function activeNow() { const t = Date.now() - 5 * 60e3; for (const [u, x] of active) if (x < t) active.delete(u); return [...active.keys()]; }
const touch = uid => { if (!uid) return; active.set(uid, Date.now()); const c = cached(uid); if (c) c.ls = Date.now(); };

// ---------- запуск и фоновые задачи ----------
async function init(opts) {
  O = { ...O, ...opts };
  try {
    jobs = (await db.dget('meta', 'jobs')) || {};
    const cur = await db.dget('weeks', WK.id);
    if (cur) { for (const [u, e] of Object.entries(WK.pts)) { const x = cur.pts[u] = cur.pts[u] || { n: e.n, p: 0 }; x.p += e.p; } WK = cur; }
    const prev = await db.dget('weeks', weekOf(Date.now() - 7 * 864e5));
    if (prev && !prev.done) finalize(prev).catch(e => console.error('week:', e.message));
    if (!WK.groups) { WK.groups = {}; for (const u of Object.keys(WK.pts)) { const c = await get(u).catch(() => null); if (c) lgJoin(c); } wkDirty = true; }   // неделя началась до лиг
    const ar = await db.dget('arena', AR.id); if (ar) { for (const [u, e] of Object.entries(AR.pts)) if (!ar.pts[u]) ar.pts[u] = e; Object.assign(ar.reg, AR.reg); AR = ar; }
    const arp = await db.dget('arena', weekOf(Date.now() - 7 * 864e5)); if (arp && !arp.done) arenaFinish(arp).catch(e => console.error('arena:', e.message));
    const dy = await db.dget('daily', DY.day); if (dy) { Object.assign(dy.res, DY.res); DY = { ...DY, ...dy }; }
    const dyp = await db.dget('daily', dayAdd(dayOf(), -1)); if (dyp && !dyp.done) dailyFinish(dyp).catch(e => console.error('daily:', e.message));
  } catch (e) { console.error('club init:', e.message); }
  setInterval(() => {
    try { weekCheck(); } catch (e) { console.error('week:', e.message); }
    if (wkDirty) { wkDirty = false; db.dset('weeks', WK.id, WK).catch(e => { wkDirty = true; console.error('week save:', e.message); }); }
    try { dailyCheck(); } catch (e) { console.error('daily:', e.message); }
    arenaJob().catch(e => console.error('arena job:', e.message));
    if (arDirty) { arDirty = false; db.dset('arena', AR.id, AR).catch(e => { arDirty = true; console.error('arena save:', e.message); }); }
    if (dyDirty) { dyDirty = false; db.dset('daily', DY.day, DY).catch(e => { dyDirty = true; console.error('daily save:', e.message); }); }
    flushStats();
    streakJob().catch(e => console.error('streak job:', e.message));
    const old = Date.now() - 3600e3;   // профили, которые давно не нужны, выгружаем из памяти
    for (const [uid, e] of C) if (e.t < old && !dirty.has(uid)) C.delete(uid);
  }, 60e3).unref();
}
// перед остановкой сервера (Render усыпляет его) сохраняем всё несохранённое
async function flushAll() { await Promise.all([flush(), wkDirty ? db.dset('weeks', WK.id, WK).catch(() => {}) : null, arDirty ? db.dset('arena', AR.id, AR).catch(() => {}) : null, dyDirty ? db.dset('daily', DY.day, DY).catch(() => {}) : null, flushStats()]); }

module.exports = {
  init, get, cached, visit, view, buy, equip, setMute, markPM, ev, game, call, weekView, statsText, stat, activeNow, touch, flushAll, has,
  ACH, LEAGUES, achEv, friendAdd, friendAnswer, friendDel, friendsView, arenaReg, arenaView, arenaLive, dailyOf, dailyView, dailyResult, dailyDoneBy, AR_GN,
  get DY() { return DY; },
  CAT, DEF, dayOf, weekOf, _t: { finalize, streakJob, dailyQuests, weekEnd, get WK() { return WK; }, set WK(v) { WK = v; }, jobs: () => jobs, arenaFinish, arenaJob, get AR() { return AR; }, set AR(v) { AR = v; }, dailyFinish, get DYv() { return DY; }, set DYv(v) { DY = v; } }
};
