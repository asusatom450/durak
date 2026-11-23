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
  recent: [], calls: null, inc: null, pm: true, mute: false, push: '', rk: 0
});
const C = new Map(), loading = new Map(), dirty = new Set(), active = new Map();
let flushT = null;
function adopt(raw) {   // документ из базы → профиль в памяти (новые поля получают значения по умолчанию)
  const c = { ...fresh(raw.uid, {}), ...raw }; c.eq = { ...DEF, ...(raw.eq || {}) }; c.own = raw.own || []; c.recent = raw.recent || [];
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
    mute: c.mute, recent: c.recent.slice(0, 10), streakR: STREAK
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
    save(c);
  }
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
    if (q.n >= q.need) { q.n = q.need; q.done = true; c.chips += q.r; stat('quest'); out.push({ t: '✅ Задание выполнено: ' + q.t, chips: q.r }); }
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
}
function weekView(uid) {
  weekCheck();
  const l = Object.entries(WK.pts).filter(([, e]) => e.p > 0).sort((a, b) => b[1].p - a[1].p), i = l.findIndex(([u]) => u === uid);
  return {
    id: WK.id, ends: weekEnd(), prize: WEEK_PRIZE, top10: WEEK_TOP10, pts: PTS, of: l.length,
    top: l.slice(0, 20).map(([u, e]) => ({ n: e.n, p: e.p, me: u === uid, fr: (cached(u) || { eq: {} }).eq.frame || '' })),
    me: i >= 0 ? { place: i + 1, p: l[i][1].p } : null
  };
}
// итоги недели: награды тройке и десятке, значок чемпиона, сообщение каждому участнику
async function finalize(W) {
  if (!W || W.done) return;
  W.done = true; await db.dset('weeks', W.id, W);   // сначала отметка, чтобы награды не выдались дважды
  const l = Object.entries(W.pts).filter(([, e]) => e.p > 0).sort((a, b) => b[1].p - a[1].p);
  if (!l.length) return;
  console.log(`Неделя ${W.id}: подводим итоги, участников ${l.length}`);
  const medal = ['🥇', '🥈', '🥉'], head = l.slice(0, 3).map(([, e], i) => `${medal[i]} ${esc(e.n)}: ${e.p}`).join('\n');
  for (let i = 0; i < l.length; i++) {
    const [uid, e] = l[i]; let c = null;
    try { c = await get(uid); } catch {}
    if (!c) continue;
    const prize = i < 3 ? WEEK_PRIZE[i] : i < 10 ? WEEK_TOP10 : 0;
    c.chips += prize;
    if (i < 3) { c.crowns++; c.champ = { wk: W.id, place: i + 1 }; unlock(c, 'frame_champ'); }
    c.wres = { wk: W.id, place: i + 1, of: l.length, p: e.p, prize };
    save(c);
    const text = `🏆 <b>Итоги недели</b>\n\nВы на <b>${i + 1} месте</b> из ${l.length}: ${e.p} ${plural(e.p, 'очко', 'очка', 'очков')}.` +
      (prize ? `\nНаграда <b>+${prize} 🪙</b> уже на вашем счёте.` : '') + (i < 3 ? '\n👑 Значок «Чемпион недели» и золотая рамка с короной ваши.' : '') +
      `\n\n${head}\n\nНовая неделя началась, очки обнулились. Удачи!`;
    if (await notifyAuto(c, text)) await sleep(50);
  }
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
const GV = { durak: 'в дурака', chess: 'в шахматы', mafia: 'в мафию', billiards: 'в бильярд', bowling: 'в боулинг', eye: 'в «Зоркий глаз»' };
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
const GI = { durak: '🃏', chess: '♞', mafia: '🔪', billiards: '🎱', bowling: '🎳', eye: '👀' };
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
    `\n<b>Вчера</b>: ${line(S[1])}\n${per(S[1])}\n` +
    `\n<b>7 дней</b>: входов ${sum('dau')} (сумма по дням), новых ${sum('new')}, партий ${S.reduce((a, s) => a + games(s), 0)}\n` +
    (total != null ? `\nВсего профилей в клубе: <b>${total}</b>` : '');
}
// сколько людей в клубе прямо сейчас (открыли приложение за последние 5 минут)
function activeNow() { const t = Date.now() - 5 * 60e3; for (const [u, x] of active) if (x < t) active.delete(u); return [...active.keys()]; }
const touch = uid => { if (uid) active.set(uid, Date.now()); };

// ---------- запуск и фоновые задачи ----------
async function init(opts) {
  O = { ...O, ...opts };
  try {
    jobs = (await db.dget('meta', 'jobs')) || {};
    const cur = await db.dget('weeks', WK.id);
    if (cur) { for (const [u, e] of Object.entries(WK.pts)) { const x = cur.pts[u] = cur.pts[u] || { n: e.n, p: 0 }; x.p += e.p; } WK = cur; }
    const prev = await db.dget('weeks', weekOf(Date.now() - 7 * 864e5));
    if (prev && !prev.done) finalize(prev).catch(e => console.error('week:', e.message));
  } catch (e) { console.error('club init:', e.message); }
  setInterval(() => {
    try { weekCheck(); } catch (e) { console.error('week:', e.message); }
    if (wkDirty) { wkDirty = false; db.dset('weeks', WK.id, WK).catch(e => { wkDirty = true; console.error('week save:', e.message); }); }
    flushStats();
    streakJob().catch(e => console.error('streak job:', e.message));
    const old = Date.now() - 3600e3;   // профили, которые давно не нужны, выгружаем из памяти
    for (const [uid, e] of C) if (e.t < old && !dirty.has(uid)) C.delete(uid);
  }, 60e3).unref();
}
// перед остановкой сервера (Render усыпляет его) сохраняем всё несохранённое
async function flushAll() { await Promise.all([flush(), wkDirty ? db.dset('weeks', WK.id, WK).catch(() => {}) : null, flushStats()]); }

module.exports = {
  init, get, cached, visit, view, buy, equip, setMute, markPM, ev, game, call, weekView, statsText, stat, activeNow, touch, flushAll, has,
  CAT, DEF, dayOf, weekOf, _t: { finalize, streakJob, dailyQuests, weekEnd, get WK() { return WK; }, set WK(v) { WK = v; }, jobs: () => jobs }
};
