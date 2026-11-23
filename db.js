// Хранилище игроков: Firebase Firestore (FIREBASE_KEY) или JSON-файл для локальных тестов.
// У каждой игры свой набор профилей: у дурака коллекция players, у шахмат chess_players (рейтинги не связаны).
const fs = require('fs'), crypto = require('crypto');
// Рейтинг начинается с 0. Профили со старой шкалой (старт 800) переводятся: из рейтинга вычитается 800,
// то есть каждый сохраняет то, что заработал сверх старта. Отметка rv: 2 значит «уже переведён»,
// а прежнее значение остаётся в поле rating_old на случай отката.
const START = 0, OLD_START = 800, RV = 2, COLS = { durak: 'players', chess: 'chess_players', mafia: 'mafia_players', billiards: 'billiards_players', bowling: 'bowling_players', eye: 'eye_players' };
let cols = null, mem = {}, fsx = null, FV = null;
const FILE = process.env.DATA_FILE || 'data.json';

if (process.env.FIREBASE_KEY) {
  try {
    const admin = require('firebase-admin');
    const key = JSON.parse(process.env.FIREBASE_KEY);
    if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(key) });
    fsx = admin.firestore(); FV = admin.firestore.FieldValue;
    cols = { durak: fsx.collection(COLS.durak), chess: fsx.collection(COLS.chess), mafia: fsx.collection(COLS.mafia), billiards: fsx.collection(COLS.billiards), bowling: fsx.collection(COLS.bowling) };
    console.log('Firestore подключен, проект:', key.project_id);
  } catch (e) {
    console.error('Не удалось подключить Firestore, проверьте FIREBASE_KEY:', e.message);
    fsx = null;
  }
}
if (!cols) {
  try { mem = JSON.parse(fs.readFileSync(FILE)); } catch {}
  console.log('Firestore не подключен: рейтинг хранится в файле и пропадет при перезапуске на Render.');
}
const flush = () => { if (!cols) try { fs.writeFileSync(FILE, JSON.stringify(mem)); } catch {} };
const fresh = (uid, name, photo, game) => ({ uid, name, photo, game, rating: START, rv: RV, games: 0, wins: 0, losses: 0, streak: 0, since: Date.now(), ...(game == 'chess' ? { draws: 0 } : {}), ...(game == 'bowling' ? { best: 0 } : {}) });
const key = (uid, game) => game + ':' + uid;

