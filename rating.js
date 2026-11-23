'use strict';
// Рейтинг для всех игр, по системе Эло (как в шахматных клубах).
// • Новичок начинает с 0: рейтинг зарабатывается победами, а не выдаётся заранее.
// • Награда зависит от силы соперников: победа над сильным даёт много, над слабым мало; поражение от слабого стоит дорого.
// • Первые 20 партий рейтинг меняется быстрее (калибровка), потом спокойнее.
// • У компьютера и гостей постоянный рейтинг своей игры: пока вы слабее компьютера, победы над ним приносят много,
//   а когда обгоните его, расти дальше можно только в играх с людьми.
const ELO = {
  start: 0, floor: 0, kNew: 48, kStd: 32, newGames: 20,
  bot: { durak: 250, chess: 350, mafia: 250, billiards: 400, bowling: 300 }
};
const expect = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));   // ожидаемый результат (от 0 до 1) игрока a против b
const kOf = games => (games < ELO.newGames ? ELO.kNew : ELO.kStd);
// изменение за партию: S — фактический результат (1 победа, 0.5 ничья, 0 поражение), E — ожидаемый.
// Победа всегда даёт хотя бы +1, поражение отнимает хотя бы 1.
function delta(games, S, E) {
  let d = Math.round(kOf(games) * (S - E));
  if (S === 1 && d < 1) d = 1;
  if (S === 0 && d > -1) d = -1;
  return d;
}
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
// 1 на 1: шахматы, бильярд
const duel = (games, r, ro, S) => delta(games, S, expect(r, ro));
// дурак: ожидание = шанс НЕ остаться дураком при таких соперниках (чем сильнее игрок, тем реже он дурак)
function durakE(ratings, i) {
  const w = ratings.map(r => Math.pow(10, -r / 400)), W = w.reduce((a, b) => a + b, 0);
  return 1 - w[i] / W;
}
// мафия: команда против команды по среднему рейтингу
const teamE = (mine, theirs) => expect(avg(mine), avg(theirs));
// боулинг: каждый с каждым по итоговому счёту, результат усредняется по соперникам
function fieldSE(ratings, scores, i) {
  let S = 0, E = 0, n = 0;
  ratings.forEach((r, j) => {
    if (j === i) return;
    S += scores[i] > scores[j] ? 1 : scores[i] < scores[j] ? 0 : .5; E += expect(ratings[i], r); n++;
  });
  return n ? { S: S / n, E: E / n } : null;
}
module.exports = { ELO, expect, kOf, delta, duel, durakE, teamE, fieldSE, avg };
