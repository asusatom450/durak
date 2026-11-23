'use strict';
// Боулинг: физика шара и кеглей, подсчёт очков, компьютерный соперник.
// Файл общий: сервер считает броски, браузер берёт отсюда размеры дорожки, траекторию для прицела и подсчёт очков.
// Единицы: сантиметры и секунды. x поперёк дорожки (0 = центр, плюс = вправо от игрока), y вдоль (0 = линия заступа).
(function (root) {
// Размеры как у настоящей дорожки: ширина 104 см, до первой кегли 18,29 м, кегли через 30,48 см, шар 21,8 см
const L = { HALF: 52.1, GUT: 23.5, HEAD: 1829, ROW: 26.4, SP: 30.48, PIT: 1912, RB: 10.9, RP: 6.05, PH: 38.1, ARR: 457, OIL: 1000 };
L.WALL = L.HALF + L.GUT;
// кегли 1–10: 1 впереди, 7 и 10 по углам последнего ряда
const PINS = [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2], [-3, 3], [-1, 3], [1, 3], [3, 3]].map(([c, r]) => [c * L.SP / 2, L.HEAD + r * L.ROW]);
const BALLS = [
  { n: 'Кобальт', lb: 12 }, { n: 'Лава', lb: 14 }, { n: 'Изумруд', lb: 13 },
  { n: 'Аметист', lb: 11 }, { n: 'Жемчуг', lb: 15 }, { n: 'Оникс', lb: 16 },
  // редкие шары из коллекции клуба: вес как у обычных, отличаются только видом
  { n: 'Галактика', lb: 14, rare: true }, { n: 'Золото', lb: 15, rare: true }, { n: 'Ледник', lb: 13, rare: true }
];
const BASE = 6;   // обычные шары доступны всем
const lbOf = id => (BALLS[id] || BALLS[1]).lb;
const DT = 1 / 600, REC = 20;   // шаг физики и запись кадра (30 в секунду)
const HK0 = 2, HK = 105;   // подкрутка: слабый снос на масле, сильный крюк на сухом конце дорожки
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// скорость шара: лёгкий можно бросить быстрее (до 36 км/ч), тяжёлый медленнее
const speedOf = (p, lb) => 430 + Math.max(0, Math.min(1, p)) * (1010 - (lb - 10) * 22 - 430);
const fullRack = () => PINS.map(([x, y], i) => ({ id: i + 1, x, y }));

function newBall(th) {
  const v = speedOf(th.p, th.lb || 14);
  return { x: th.x, y: 0, vx: v * Math.sin(th.a), vy: v * Math.cos(th.a), s: th.s, gut: 0, done: false, m: 7.6 + ((th.lb || 14) - 14) * .3 };   // эффективная масса: шар бьёт кеглю выше центра и почти не отскакивает
}
// один шаг шара без кеглей: крюк, трение, желоб, падение в яму
function ballStep(b) {
  if (b.done) return;
  if (!b.gut) b.vx += -b.s * (HK0 + HK * ss(L.OIL, L.OIL + 380, b.y)) * DT;
  const sp = Math.hypot(b.vx, b.vy), k = sp > 1 ? Math.max(0, 1 - 18 * DT / sp) : 0;
  b.vx *= k; b.vy *= k;
  b.x += b.vx * DT; b.y += b.vy * DT;
  if (!b.gut && Math.abs(b.x) > L.HALF) { b.gut = Math.sign(b.x); b.vx = 0; b.x = b.gut * (L.HALF + L.GUT / 2); }
  if (b.y > L.PIT + 6 || sp < 20) b.done = true;
}
// траектория для прицела: точки через каждые ~10 шагов, без кеглей и без случайности
function path(th) {
  const b = newBall(th), pts = [[b.x, b.y]];
  let n = 0, gutAt = -1;
  while (!b.done && n < 600 * 8) {
    ballStep(b); n++;
    if (b.gut && gutAt < 0) gutAt = pts.length;
    if (n % 10 === 0) pts.push([b.x, b.y]);
    if (b.y > L.HEAD + 90) break;
  }
  return { pts, gutAt };
}
// где окажется шар на линии первой кегли (для компьютера)
function xAt(th, y) { const b = newBall(th); let n = 0; while (!b.done && b.y < y && n < 6000) { ballStep(b); n++; } return b.gut ? b.gut * 999 : b.x; }

// ---------- бросок целиком: шар, кегли, разлёт ----------
// stand: стоящие кегли [{id,x,y}]; th: {x, a, p, s, lb}. Возвращает кадры, события для звука и оставшиеся кегли.
function simulate(stand, th, rnd) {
  rnd = rnd || Math.random;
  const b = newBall(th), MP = 1.55, E_BP = 0.76, E_PP = 0.68;
  const P = stand.map(q => ({ id: q.id, x: q.x, y: q.y, vx: 0, vy: 0, st: 0, th: 0, om: 0, ph: 0, w: 0, out: false, t0: 0, wob: 0, tw: 0, act: false }));
  const frames = [], events = [];
  let t = 0, step = 0, hitAt = -1, doneAt = -1, gutEv = false, lastAct = 0;
  const ev = (k, v) => { if (events.length < 70) events.push({ t: +t.toFixed(3), k, v: +Math.min(1, v).toFixed(2) }); };
  // части кегли для столкновений: стоящая = круг у основания, падающая = три круга вдоль корпуса
  const parts = q => {
    if (!q.st) return [[q.x, q.y, L.RP]];
    const s = Math.sin(q.th), c = Math.cos(q.ph), n = Math.sin(q.ph);
    return [[q.x + c * 11 * s, q.y + n * 11 * s, 6], [q.x + c * 24 * s, q.y + n * 24 * s, 3.3], [q.x + c * 35 * s, q.y + n * 35 * s, 3.4]];
  };
  const knock = (q, dv) => {
    if (q.st) return;
    if (dv > 24 + 34 * rnd()) {
      q.st = 1; q.t0 = t; q.ph = Math.atan2(q.vy, q.vx) + (rnd() - .5) * .7;
      q.om = Math.max(5, Math.min(16, dv / 22)); q.w = (rnd() - .5) * 7; q.act = true;
    } else { q.wob = Math.min(.32, Math.max(q.wob, dv / 110)); q.tw = t; q.act = true; }
  };
  const snap = () => {
    const f = b.done ? [-99999, -99999] : [Math.round(b.x * 10), Math.round(b.y * 10)];
    if (lastAct || !frames.length) {
      for (const q of P) {
        let tl = q.st ? q.th : q.wob * Math.sin((t - q.tw) * 19) * Math.exp(-(t - q.tw) * 4.5);
        f.push(Math.round(q.x * 10), Math.round(q.y * 10), q.out ? 999 : Math.round(tl * 57.3), Math.round(((q.ph * 57.3) % 360 + 360) % 360));
      }
    }
    frames.push(f); lastAct = 0;
  };
  snap();
  while (step < 600 * 9) {
    step++; t += DT;
    const wasGut = b.gut; ballStep(b);
    if (b.gut && !wasGut && !gutEv) { gutEv = true; ev('g', .8); }
    if (b.done && doneAt < 0) { doneAt = t; if (!b.gut) ev('x', .7); }
    // шар о кегли
    if (!b.done && !b.gut && b.y > L.HEAD - 40) for (const q of P) {
      if (q.out) continue;
      for (const [px, py, r] of parts(q)) {
        const dx = px - b.x, dy = py - b.y, d = Math.hypot(dx, dy);
        if (d >= L.RB + r || d === 0) continue;
        const nx = dx / d, ny = dy / d, vn = (b.vx - q.vx) * nx + (b.vy - q.vy) * ny;
        const ov = L.RB + r - d; q.x += nx * ov * .85; q.y += ny * ov * .85; b.x -= nx * ov * .15; b.y -= ny * ov * .15;
        if (vn <= 0) continue;
        const J = (1 + E_BP) * vn / (1 / b.m + 1 / MP);
        b.vx -= J / b.m * nx; b.vy -= J / b.m * ny; q.vx += J / MP * nx; q.vy += J / MP * ny;
        if (hitAt < 0) hitAt = t;
        knock(q, J / MP); ev('p', vn / 700); break;
      }
    }
    // кегля о кеглю
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (p.out) continue;
      const pm = p.st || p.vx * p.vx + p.vy * p.vy > 1;
      for (let j = i + 1; j < P.length; j++) {
        const q = P[j]; if (q.out) continue;
        if (!pm && !(q.st || q.vx * q.vx + q.vy * q.vy > 1)) continue;
        if (Math.abs(p.x - q.x) > 80 || Math.abs(p.y - q.y) > 80) continue;
        let hit = false;
        for (const a of parts(p)) { for (const c of parts(q)) {
          const dx = c[0] - a[0], dy = c[1] - a[1], d = Math.hypot(dx, dy);
          if (d >= a[2] + c[2] || d === 0) continue;
          const nx = dx / d, ny = dy / d, ov = a[2] + c[2] - d;
          p.x -= nx * ov / 2; p.y -= ny * ov / 2; q.x += nx * ov / 2; q.y += ny * ov / 2;
          const vn = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
          if (vn > 0) {
            const J = (1 + E_PP) * vn / 2;
            p.vx -= J * nx; p.vy -= J * ny; q.vx += J * nx; q.vy += J * ny;
            knock(p, J); knock(q, J); if (vn > 60) ev('p', vn / 900);
            p.w += (rnd() - .5) * vn / 60; q.w += (rnd() - .5) * vn / 60;
          }
          hit = true; break;
        } if (hit) break; }
      }
    }
    // движение кеглей
    for (const q of P) {
      if (q.out) continue;
      const sp = Math.hypot(q.vx, q.vy);
      if (sp > 0) {
        const fr = q.st ? (t - q.t0 < .2 ? 0 : q.th > 1.4 ? 400 : 230) : 1300, k = Math.max(0, 1 - fr * DT / sp);
        q.vx *= k; q.vy *= k; q.x += q.vx * DT; q.y += q.vy * DT;
        if (sp > 2) q.act = true;
      }
      if (q.st) {
        if (q.th < Math.PI / 2) { q.th = Math.min(Math.PI / 2, q.th + q.om * DT); q.act = true; }
        q.ph += q.w * DT; q.w *= 1 - 1.8 * DT; if (Math.abs(q.w) > .05) q.act = true;
      } else if (q.wob && t - q.tw < 1.2) q.act = true;
      if (Math.abs(q.x) > L.HALF + 1 && !q.st) { q.st = 1; q.t0 = t; q.ph = Math.atan2(q.vy, q.vx); q.om = 8; }
      if (Math.abs(q.x) > L.WALL - 4 && q.y > L.HEAD - 90) { q.x = Math.sign(q.x) * (L.WALL - 4); if (q.vx * Math.sign(q.x) > 0) { if (Math.abs(q.vx) > 80) ev('w', Math.abs(q.vx) / 900); q.vx = -q.vx * .45; } }
      if (q.y > L.PIT) { q.out = true; q.st = 1; q.vx = q.vy = 0; }
      if (q.act) { lastAct = 1; q.act = false; }
    }
    if (step % REC === 0) snap();
    if (doneAt >= 0 && (t - doneAt > 2.6 || (!lastAct && t - doneAt > .5 && step % REC === 1))) break;
  }
  lastAct = 1; snap();
  const standing = P.filter(q => !q.st && !q.out && Math.abs(q.x) <= L.HALF).map(q => ({ id: q.id, x: +q.x.toFixed(1), y: +q.y.toFixed(1) }));
  return { frames, events, standing, knocked: stand.length - standing.length, gutter: !!b.gut, hit: +(hitAt < 0 ? (doneAt < 0 ? t : doneAt) : hitAt).toFixed(2), dur: +t.toFixed(2), ids: P.map(q => q.id) };
}

