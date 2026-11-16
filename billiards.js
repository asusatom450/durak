'use strict';
// Бильярд (американка, 8 шаров): физика, правила и компьютерный соперник.
// Стол вертикальный: x от 0 до W (ширина), y от 0 до L (длина). Низ стола (большой y) = «дом», пирамида вверху.
const T = { W: 500, L: 1000, R: 13, PK: [[0, 0, 30], [500, 0, 30], [0, 1000, 30], [500, 1000, 30], [0, 500, 27], [500, 500, 27]] };
const FRIC_K = 0.45, FRIC_C = 85, REST_WALL = 0.8, REST_BALL = 0.96, STOP = 5;
const isSolid = id => id >= 1 && id <= 7, isStripe = id => id >= 9 && id <= 15;
const inGroup = (g, id) => (g === 'solid' ? isSolid(id) : g === 'stripe' ? isStripe(id) : false);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function newBalls() {
  const sp = 2 * T.R + .2, pos = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) pos.push([250 + (c - r / 2) * sp, 300 - r * (Math.sqrt(3) / 2 * sp)]);
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]), stripes = shuffle([9, 10, 11, 12, 13, 14, 15]), pl = new Array(15);
  pl[4] = 8; pl[10] = solids.pop(); pl[14] = stripes.pop();
  const rest = shuffle([...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (pl[i] === undefined) pl[i] = rest.pop();
  const balls = [{ id: 0, x: 250, y: 750, on: true }];
  pos.forEach((p, i) => balls.push({ id: pl[i], x: p[0], y: p[1], on: true }));
  return balls.sort((a, b) => a.id - b.id);
}

// Один удар: возвращает конечные позиции, запись кадров (30 Гц) и события для звуков.
function simulate(balls0, angle, power, rec) {
  const R = T.R, DT = 1 / 240, b = balls0.map(o => ({ id: o.id, x: o.x, y: o.y, vx: 0, vy: 0, on: o.on }));
  const cue = b[0], v0 = 150 + power * 2250; cue.vx = Math.cos(angle) * v0; cue.vy = Math.sin(angle) * v0;
  const frames = [], events = [], pocketed = [];
  let firstHit = null, rail = false, cuePocketed = false, step = 0;
  const snap = () => { if (!rec) return; const f = []; for (const o of b) { if (o.on) f.push(Math.round(o.x * 4), Math.round(o.y * 4)); else f.push(-1, -1); } frames.push(f); };
  snap();
  const MAX = 240 * 28;
  while (step < MAX) {
    step++;
    let moving = false;
    for (const o of b) {
      if (!o.on) continue;
      o.x += o.vx * DT; o.y += o.vy * DT;
      // лузы
      let potted = false;
      for (const [px, py, pr] of T.PK) if (Math.hypot(o.x - px, o.y - py) < pr) { potted = true; break; }
      if (potted) {
        o.on = false; o.vx = o.vy = 0; if (o.id === 0) cuePocketed = true; else pocketed.push(o.id);
        events.push({ t: +(step * DT).toFixed(3), k: 'p', v: 1 }); continue;
      }
      // борта
      let hit = 0;
      if (o.x < R) { o.x = R; if (o.vx < 0) { hit = -o.vx; o.vx = -o.vx * REST_WALL; o.vy *= .98; } }
      else if (o.x > T.W - R) { o.x = T.W - R; if (o.vx > 0) { hit = o.vx; o.vx = -o.vx * REST_WALL; o.vy *= .98; } }
      if (o.y < R) { o.y = R; if (o.vy < 0) { hit = Math.max(hit, -o.vy); o.vy = -o.vy * REST_WALL; o.vx *= .98; } }
      else if (o.y > T.L - R) { o.y = T.L - R; if (o.vy > 0) { hit = Math.max(hit, o.vy); o.vy = -o.vy * REST_WALL; o.vx *= .98; } }
      if (hit > 20) { if (firstHit !== null) rail = true; events.push({ t: +(step * DT).toFixed(3), k: 'r', v: +Math.min(1, hit / 1500).toFixed(2) }); }
    }
    // шар о шар
    for (let i = 0; i < 16; i++) {
      const p = b[i]; if (!p.on) continue;
      for (let j = i + 1; j < 16; j++) {
        const q = b[j]; if (!q.on) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = 2 * R - d;
        p.x -= nx * ov / 2; p.y -= ny * ov / 2; q.x += nx * ov / 2; q.y += ny * ov / 2;
        const vn = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
        if (vn > 0) {
          const imp = vn * (1 + REST_BALL) / 2;
          p.vx -= imp * nx; p.vy -= imp * ny; q.vx += imp * nx; q.vy += imp * ny;
          if (vn > 15) events.push({ t: +(step * DT).toFixed(3), k: 'c', v: +Math.min(1, vn / 1600).toFixed(2) });
          if (firstHit === null && (i === 0)) firstHit = q.id;
        }
      }
    }
    // трение качения
    for (const o of b) {
      if (!o.on) continue;
      const sp = Math.hypot(o.vx, o.vy);
      if (sp === 0) continue;
      if (sp < STOP) { o.vx = o.vy = 0; continue; }
      const f = Math.max(0, 1 - (FRIC_K * DT + FRIC_C * DT / sp));
      o.vx *= f; o.vy *= f; moving = true;
    }
    if (rec && step % 8 === 0) snap();
    if (!moving) break;
  }
  if (rec && step % 8 !== 0) snap();
  return {
    balls: b.map(o => ({ id: o.id, x: +o.x.toFixed(2), y: +o.y.toFixed(2), on: o.on })),
    frames, events, firstHit, rail, pocketed, cuePocketed, dur: +(step * DT).toFixed(2)
  };
}

const onTable = (balls) => balls.filter(o => o.on);
function ownLeft(bl, p) { const g = bl.groups[p]; return g ? bl.balls.filter(o => o.on && inGroup(g, o.id)).length : 15; }

// Правила: что произошло после удара (без изменения состояния)
function judge(bl, sim) {
  const p = bl.turn, g = bl.groups[p], eightOnly = !!g && ownLeft(bl, p) === 0, fh = sim.firstHit;
  let foul = null;
  if (sim.cuePocketed) foul = 'биток упал в лузу';
  else if (fh === null) foul = 'битком не задет ни один шар';
  else if (g) { if (eightOnly) { if (fh !== 8) foul = 'сначала нужно бить по восьмёрке'; } else if (!inGroup(g, fh)) foul = 'первым задет чужой шар'; }
  else if (fh === 8) foul = 'на открытом столе нельзя бить сначала по восьмёрке';
  if (!foul && !sim.pocketed.length && !sim.rail) foul = 'после касания ни один шар не дошёл до борта';
  if (sim.pocketed.includes(8)) {
    if (bl.shots === 0) return { rerack: true, foul: null };
    const ok = !foul && eightOnly;
    return { end: true, win: ok ? p : 1 - p, reason: ok ? 'восьмёрка забита' : (foul ? 'восьмёрка забита с фолом' : 'восьмёрка забита раньше времени') };
  }
  const objs = sim.pocketed.filter(id => id !== 8);
  let assign = null;
  if (!foul && !g && bl.shots > 0 && objs.length) assign = isSolid(objs[0]) ? 'solid' : 'stripe';
  const grp = assign || g, mine = grp ? objs.filter(id => inGroup(grp, id)) : (bl.shots === 0 ? objs : []);
  const cont = !foul && (grp ? mine.length > 0 : (bl.shots === 0 && objs.length > 0));
  return { foul, assign, objs, mine, cont };
}

const GN = { solid: 'цельные', stripe: 'полосатые' };
function apply(bl, sim, out) {
  const p = bl.turn;
  bl.balls = sim.balls; bl.shots++;
  if (out.rerack) { bl.balls = newBalls(); bl.shots = 0; bl.hand = false; bl.msg = 'Восьмёрка на разбое: пирамида собрана заново'; return; }
  if (out.end) { bl.over = true; bl.winner = out.win; bl.reason = out.reason; bl.msg = out.reason; return; }
  if (out.assign) { bl.groups[p] = out.assign; bl.groups[1 - p] = out.assign === 'solid' ? 'stripe' : 'solid'; bl.open = false; }
  const cue = bl.balls[0];
  if (out.foul) { bl.turn = 1 - p; bl.hand = true; bl.msg = 'Фол: ' + out.foul + '. Шар в руке у соперника'; }
  else if (out.cont) { bl.hand = false; bl.msg = (out.assign ? `Ваши шары: ${GN[out.assign]}. ` : '') + 'Забит шар: бейте ещё'; }
  else { bl.turn = 1 - p; bl.hand = false; bl.msg = out.objs && out.objs.length ? 'Забит чужой шар: ход переходит' : 'Мимо: ход переходит'; }
  if (!cue.on && !bl.hand) bl.hand = true;
}

function canPlace(bl, x, y) {
  const R = T.R;
  if (!(x >= R && x <= T.W - R && y >= R && y <= T.L - R)) return false;
  for (const o of bl.balls) if (o.on && o.id !== 0 && Math.hypot(o.x - x, o.y - y) < 2 * R + .5) return false;
  for (const [px, py, pr] of T.PK) if (Math.hypot(px - x, py - y) < pr + 6) return false;
  return true;
}

// ---------- компьютер ----------
function targetsOf(bl, p) {
  const g = bl.groups[p], t = bl.balls.filter(o => o.on && o.id !== 0);
  if (!g) return t.filter(o => o.id !== 8);
  const own = t.filter(o => inGroup(g, o.id));
  return own.length ? own : t.filter(o => o.id === 8);
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function clear(balls, x1, y1, x2, y2, ign, rad) { for (const o of balls) if (o.on && !ign.includes(o.id) && segDist(o.x, o.y, x1, y1, x2, y2) < rad) return false; return true; }
function candidates(bl, cue) {
  const R = T.R, out = [];
  for (const t of targetsOf(bl, bl.turn)) for (const pk of T.PK) {
    const px = pk[0] + (250 - pk[0]) * .04, py = pk[1] + (500 - pk[1]) * .02, dx = px - t.x, dy = py - t.y, d = Math.hypot(dx, dy);
    if (d < 1) continue;
    const ux = dx / d, uy = dy / d, gx = t.x - ux * 2 * R, gy = t.y - uy * 2 * R, cx = gx - cue.x, cy = gy - cue.y, cd = Math.hypot(cx, cy);
    if (cd < 1) continue;
    const dot = (cx * ux + cy * uy) / cd;
    if (dot < .3) continue;
    if (!clear(bl.balls, cue.x, cue.y, gx, gy, [0, t.id], 2 * R * .97)) continue;
    if (!clear(bl.balls, t.x, t.y, px, py, [0, t.id], 2 * R * .97)) continue;
    out.push({ angle: Math.atan2(cy, cx), dist: cd + d, dot, tid: t.id });
  }
  return out.sort((a, b) => (b.dot * 400 - b.dist) - (a.dot * 400 - a.dist));
}
function score(bl, sim, out) {
  if (out.end) return out.win === bl.turn ? 1e6 : -1e6;
  if (out.rerack) return -50;
  if (out.foul) return -500;
  if (out.cont) return 300 + 80 * (out.mine ? out.mine.length : 0);
  return out.objs && out.objs.length ? -150 : 0;
}
function botPlan(bl) {
  const cueBall = bl.balls[0], plan = {};
  if (bl.hand || !cueBall.on) {   // шар в руке: ищем лучшее место
    let best = null, bs = -1e9;
    for (let ix = 0; ix < 6; ix++) for (let iy = 0; iy < 9; iy++) {
      const x = 60 + ix * 76, y = 80 + iy * 105;
      if (!canPlace(bl, x, y)) continue;
      const c = candidates(bl, { x, y });
      const s = c.length * 100 - (c[0] ? c[0].dist / 10 : 500);
      if (s > bs) { bs = s; best = { x, y }; }
    }
    plan.place = best || { x: 250, y: 750 };
  }
  const cue = plan.place ? { id: 0, x: plan.place.x, y: plan.place.y, on: true } : cueBall;
  const balls = bl.balls.map(o => (o.id === 0 ? cue : o));
  if (bl.shots === 0 && !plan.place) {   // разбой
    plan.angle = Math.atan2(300 - cue.y, 250 - cue.x) + (Math.random() - .5) * .05; plan.power = .95; return plan;
  }
  const b2 = { ...bl, balls }, cands = candidates(b2, cue).slice(0, 10);
  let best = null, bs = -1e9;
  for (const c of cands) for (const pw of [.5, .8]) {
    const sim = simulate(balls, c.angle, pw, false), out = judge(b2, sim), s = score(b2, sim, out) + Math.random() * 20;
    if (s > bs) { bs = s; best = { angle: c.angle, power: pw }; }
  }
  if (!best || bs < -400) {   // чистых ударов нет: бьем по ближайшей своей цели, выбирая безопасный вариант
    const ts = targetsOf(b2, bl.turn).sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y));
    for (let k = 0; k < 8 && ts.length; k++) {
      const t = ts[k % Math.min(3, ts.length)], ang = Math.atan2(t.y - cue.y, t.x - cue.x) + (Math.random() - .5) * .04, pw = .35 + Math.random() * .4;
      const sim = simulate(balls, ang, pw, false), s = score(b2, sim, judge(b2, sim)) + Math.random() * 10;
      if (!best || s > bs) { bs = s; best = { angle: ang, power: pw }; }
    }
  }
  if (!best) best = { angle: -Math.PI / 2, power: .5 };
  plan.angle = best.angle + (Math.random() - .5) * .07; plan.power = best.power; return plan;   // небольшая неточность: компьютер не идеален
}
module.exports = { T, newBalls, simulate, judge, apply, canPlace, botPlan, isSolid, isStripe, inGroup };
