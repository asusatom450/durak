const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const db = require('./db');
const BL = require('./billiards.js');
const BW = require('./bowling.js');
const RT = require('./rating.js');   // общий рейтинг по Эло для всех игр   // боулинг: физика и счёт, этот же файл грузит браузер
const { Chess } = require('./chess-lib.js');   // правила шахмат: chess.js, положен в проект целиком

// ---------- Telegram-бот: кнопка «Играть» по /start (через webhook) ----------
const TOKEN = process.env.BOT_TOKEN, APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
const tg = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).catch(() => {});

const KB_D = APP_URL ? { inline_keyboard: [[{ text: '🃏 Играть в дурака', web_app: { url: APP_URL } }], [{ text: '📖 Правила', callback_data: 'rules_durak' }]] } : undefined;
const KB_M = APP_URL ? { inline_keyboard: [[{ text: '🔪 Играть в мафию', web_app: { url: APP_URL + '/mafia' } }], [{ text: '📖 Правила', callback_data: 'rules_mafia' }]] } : undefined;
const KB_B = APP_URL ? { inline_keyboard: [[{ text: '🎱 Играть в бильярд', web_app: { url: APP_URL + '/billiards' } }], [{ text: '📖 Правила', callback_data: 'rules_billiards' }]] } : undefined;
const KB_C = APP_URL ? { inline_keyboard: [[{ text: '♞ Играть в шахматы', web_app: { url: APP_URL + '/chess' } }], [{ text: '📖 Правила', callback_data: 'rules_chess' }]] } : undefined;
const KB_W = APP_URL ? { inline_keyboard: [[{ text: '🎳 Играть в боулинг', web_app: { url: APP_URL + '/bowling' } }], [{ text: '📖 Правила', callback_data: 'rules_bowling' }]] } : undefined;
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

<b>Рейтинг</b> по системе Эло: новичок начинает с 0, за победу над сильным соперником дают больше, над слабым меньше. Партии с компьютером тоже идут в зачёт, пока вы слабее его. Первые 20 партий рейтинг меняется быстрее. Очень короткие партии не считаются.`;
const CARD_M = `🔪 <b>МАФИЯ</b>
𝗡𝗜𝗚𝗛𝗧 · 𝗗𝗔𝗬 · 𝗩𝗢𝗧𝗘

<i>Город засыпает, просыпается мафия. Найдите злодеев раньше, чем они найдут вас.</i>

<blockquote>👥 5–12 игроков, пустые места займут боты
🎭 Роли: мафия, комиссар, доктор, мирные жители
🌙 Ночью мафия выбирает жертву, днем город голосует
💬 Чат, реакции и тайный чат мафии
🏅 Свой рейтинг и ранги: от Прохожего до Дона</blockquote>

${WAIT}`;
const RULES_M = `📖 <b>ПРАВИЛА МАФИИ</b>
𝗠𝗔𝗙𝗜𝗔

<blockquote>🔪 <b>Мафия:</b> знает своих, ночью убивает одного игрока.
🕵️ <b>Комиссар:</b> ночью проверяет игрока и узнает, мафия ли он.
💉 <b>Доктор:</b> ночью лечит игрока (того же два раза подряд нельзя).
🧑 <b>Мирные жители:</b> ночью спят, днем ищут мафию.</blockquote>

<b>Ход игры</b>
🌙 <b>Ночь:</b> мафия выбирает жертву (у них свой тайный чат), доктор и комиссар действуют.
☀️ <b>Утро:</b> город узнает, кто погиб и какая у него была роль.
💬 <b>Обсуждение:</b> общий чат, подозревайте и защищайтесь.
🗳️ <b>Голосование:</b> игрок с наибольшим числом голосов изгоняется (при ничьей никого).

<b>Победа:</b> мирные побеждают, когда вся мафия изгнана; мафия побеждает, когда ее становится не меньше, чем остальных.

<b>Рейтинг</b> по системе Эло: новичок начинает с 0, команда против команды по среднему рейтингу. Победа над сильной командой даёт больше. Первые 20 игр рейтинг меняется быстрее. Если выйти из игры, засчитывается поражение.`;
const CARD_B = `🎱 <b>БИЛЬЯРД</b>
𝗔𝗠𝗘𝗥𝗜𝗖𝗔𝗡 𝗣𝗢𝗢𝗟 · 𝟴-𝗕𝗔𝗟𝗟

<i>Американка на восемь шаров: целитесь, выбирайте силу и забивайте.</i>

<blockquote>🎯 Точная наводка и сила удара
👥 Игра с другом или против компьютера
⏱ 60 секунд на удар
🏅 Свой рейтинг и ранги: от Новичка до Чемпиона</blockquote>

${WAIT}`;
const RULES_B = `📖 <b>ПРАВИЛА БИЛЬЯРДА</b>
𝗣𝗢𝗢𝗟

<blockquote>🎱 15 шаров и белый биток. Цель: забить все шары своей группы (цельные 1–7 или полосатые 9–15), затем черную восьмерку.
🔺 Первый удар: разбой пирамиды. Пока никто не забил, стол «открыт».
🎯 Первый забитый шар определяет вашу группу.</blockquote>

<b>Ход</b>
• Забили свой шар: бьете еще раз. Не забили: ход соперника.
• Первым биток должен коснуться шара вашей группы (когда они закончились, восьмерки).
• После касания какой-нибудь шар должен дойти до борта или упасть в лузу.

<b>Фол:</b> биток упал в лузу, касание не своего шара, нет касаний, нет борта, не уложились во время. Соперник ставит биток в любое место стола («шар в руке»).

<b>Победа:</b> вы забили восьмерку после всех своих шаров без фола. <b>Поражение:</b> забили восьмерку раньше времени или с фолом.

<b>Как играть:</b> ведите пальцем по столу, чтобы прицелиться, кнопки ◀ ▶ для точной наводки, ползунок задает силу, кнопка «Удар».

Вызывать лузу не нужно. Рейтинг по системе Эло: новичок начинает с 0, за победу над сильным соперником дают больше. Партии с компьютером тоже идут в зачёт, пока вы слабее его. Если соперник не бьет 60 секунд, шар в руке переходит к вам, три раза подряд означает поражение.`;
const CARD_W = `🎳 <b>БОУЛИНГ</b>
𝗧𝗘𝗡 𝗣𝗜𝗡 · 𝟭–𝟰 𝗣𝗟𝗔𝗬𝗘𝗥𝗦

<i>Десять кеглей, десять фреймов: выбирайте шар, закручивайте и выбивайте страйки.</i>

<blockquote>🎳 Живая физика шара и разлёт кеглей
🌀 Подкрутка, сила броска и шары разного веса
📺 Табло над дорожкой, как в настоящем клубе
👥 До 4 игроков, можно с ботами или в одиночку
🏅 Свой рейтинг и ранги: от Новичка до Легенды 300</blockquote>

${WAIT}`;
const RULES_W = `📖 <b>ПРАВИЛА БОУЛИНГА</b>
𝗕𝗢𝗪𝗟𝗜𝗡𝗚