// ---------- счёт ----------
// fr: 10 фреймов, в каждом массив сбитых кеглей за броски
function frameDone(f, r) { return f < 9 ? (r[0] === 10 || r.length >= 2) : (r.length >= 3 || (r.length === 2 && r[0] + r[1] < 10)); }
function totals(fr) {
  const flat = [], start = [];
  fr.forEach(r => { start.push(flat.length); r.forEach(n => flat.push(n)); });
  const out = []; let tot = 0, ok = true;
  for (let f = 0; f < 10; f++) {
    const r = fr[f] || [], i = start[f];
    if (!ok || !r.length || !frameDone(f, r)) { ok = false; out.push(null); continue; }
    let add;
    if (f === 9) add = r.reduce((a, n) => a + n, 0);
    else if (r[0] === 10) add = flat[i + 2] === undefined ? null : 10 + flat[i + 1] + flat[i + 2];
    else if (r[0] + r[1] === 10) add = flat[i + 2] === undefined ? null : 10 + flat[i + 2];
    else add = r[0] + r[1];
    if (add === null) { ok = false; out.push(null); continue; }
    tot += add; out.push(tot);
  }
  return out;
}
const total = fr => { const t = totals(fr); for (let f = 9; f >= 0; f--) if (t[f] !== null) return t[f]; return 0; };
// сплит: первая кегля сбита, а оставшиеся стоят раздельными группами
function isSplit(ids) {
  if (ids.length < 2 || ids.includes(1)) return false;
  const adj = (a, b) => { const [x1, y1] = PINS[a - 1], [x2, y2] = PINS[b - 1], d = Math.hypot(x1 - x2, y1 - y2); return d < L.SP * 1.05 || (Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 2 * L.ROW + 1); };
  const seen = new Set([ids[0]]), st = [ids[0]];
  while (st.length) { const a = st.pop(); for (const b of ids) if (!seen.has(b) && adj(a, b)) { seen.add(b); st.push(b); } }
  return seen.size < ids.length;
}

