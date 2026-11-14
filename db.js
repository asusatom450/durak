// Хранилище игроков: Firebase Firestore (FIREBASE_KEY) или JSON-файл для локальных тестов.
const fs = require('fs'), crypto = require('crypto');
const START = 800;
let col = null, mem = {};
const FILE = process.env.DATA_FILE || 'data.json';

if (process.env.FIREBASE_KEY) {
  try {
    const admin = require('firebase-admin');
    const key = JSON.parse(process.env.FIREBASE_KEY);
    if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(key) });
    col = admin.firestore().collection('players');
    console.log('Firestore подключен, проект:', key.project_id);
  } catch (e) {
    console.error('Не удалось подключить Firestore, проверьте FIREBASE_KEY:', e.message);
  }
}
if (!col) {
  try { mem = JSON.parse(fs.readFileSync(FILE)); } catch {}
  console.log('Firestore не подключен: рейтинг хранится в файле и пропадет при перезапуске на Render.');
}
const flush = () => { if (!col) try { fs.writeFileSync(FILE, JSON.stringify(mem)); } catch {} };
const fresh = (uid, name, photo) => ({ uid, name, photo, rating: START, games: 0, wins: 0, losses: 0, streak: 0, since: Date.now(),
  crating: START, cgames: 0, cwins: 0, closses: 0, cdraws: 0 });   // c*: шахматы

async function getUser(uid, name, photo) {
  if (col) {
    const ref = col.doc(uid), snap = await ref.get();
    if (!snap.exists) { const u = fresh(uid, name, photo); await ref.set(u); return u; }
    const u = { ...fresh(uid, name, photo), ...snap.data(), uid };
    if (u.name !== name || u.photo !== photo) { u.name = name; u.photo = photo; await ref.update({ name, photo }); }
    return u;
  }
  const u = mem[uid] = Object.assign(fresh(uid, name, photo), mem[uid] || {});
  u.name = name; u.photo = photo; flush();
  return { ...u };
}
async function saveUser(p) {
  const f = { rating: p.rating, games: p.games, wins: p.wins, losses: p.losses, streak: p.streak,
    crating: p.crating ?? START, cgames: p.cgames || 0, cwins: p.cwins || 0, closses: p.closses || 0, cdraws: p.cdraws || 0 };
  if (col) return col.doc(p.uid).update(f).catch(e => console.error('db save:', e.message));
  mem[p.uid] = { ...mem[p.uid], ...f }; flush();
}
async function top(n = 10, rf = 'rating', gf = 'games') {
  if (col) {
    const s = await col.orderBy(rf, 'desc').limit(60).get();   // без составного индекса
    return s.docs.map(x => x.data()).filter(u => u[gf] > 0).slice(0, n);
  }
  return Object.values(mem).filter(u => u[gf] > 0).sort((a, b) => (b[rf] ?? 0) - (a[rf] ?? 0)).slice(0, n);
}
// Проверка подписи Telegram Mini App (initData): без нее рейтинг подделать нельзя.
function verify(d, token) {
  try {
    const p = new URLSearchParams(d), h = p.get('hash'); if (!h) return null;
    p.delete('hash');
    const s = [...p.entries()].map(([k, v]) => k + '=' + v).sort().join('\n');
    const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const c = crypto.createHmac('sha256', key).update(s).digest('hex');
    if (c.length != h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) return null;
    if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 604800) return null;
    const u = JSON.parse(p.get('user')); return u && u.id ? u : null;
  } catch { return null; }
}
module.exports = { getUser, saveUser, top, verify, START };