<blockquote>🎳 Игра из 10 фреймов. В каждом фрейме два броска, чтобы сбить 10 кеглей.
❌ <b>Страйк:</b> все 10 кеглей первым броском. Очки: 10 + кегли за два следующих броска.
➗ <b>Спэр:</b> все кегли за два броска. Очки: 10 + кегли за следующий бросок.
🔟 <b>10-й фрейм:</b> после страйка или спэра даётся ещё бросок, всего до трёх.</blockquote>

Максимум 300 очков: 12 страйков подряд.

<b>Как бросать</b>
• Двигайте шар внизу экрана: откуда бросать.
• Коснитесь дорожки: куда целиться. Ориентируйтесь на стрелки.
• Ползунок подкрутки: шар заворачивает в конце дорожки.
• Зажмите «Бросок» и отпустите: сила зависит от момента. Пунктир показывает, куда пойдёт шар.
💡 Лучше всего попадать в «карман»: между 1-й и 3-й кеглей (при подкрутке вправо между 1-й и 2-й).

<b>Рейтинг</b> по системе Эло: побеждает больший счёт, новичок начинает с 0, за победу над сильными соперниками дают больше. Одиночная тренировка рейтинг не меняет. На бросок 45 секунд: не успели, бросок не засчитан; три раза подряд, и вы выбываете.`;
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
const TIPS = {
  tip_durak: '🃏 Колода 36 карт, по 6 каждому, козырь по последней карте. Бейте старшей картой той же масти или козырем, подкидывайте карты того же достоинства. Кто остался с картами последним, тот дурак.',
  tip_chess: '♞ Мат королю выигрывает партию. Есть рокировка, взятие на проходе и превращение пешки. Ничья: пат, повтор, 50 ходов. Упало время: поражение. Нажмите фигуру, затем клетку с точкой.',
  tip_mafia: '🔪 Ночью мафия убивает, доктор лечит, комиссар проверяет. Днем город обсуждает и голосует. Мирные побеждают, изгнав всю мафию, мафия: когда ее не меньше остальных.',
  tip_billiards: '🎱 Забейте все шары своей группы (цельные 1–7 или полосатые 9–15), затем восьмерку. Фол: биток в лузе, нет касания или борта. После фола шар в руке у соперника.',
  tip_bowling: '🎳 10 фреймов по 2 броска. Страйк: 10 + два следующих броска, спэр: 10 + следующий. Цельтесь в «карман» между 1-й и 3-й кеглей. Зажмите «Бросок» и отпустите.'
};
// Меню игр на /start: одна картинка с панелью на каждую игру + кнопки. Правила показываются всплывающим окошком (как подсказка).
const MENU_CAP = `<b>ИГРОВОЙ КЛУБ</b>
Выберите игру. Кнопка 📖 показывает правила во всплывающем окошке.

