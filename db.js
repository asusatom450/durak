// Хранилище игроков: Firebase Firestore (FIREBASE_KEY) или JSON-файл для локальных тестов.
// У каждой игры свой набор профилей: у дурака коллекция players, у шахмат chess_players (рейтинги не связаны).
const fs = require('fs'), crypto = require('crypto');
const START = 800, COLS = { durak: 'players', chess: 'chess_players', mafia: 'mafia_players' };
let cols = null, mem = {};
const FILE = process.env.DATA_FILE || 'data.json';

if (process.env.FIREBASE_KEY) {
  try {
    const admin = require('firebase-admin');
    const key = JSON.parse(process.env.FIREBASE_KEY);
    if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(key) });
    const fsx = admin.firestore();
    cols = { durak: fsx.collection(COLS.durak), chess: fsx.collection(COLS.chess), mafia: fsx.collection(COLS.mafia) };
    console.log('Firestore подключен, проект:', key.project_id);
  } catch (e) {
    console.error('Не удалось подключить Firestore, проверьте FIREBASE_KEY:', e.message);
  }
}
if (!cols) {
  try { mem = JSON.parse(fs.readFileSync(FILE)); } catch {}
  console.log('Firestore не подключен: рейтинг хранится в файле и пропадет при перезапуске на Render.');
}
const flush = () => { if (!cols) try { fs.writeFileSync(FILE, JSON.stringify(mem)); } catch {} };
const fresh = (uid, name, photo, game) => ({ uid, name, photo, game, rating: START, games: 0, wins: 0, losses: 0, streak: 0, since: Date.now(), ...(game == 'chess' ? { draws: 0 } : {}) });
const key = (uid, game) => game + ':' + uid;

async function getUser(uid, name, photo, game = 'durak') {
  if (cols) {
    const ref = cols[game].doc(uid), snap = await ref.get();
    if (!snap.exists) { const u = fresh(uid, name, photo, game); await ref.set(u); return u; }
    const u = { ...fresh(uid, name, photo, game), ...snap.data(), uid, game };
    if (u.name !== name || u.photo !== photo) { u.name = name; u.photo = photo; await ref.update({ name, photo }); }
    return u;
  }
  const k = key(uid, game), u = mem[k] = Object.assign(fresh(uid, name, photo, game), mem[k] || {});
  u.name = name; u.photo = photo; u.game = game; flush();
  return { ...u };
}
async function saveUser(p) {
  const game = p.game || 'durak';
  const f = { rating: p.rating, games: p.games, wins: p.wins, losses: p.losses, streak: p.streak };
  if (game == 'chess') f.draws = p.draws || 0;
  if (cols) return cols[game].doc(p.uid).update(f).catch(e => console.error('db save:', e.message));
  mem[key(p.uid, game)] = { ...mem[key(p.uid, game)], ...f }; flush();
}
async function top(n = 10, game = 'durak') {
  if (cols) {
    const s = await cols[game].orderBy('rating', 'desc').limit(60).get();   // без составного индекса
    return s.docs.map(x => x.data()).filter(u => u.games > 0).slice(0, n);
  }
  return Object.values(mem).filter(u => (u.game || 'durak') == game && u.games > 0).sort((a, b) => b.rating - a.rating).slice(0, n);
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
module.exports = { getUser, saveUser, top, verify, START };