// перевод со старой шкалы; возвращает true, если профиль изменился
function conv(u) { if (u.rv === RV) return false; const raw = u.rating == null ? OLD_START : u.rating; u.rating_old = raw; u.rating = Math.max(0, Math.round(raw - OLD_START)); u.rv = RV; return true; }
async function getUser(uid, name, photo, game = 'durak') {
  if (cols) {
    const ref = cols[game].doc(uid), snap = await ref.get();
    if (!snap.exists) { const u = fresh(uid, name, photo, game); await ref.set(u); return u; }
    const u = { ...fresh(uid, name, photo, game), ...snap.data(), uid, game }, ch = {};
    if (conv(u)) { ch.rating = u.rating; ch.rv = RV; ch.rating_old = u.rating_old; }
    if (u.name !== name || u.photo !== photo) { u.name = name; u.photo = photo; ch.name = name; ch.photo = photo; }
    if (Object.keys(ch).length) await ref.update(ch);
    return u;
  }
  const k = key(uid, game), old = mem[k], u = mem[k] = Object.assign(fresh(uid, name, photo, game), old || {});
  if (old) conv(u);
  u.name = name; u.photo = photo; u.game = game; flush();
  return { ...u };
}
async function saveUser(p) {
  const game = p.game || 'durak';
  const f = { rating: p.rating, rv: RV, games: p.games, wins: p.wins, losses: p.losses, streak: p.streak };
  if (game == 'chess') f.draws = p.draws || 0;
  if (game == 'bowling') f.best = p.best || 0;   // лучший счёт за игру
  if (cols) return cols[game].doc(p.uid).update(f).catch(e => console.error('db save:', e.message));
  mem[key(p.uid, game)] = { ...mem[key(p.uid, game)], ...f }; flush();
}
async function top(n = 10, game = 'durak') {
  if (cols) {
    const s = await cols[game].orderBy('rating', 'desc').limit(60).get();   // без составного индекса
    return s.docs.map(x => { const u = x.data(); conv(u); return u; }).filter(u => u.games > 0).sort((a, b) => b.rating - a.rating).slice(0, n);
  }
  return Object.entries(mem).filter(([k, u]) => !k.startsWith('doc:') && (u.game || 'durak') == game && u.games > 0).map(([, u]) => u).map(u => { conv(u); return u; }).sort((a, b) => b.rating - a.rating).slice(0, n);
}
// Перевод всех профилей на новую шкалу. В Firestore он выполняется один раз: после него ставится отметка meta/rating,
// и следующие запуски сервера (Render часто будит его) читают только её, не тратя лимит чтений.
// Каждый профиль обновляется, только если его не меняли после чтения: так перевод не затрёт только что сыгранную партию.
// Профили, которые не удалось перевести сразу, переводятся при входе игрока (getUser) и в таблице лучших (top).
async function migrate() {
  if (cols) {
    const meta = cols.durak.firestore.collection('meta').doc('rating');
    try { const m = await meta.get(); if (m.exists && m.data().v === RV) return; }
    catch (e) { console.error('migrate meta:', e.message); return; }
    let ok = true;
    for (const [g, c] of Object.entries(cols)) {
      try {
        const snap = await c.get(), todo = [];
        for (const doc of snap.docs) { const u = doc.data(); if (conv(u)) todo.push([doc, { rating: u.rating, rv: RV, rating_old: u.rating_old }]); }
        let done = 0;
        for (let i = 0; i < todo.length; i += 200) {
          const res = await Promise.all(todo.slice(i, i + 200).map(([doc, f]) => doc.ref.update(f, { lastUpdateTime: doc.updateTime }).then(() => 1, () => 0)));
          done += res.reduce((a, b) => a + b, 0);
        }
        if (todo.length) console.log(`Рейтинг: ${g}, переведено на новую шкалу профилей: ${done} из ${todo.length}`);
      } catch (e) { ok = false; console.error('migrate', g, e.message); }
    }
    if (ok) await meta.set({ v: RV, at: Date.now() }).catch(e => console.error('migrate meta:', e.message));
    return;
  }
  let total = 0; for (const [k, u] of Object.entries(mem)) if (!k.startsWith('doc:') && conv(u)) total++;   // только профили игр
  if (total) { flush(); console.log('Рейтинг: переведено на новую шкалу профилей:', total); }
}
// рейтинг игрока в игре без создания профиля (для украшений «за ранг»)
async function peekRating(uid, game) {
  if (cols) { const s = await cols[game].doc(uid).get(); if (!s.exists) return null; const u = s.data(); conv(u); return u; }
  const u = mem[key(uid, game)]; if (!u) return null; conv(u); return { ...u };
}
// ---------- общие документы клуба: профиль клуба (club), неделя (weeks), статистика (stats), служебные (meta) ----------
// В Firestore это обычные коллекции, индексы создавать не нужно. Без Firestore всё лежит в том же файле.
const dk = (col, id) => 'doc:' + col + '/' + id;
const copy = o => (o == null ? null : JSON.parse(JSON.stringify(o)));
async function dget(col, id) {
  if (fsx) { const s = await fsx.collection(col).doc(id).get(); return s.exists ? s.data() : null; }
  return copy(mem[dk(col, id)]);
}
async function dset(col, id, data) {
  if (fsx) return fsx.collection(col).doc(id).set(data);
  mem[dk(col, id)] = copy(data); flush();
}
async function dinc(col, id, fields) {   // счётчики: прибавить к полям, не читая документ
  if (fsx) { const o = {}; for (const [k, v] of Object.entries(fields)) o[k] = FV.increment(v); return fsx.collection(col).doc(id).set(o, { merge: true }); }
  const d = mem[dk(col, id)] = mem[dk(col, id)] || {}; for (const [k, v] of Object.entries(fields)) d[k] = (d[k] || 0) + v; flush();
}
async function dfind(col, field, value, limit = 500) {   // поиск по одному полю (индекс Firestore создаёт сам)
  if (fsx) { const s = await fsx.collection(col).where(field, '==', value).limit(limit).get(); return s.docs.map(x => x.data()); }
  const p = 'doc:' + col + '/';
  return Object.entries(mem).filter(([k, v]) => k.startsWith(p) && v && v[field] === value).slice(0, limit).map(([, v]) => copy(v));
}
async function dcount(col) {
  if (fsx) { try { return (await fsx.collection(col).count().get()).data().count; } catch { return null; } }
  return Object.keys(mem).filter(k => k.startsWith('doc:' + col + '/')).length;
}
// играл ли человек раньше хоть в одну игру (приглашение засчитывается только новичку)
async function played(uid) {
  for (const g of Object.keys(COLS)) {
    if (cols) { const s = await cols[g].doc(uid).get(); if (s.exists && (s.data().games || 0) > 0) return true; }
    else if ((mem[key(uid, g)] || {}).games > 0) return true;
  }
  return false;
}
// Проверка подписи Telegram Mini App (initData): без нее рейтинг подделать нельзя.
function verify(d, token) {
  try {
    const p = new URLSearchParams(d), h = p.get('hash'); if (!h) return null;
    p.delete('hash');
    const s = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
    const kk = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const c = crypto.createHmac('sha256', kk).update(s).digest('hex');
    if (c.length != h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) return null;
    if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 604800) return null;
    const u = JSON.parse(p.get('user')); return u && u.id ? u : null;
  } catch { return null; }
}
module.exports = { getUser, saveUser, top, verify, migrate, START, peekRating, dget, dset, dinc, dfind, dcount, played, GAMES: Object.keys(COLS) };