<i>⏳ Первый вход может занять 30–60 секунд: сервер просыпается. Просто подождите, и игра откроется.</i>`;
const MENU_KB = APP_URL ? { inline_keyboard: [
  [{ text: '🃏 Дурак', web_app: { url: APP_URL } }, { text: '📖 Правила', callback_data: 'tip_durak' }],
  [{ text: '♞ Шахматы', web_app: { url: APP_URL + '/chess' } }, { text: '📖 Правила', callback_data: 'tip_chess' }],
  [{ text: '🔪 Мафия', web_app: { url: APP_URL + '/mafia' } }, { text: '📖 Правила', callback_data: 'tip_mafia' }],
  [{ text: '🎱 Бильярд', web_app: { url: APP_URL + '/billiards' } }, { text: '📖 Правила', callback_data: 'tip_billiards' }],
  [{ text: '🎳 Боулинг', web_app: { url: APP_URL + '/bowling' } }, { text: '📖 Правила', callback_data: 'tip_bowling' }]] } : undefined;
let MENU_ID = null;   // file_id картинки: после первой отправки Telegram хранит ее у себя
async function sendMenu(chat) {
  try {
    if (!MENU_ID) {
      const fd = new FormData();
      fd.append('chat_id', String(chat)); fd.append('caption', MENU_CAP); fd.append('parse_mode', 'HTML');
      if (MENU_KB) fd.append('reply_markup', JSON.stringify(MENU_KB));
      fd.append('photo', new Blob([fs.readFileSync(path.join(__dirname, 'menu.jpg'))], { type: 'image/jpeg' }), 'menu.jpg');
      const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: fd })).json();
      if (!r.ok) throw new Error(r.description);
      MENU_ID = r.result.photo[r.result.photo.length - 1].file_id;
      return;
    }
    await tg('sendPhoto', { chat_id: chat, photo: MENU_ID, caption: MENU_CAP, parse_mode: 'HTML', reply_markup: MENU_KB });
  } catch (e) {   // нет картинки или Telegram отказал: показываем то же меню текстом
    console.error('menu:', e.message);
    await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: MENU_CAP, reply_markup: MENU_KB });
  }
}
const srv = http.createServer((q, r) => {
  if (q.url.split('?')[0] === '/bowling.js') {   // физика и счёт боулинга нужны и браузеру (прицел, табло)
    r.writeHead(200, { 'content-type': 'application/javascript;charset=utf-8', 'cache-control': 'no-cache' });
    return r.end(fs.readFileSync(path.join(__dirname, 'bowling.js')));
  }
  if (q.url.startsWith('/api/')) {
    const json = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    (async () => {
      const gp = new URL(q.url, 'http://x').searchParams, g = GAMES.includes(gp.get('g')) ? gp.get('g') : 'durak';
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
          tg('answerCallbackQuery', TIPS[cb.data] ? { callback_query_id: cb.id, text: TIPS[cb.data], show_alert: true } : { callback_query_id: cb.id });
          const ch = cb.message.chat.id;
          if (cb.data == 'rules_chess') msg(ch, RULES_C, KB_C);
          else if (cb.data == 'rules_mafia') msg(ch, RULES_M, KB_M);
          else if (cb.data == 'rules_billiards') msg(ch, RULES_B, KB_B);
          else if (cb.data == 'rules_bowling') msg(ch, RULES_W, KB_W);
          else if (cb.data == 'rules_durak' || cb.data == 'rules') msg(ch, RULES, KB_D);
        } else if (m && m.text) {
          const t = m.text, id = m.chat.id;
          if (/^\/(start|menu)/.test(t)) sendMenu(id);   // одно меню с картинкой вместо ленты сообщений   // две отдельные карточки
          else if (/^\/durak/.test(t)) msg(id, CARD_D, KB_D);
          else if (/^\/chess/.test(t)) msg(id, CARD_C, KB_C);
          else if (/^\/mafia/.test(t)) msg(id, CARD_M, KB_M);
          else if (/^\/billiards/.test(t)) msg(id, CARD_B, KB_B);
          else if (/^\/bowling/.test(t)) msg(id, CARD_W, KB_W);
          else if (/^\/(rules|help)/.test(t)) msg(id, RULES, KB_D).then(() => msg(id, RULES_C, KB_C)).then(() => msg(id, RULES_M, KB_M)).then(() => msg(id, RULES_B, KB_B)).then(() => msg(id, RULES_W, KB_W));
        }
      } catch {}
    });
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  r.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
const wss = new WebSocketServer({ server: srv, perMessageDeflate: { threshold: 1024 } });
const rooms = {};
const GAMES = ['durak', 'chess', 'mafia', 'billiards', 'bowling'], GN = { durak: 'дурака', chess: 'шахмат', mafia: 'мафии', billiards: 'бильярда', bowling: 'боулинга' };
const gameOf = m => (GAMES.includes(m.game) ? m.game : 'durak');
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
// ---------- рейтинг (Эло, см. rating.js) ----------
// у игрока из Telegram его рейтинг; у компьютера и гостя постоянный рейтинг игры
const rOf = (p, game) => (p.prof && !p.bot ? p.prof.rating : RT.ELO.bot[game]);
// записать результат партии: d уже посчитан, res — 'win' | 'loss' | 'draw'
function rate(pr, d, res) {
  const before = pr.rating; pr.rating = Math.max(RT.ELO.floor, before + d); pr.games++;
  if (res === 'win') { pr.wins++; pr.streak = (pr.streak || 0) + 1; }
  else if (res === 'loss') { pr.losses++; pr.streak = 0; }
  else pr.draws = (pr.draws || 0) + 1;
  db.saveUser(pr);
  return { d: pr.rating - before, before, after: pr.rating };
}
// Дурак: ожидание = шанс не остаться дураком при таких соперниках. Ушедший из игры считается проигравшим.
function settle(R) {
  R.result = [];
  if (R.loser < 0) return;   // ничья: рейтинг не меняется
  const rr = R.players.map(p => rOf(p, 'durak'));
  R.players.forEach((p, i) => {
    if (!p.prof || p.bot) return;
    const lost = i == R.loser || !!p.left;
    R.result.push({ i, ...rate(p.prof, RT.delta(p.prof.games, lost ? 0 : 1, RT.durakE(rr, i)), lost ? 'loss' : 'win') });
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
  if (R.game === 'mafia') return mfDrop(R, p);
  if (R.game === 'billiards') return blDrop(R, p);
  if (R.game === 'bowling') return bwDrop(R, p);
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
  if (R.game === 'mafia') return mfTick(R);
  if (R.game === 'billiards') return blTick(R);
  if (R.game === 'bowling') return bwTick(R);
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
    if (p.prof && (p.fines || 0) < 2) { p.fines = (p.fines || 0) + 1; const b = p.prof.rating; p.prof.rating = Math.max(RT.ELO.floor, b - AFK_PEN); d = p.prof.rating - b; db.saveUser(p.prof); }
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
// Шахматы: обычное Эло, партия с компьютером тоже идёт в зачёт. Партии короче 4 полуходов не считаются.
function chElo(R) {
  const [a, b] = R.players;
  if (R.ch.history().length < 4) return;
  const sa = !R.result.winner ? .5 : (R.col[0] == R.result.winner ? 1 : 0), ra = rOf(a, 'chess'), rb = rOf(b, 'chess');
  R.rres = [];
  [[a, 0, sa, ra, rb], [b, 1, 1 - sa, rb, ra]].forEach(([p, i, sc, r1, r2]) => {
    if (!p.prof || p.bot) return;
    R.rres.push({ i, ...rate(p.prof, RT.duel(p.prof.games, r1, r2, sc), sc === 1 ? 'win' : sc === 0 ? 'loss' : 'draw') });
  });
}
function chEnd(R, res) { if (R.over) return; R.over = true; R.result = res; R.draw = null; chElo(R); }
function chMove(R, i, m) {
  const c = R.col[i]; if (R.ch.turn() !== c) return;
  const promo = ['q', 'r', 'b', 'n'].includes(m.promo) ? m.promo : undefined;
  // время проверяем до хода: ход после падения флага на доску не попадает
  const now = Date.now();
  if (R.cl[c] - (now - R.cl.since) <= 0) { R.cl[c] = 0; return chEnd(R, { winner: chOther(c), reason: 'time' }); }
  let mv; try { mv = R.ch.move({ from: m.from, to: m.to, promotion: promo }); } catch { return; }
  R.cl[c] -= now - R.cl.since; R.cl.since = now;
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

// ================= МАФИЯ =================
const MF = { night: +process.env.MF_NIGHT_MS || 40000, day: +process.env.MF_DAY_MS || 75000, vote: +process.env.MF_VOTE_MS || 30000 };
const MF_BOTN = ['Тони', 'Лука', 'Виктор', 'Эмма', 'Ада', 'Макс', 'Роза', 'Хьюго', 'Вера', 'Феликс', 'Нина', 'Борис'];
const MF_RN = { mafia: 'Мафия', doctor: 'Доктор', sheriff: 'Комиссар', civ: 'Мирный житель' };
const rnd = a => a[Math.random() * a.length | 0];
const mfAlive = R => R.players.map((_, i) => i).filter(i => R.mf.alive[i]);
function mfVis(R, e, j) {
  if (e.ch == 'p') return e.to === j;
  if (!R.mf) return true;
  if (e.ch == 'mafia') return R.mf.roles[j] == 'mafia';
  if (e.ch == 'dead') return !R.mf.alive[j];
  return true;
}
function mfPush(R, e) {
  R.log.push(e); R.log = R.log.slice(-40);
  R.players.forEach((p, j) => { if (mfVis(R, e, j)) p.lc = (p.lc || 0) + 1; });
}
const mfSys = (R, text) => mfPush(R, { n: -1, text, ch: 'all' });
function mfStart(R) {
  R.players = R.players.filter(p => p.bot || (p.ws && !p.left));
  R.players.forEach(p => { p.off = false; p.left = false; clearTimeout(p.tm); p.lc = 0; });
  const n = R.players.length;
  if (n < 5) { R.started = false; R.over = false; R.mf = null; return; }
  const mc = n >= 12 ? 4 : n >= 9 ? 3 : n >= 6 ? 2 : 1, roles = [];
  for (let k = 0; k < mc; k++) roles.push('mafia');
  roles.push('doctor', 'sheriff'); while (roles.length < n) roles.push('civ');
  for (let k = n - 1; k > 0; k--) { const j = Math.random() * (k + 1) | 0; [roles[k], roles[j]] = [roles[j], roles[k]]; }
  R.mf = { roles, alive: roles.map(() => true), day: 0, phase: 'night', end: 0, t0: 0, dur: 0, allAt: 0, nv: {}, heal: null, lastHeal: -1, check: null, checks: {}, ready: {}, votes: {}, won: null, fate: {} };
  R.started = true; R.over = false; R.rres = null; R.log = [];
  mfSys(R, `🎭 Игра началась: игроков ${n}, мафии ${mc}`);
  mfNight(R, 1);
}
function mfSched(R, ms) {
  const mf = R.mf, now = Date.now(); mf.t0 = now; mf.end = now + ms; mf.dur = ms; mf.allAt = 0;
  R.players.forEach(p => { p.botDone = false; p.botAt = now + 2500 + Math.random() * Math.max(1000, ms * .5); });
}
function mfNight(R, day) {
  const mf = R.mf; mf.phase = 'night'; mf.day = day; mf.nv = {}; mf.heal = null; mf.check = null; mf.ready = {}; mf.votes = {};
  mfSched(R, MF.night); mfSys(R, `🌙 Ночь ${day}. Город засыпает, просыпается мафия…`);
}
// fate: как выбыл игрок (kill — ночью, vote — изгнан городом, left — ушёл), для карточек и утренней газеты
function mfKill(R, i, how, fate) { R.mf.alive[i] = false; R.mf.fate[i] = fate; mfSys(R, `${how} ${R.players[i].name}: ${MF_RN[R.mf.roles[i]]}`); }
function mfEnd(R, w) {
  const mf = R.mf; mf.phase = 'over'; mf.won = w; R.over = true;
  mfSys(R, w == 'mafia' ? '🔪 Победила мафия!' : '🏆 Победили мирные жители!');
  mfSettle(R);
}
function mfWinCheck(R) {
  const mf = R.mf, al = mfAlive(R), m = al.filter(i => mf.roles[i] == 'mafia').length;
  const w = !m ? 'town' : (m >= al.length - m ? 'mafia' : null);
  if (w) mfEnd(R, w);
  return !!w;
}
function mfTop(cnt) {   // единственный лидер по голосам или null
  let best = 0, tie = [];
  for (const [t, c] of Object.entries(cnt)) { if (c > best) { best = c; tie = [+t]; } else if (c == best) tie.push(+t); }
  return tie;
}
function mfDawn(R) {
  const mf = R.mf, cnt = {};
  mfAlive(R).filter(i => mf.roles[i] == 'mafia').forEach(i => { const t = mf.nv[i]; if (t != null && mf.alive[t]) cnt[t] = (cnt[t] || 0) + 1; });
  const tie = mfTop(cnt), target = tie.length ? rnd(tie) : null;
  mf.lastHeal = mf.heal == null ? -1 : mf.heal; mf.phase = 'day'; mf.ready = {}; mf.votes = {};
  if (target != null && target !== mf.heal) mfKill(R, target, `☀️ День ${mf.day}. Ночью убит`, 'kill');
  else mfSys(R, `☀️ День ${mf.day}. Этой ночью никто не погиб.`);
  if (mfWinCheck(R)) return;
  mfSched(R, MF.day); mfSys(R, '💬 Обсуждение: кто из вас мафия?');
}
function mfAdvance(R) {
  const mf = R.mf;
  if (mf.phase == 'night') mfDawn(R);
  else if (mf.phase == 'day') { mf.phase = 'vote'; mf.votes = {}; mfSched(R, MF.vote); mfSys(R, '🗳️ Голосование: кого изгнать из города?'); }
  else if (mf.phase == 'vote') {
    const cnt = {};
    Object.entries(mf.votes).forEach(([v, t]) => { if (t != null && mf.alive[+v] && mf.alive[t]) cnt[t] = (cnt[t] || 0) + 1; });
    const tie = mfTop(cnt);
    if (tie.length == 1) mfKill(R, tie[0], '⚖️ Город изгнал', 'vote'); else mfSys(R, '⚖️ Мнения разошлись: никого не изгнали.');
    if (mfWinCheck(R)) return;
    mfNight(R, mf.day + 1);
  }
}
function mfAllDone(R) {
  const mf = R.mf, al = mfAlive(R);
  if (mf.phase == 'night') return al.every(i => mf.roles[i] == 'mafia' ? mf.nv[i] != null : mf.roles[i] == 'doctor' ? mf.heal != null : mf.roles[i] == 'sheriff' ? mf.check != null : true);
  if (mf.phase == 'day') return al.every(i => mf.ready[i]);
  if (mf.phase == 'vote') return al.every(i => i in mf.votes);
  return false;
}
// Боты. Раньше мафиози голосовали днём единым блоком, а мирные наугад, и мафия выигрывала почти всегда.
// Теперь: комиссар-бот раскрывается и называет найденную мафию, мирные боты идут за ним,
// иногда догадываются сами; мафия днём голосует вразнобой, а ночью охотится на раскрытого комиссара.
const MF_FOLLOW = .4, MF_TRUST = .85, MF_GUESS = .4;
function mfBots(R) {
  const mf = R.mf, now = Date.now(); let ch = false;
  R.players.forEach((p, i) => {
    if (!p.bot || !mf.alive[i] || p.botDone || now < p.botAt) return;
    p.botDone = true; ch = true;
    const alive = mfAlive(R), role = mf.roles[i], others = alive.filter(j => j != i), nm = others.filter(j => mf.roles[j] != 'mafia');
    const claim = mf.claim != null && mf.alive[mf.claim] ? mf.claim : null, claimBy = mf.claimBy != null && mf.alive[mf.claimBy] ? mf.claimBy : null;
    if (mf.phase == 'night') {
      if (role == 'mafia') { const mate = Object.values(mf.nv).find(t => t != null && mf.alive[t]); mf.nv[i] = mate != null ? mate : claimBy != null ? claimBy : rnd(nm); }
      else if (role == 'doctor') mf.heal = claimBy != null && claimBy !== mf.lastHeal && Math.random() < .7 ? claimBy : rnd(alive.filter(j => j != mf.lastHeal));
      else if (role == 'sheriff') { const pool = others.filter(j => mf.checks[j] === undefined), t = rnd(pool.length ? pool : others); mf.check = t; mf.checks[t] = mf.roles[t] == 'mafia'; }
    } else if (mf.phase == 'day') {
      mf.ready[i] = true;
      if (role == 'sheriff') {   // раскрывается, если знает живую мафию
        const t = others.find(j => mf.checks[j] === true);
        if (t !== undefined && claim !== t) { mf.claim = t; mf.claimBy = i; mfPush(R, { n: i, name: p.name, text: `🕵️ Я комиссар! ${R.players[t].name} — мафия`, ch: 'all' }); }
      }
    } else if (mf.phase == 'vote') {
      let t;
      if (role == 'mafia') {
        const mate = Object.entries(mf.votes).find(([v, x]) => x != null && mf.roles[+v] == 'mafia' && mf.alive[x] && mf.roles[x] != 'mafia');
        if (claim != null && mf.roles[claim] == 'mafia' && claimBy != null) t = claimBy;   // защищают своего: голосуют против обвинителя
        else t = mate && Math.random() < MF_FOLLOW ? mate[1] : rnd(nm);
      } else {
        const known = role == 'sheriff' ? others.find(j => mf.checks[j] === true) : undefined;
        if (known !== undefined) t = known;
        else if (claim != null && claim !== i && Math.random() < MF_TRUST) t = claim;
        else if (Math.random() < .1) t = null;
        else if (Math.random() < MF_GUESS) t = rnd(others.filter(j => mf.roles[j] == 'mafia'));
        else t = rnd(others);
      }
      mf.votes[i] = t == undefined ? null : t;
    }
  });
  return ch;
}
function mfTick(R) {
  if (!R.started || R.over || !R.mf) return;
  const mf = R.mf, now = Date.now(); let ch = mfBots(R);
  if (mfAllDone(R)) { if (!mf.allAt) mf.allAt = now; } else mf.allAt = 0;
  if (now >= mf.end || (mf.allAt && now >= mf.allAt + 1500 && now >= mf.t0 + 3000)) { mfAdvance(R); ch = true; }
  if (ch) send(R);
}
function mfDrop(R, p) {
  const i = R.players.indexOf(p); if (i < 0 || p.left) return;
  p.left = true; p.off = false;
  if (!R.started || R.over || !R.mf || !R.mf.alive[i]) return;
  R.mf.alive[i] = false; R.mf.fate[i] = 'left'; mfSys(R, `🚪 ${p.name} покинул игру: ${MF_RN[R.mf.roles[i]]}`);
  mfWinCheck(R);
}
// Мафия: команда против команды по среднему рейтингу. Ушедший из игры проигрывает.
function mfSettle(R) {
  const mf = R.mf, P = R.players, side = i => (mf.roles[i] == 'mafia' ? 'mafia' : 'town'); R.rres = [];
  const team = t => P.map((p, i) => (side(i) == t ? rOf(p, 'mafia') : null)).filter(x => x != null), rm = team('mafia'), rt = team('town');
  P.forEach((p, i) => {
    if (!p.prof || p.bot) return;
    const win = !p.left && side(i) == mf.won, E = side(i) == 'mafia' ? RT.teamE(rm, rt) : RT.teamE(rt, rm);
    R.rres.push({ i, ...rate(p.prof, RT.delta(p.prof.games, win ? 1 : 0, E), win ? 'win' : 'loss') });
  });
}
function mfChat(R, i, m) {
  const tx = String(m.text || '').trim().slice(0, 120); if (!tx) return;
  const mf = R.mf; let ch = 'all';
  if (R.started && !R.over && mf) {
    if (!mf.alive[i]) ch = 'dead';
    else if (mf.phase == 'night') { if (mf.roles[i] != 'mafia') return; ch = 'mafia'; }
  }
  mfPush(R, { n: i, name: R.players[i].name, text: tx, ch });
}
function mfMsg(R, i, m) {
  const mf = R.mf;
  if (!R.started) {
    if (m.t == 'bot' && R.players.length < 12) R.players.push({ name: MF_BOTN[R.players.length % 12], hand: [], bot: true, ws: null });
    else if (m.t == 'start') mfStart(R);
    return;
  }
  if (R.over) {
    if (m.t == 'again') { R.started = false; R.over = false; R.mf = null; R.log = []; R.players = R.players.filter(p => p.bot || (p.ws && !p.left)); R.players.forEach(p => { p.lc = 0; p.off = false; }); }
    return;
  }
  if (!mf.alive[i]) return;
  const role = mf.roles[i], t = m.target, ok = Number.isInteger(t) && t >= 0 && t < R.players.length && mf.alive[t];
  if (m.t == 'act' && mf.phase == 'night' && ok) {
    if (role == 'mafia' && mf.roles[t] != 'mafia') mf.nv[i] = t;
    else if (role == 'doctor' && t !== mf.lastHeal) mf.heal = t;
    else if (role == 'sheriff' && mf.check == null && t !== i) {
      mf.check = t; const isM = mf.roles[t] == 'mafia'; mf.checks[t] = isM;
      mfPush(R, { n: -1, ch: 'p', to: i, text: `🔎 Проверка: ${R.players[t].name} — ${isM ? 'МАФИЯ' : 'не мафия'}` });
    }
  } else if (m.t == 'ready' && mf.phase == 'day') mf.ready[i] = true;
  else if (m.t == 'vote' && mf.phase == 'vote') { if (m.target == null) mf.votes[i] = null; else if (ok && t !== i) mf.votes[i] = t; }
}
function mfState(R, i) {
  const mf = R.mf, now = Date.now(), my = mf ? mf.roles[i] : null, aliveMe = mf ? mf.alive[i] : true;
  const ghost = !!mf && (!aliveMe || R.over), mafiaMe = my == 'mafia';
  return {
    game: 'mafia', room: R.code, you: i, host: true, started: R.started, over: R.over, status: !R.started ? 'lobby' : (R.over ? 'over' : 'play'),
    phase: mf ? mf.phase : 'lobby', day: mf ? mf.day : 0, left: mf ? Math.max(0, mf.end - now) : 0, dur: mf ? mf.dur : 0,
    myRole: my, alive: aliveMe, won: mf ? mf.won : null, need: 5,
    players: R.players.map((p, j) => ({
      name: p.name, bot: p.bot, photo: p.photo || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
      alive: mf ? mf.alive[j] : true, fate: mf && mf.fate ? mf.fate[j] || null : null,
      role: mf && (ghost || j === i || (mafiaMe && mf.roles[j] == 'mafia') || !mf.alive[j]) ? mf.roles[j] : null,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak, since: p.prof.since } : null
    })),
    mv: mf && mafiaMe && mf.phase == 'night' ? mf.nv : null, heal: mf && my == 'doctor' ? mf.heal : null, lastHeal: mf && my == 'doctor' ? mf.lastHeal : -1,
    check: mf && my == 'sheriff' ? mf.check : null, checks: mf && my == 'sheriff' ? mf.checks : null,
    votes: mf && mf.phase == 'vote' ? mf.votes : null, ready: mf ? Object.keys(mf.ready).map(Number) : [],
    log: R.log.filter(e => mfVis(R, e, i)).slice(-30), logN: R.players[i].lc || 0, rres: R.rres || null, radio: R.radio || null, now
  };
}

// ================= БИЛЬЯРД =================
const BL_MS = +process.env.BL_SHOT_MS || 60000;
function blStart(R) {
  const again = R.over && R.bl;
  R.players = R.players.filter(p => p.bot || (p.ws && !p.left));
  R.players.forEach(p => { p.off = false; clearTimeout(p.tm); });
  if (R.players.length < 2) { R.started = false; R.over = false; return; }
  const first = again ? 1 - R.bl.breaker : (Math.random() < .5 ? 0 : 1);
  R.bl = { balls: BL.newBalls(), turn: first, breaker: first, groups: [null, null], open: true, hand: false, shots: 0, over: false, winner: null, reason: '', msg: 'Разбейте пирамиду', to: [0, 0], end: Date.now() + BL_MS, seq: 0 };
  R.started = true; R.over = false; R.rres = null; R.animUntil = 0; R.mv++;
  sys(R, `🎱 Игра началась. Разбивает ${R.players[first].name}`);
}
function blEnd(R) {
  const bl = R.bl; R.over = true; bl.over = true; R.rres = null;
  // Бильярд: обычное Эло, партия с компьютером тоже идёт в зачёт
  const [a, b] = R.players, ra = rOf(a, 'billiards'), rb = rOf(b, 'billiards');
  R.rres = [];
  [[a, 0, ra, rb], [b, 1, rb, ra]].forEach(([p, i, r1, r2]) => {
    if (!p.prof || p.bot) return;
    const sc = bl.winner === i ? 1 : 0;
    R.rres.push({ i, ...rate(p.prof, RT.duel(p.prof.games, r1, r2, sc), sc ? 'win' : 'loss') });
  });
}
function blShot(R, i, a, p) {
  const bl = R.bl;
  if (!bl || bl.over || bl.turn !== i || !Number.isFinite(a) || !Number.isFinite(p) || !bl.balls[0].on) return false;
  if (Date.now() < (R.animUntil || 0) - 400) return false;
  p = Math.max(.03, Math.min(1, p));
  const sim = BL.simulate(bl.balls, a, p, true), out = BL.judge(bl, sim);
  BL.apply(bl, sim, out);
  bl.to[i] = 0; bl.seq++; R.mv++; bl.last.seq = bl.seq;
  R.animUntil = Date.now() + sim.dur * 1000 + 700; bl.end = R.animUntil + BL_MS;
  bcast(R, { ev: 'shot', seq: bl.seq, frames: sim.frames, events: sim.events, by: i });
  if (bl.over) blEnd(R);
  return true;
}
function blMsg(R, i, m) {
  if (!R.started) {
    if (m.t == 'bot' && R.players.length < 2) R.players.push({ name: 'Компьютер', hand: [], bot: true, ws: null });
    else if (m.t == 'start' && R.players.length >= 2) blStart(R);
    return;
  }
  if (R.over) { if (m.t == 'again') blStart(R); return; }
  const bl = R.bl;
  if (m.t == 'shot') blShot(R, i, +m.a, +m.p);
  else if (m.t == 'place') {
    if (bl.turn === i && bl.hand && Date.now() >= (R.animUntil || 0) - 400 && BL.canPlace(bl, +m.x, +m.y)) { const c = bl.balls[0]; c.x = +m.x; c.y = +m.y; c.on = true; }
  } else if (m.t == 'resign') { bl.winner = 1 - i; bl.reason = R.players[i].name + ' сдался'; blEnd(R); }
}
function blTick(R) {
  if (!R.started || R.over || !R.bl) return;
  const bl = R.bl, now = Date.now(), i = bl.turn, p = R.players[i];
  if (!p || p.bot || p.off || p.left || now < bl.end) return;
  bl.to[i]++;
  if (bl.to[i] >= 3) { bl.winner = 1 - i; bl.reason = p.name + ' не ходит (вышло время)'; blEnd(R); }
  else { bl.turn = 1 - i; bl.hand = true; bl.msg = `${p.name} не успел ударить: шар в руке у соперника`; bl.end = now + BL_MS; R.mv++; bl.seq++; bl.last = { by: i, time: true, seq: bl.seq }; }
  send(R);
}
function blDrop(R, p) {
  if (p.left) return; p.left = true; p.off = false;
  sys(R, p.name + ' покинул игру');
  if (R.started && !R.over && R.bl) { R.bl.winner = 1 - R.players.indexOf(p); R.bl.reason = 'соперник покинул игру'; blEnd(R); }
}
function blSchedule(R) {
  if (!R.started || R.over || !R.bl) return;
  const bl = R.bl, p = R.players[bl.turn]; if (!p || !p.bot) return;
  const key = bl.seq, wait = Math.max(0, (R.animUntil || 0) - Date.now());
  R.tm = setTimeout(() => {
    if (!R.started || R.over || R.bl !== bl || bl.seq !== key || !R.players[bl.turn].bot) return;
    const plan = BL.botPlan(bl);
    if (plan.place) { const c = bl.balls[0]; c.x = plan.place.x; c.y = plan.place.y; c.on = true; }
    blShot(R, bl.turn, plan.angle, plan.power); send(R);
  }, wait + 1300 + Math.random() * 900);
}
function blState(R, i) {
  const bl = R.bl, now = Date.now(), playing = R.started && !R.over;
  return {
    game: 'billiards', room: R.code, you: i, host: true, started: R.started, over: R.over, status: playing ? 'play' : (R.over ? 'over' : 'lobby'),
    turn: bl ? bl.turn : 0, groups: bl ? bl.groups : [null, null], open: bl ? bl.open : true, hand: bl ? bl.hand : false, shots: bl ? bl.shots : 0,
    balls: bl ? bl.balls.filter(o => o.on).map(o => [o.id, Math.round(o.x * 10) / 10, Math.round(o.y * 10) / 10]) : [],
    msg: bl ? bl.msg : '', seq: bl ? bl.seq : 0, last: bl ? bl.last || null : null, left: bl ? Math.max(0, bl.end - now) : 0, shotMs: BL_MS,
    winner: bl && bl.over ? bl.winner : null, reason: bl && bl.over ? bl.reason : '', rres: R.rres || null,
    players: R.players.map(p => ({
      name: p.name, bot: p.bot, photo: p.photo || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak || 0, since: p.prof.since } : null
    })),
    log: R.log.slice(-30), logN: R.logN, radio: R.radio || null, now
  };
}

// ================= БОУЛИНГ =================
// Игроки бросают по очереди, фрейм за фреймом. Бросок считает сервер и рассылает кадры анимации всем.
const BW_MS = +process.env.BW_ROLL_MS || 45000, BW_MAX = 4;
const BW_BOTN = ['Кегельбот', 'Страйкер', 'Хук', 'Спэр'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function bwBot(R) {   // у каждого компьютера своя манера: рука, подкрутка, сила
  const hand = Math.random() < .8 ? 1 : -1;
  return { name: BW_BOTN[R.players.length % BW_BOTN.length], hand: [], bot: true, ws: null, ball: Math.random() * BW.BALLS.length | 0,
    style: { hand, s: .42 + Math.random() * .22, p: .55 + Math.random() * .12 } };
}
function bwStart(R) {
  R.players = R.players.filter(p => p.bot || p.ws);   // вышедший кнопкой, но оставшийся на связи играет снова
  R.players.forEach(p => { p.off = false; p.left = false; clearTimeout(p.tm); });
  if (!R.players.length) { R.started = false; R.over = false; return; }
  const n = R.players.length, z = () => R.players.map(() => 0);
  R.bw = { cur: 0, frame: 0, fr: R.players.map(() => Array.from({ length: 10 }, () => [])), fl: R.players.map(() => []), sp: R.players.map(() => []),
    pins: BW.fullRack(), seq: 0, end: Date.now() + BW_MS, over: false, to: z(), streak: z(), last: null, win: null, tot: null, v: 0 };
  R.started = true; R.over = false; R.rres = null; R.animUntil = 0; R.mv++;
  sys(R, n === 1 ? '🎳 Тренировка началась' : `🎳 Игра началась. Первым бросает ${R.players[0].name}`);
}
function bwNext(R) {   // следующий игрок; после последнего начинается новый фрейм
  const bw = R.bw, n = R.players.length, ok = j => !R.players[j].left;
  bw.pins = BW.fullRack();
  for (let j = bw.cur + 1; j < n; j++) if (ok(j)) { bw.cur = j; return; }
  bw.frame++;
  if (bw.frame < 10) for (let j = 0; j < n; j++) if (ok(j)) { bw.cur = j; return; }
  bw.over = true;
}
// бросок игрока i; th = null значит «время вышло»: бросок не засчитан, кегли стоят
function bwRoll(R, i, th) {
  const bw = R.bw;
  if (!bw || bw.over || R.over || bw.cur !== i) return false;
  if (th && Date.now() < (R.animUntil || 0) - 300) return false;
  const p = R.players[i], f = bw.frame, rolls = bw.fr[i][f], full = bw.pins.length === 10;
  let res = null;
  if (th) {
    const x = +th.x, a = +th.a, pw = +th.p, s = +th.s;
    if (![x, a, pw, s].every(Number.isFinite)) return false;
    const lb = BW.lbOf(p.ball), g = p.bot ? 0 : 1;   // у человека небольшой разброс, как у живой руки
    const real = { x: clamp(x, -40, 40), a: clamp(a, -.2, .2) + BW.gauss() * .001 * g, p: clamp(clamp(pw, 0, 1) + BW.gauss() * .008 * g, 0, 1), s: clamp(s, -1, 1) + BW.gauss() * .03 * g, lb };
    res = BW.simulate(bw.pins, real);
    bw.to[i] = 0; bw.v = Math.round(BW.speedOf(real.p, lb) * .36) / 10;
  } else bw.fl[i].push(f + ':' + rolls.length);
  const standing = res ? res.standing : bw.pins, n = res ? res.knocked : 0;
  let kind = 'pins';
  if (!res) kind = 'foul';
  else if (res.gutter && !n) kind = 'gutter';
  else if (!standing.length) kind = full ? 'strike' : 'spare';
  else if (full && BW.isSplit(standing.map(q => q.id))) kind = 'split';
  else if (!n) kind = 'miss';
  if (kind === 'split') bw.sp[i].push(f + ':' + rolls.length);
  rolls.push(n);
  bw.streak[i] = kind === 'strike' ? bw.streak[i] + 1 : 0;
  bw.seq++; R.mv++;
  bw.last = { seq: bw.seq, by: i, n, kind, streak: bw.streak[i], left: standing.map(q => q.id), frame: f, roll: rolls.length, v: res ? bw.v : 0 };
  bw.pins = standing;
  if (BW.frameDone(f, rolls)) bwNext(R);
  else if (!bw.pins.length) bw.pins = BW.fullRack();   // 10-й фрейм: после страйка или спэра новая расстановка
  R.animUntil = Date.now() + (res ? res.dur * 1000 + 1900 : 1600); bw.end = R.animUntil + BW_MS;
  if (res) bcast(R, { ev: 'roll', seq: bw.seq, by: i, ids: res.ids, frames: res.frames, events: res.events, hit: res.hit, gut: res.gutter, dur: res.dur, s: clamp(+th.s, -1, 1), v: bw.v });
  if (bw.over) bwEnd(R);
  return true;
}
function bwEnd(R) {
  const bw = R.bw, P = R.players; bw.over = true; R.over = true; R.rres = [];
  const tot = P.map((_, j) => BW.total(bw.fr[j])), alive = P.map((_, j) => j).filter(j => !P[j].left);
  const top = alive.length ? Math.max(...alive.map(j => tot[j])) : -1;
  bw.tot = tot; bw.win = alive.filter(j => tot[j] === top);
  // Эло: каждый с каждым по итоговому счёту (ушедший ниже всех), результат усредняется по соперникам
  const R0 = P.map(p => rOf(p, 'bowling')), sc = P.map((p, j) => (p.left ? -1 : tot[j])), multi = P.length > 1;
  P.forEach((p, i) => {
    if (!p.prof) return;
    const pr = p.prof, before = pr.rating, done = BW.frameDone(9, bw.fr[i][9]) && !p.left;
    const nb = done && tot[i] > (pr.best || 0); if (nb) pr.best = tot[i];
    if (!multi) { db.saveUser(pr); R.rres.push({ i, d: 0, before, after: before, best: pr.best || 0, nb }); return; }
    const f = RT.fieldSE(R0, sc, i), won = bw.win.includes(i);
    R.rres.push({ i, ...rate(pr, RT.delta(pr.games, f.S, f.E), won ? 'win' : 'loss'), best: pr.best || 0, nb });
  });
  if (multi && bw.win.length) sys(R, `🏆 ${bw.win.map(j => P[j].name).join(', ')}: ${top} очков`);
  else if (!multi) sys(R, `🎳 Тренировка окончена: ${tot[0]} очков`);
}
function bwDrop(R, p, why) {
  if (p.left) return; p.left = true; p.off = false;
  sys(R, p.name + ' ' + (why || 'покинул игру'));
  if (!R.started || R.over || !R.bw) return;
  const bw = R.bw, i = R.players.indexOf(p), rest = R.players.filter(q => !q.left);
  if (!rest.some(q => !q.bot) || (R.players.length > 1 && rest.length < 2)) return bwEnd(R);
  if (bw.cur === i) { bwNext(R); bw.end = Math.max(Date.now(), R.animUntil || 0) + BW_MS; R.mv++; if (bw.over) bwEnd(R); }
}
function bwMsg(R, i, m) {
  const p = R.players[i];
  if (m.t == 'ball') { const b = +m.id; if (Number.isInteger(b) && b >= 0 && b < BW.BALLS.length) p.ball = b; return; }
  if (!R.started) {
    if (m.t == 'bot' && R.players.length < BW_MAX) R.players.push(bwBot(R));
    else if (m.t == 'start' && R.players.length >= 1) bwStart(R);
    return;
  }
  if (R.over) { if (m.t == 'again') bwStart(R); return; }
  if (m.t == 'roll') bwRoll(R, i, m);
  else if (m.t == 'resign') bwDrop(R, p, R.players.length > 1 ? 'вышел из игры' : 'закончил тренировку');
}
function bwTick(R) {
  if (!R.started || R.over || !R.bw) return;
  const bw = R.bw, now = Date.now(), i = bw.cur, p = R.players[i];
  if (!p || p.bot || p.off || p.left || now < bw.end) return;
  bw.to[i]++;
  if (bw.to[i] >= 3) bwDrop(R, p, 'не бросает и выбывает из игры');
  else { sys(R, `⏱ ${p.name}: время вышло, бросок не засчитан`); bwRoll(R, i, null); }
  send(R);
}
function bwSchedule(R) {
  if (!R.started || R.over || !R.bw) return;
  const bw = R.bw, p = R.players[bw.cur]; if (!p || !p.bot || p.left) return;
  const key = bw.seq, wait = Math.max(0, (R.animUntil || 0) - Date.now());
  R.tm = setTimeout(() => {
    if (!R.started || R.over || R.bw !== bw || bw.seq !== key || R.players[bw.cur] !== p) return;
    bwRoll(R, bw.cur, BW.botPlan(bw.pins, BW.lbOf(p.ball), p.style)); send(R);
  }, wait + 900 + Math.random() * 900);
}
function bwState(R, i) {
  const bw = R.bw, now = Date.now(), playing = R.started && !R.over;
  return {
    game: 'bowling', room: R.code, you: i, host: true, started: R.started, over: R.over, status: playing ? 'play' : (R.over ? 'over' : 'lobby'),
    cur: bw ? bw.cur : 0, frame: bw ? bw.frame : 0, fr: bw ? bw.fr : [], fl: bw ? bw.fl : [], sp: bw ? bw.sp : [],
    pins: bw ? bw.pins.map(q => [q.id, q.x, q.y]) : [], seq: bw ? bw.seq : 0, left: bw && playing ? Math.max(0, bw.end - now) : 0, rollMs: BW_MS,
    last: bw ? bw.last : null, win: bw && bw.over ? bw.win : null, tot: bw && bw.over ? bw.tot : null, rres: R.rres || null, max: BW_MAX,
    players: R.players.map(p => ({
      name: p.name, bot: p.bot, photo: p.photo || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0, ball: p.ball || 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak || 0, since: p.prof.since, best: p.prof.best || 0 } : null
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
  if (R.game === 'mafia') return mfState(R, i);
  if (R.game === 'billiards') return blState(R, i);
  if (R.game === 'bowling') return bwState(R, i);
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
  if (R.game === 'mafia') return;
  if (R.game === 'billiards') return blSchedule(R);
  if (R.game === 'bowling') return bwSchedule(R);
  if (R.started && !R.over && R.players.some(p => p.bot))
    R.tm = setTimeout(() => { if (botStep(R)) send(R); }, 900);
}
const err = (ws, m) => ws.send(JSON.stringify({ err: m }));

// После конца партии комната возвращается в лобби, чтобы мог зайти новый игрок
function toLobby(R) {
  R.started = false; R.over = false; R.mf = null; R.rres = null; R.result = null; R.mv++;
  R.players = R.players.filter(p => p.bot || p.ws);   // кто на связи, остаётся, даже если выходил из прошлой партии
  R.players.forEach(p => { p.off = false; p.left = false; clearTimeout(p.tm); p.lc = 0; });
}
wss.on('connection', ws => {
  ws.send(JSON.stringify({ ev: 'stations', list: STATIONS }));
  // Любая ошибка при разборе сообщения не должна ронять сервер: иначе пропадают все комнаты
  ws.on('message', raw => onMessage(ws, raw).catch(e => console.error('message:', e && e.stack || e)));
  ws.on('close', () => { try { onClose(ws); } catch (e) { console.error('close:', e && e.stack || e); } });
});
async function onMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t == 'join') {
      const code = String(m.room || '').toUpperCase().slice(0, 8);
      if (!code) return err(ws, 'Введите код комнаты');
      if (rooms[code] && rooms[code].game !== gameOf(m)) return err(ws, 'Это комната для ' + GN[rooms[code].game]);
      const R = rooms[code] || (rooms[code] = { code, players: [], started: false, over: false, table: [], deck: [], loser: -1, log: [], logN: 0, mv: 0, game: gameOf(m) });
      let A;
      try { A = await auth(m, R.game); }
      catch (e) {   // база не ответила: просим войти ещё раз, пустую комнату убираем
        console.error('auth:', e.message);
        if (!R.players.length && rooms[code] === R) delete rooms[code];
        return err(ws, 'Не удалось войти, попробуйте ещё раз');
      }
      if (rooms[code] !== R) {   // пока проверяли вход, последний игрок вышел и комнату убрали: возвращаем её
        if (rooms[code]) return err(ws, 'Комната закрылась, попробуйте ещё раз');
        rooms[code] = R;
      }
      const uid = A.uid;
      const old = uid && R.players.find(p => p.uid == uid);
      if (old) {
        if (old.left) return err(ws, 'Вы покинули эту партию. Дождитесь ее окончания.');
        const o = old.ws; old.ws = ws; ws.p = old; ws.R = R; clearTimeout(R.gc); R.idleKey = null;
        if (old.off) { clearTimeout(old.tm); old.off = false; sys(R, old.name + ' вернулся'); }
        if (o && o !== ws) o.close();
        return send(R);
      }
      if (R.started && R.over) toLobby(R);
      if (R.started) return err(ws, 'Игра уже идет');
      if (R.players.length >= (R.game == 'chess' || R.game == 'billiards' ? 2 : R.game == 'mafia' ? 12 : R.game == 'bowling' ? BW_MAX : 6)) return err(ws, 'Комната заполнена');
      const photo = /^https:\/\/[\w.\/-]+$/.test(m.photo || '') ? m.photo.slice(0, 300) : '';
      ws.p = { name: String(m.name || 'Игрок').slice(0, 12), uid, photo: A.prof ? A.prof.photo : '', prof: A.prof, hand: [], bot: false, ws };
      if (R.game === 'bowling') ws.p.ball = R.players.length % BW.BALLS.length;   // у каждого свой шар по умолчанию
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
    if (R.game === 'mafia' && m.t == 'chat') { mfChat(R, i, m); return send(R); }
    if (m.t == 'chat') {
      const tx = String(m.text || '').trim().slice(0, 80);
      if (tx) { R.log.push({ n: i, name: R.players[i].name, text: tx }); R.log = R.log.slice(-30); R.logN++; }
      return send(R);
    }
    if (m.t == 'react') { if (EMO.includes(m.e)) bcast(R, { ev: 'react', from: i, e: m.e }); return; }
    if (R.game === 'chess') { chMsg(R, i, m); return send(R); }
    if (R.game === 'mafia') { mfMsg(R, i, m); return send(R); }
    if (R.game === 'billiards') { blMsg(R, i, m); return send(R); }
    if (R.game === 'bowling') { bwMsg(R, i, m); return send(R); }
    if (m.t == 'bot' && !R.started && R.players.length < 6)
      R.players.push({ name: BOTN[R.players.length % BOTN.length], hand: [], bot: true, ws: null });
    else if (m.t == 'start' && !R.started && R.players.length >= 2) start(R);
    else if (m.t == 'again' && R.over) start(R);
    else if (R.started && !R.over) {
      if (m.t == 'play') {
        if (!Number.isInteger(m.i)) return;   // номер карты только целым числом: иначе hand["__proto__"] и т. п.
        const c = R.players[i].hand[m.i]; if (!c) return;
        if (i == R.def) {
          const to = Number.isInteger(m.to) ? m.to : -1;
          const oi = (R.table[to] && !R.table[to].d && beats(R, R.table[to].a, c)) ? to : R.table.findIndex(t => !t.d && beats(R, t.a, c));
          if (oi >= 0) defend(R, i, m.i, oi);
        } else if (canAtk(R, i, c)) attack(R, i, m.i);
      } else if (m.t == 'take' && i == R.def && open(R)) take(R, i);
      else if (m.t == 'done' && i != R.def && R.table.length && !open(R)) endRound(R, false);
    }
    send(R);
}
function onClose(ws) {
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
}

// Ошибка в одной комнате не останавливает таймеры остальных
setInterval(() => Object.values(rooms).forEach(R => { try { afkTick(R); } catch (e) { console.error('tick', R.code, e && e.stack || e); } }), 1000);
// Последняя страховка: непойманная ошибка (например, в таймере бота) пишется в лог, а сервер продолжает работать
process.on('unhandledRejection', e => console.error('unhandledRejection:', e && e.stack || e));
process.on('uncaughtException', e => console.error('uncaughtException:', e && e.stack || e));
srv.listen(process.env.PORT || 3000, () => {
  db.migrate().catch(e => console.error('migrate:', e.message));   // старые профили на новую шкалу рейтинга
  console.log('Дурак запущен на порту', process.env.PORT || 3000);
  if (TOKEN && APP_URL) {
    tg('setWebhook', { url: APP_URL + '/tg/' + TOKEN });
    tg('setMyCommands', { commands: [{ command: 'start', description: 'Меню игр' }, { command: 'durak', description: 'Подкидной дурак' }, { command: 'chess', description: 'Шахматы' }, { command: 'mafia', description: 'Мафия' }, { command: 'billiards', description: 'Бильярд' }, { command: 'bowling', description: 'Боулинг' }, { command: 'rules', description: 'Правила игр' }] });
    tg('setMyDescription', { description: `♠️ Игровой клуб: подкидной дурак, шахматы, мафия, бильярд и боулинг онлайн

Играйте с друзьями или ботами прямо в Telegram: чат, реакции, радио за столом, отдельный рейтинг с рангами в каждой игре.

Нажмите Start и выберите игру.

⏳ Первый вход может занять 30–60 секунд: сервер просыпается. Просто подождите, и игра откроется.` });
    tg('setMyShortDescription', { short_description: 'Дурак, шахматы, мафия, бильярд и боулинг онлайн: друзья, боты, чат, рейтинг. Первый вход до 60 сек ⏳' });
    tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: APP_URL } } });
  }
});