// ---------- компьютер ----------
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
// угол, при котором шар придёт в точку tx на линии ty (поиск делением пополам)
function aimFor(th, tx, ty) {
  let lo = -.16, hi = .16;
  for (let k = 0; k < 26; k++) { const m = (lo + hi) / 2, x = xAt({ ...th, a: m }, ty); if (x < tx) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function botPlan(stand, lb, style) {
  const st = style || { hand: 1, s: .55, p: .62 };
  const knocked = th => stand.length - simulate(stand, th).standing.length;
  let best = null, bs = -1;
  if (stand.length === 10) {   // первый шар: крюк в «карман» между 1 и 3 (у левши между 1 и 2)
    for (const x0 of [20, 12]) for (const off of [4.5, 5.5, 6.5]) {
      const th = { x: x0 * st.hand, s: st.s * st.hand, p: st.p, lb, a: 0 };
      th.a = aimFor(th, off * st.hand, L.HEAD);
      if (Math.abs(xAt(th, L.HEAD)) > 100) continue;
      const k = knocked(th) + Math.random() * .5 - Math.abs(off - 5.5) * .2;
      if (k > bs) { bs = k; best = th; }
    }
  } else {   // добивание: прямой шар в ключевую кеглю, с другой стороны дорожки
    for (const q of stand) for (const off of [-5, 0, 5]) {
      const th = { x: Math.max(-36, Math.min(36, -q.x * .6)), s: 0, p: .74, lb, a: 0 };
      th.a = aimFor(th, q.x + off, q.y);
      const k = knocked(th) - Math.abs(off) * .01;
      if (k > bs) { bs = k; best = th; }
    }
  }
  best = best || { x: 0, a: 0, s: 0, p: .6, lb };
  const miss = Math.random() < .08 ? 3 : 1;   // иногда компьютер ошибается заметно
  return { x: best.x, a: best.a + gauss() * .0025 * miss, p: Math.max(0, Math.min(1, best.p + gauss() * .025)), s: best.s + gauss() * .04, lb };
}

const API = { L, PINS, BALLS, BASE, lbOf, speedOf, fullRack, path, xAt, simulate, frameDone, totals, total, isSplit, botPlan, aimFor, gauss };
if (typeof module === 'object' && module.exports) module.exports = API; else root.BWL = API;
})(this);
