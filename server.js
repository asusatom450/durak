const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');
const CL = require('./club.js');   // общий профиль клуба: фишки, задания, неделя, коллекция, приглашения
const BL = require('./billiards.js');
const BW = require('./bowling.js');
const RT = require('./rating.js');   // общий рейтинг по Эло для всех игр   // боулинг: физика и счёт, этот же файл грузит браузер
const { Chess } = require('./chess-lib.js');   // правила шахмат: chess.js, положен в проект целиком

// ---------- Telegram-бот: кнопка «Играть» по /start (через webhook) ----------
const TOKEN = process.env.BOT_TOKEN, APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
const tg = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).catch(() => {});
// то же, но с ответом Telegram ({ ok, result } или { ok: false, description })
const tgJ = (m, b) => fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b)
}).then(r => r.json()).catch(e => ({ ok: false, description: e.message }));
// Ссылки на игры внутри Telegram (Mini App в @BotFather): по ним открывается нужная игра, startapp передаёт код комнаты
// и того, кто позвал (например K7QX-u12345). Имя бота уточняется при запуске через getMe.
let BOT = process.env.BOT_USERNAME || 'duraktelega_bot';
const APPS = { durak: 'durakvtelege', chess: 'chess', mafia: 'mafia', billiards: 'billiards', bowling: 'bowling', eye: 'eye', rainbow: 'rainbow' };
const appLink = (g, sp) => `https://t.me/${BOT}/${APPS[g] || APPS.durak}` + (sp ? '?startapp=' + sp : '');
const ADMINS = String(process.env.ADMIN_ID || '').split(/[\s,]+/).filter(Boolean);   // кто видит /stats
const escH = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const KB_D = APP_URL ? { inline_keyboard: [[{ text: '🃏 Играть в дурака', web_app: { url: APP_URL } }], [{ text: '📖 Правила', callback_data: 'rules_durak' }]] } : undefined;
const KB_M = APP_URL ? { inline_keyboard: [[{ text: '🔪 Играть в мафию', web_app: { url: APP_URL + '/mafia' } }], [{ text: '📖 Правила', callback_data: 'rules_mafia' }]] } : undefined;
const KB_B = APP_URL ? { inline_keyboard: [[{ text: '🎱 Играть в бильярд', web_app: { url: APP_URL + '/billiards' } }], [{ text: '📖 Правила', callback_data: 'rules_billiards' }]] } : undefined;
const KB_C = APP_URL ? { inline_keyboard: [[{ text: '♞ Играть в шахматы', web_app: { url: APP_URL + '/chess' } }], [{ text: '📖 Правила', callback_data: 'rules_chess' }]] } : undefined;
const KB_R = APP_URL ? { inline_keyboard: [[{ text: '🌈 Играть в «Радугу»', web_app: { url: APP_URL + '/rainbow' } }], [{ text: '📖 Правила', callback_data: 'rules_rainbow' }]] } : undefined;
const KB_E = APP_URL ? { inline_keyboard: [[{ text: '👀 Играть в «Зоркий глаз»', web_app: { url: APP_URL + '/eye' } }], [{ text: '📖 Правила', callback_data: 'rules_eye' }]] } : undefined;
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
const CARD_E = `👀 <b>ЗОРКИЙ ГЛАЗ</b>
𝗙𝗜𝗡𝗗 𝗧𝗛𝗘 𝗣𝗔𝗜𝗥 · 𝟮–𝟲 𝗣𝗟𝗔𝗬𝗘𝗥𝗦

<i>Быстрая игра на внимательность и реакцию: найдите одинаковую картинку раньше всех.</i>

<blockquote>🃏 57 карточек по 8 картинок, у любых двух ровно одна общая
⚡ Кто первым нажал пару, забирает карточку
🤖 Можно с друзьями или с компьютером
👨‍👩‍👧 Подходит детям от 6 лет
🏅 Свой рейтинг и ранги: от Новичка до Зоркого глаза</blockquote>

${WAIT}`;
const RULES_E = `📖 <b>ПРАВИЛА «ЗОРКОГО ГЛАЗА»</b>
𝗙𝗜𝗡𝗗 𝗧𝗛𝗘 𝗣𝗔𝗜𝗥

<blockquote>🃏 На каждой карточке 8 картинок. У любых двух карточек всегда ровно одна общая картинка, но она может быть другого размера и повёрнута.
🎯 В центре стола открыта карточка, у каждого игрока своя карточка.
⚡ Найдите картинку, которая есть и на вашей карточке, и в центре, и нажмите её первым.</blockquote>

✅ Угадали: центральная карточка ваша, она становится вашей новой карточкой, а в центр выходит следующая.
❌ Ошиблись: полторы секунды нельзя нажимать.
🏆 Когда колода из 30 карточек закончится, побеждает тот, у кого больше всех.

<b>Рейтинг</b> по системе Эло: каждый с каждым по числу карточек, новичок начинает с 0, за победу над сильными дают больше. Первые 20 игр рейтинг меняется быстрее.`;
const CARD_R = `🌈 <b>РАДУГА</b>
𝗖𝗢𝗟𝗢𝗥 𝗖𝗔𝗥𝗗𝗦 · 𝟮–𝟲 𝗣𝗟𝗔𝗬𝗘𝗥𝗦

<i>Весёлая карточная игра на сброс: цвет к цвету, число к числу, и подлые «+4» соседу.</i>

<blockquote>🃏 108 карт: 4 цвета, «Пропуск», «Разворот», «+2», «Радуга» и «Радуга +4»
☝️ Осталась одна карта: успейте нажать «Последняя!»
👥 2–6 игроков, пустые места займут боты
🏅 Свой рейтинг и ранги: от Новичка до Радужного</blockquote>

${WAIT}`;
const RULES_R = `📖 <b>ПРАВИЛА «РАДУГИ»</b>
𝗖𝗢𝗟𝗢𝗥 𝗖𝗔𝗥𝗗𝗦

<blockquote>🃏 Каждому 7 карт, одна карта открыта в центре.
🎨 Кладите карту того же цвета или того же значения (число или знак).
🌈 «Радугу» можно положить всегда и выбрать любой цвет.
🏆 Кто первым избавился от всех карт, тот победил.</blockquote>

<b>Особые карты</b>
⊘ <b>Пропуск:</b> следующий игрок пропускает ход.
⇄ <b>Разворот:</b> ход идёт в обратную сторону (вдвоём работает как пропуск).
➕ <b>+2:</b> следующий берёт 2 карты и пропускает ход.
🌈 <b>Радуга +4:</b> выбираете цвет, следующий берёт 4 карты и пропускает ход.

<b>Нечем ходить:</b> возьмите карту из колоды. Подошла, можно сразу сыграть её или пропустить ход.
☝️ <b>Последняя карта:</b> оставляя одну карту, нажмите «Последняя!». Не успели, и за 3 секунды соперник может поймать вас: +2 карты.
⏱ На ход 30 секунд: не успели, берёте карту и ход переходит. Три раза подряд, и вы выбываете.

<b>Рейтинг</b> по системе Эло: каждый с каждым по числу оставшихся карт, новичок начинает с 0. Первые 20 игр рейтинг меняется быстрее.`;
const RULES = `📖 <b>ПРАВИЛА ИГРЫ</b>
𝗣𝗢𝗗𝗞𝗜𝗗𝗡𝗢𝗬 𝗗𝗨𝗥𝗔𝗞

<blockquote>🃏 <b>Колода:</b> 36 карт, каждому по 6. Последняя карта колоды задает козырь.
🎯 <b>Первый ход:</b> у владельца младшего козыря.
⚔️ <b>Атака и защита:</b> побейте карту старшей картой той же масти или любым козырем.
➕ <b>Подкидывать</b> можно карты тех достоинств, что уже лежат на столе (не больше 6 и не больше, чем карт у защитника).</blockquote>

✅ Всё побито: нажмите <b>«Бито»</b>, ходит защитник.
🤲 Не можете побить: нажмите <b>«Взять»</b>.
🔄 После хода все добирают карты до 6.
🤡 Кто остался с картами последним, тот <b>дурак</b>.

<b>Рейтинг</b> по системе Эло: новичок начинает с 0, ожидание считается по силе всех за столом: остаться дураком среди слабых стоит дорого, выбраться из-за стола сильных выгодно. Первые 20 партий рейтинг меняется быстрее. Ушедший из партии проигрывает.`;
const TIPS = {
  tip_durak: '🃏 Колода 36 карт, по 6 каждому, козырь по последней карте. Бейте старшей картой той же масти или козырем, подкидывайте карты того же достоинства. Кто остался с картами последним, тот дурак.',
  tip_chess: '♞ Мат королю выигрывает партию. Есть рокировка, взятие на проходе и превращение пешки. Ничья: пат, повтор, 50 ходов. Упало время: поражение. Нажмите фигуру, затем клетку с точкой.',
  tip_mafia: '🔪 Ночью мафия убивает, доктор лечит, комиссар проверяет. Днем город обсуждает и голосует. Мирные побеждают, изгнав всю мафию, мафия: когда ее не меньше остальных.',
  tip_billiards: '🎱 Забейте все шары своей группы (цельные 1–7 или полосатые 9–15), затем восьмерку. Фол: биток в лузе, нет касания или борта. После фола шар в руке у соперника.',
  tip_rainbow: '🌈 Кладите карту того же цвета или значения, «Радугу» можно всегда. +2 и +4: сосед берёт карты и пропускает ход. Оставляя одну карту, нажмите «Последняя!». Первый без карт победил.',
  tip_eye: '👀 У любых двух карточек ровно одна общая картинка. Найдите её на своей карточке и в центре и нажмите первым: центральная карточка ваша. Ошибка: пауза 1,5 с. Больше карточек, победа.',
  tip_bowling: '🎳 10 фреймов по 2 броска. Страйк: 10 + два следующих броска, спэр: 10 + следующий. Цельтесь в «карман» между 1-й и 3-й кеглей. Зажмите «Бросок» и отпустите.'
};
// полные правила каждой игры: их присылает бот и показывает приложение (окно 📖)
const RULES_BY = { durak: RULES, chess: RULES_C, mafia: RULES_M, billiards: RULES_B, bowling: RULES_W, eye: RULES_E, rainbow: RULES_R };
// Меню игр на /start: одна картинка с панелью на каждую игру + кнопки. Правила показываются всплывающим окошком (как подсказка).
const menuCap = () => `<b>ИГРОВОЙ КЛУБ</b>
Нажмите <b>🎮 Открыть клуб</b>: все игры карточками, правила, задания и турнир недели на одном экране. Или сразу выберите игру кнопкой ниже, 📖 коротко покажет правила.

⚡ В клубе: быстрый подбор соперника, задача дня, лиги недели, турнир выходных по субботам, друзья, медали и задания с фишками.
🤝 Зовите друзей: напишите @${BOT} в любом чате или добавьте бота в группу.

<i>⏳ Первый вход может занять 30–60 секунд: сервер просыпается. Просто подождите, и игра откроется.</i>`;
const MENU_KB = APP_URL ? { inline_keyboard: [
  [{ text: '🎮 Открыть клуб', web_app: { url: APP_URL + '/club' } }],
  [{ text: '🃏 Дурак', web_app: { url: APP_URL } }, { text: '📖 Правила', callback_data: 'tip_durak' }],
  [{ text: '♞ Шахматы', web_app: { url: APP_URL + '/chess' } }, { text: '📖 Правила', callback_data: 'tip_chess' }],
  [{ text: '🔪 Мафия', web_app: { url: APP_URL + '/mafia' } }, { text: '📖 Правила', callback_data: 'tip_mafia' }],
  [{ text: '🎱 Бильярд', web_app: { url: APP_URL + '/billiards' } }, { text: '📖 Правила', callback_data: 'tip_billiards' }],
  [{ text: '🎳 Боулинг', web_app: { url: APP_URL + '/bowling' } }, { text: '📖 Правила', callback_data: 'tip_bowling' }],
  [{ text: '👀 Зоркий глаз', web_app: { url: APP_URL + '/eye' } }, { text: '📖 Правила', callback_data: 'tip_eye' }],
  [{ text: '🌈 Радуга', web_app: { url: APP_URL + '/rainbow' } }, { text: '📖 Правила', callback_data: 'tip_rainbow' }]] } : undefined;
let MENU_ID = null;   // file_id картинки: после первой отправки Telegram хранит ее у себя
async function sendMenu(chat) {
  try {
    if (!MENU_ID) {
      const fd = new FormData();
      fd.append('chat_id', String(chat)); fd.append('caption', menuCap()); fd.append('parse_mode', 'HTML');
      if (MENU_KB) fd.append('reply_markup', JSON.stringify(MENU_KB));
      fd.append('photo', new Blob([fs.readFileSync(path.join(__dirname, 'menu.jpg'))], { type: 'image/jpeg' }), 'menu.jpg');
      const r = await (await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, { method: 'POST', body: fd })).json();
      if (!r.ok) throw new Error(r.description);
      MENU_ID = r.result.photo[r.result.photo.length - 1].file_id;
      return;
    }
    await tg('sendPhoto', { chat_id: chat, photo: MENU_ID, caption: menuCap(), parse_mode: 'HTML', reply_markup: MENU_KB });
  } catch (e) {   // нет картинки или Telegram отказал: показываем то же меню текстом
    console.error('menu:', e.message);
    await tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: menuCap(), reply_markup: MENU_KB });
  }
}
// ---------- приглашения: инлайн-режим (@бот в любом чате) и игра в группах ----------
const INL = {
  durak: { kw: /дур|карт|durak/, title: '🃏 Сыграем в дурака?', desc: 'Подкидной на 2–6 игроков, пустые места займут боты', btn: '🃏 Сесть за стол', text: c => `🃏 <b>Сыграем в дурака?</b>\nКомната <code>${c}</code>: нажмите кнопку и садитесь за стол. Пустые места займут боты.` },
  chess: { kw: /шах|chess/, title: '♞ Сыграем в шахматы?', desc: 'Партия один на один с часами', btn: '♞ Сесть за доску', text: c => `♞ <b>Сыграем в шахматы?</b>\nКомната <code>${c}</code>: кто первым нажмёт кнопку, тот и соперник.` },
  mafia: { kw: /маф|mafia/, title: '🔪 Сыграем в мафию?', desc: 'От 5 игроков, недостающих заменят боты', btn: '🔪 Войти в город', text: c => `🔪 <b>Сыграем в мафию?</b>\nГород <code>${c}</code> ждёт жителей. Чем больше людей, тем интереснее, недостающих заменят боты.` },
  billiards: { kw: /бил|пул|pool|бильярд/, title: '🎱 Сыграем в бильярд?', desc: 'Американка на 8 шаров, один на один', btn: '🎱 К столу', text: c => `🎱 <b>Сыграем в бильярд?</b>\nСтол <code>${c}</code> накрыт, кий ждёт. Нажмите кнопку, чтобы разбить пирамиду.` },
  rainbow: { kw: /радуг|цвет|уно|uno|rainbow|сброс/, title: '🌈 Сыграем в «Радугу»?', desc: 'Карты на сброс: цвет к цвету, +2 и +4, до 6 игроков', btn: '🌈 За стол', text: c => `🌈 <b>Сыграем в «Радугу»?</b>\nСтол <code>${c}</code>: цвет к цвету, число к числу, и не забудьте крикнуть «Последняя!». До 6 игроков, пустые места займут боты.` },
  eye: { kw: /глаз|зорк|пар|карт|eye/, title: '👀 Сыграем в «Зоркий глаз»?', desc: 'Кто первым найдёт одинаковую картинку, 2–6 игроков', btn: '👀 Играть', text: c => `👀 <b>Сыграем в «Зоркий глаз»?</b>\nСтол <code>${c}</code>: кто быстрее найдёт одинаковую картинку на двух карточках? До 6 игроков, можно с детьми.` },
  bowling: { kw: /боул|кегл|bowl/, title: '🎳 Сыграем в боулинг?', desc: 'До 4 игроков, 10 фреймов, страйки', btn: '🎳 На дорожку', text: c => `🎳 <b>Сыграем в боулинг?</b>\nДорожка <code>${c}</code> свободна, до 4 игроков. Нажмите кнопку и выбирайте шар.` }
};
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function rcode(n = 4) { for (;;) { let s = ''; for (let i = 0; i < n; i++) s += CODE_CH[crypto.randomInt(CODE_CH.length)]; if (!rooms[s]) return s; } }
function inlineAnswer(q) {
  const s = String(q.query || '').toLowerCase(), from = q.from.id;
  const ord = GAMES.slice().sort((a, b) => (INL[b].kw.test(s) ? 1 : 0) - (INL[a].kw.test(s) ? 1 : 0));
  const results = ord.map(g => { const code = rcode(); return {
    type: 'article', id: g + '_' + code, title: INL[g].title, description: INL[g].desc,
    input_message_content: { message_text: INL[g].text(code), parse_mode: 'HTML' },
    reply_markup: { inline_keyboard: [[{ text: INL[g].btn, url: appLink(g, code + '-u' + from) }]] }
  }; });
  CL.stat('inline');
  return tg('answerInlineQuery', { inline_query_id: q.id, results, cache_time: 0, is_personal: true });
}
// в группе кнопки web_app запрещены, поэтому ссылки вида t.me/бот/игра?startapp=КОД: все, кто нажал, садятся за один стол
const groupInvite = (chat, g, from) => { const code = rcode(); return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text: INL[g].text(code), reply_markup: { inline_keyboard: [[{ text: INL[g].btn, url: appLink(g, code + (from ? '-u' + from : '')) }]] } }); };
function groupMenu(chat, from) {
  const b = g => ({ text: INL[g].title.split(' ')[0] + ' ' + ({ durak: 'Дурак', chess: 'Шахматы', mafia: 'Мафия', billiards: 'Бильярд', bowling: 'Боулинг', eye: 'Зоркий глаз', rainbow: 'Радуга' })[g], url: appLink(g, rcode() + (from ? '-u' + from : '')) });
  return tg('sendMessage', { chat_id: chat, parse_mode: 'HTML',
    text: '🎲 <b>Игровой клуб в вашем чате</b>\nВыберите игру: каждая кнопка открывает отдельный стол, и все, кто нажмёт её, играют вместе.\n\nКоманды: /durak /chess /mafia /billiards /bowling /eye /rainbow',
    reply_markup: { inline_keyboard: [[b('durak'), b('chess')], [b('mafia'), b('billiards')], [b('bowling'), b('eye')], [b('rainbow')]] } });
}
async function onUpdate(u) {
  const msg = (chat, text, kb) => tg('sendMessage', { chat_id: chat, parse_mode: 'HTML', text, reply_markup: kb, disable_web_page_preview: true });
  if (u.inline_query) return inlineAnswer(u.inline_query);
  if (u.my_chat_member) {   // бота добавили в группу: сразу показываем игры
    const x = u.my_chat_member, inn = s => s === 'member' || s === 'administrator';
    if (x.chat.type !== 'private' && inn(x.new_chat_member.status) && !inn(x.old_chat_member.status)) { CL.stat('group'); await groupMenu(x.chat.id, x.from && x.from.id); }
    if (x.chat.type === 'private') CL.markPM('tg' + x.chat.id, inn(x.new_chat_member.status) || x.new_chat_member.status === 'restricted').catch(() => {});
    return;
  }
  const cb = u.callback_query;
  if (cb) {
    if (cb.data === 'mute') {
      await CL.setMute('tg' + cb.from.id, true).catch(() => {});
      return tg('answerCallbackQuery', { callback_query_id: cb.id, text: '🔕 Уведомления отключены. Включить их снова можно в клубе, в окне заданий.', show_alert: true });
    }
    tg('answerCallbackQuery', TIPS[cb.data] ? { callback_query_id: cb.id, text: TIPS[cb.data], show_alert: true } : { callback_query_id: cb.id });
    const ch = cb.message && cb.message.chat.id; if (!ch) return;
    if (cb.data == 'rules_chess') msg(ch, RULES_C, KB_C);
    else if (cb.data == 'rules_mafia') msg(ch, RULES_M, KB_M);
    else if (cb.data == 'rules_billiards') msg(ch, RULES_B, KB_B);
    else if (cb.data == 'rules_bowling') msg(ch, RULES_W, KB_W);
    else if (cb.data == 'rules_eye') msg(ch, RULES_E, KB_E);
    else if (cb.data == 'rules_rainbow') msg(ch, RULES_R, KB_R);
    else if (cb.data == 'rules_durak' || cb.data == 'rules') msg(ch, RULES, KB_D);
    return;
  }
  const m = u.message; if (!m || !m.text) return;
  const cm = /^\/([a-z]+)(?:@(\w+))?/i.exec(m.text); if (!cm) return;
  if (cm[2] && cm[2].toLowerCase() !== BOT.toLowerCase()) return;   // команда другому боту
  const c = cm[1].toLowerCase(), id = m.chat.id, from = m.from && m.from.id;
  if (m.chat.type !== 'private') {   // группа
    if (GAMES.includes(c)) { CL.stat('group'); return groupInvite(id, c, from); }
    if (c == 'start' || c == 'menu' || c == 'play') return groupMenu(id, from);
    if (c == 'rules' || c == 'help') return msg(id, RULES).then(() => msg(id, RULES_C)).then(() => msg(id, RULES_M)).then(() => msg(id, RULES_B)).then(() => msg(id, RULES_W)).then(() => msg(id, RULES_E)).then(() => msg(id, RULES_R));
    return;
  }
  if (c == 'start' || c == 'menu' || c == 'play') { if (from) CL.markPM('tg' + from, true, { name: String(m.from.first_name || 'Игрок').slice(0, 24) }).catch(() => {}); return sendMenu(id); }
  if (c == 'durak') return msg(id, CARD_D, KB_D);
  if (c == 'chess') return msg(id, CARD_C, KB_C);
  if (c == 'mafia') return msg(id, CARD_M, KB_M);
  if (c == 'billiards') return msg(id, CARD_B, KB_B);
  if (c == 'bowling') return msg(id, CARD_W, KB_W);
  if (c == 'eye') return msg(id, CARD_E, KB_E);
  if (c == 'rainbow') return msg(id, CARD_R, KB_R);
  if (c == 'rules' || c == 'help') return msg(id, RULES, KB_D).then(() => msg(id, RULES_C, KB_C)).then(() => msg(id, RULES_M, KB_M)).then(() => msg(id, RULES_B, KB_B)).then(() => msg(id, RULES_W, KB_W)).then(() => msg(id, RULES_E, KB_E)).then(() => msg(id, RULES_R, KB_R));
  if (c == 'stats') {
    if (!ADMINS.includes(String(from))) return msg(id, ADMINS.length ? 'Эта команда только для владельца клуба.' : `Статистика видна только владельцу. Добавьте на Render переменную <code>ADMIN_ID</code> со значением <code>${from}</code> (это ваш номер в Telegram) и перезапустите сервер.`);
    return msg(id, await CL.statsText(online()));
  }
}
// тело POST-запроса (JSON), не больше max байт
const readBody = (q, max) => new Promise((ok, no) => {
  const parts = []; let n = 0;
  q.on('data', d => { n += d.length; if (n > max) { no(new Error('too big')); q.destroy(); } else parts.push(d); });
  q.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch (e) { no(e); } });
  q.on('error', no);
});
// кто прислал запрос из приложения: проверенный пользователь Telegram (в локальной проверке без токена: dev + uid)
function webUser(b) {
  if (TOKEN) {
    const u = b.d && db.verify(b.d, TOKEN); if (!u) return null;
    return { uid: 'tg' + u.id, tgId: u.id, name: String(u.first_name || 'Игрок').slice(0, 24), photo: PHOTO.test(u.photo_url || '') ? u.photo_url.slice(0, 300) : '' };
  }
  return b.uid ? { uid: 'dev' + String(b.uid).slice(0, 30), name: String(b.name || 'Игрок').slice(0, 24), photo: '' } : null;
}
const CARDS = new Map();   // картинки результатов для «Поделиться»: Telegram забирает их по ссылке, храним час
async function clubApi(b) {
  const me = webUser(b); if (!me) return { err: 'Клуб доступен игрокам из Telegram' };
  const a = String(b.a || 'get'), info = { name: me.name, photo: me.photo };
  if (a == 'get') {
    const ref = (/-u(\d{3,15})$/.exec(String(b.sp || '')) || [])[1];
    const { c, daily } = await CL.visit(me.uid, info, ref ? 'tg' + ref : '');
    return { me: CL.view(c), daily, cat: CL.CAT, week: CL.weekView(me.uid), onl: online().all, ach: CL.ACH, dly: CL.dailyView(me.uid), arena: CL.arenaView(me.uid) };
  }
  let res;
  if (a == 'buy') res = await CL.buy(me.uid, String(b.id || ''));
  else if (a == 'equip') res = await CL.equip(me.uid, String(b.id || ''), String(b.kind || ''));
  else if (a == 'mute') res = await CL.setMute(me.uid, !!b.on);
  else if (a == 'week') return { week: CL.weekView(me.uid) };
  else if (a == 'friends') return await CL.friendsView(me.uid);
  else if (a == 'fr_add') res = await CL.friendAdd(me.uid, String(b.to || ''));
  else if (a == 'fr_ok' || a == 'fr_no') res = await CL.friendAnswer(me.uid, String(b.u || ''), a == 'fr_ok');
  else if (a == 'fr_del') res = await CL.friendDel(me.uid, String(b.u || ''));
  else if (a == 'arena') return { arena: CL.arenaView(me.uid) };
  else if (a == 'arena_reg') res = await CL.arenaReg(me.uid);
  else if (a == 'daily') return { dly: CL.dailyView(me.uid) };
  else return { err: 'Неизвестное действие' };
  const c = await CL.get(me.uid, info);
  return { ...res, me: c ? CL.view(c) : null };
}
async function cardApi(b) {
  if (!TOKEN || !APP_URL) return { err: 'Поделиться картинкой можно только в Telegram' };
  const u = b.d && db.verify(b.d, TOKEN); if (!u) return { err: 'Поделиться картинкой можно только в Telegram' };
  const raw = Buffer.from(String(b.img || '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
  if (raw.length < 2000 || raw.length > 1.8e6 || raw[0] !== 0xFF || raw[1] !== 0xD8) return { err: 'Картинка не получилась' };
  const now = Date.now(); for (const [k, x] of CARDS) if (now - x.t > 3600e3 || CARDS.size > 300) CARDS.delete(k);
  const id = crypto.randomBytes(12).toString('hex'), url = APP_URL.replace(/\/$/, '') + '/card/' + id + '.jpg', g = GAMES.includes(b.g) ? b.g : 'durak';
  CARDS.set(id, { buf: raw, t: now }); CL.stat('share');
  const r = await tgJ('savePreparedInlineMessage', {
    user_id: u.id, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true,
    result: { type: 'photo', id, photo_url: url, thumbnail_url: url, caption: escH(String(b.cap || '').slice(0, 300)), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🎮 Сыграть в клубе', url: appLink(g, '-u' + u.id) }]] } }
  });
  if (!r.ok) console.error('share:', r.description);
  return { id: r.ok ? r.result.id : null, url, err: r.ok ? null : r.description };
}
const srv = http.createServer((q, r) => {
  const pth = q.url.split('?')[0];
  if (pth === '/bowling.js') {   // физика и счёт боулинга нужны и браузеру (прицел, табло)
    r.writeHead(200, { 'content-type': 'application/javascript;charset=utf-8', 'cache-control': 'no-cache' });
    return r.end(fs.readFileSync(path.join(__dirname, 'bowling.js')));
  }
  if (pth === '/menu.jpg') {   // картинка меню: из неё экран клуба вырезает карточки игр
    r.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
    return r.end(fs.readFileSync(path.join(__dirname, 'menu.jpg')));
  }
  if (pth.startsWith('/card/')) {
    const x = CARDS.get(pth.slice(6).replace(/\.jpg$/, ''));
    if (!x) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' }); return r.end(x.buf);
  }
  if (q.method === 'POST' && (pth === '/api/club' || pth === '/api/card')) {
    const json = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    readBody(q, pth === '/api/card' ? 2.6e6 : 20000).then(b => (pth === '/api/card' ? cardApi(b) : clubApi(b))).then(json)
      .catch(e => { console.error(pth, e.message); if (!r.headersSent) { r.writeHead(500, { 'content-type': 'application/json' }); r.end('{"err":"Сервер не ответил, попробуйте ещё раз"}'); } });
    return;
  }
  if (q.url.startsWith('/api/')) {
    const json = o => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    (async () => {
      if (q.url.startsWith('/api/online')) return json(online());
      const gp = new URL(q.url, 'http://x').searchParams, g = GAMES.includes(gp.get('g')) ? gp.get('g') : 'durak';
      if (q.url.startsWith('/api/rules')) return json({ html: RULES_BY[gp.get('g')] || '' });
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
      let u; try { u = JSON.parse(s); } catch { return; }
      onUpdate(u).catch(e => console.error('update:', e && e.stack || e));
    });
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  r.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
const wss = new WebSocketServer({ server: srv, perMessageDeflate: { threshold: 1024 } });
const rooms = {};
const GAMES = ['durak', 'chess', 'mafia', 'billiards', 'bowling', 'eye', 'rainbow'], GN = { durak: 'дурака', chess: 'шахмат', mafia: 'мафии', billiards: 'бильярда', bowling: 'боулинга', eye: '«Зоркого глаза»', rainbow: '«Радуги»' };
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
// Конец партии для клуба: задания дня, очки недели, последние соперники. Кто ушёл из партии, ничего не получает.
// list: [{ p, res: 'win' | 'loss' | 'draw', extra }]
function clubEnd(R, list) {
  try {
    if (list.some(x => x.p.prof && !x.p.bot && !x.p.left)) CL.stat('g_' + R.game);   // партия, которую кто-то доиграл
    const hum = R.players.filter(p => p.prof && !p.bot).map(p => ({ uid: p.uid, name: p.prof.name || p.name }));
    for (const x of list) {
      const p = x.p; if (!p.prof || p.bot || p.left) continue;
      CL.game(p.uid, R.game, { res: x.res, extra: x.extra, rating: p.prof.rating }, hum).catch(e => console.error('club game:', e.message));
    }
  } catch (e) { console.error('club end:', e && e.stack || e); }
}
// Дурак: ожидание = шанс не остаться дураком при таких соперниках. Ушедший из игры считается проигравшим.
function settle(R) {
  R.result = [];
  const hum = R.players.filter(p => p.prof && !p.bot);
  if (R.loser < 0) return clubEnd(R, hum.map(p => ({ p, res: 'draw' })));   // ничья: рейтинг не меняется
  const rr = R.players.map(p => rOf(p, 'durak'));
  R.players.forEach((p, i) => {
    if (!p.prof || p.bot) return;
    const lost = i == R.loser || !!p.left;
    R.result.push({ i, ...rate(p.prof, RT.delta(p.prof.games, lost ? 0 : 1, RT.durakE(rr, i)), lost ? 'loss' : 'win') });
  });
  clubEnd(R, hum.map(p => ({ p, res: R.players.indexOf(p) == R.loser ? 'loss' : 'win' })));
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
  if (R.game === 'eye') return eyDrop(R, p);
  if (R.game === 'rainbow') return rbDrop(R, p);
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
  if (R.game === 'rainbow') return rbTick(R);
  if (R.game === 'eye') return;   // раунды короткие: ждать некого, отключившихся убирает общий таймер
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
  if (R.daily) { const ok = !!R.result && R.result.winner === R.col[0] && R.result.reason === 'mate', ms = Date.now() - R.daily.t0; return dailyDone(R, ok ? 1e7 - ms : -ms, { ok, ms }); }
  const [a, b] = R.players;
  if (R.ch.history().length < 4) return;
  const sa = !R.result.winner ? .5 : (R.col[0] == R.result.winner ? 1 : 0), ra = rOf(a, 'chess'), rb = rOf(b, 'chess');
  R.rres = [];
  [[a, 0, sa, ra, rb], [b, 1, 1 - sa, rb, ra]].forEach(([p, i, sc, r1, r2]) => {
    if (!p.prof || p.bot) return;
    R.rres.push({ i, ...rate(p.prof, RT.duel(p.prof.games, r1, r2, sc), sc === 1 ? 'win' : sc === 0 ? 'loss' : 'draw') });
  });
  const mate = R.result && R.result.reason === 'mate' ? Math.ceil(R.ch.history().length / 2) : 0;
  clubEnd(R, [[a, sa], [b, 1 - sa]].map(([p, sc]) => ({ p, res: sc === 1 ? 'win' : sc === 0 ? 'loss' : 'draw', extra: mate ? { mate } : {} })));
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
  if (R.daily && i === 0 && ++R.daily.mv >= 2 && !R.over) chEnd(R, { winner: chOther(c), reason: 'puzzle' });   // задача дня: два хода, и мат не поставлен
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
  else if (m.t == 'again') { if (R.over && !R.daily) chStart(R, R.tc); }
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
      name: p.name, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, col: R.col ? R.col[j] : null, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
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
  clubEnd(R, P.map((p, i) => ({ p, res: side(i) == mf.won ? 'win' : 'loss', extra: { role: mf.roles[i] } })));
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
      name: p.name, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
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
  if (R.daily) { R.rres = []; return dailyDone(R, bl.daily.pots * 100 + bl.daily.left, { pots: bl.daily.pots, shots: bl.shots }); }
  // Бильярд: обычное Эло, партия с компьютером тоже идёт в зачёт
  const [a, b] = R.players, ra = rOf(a, 'billiards'), rb = rOf(b, 'billiards');
  R.rres = [];
  [[a, 0, ra, rb], [b, 1, rb, ra]].forEach(([p, i, r1, r2]) => {
    if (!p.prof || p.bot) return;
    const sc = bl.winner === i ? 1 : 0;
    R.rres.push({ i, ...rate(p.prof, RT.duel(p.prof.games, r1, r2, sc), sc ? 'win' : 'loss') });
  });
  clubEnd(R, [a, b].map((p, i) => ({ p, res: bl.winner === i ? 'win' : 'loss' })));
}
function blShot(R, i, a, p) {
  const bl = R.bl;
  if (!bl || bl.over || bl.turn !== i || !Number.isFinite(a) || !Number.isFinite(p) || !bl.balls[0].on) return false;
  if (Date.now() < (R.animUntil || 0) - 400) return false;
  p = Math.max(.03, Math.min(1, p));
  if (R.daily) return blDailyShot(R, i, a, p);
  const sim = BL.simulate(bl.balls, a, p, true), out = BL.judge(bl, sim);
  BL.apply(bl, sim, out);
  bl.to[i] = 0; bl.seq++; R.mv++; bl.last.seq = bl.seq;
  const sh = R.players[i];   // задание «забейте свои шары»: считаем шары своей группы без фола
  if (sh && sh.prof && !sh.bot && !bl.last.foul) {
    const g = bl.groups[i], n = bl.last.pots.filter(id => id !== 0 && id !== 8 && (!g || (g === 'solid' ? id < 8 : id > 8))).length;
    if (n) CL.ev(sh.uid, 'billiards', { pot: n }).catch(() => {});
  }
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
  if (R.over) { if (m.t == 'again' && !R.daily) blStart(R); return; }
  const bl = R.bl;
  if (m.t == 'shot') blShot(R, i, +m.a, +m.p);
  else if (m.t == 'place') {
    if (bl.turn === i && bl.hand && Date.now() >= (R.animUntil || 0) - 400 && BL.canPlace(bl, +m.x, +m.y)) { const c = bl.balls[0]; c.x = +m.x; c.y = +m.y; c.on = true; }
  } else if (m.t == 'resign') { bl.winner = 1 - i; bl.reason = R.players[i].name + ' сдался'; blEnd(R); }
}
function blTick(R) {
  if (!R.started || R.over || !R.bl || R.daily) return;
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
      name: p.name, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
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
  return { name: BW_BOTN[R.players.length % BW_BOTN.length], hand: [], bot: true, ws: null, ball: Math.random() * BW.BASE | 0,
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
  if (bw.frame < (R.daily ? 3 : 10)) for (let j = 0; j < n; j++) if (ok(j)) { bw.cur = j; return; }   // в задаче дня три фрейма
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
  if (kind === 'strike' && p.prof && !p.bot) CL.ev(p.uid, 'bowling', { strike: 1 }).catch(() => {});   // задание «выбейте страйки»
  if (kind === 'strike' && bw.streak[i] === 3 && p.prof && !p.bot) CL.achEv(p.uid, 'bowling_turkey').catch(() => {});   // медаль «Индейка»
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
  if (R.daily) { const tot = BW.total(bw.fr[0]); bw.tot = [tot]; bw.win = [0]; sys(R, `🧩 Задача дня: ${tot} очков за 3 фрейма`); return dailyDone(R, P[0].left ? -1 : tot, { pts: tot }); }
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
  clubEnd(R, P.map((p, j) => ({ p, res: multi ? (bw.win.includes(j) ? (bw.win.length > 1 ? 'draw' : 'win') : 'loss') : 'loss', extra: BW.frameDone(9, bw.fr[j][9]) ? { score: tot[j] } : {} })));
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
  if (m.t == 'ball') {   // редкие шары только у тех, у кого они есть в коллекции клуба
    const b = +m.id, c = p.uid && CL.cached(p.uid);
    if (Number.isInteger(b) && b >= 0 && b < BW.BALLS.length && (b < BW.BASE || (c && CL.has(c, 'ball_' + b)))) p.ball = b;
    return;
  }
  if (!R.started) {
    if (m.t == 'bot' && R.players.length < BW_MAX) R.players.push(bwBot(R));
    else if (m.t == 'start' && R.players.length >= 1) bwStart(R);
    return;
  }
  if (R.over) { if (m.t == 'again' && !R.daily) bwStart(R); return; }
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
      name: p.name, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0, ball: p.ball || 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak || 0, since: p.prof.since, best: p.prof.best || 0 } : null
    })),
    log: R.log.slice(-30), logN: R.logN, radio: R.radio || null, now
  };
}

// ================= ЗОРКИЙ ГЛАЗ =================
// 57 карточек по 8 картинок, у любых двух карточек ровно одна общая картинка
// (конечная проективная плоскость порядка 7: прямые y = mx + b, вертикали и «бесконечная» прямая).
// В центре колода, у каждого игрока своя верхняя карточка. Кто первым нажал общую картинку своей и центральной
// карточки, забирает центральную: она становится его верхней. Ошибка: полторы секунды штрафной паузы.
// Колода кончилась: побеждает тот, у кого больше карточек. Картинки рисует браузер, сервер знает только их номера.
const EY_CARDS = (() => {
  const n = 7, C = [];
  for (let m = 0; m < n; m++) for (let b = 0; b < n; b++) { const c = []; for (let x = 0; x < n; x++) c.push(x * n + (m * x + b) % n); c.push(n * n + m); C.push(c); }
  for (let x = 0; x < n; x++) { const c = []; for (let y = 0; y < n; y++) c.push(x * n + y); c.push(n * n + n); C.push(c); }
  const c = []; for (let m = 0; m <= n; m++) c.push(n * n + m); C.push(c);
  return C;
})();
const EY_DECK = +process.env.EY_DECK || 30, EY_GAP = 1100, EY_FRZ = 1500, EY_START = 3500, EY_MAX = 6;
const EY_BOTN = ['Сова', 'Рысь', 'Сокол', 'Ястреб', 'Лиса', 'Филин'];
const eyCommon = (a, b) => EY_CARDS[a].find(x => EY_CARDS[b].includes(x));
function eyStart(R) {
  R.players = R.players.filter(p => p.bot || p.ws);
  R.players.forEach(p => { p.off = false; p.left = false; clearTimeout(p.tm); });
  if (R.players.length < 2) { R.started = false; R.over = false; return; }
  const ids = EY_CARDS.map((_, k) => k);
  for (let k = ids.length - 1; k > 0; k--) { const j = Math.random() * (k + 1) | 0; [ids[k], ids[j]] = [ids[j], ids[k]]; }
  const n = R.players.length, top = ids.splice(0, n), deck = ids.splice(0, EY_DECK), z = () => top.map(() => 0);
  R.ey = { deck, center: deck.pop(), top, cnt: z(), frz: z(), miss: z(), fast: z(), round: 1, total: EY_DECK, seq: 0,
    readyAt: Date.now() + EY_START, last: null, over: false, win: null, botAt: null };
  R.started = true; R.over = false; R.rres = null; R.mv++;
  sys(R, '👀 Игра началась: ищите одинаковые картинки!');
}
// нажатие на картинку s; неверная картинка: штрафная пауза
function eyTap(R, i, s) {
  const ey = R.ey, now = Date.now(), p = R.players[i];
  if (!ey || ey.over || R.over || !p || p.left || now < ey.readyAt || now < ey.frz[i] || !Number.isInteger(s)) return;
  if (s !== eyCommon(ey.center, ey.top[i])) { ey.frz[i] = now + EY_FRZ; ey.miss[i]++; notify(p, { ev: 'eymiss', s, ms: EY_FRZ }); return; }
  eyCatch(R, i, s);
}
function eyCatch(R, i, s) {
  const ey = R.ey, now = Date.now(), t = now - ey.readyAt;
  ey.cnt[i]++; if (!ey.fast[i] || t < ey.fast[i]) ey.fast[i] = t; ey.sum = (ey.sum || 0) + t;
  ey.seq++; R.mv++;
  ey.last = { seq: ey.seq, by: i, sym: s, card: ey.center, ms: t };
  ey.top[i] = ey.center;
  bcast(R, { ev: 'eycatch', seq: ey.seq, by: i, sym: s, ms: t });
  if (!ey.deck.length) return eyEnd(R);
  ey.center = ey.deck.pop(); ey.round++; ey.readyAt = now + EY_GAP; ey.botAt = null;
}
// Рейтинг: каждый с каждым по числу карточек (ушедший ниже всех), как в боулинге
function eyEnd(R) {
  const ey = R.ey, P = R.players; if (ey.over) return;
  ey.over = true; R.over = true; R.rres = [];
  if (R.daily) { ey.win = [0]; const ms = ey.sum + ey.miss[0] * 2000; return P[0].left ? dailyDone(R, -9e9, { quit: 1 }) : dailyDone(R, -ms, { ms, miss: ey.miss[0] }); }
  const alive = P.map((_, j) => j).filter(j => !P[j].left), top = alive.length ? Math.max(...alive.map(j => ey.cnt[j])) : -1;
  ey.win = alive.filter(j => ey.cnt[j] === top);
  const res = j => (ey.win.includes(j) ? (ey.win.length > 1 ? 'draw' : 'win') : 'loss');
  const R0 = P.map(p => rOf(p, 'eye')), sc = P.map((p, j) => (p.left ? -1 : ey.cnt[j]));
  P.forEach((p, i) => {
    if (!p.prof || p.bot) return;
    const f = RT.fieldSE(R0, sc, i);
    R.rres.push({ i, ...rate(p.prof, RT.delta(p.prof.games, f.S, f.E), res(i)) });
  });
  if (ey.win.length) sys(R, `🏆 ${ey.win.map(j => P[j].name).join(', ')}: ${top} ${top % 10 == 1 && top % 100 != 11 ? 'карточка' : top % 10 >= 2 && top % 10 <= 4 && (top % 100 < 10 || top % 100 >= 20) ? 'карточки' : 'карточек'}`);
  clubEnd(R, P.map((p, j) => ({ p, res: res(j), extra: { catch: ey.cnt[j], fast: ey.fast[j] } })));
}
function eyDrop(R, p) {
  if (p.left) return; p.left = true; p.off = false;
  sys(R, p.name + ' покинул игру');
  if (!R.started || R.over || !R.ey) return;
  const rest = R.players.filter(q => !q.left);
  if (!rest.some(q => !q.bot) || rest.length < 2) eyEnd(R);
}
function eyMsg(R, i, m) {
  if (!R.started) {
    if (m.t == 'bot' && R.players.length < EY_MAX) R.players.push(mkBot(R));
    else if (m.t == 'start' && R.players.length >= 2) eyStart(R);
    return;
  }
  if (R.over) { if (m.t == 'again' && !R.daily) eyStart(R); return; }
  if (m.t == 'tap') eyTap(R, i, m.s);
  else if (m.t == 'resign') eyDrop(R, R.players[i]);
}
// Компьютер замечает пару в среднем за 3,6 с (чем больше ботов, тем каждый чуть медленнее),
// время для раунда выбирается один раз, поэтому повторные рассылки состояния его не сдвигают
function eySchedule(R) {
  const ey = R.ey; if (!R.started || R.over || !ey || ey.over) return;
  const bots = R.players.map((_, i) => i).filter(i => R.players[i].bot && !R.players[i].left);
  if (!bots.length) return;
  if (!ey.botAt || ey.botAt.seq !== ey.seq) {
    const nb = bots.length;
    ey.botAt = { seq: ey.seq, t: bots.map(i => ({ i, at: ey.readyAt + Math.round(1000 * clamp(3.6 + .2 * (nb - 1) + BW.gauss() * .9, 1.7, 8)) })) };
  }
  const first = ey.botAt.t.reduce((a, b) => (b.at < a.at ? b : a)), key = ey.seq;
  R.tm = setTimeout(() => {
    if (!R.started || R.over || R.ey !== ey || ey.seq !== key || R.players[first.i].left) return;
    eyCatch(R, first.i, eyCommon(ey.center, ey.top[first.i])); send(R);
  }, Math.max(30, first.at - Date.now()));
}
function eyState(R, i) {
  const ey = R.ey, now = Date.now(), playing = R.started && !R.over;
  return {
    game: 'eye', room: R.code, you: i, host: true, started: R.started, over: R.over, status: playing ? 'play' : (R.over ? 'over' : 'lobby'),
    center: ey ? ey.center : -1, cs: ey ? EY_CARDS[ey.center] : [], mine: ey ? ey.top[i] : -1, ms: ey ? EY_CARDS[ey.top[i]] : [],
    cnt: ey ? ey.cnt : [], round: ey ? ey.round : 0, total: ey ? ey.total : EY_DECK, seq: ey ? ey.seq : 0,
    ready: ey && playing ? Math.max(0, ey.readyAt - now) : 0, frz: ey && playing ? Math.max(0, ey.frz[i] - now) : 0, last: ey ? ey.last : null,
    win: ey && ey.over ? ey.win : null, fast: ey ? ey.fast : [], miss: ey ? ey.miss : [], rres: R.rres || null, max: EY_MAX,
    players: R.players.map(p => ({
      name: p.name, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak || 0, since: p.prof.since, draws: p.prof.draws || 0 } : null
    })),
    log: R.log.slice(-30), logN: R.logN, radio: R.radio || null, now
  };
}

// ================= РАДУГА =================
// Карточная игра на сброс. 108 карт: 4 цвета, в каждом 0 (одна), 1–9, «Пропуск», «Разворот», «+2» (по две),
// и 8 «радужных»: «Радуга» (выбор цвета) и «Радуга +4». Кладите карту того же цвета или того же значения,
// «радужную» можно всегда. Нечем ходить: берёте карту, подошла — можно сразу сыграть. Первый без карт победил.
// Осталась одна карта: нажмите «Последняя!», иначе за 3 секунды соперник может поймать, и вы берёте 2.
const RB_MS = +process.env.RB_TURN_MS || 30000, RB_MAX = 6, RB_CATCH = 3000, RB_HAND = 7;
const RB_BOTN = ['Ириска', 'Пиксель', 'Бублик', 'Карамель', 'Шнурок', 'Ватрушка'];
const rbShuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function rbDeck() {
  const d = []; let id = 0;
  for (let c = 0; c < 4; c++) {
    d.push({ id: id++, c, v: 0 });
    for (let k = 0; k < 2; k++) { for (let v = 1; v <= 9; v++) d.push({ id: id++, c, v }); for (const v of ['S', 'R', 'D']) d.push({ id: id++, c, v }); }
  }
  for (let k = 0; k < 4; k++) { d.push({ id: id++, c: 4, v: 'W' }); d.push({ id: id++, c: 4, v: 'F' }); }
  return rbShuffle(d);
}
const RB_ORD = { S: 10, R: 11, D: 12, W: 13, F: 14 }, rbVal = k => (typeof k.v === 'number' ? k.v : RB_ORD[k.v]);
const rbOk = (rb, k) => k.c === 4 || k.c === rb.color || k.v === rb.top.v;
function rbStep(R, from, n) { const P = R.players, rb = R.rb; let i = from; for (let s = 0, g = 0; s < n && g < 50; g++) { i = (i + rb.dir + P.length) % P.length; if (!P[i].left) s++; } return i; }
function rbRefill(rb) { if (rb.disc.length <= 1) return; const top = rb.disc.pop(); rb.deck = rbShuffle(rb.disc); rb.disc = [top]; }
function rbTake(R, i, n) {
  const rb = R.rb, h = R.players[i].hand, got = [];
  for (let k = 0; k < n; k++) { if (!rb.deck.length) rbRefill(rb); if (!rb.deck.length) break; const c = rb.deck.pop(); h.push(c); got.push(c); }
  if (h.length > 1) delete rb.said[i];
  if (rb.catch && rb.catch.i === i) rb.catch = null;
  return got;
}
function rbBestColor(h) { const n = [0, 0, 0, 0]; h.forEach(c => { if (c.c < 4) n[c.c]++; }); return n.indexOf(Math.max(...n)); }
function rbStart(R) {
  R.players = R.players.filter(p => p.bot || p.ws);
  R.players.forEach(p => { p.off = false; p.left = false; clearTimeout(p.tm); p.hand = []; });
  if (R.players.length < 2) { R.started = false; R.over = false; return; }
  const deck = rbDeck(); let top = deck.pop();
  while (typeof top.v !== 'number') { deck.unshift(top); top = deck.pop(); }   // первая открытая карта всегда числовая
  R.rb = { deck, disc: [top], top, color: top.c, dir: 1, cur: Math.random() * R.players.length | 0, drawn: null, said: {}, catch: null, seq: 0,
    end: Date.now() + RB_MS + 1500, to: R.players.map(() => 0), wild: R.players.map(() => 0), catches: R.players.map(() => 0), over: false, winner: null, last: null, botKey: '', botAt: 0 };
  R.players.forEach(p => { p.hand = deck.splice(deck.length - RB_HAND, RB_HAND); });
  R.started = true; R.over = false; R.rres = null; R.mv++;
  sys(R, `🌈 Игра началась. Первым ходит ${R.players[R.rb.cur].name}`);
}
function rbNext(R, skip) { const rb = R.rb; rb.cur = rbStep(R, rb.cur, skip ? 2 : 1); rb.drawn = null; rb.end = Date.now() + RB_MS; R.mv++; }
function rbPlay(R, i, m) {
  const rb = R.rb, p = R.players[i];
  if (!rb || rb.over || rb.cur !== i) return;
  const k = p.hand.findIndex(x => x.id === m.id); if (k < 0) return;
  const card = p.hand[k];
  if (rb.drawn != null && card.id !== rb.drawn) return;   // после добора можно сыграть только взятую карту
  if (!rbOk(rb, card)) return;
  if (m.last && p.hand.length === 2) rb.said[i] = true;
  p.hand.splice(k, 1); rb.disc.push(card); rb.top = card; rb.seq++; R.mv++; rb.to[i] = 0;
  rb.color = card.c < 4 ? card.c : ([0, 1, 2, 3].includes(m.color) ? m.color : rbBestColor(p.hand));
  if (card.c === 4) rb.wild[i]++;
  let skip = false, n = 0;
  if (card.v === 'S') skip = true;
  else if (card.v === 'R') { if (R.players.filter(q => !q.left).length <= 2) skip = true; else rb.dir *= -1; }
  else if (card.v === 'D') { n = 2; skip = true; }
  else if (card.v === 'F') { n = 4; skip = true; }
  const tgt = rbStep(R, i, 1);
  rb.last = { seq: rb.seq, by: i, card, color: rb.color, n, tgt: n || card.v === 'S' ? tgt : null, dir: rb.dir };
  if (n) { rbTake(R, tgt, n); sys(R, `${R.players[tgt].name} берёт ${n} и пропускает ход`); }
  if (!p.hand.length) return rbEnd(R, i);
  if (p.hand.length === 1 && !rb.said[i]) {   // забыл сказать «Последняя!»: окно, когда соперник может поймать
    const bots = R.players.map((_, j) => j).filter(j => j !== i && R.players[j].bot && !R.players[j].left);
    rb.catch = { i, until: Date.now() + RB_CATCH, bot: bots.length && Math.random() < .55 ? { j: rnd(bots), at: Date.now() + 900 + Math.random() * 1600 } : null };
  }
  rbNext(R, skip);
}
function rbDraw(R, i) {
  const rb = R.rb; if (!rb || rb.over || rb.cur !== i || rb.drawn != null) return;
  const c = rbTake(R, i, 1)[0]; rb.seq++; R.mv++; rb.to[i] = 0;
  rb.last = { seq: rb.seq, by: i, drew: 1 };
  if (c && rbOk(rb, c)) { rb.drawn = c.id; rb.end = Date.now() + Math.min(RB_MS, 15000); }   // подошла: можно сыграть её или пропустить ход
  else rbNext(R, false);
}
function rbPass(R, i) { const rb = R.rb; if (!rb || rb.over || rb.cur !== i || rb.drawn == null) return; rb.seq++; rbNext(R, false); }
function rbSay(R, i) {
  const rb = R.rb; if (!rb || rb.over || R.players[i].hand.length > 2) return;
  rb.said[i] = true;
  if (rb.catch && rb.catch.i === i) { rb.catch = null; rb.seq++; sys(R, `☝️ ${R.players[i].name}: «Последняя!»`); }
}
function rbCatch(R, j) {
  const rb = R.rb, w = rb && rb.catch;
  if (!w || Date.now() > w.until || w.i === j || R.players[j].left) return;
  rb.catch = null; rbTake(R, w.i, 2); rb.seq++; R.mv++; rb.catches[j]++;
  rb.last = { seq: rb.seq, by: j, caught: w.i };
  sys(R, `🫵 ${R.players[j].name} ловит ${R.players[w.i].name}: «Последняя!» не прозвучала, +2 карты`);
}
// Рейтинг: каждый с каждым по числу оставшихся карт (меньше лучше), ушедший ниже всех
function rbEnd(R, w) {
  const rb = R.rb, P = R.players; if (rb.over) return;
  rb.over = true; R.over = true; rb.winner = w; rb.catch = null; R.rres = [];
  const sc = P.map(p => (p.left ? -999 : -p.hand.length)), R0 = P.map(p => rOf(p, 'rainbow'));
  P.forEach((p, i) => { if (!p.prof || p.bot) return; const f = RT.fieldSE(R0, sc, i); R.rres.push({ i, ...rate(p.prof, RT.delta(p.prof.games, f.S, f.E), i === w ? 'win' : 'loss') }); });
  if (w >= 0) sys(R, `🏆 ${P[w].name} сбрасывает все карты!`);
  clubEnd(R, P.map((p, j) => ({ p, res: j === w ? 'win' : 'loss', extra: { wild: rb.wild[j], catches: rb.catches[j] } })));
}
function rbDrop(R, p, why) {
  if (p.left) return; p.left = true; p.off = false;
  sys(R, p.name + ' ' + (why || 'покинул игру'));
  if (!R.started || R.over || !R.rb) return;
  const rb = R.rb, i = R.players.indexOf(p), rest = R.players.map((_, j) => j).filter(j => !R.players[j].left);
  rb.deck.unshift(...p.hand); p.hand = [];
  if (rb.catch && rb.catch.i === i) rb.catch = null;
  if (!rest.some(j => !R.players[j].bot)) return rbEnd(R, -1);
  if (rest.length < 2) return rbEnd(R, rest[0]);
  if (rb.cur === i) { rb.seq++; rbNext(R, false); }
}
function rbMsg(R, i, m) {
  if (!R.started) {
    if (m.t == 'bot' && R.players.length < RB_MAX) R.players.push(mkBot(R));
    else if (m.t == 'start' && R.players.length >= 2) rbStart(R);
    return;
  }
  if (R.over) { if (m.t == 'again') rbStart(R); return; }
  if (m.t == 'play') rbPlay(R, i, { id: +m.id, color: +m.color, last: !!m.last });
  else if (m.t == 'draw') rbDraw(R, i);
  else if (m.t == 'pass') rbPass(R, i);
  else if (m.t == 'last') rbSay(R, i);
  else if (m.t == 'catch') rbCatch(R, i);
  else if (m.t == 'resign') rbDrop(R, R.players[i], 'вышел из игры');
}
// время хода вышло: берёт карту и пропускает ход, три раза подряд — выбывает. У отключившегося ход проходит сам.
function rbTick(R) {
  if (!R.started || R.over || !R.rb) return;
  const rb = R.rb, now = Date.now();
  if (rb.catch && now > rb.catch.until) { rb.catch = null; send(R); }
  const i = rb.cur, p = R.players[i];
  if (!p || p.bot || p.left || now < rb.end) return;
  if (!p.off && ++rb.to[i] >= 3) { rbDrop(R, p, 'не ходит и выбывает'); return send(R); }
  if (!p.off) sys(R, `⏱ ${p.name}: время вышло`);
  if (rb.drawn == null) rbTake(R, i, 1);
  rb.seq++; rbNext(R, false); send(R);
}
// Компьютер: держит «радужные» на конец, против почти пустой руки соседа бьёт действиями, цвет выбирает по своей руке
function rbBotMove(R, i) {
  const rb = R.rb, h = R.players[i].hand;
  if (rb.drawn != null) { const c = h.find(x => x.id === rb.drawn); return c && rbOk(rb, c) ? rbPlay(R, i, { id: c.id, color: rbBestColor(h.filter(x => x !== c)), last: h.length === 2 }) : rbPass(R, i); }
  const ok = h.filter(c => rbOk(rb, c)); if (!ok.length) return rbDraw(R, i);
  const nextN = R.players[rbStep(R, i, 1)].hand.length;
  const score = c => (c.c === 4 ? (h.length <= 2 || nextN <= 2 ? 40 : -40) : 0) + (typeof c.v !== 'number' ? (nextN <= 3 ? 30 : 6) : c.v) + (c.c === rb.color ? 1 : 0);
  ok.sort((a, b) => score(b) - score(a));
  const c = ok[0];
  rbPlay(R, i, { id: c.id, color: rbBestColor(h.filter(x => x !== c)), last: h.length === 2 && Math.random() < .9 });
}
function rbSchedule(R) {
  const rb = R.rb; if (!R.started || R.over || !rb || rb.over) return;
  const now = Date.now(), ev = [], p = R.players[rb.cur];
  if (p && p.bot && !p.left) { const key = rb.seq + ':' + rb.cur; if (rb.botKey !== key) { rb.botKey = key; rb.botAt = now + 900 + Math.random() * 800; } ev.push([rb.botAt, () => rbBotMove(R, rb.cur)]); }
  const w = rb.catch; if (w && w.bot && now < w.until) ev.push([w.bot.at, () => rbCatch(R, w.bot.j)]);
  if (!ev.length) return;
  ev.sort((a, b) => a[0] - b[0]);
  const [at, f] = ev[0], key = rb.seq;
  R.tm = setTimeout(() => { if (!R.started || R.over || R.rb !== rb || rb.seq !== key) return; f(); send(R); }, Math.max(30, at - now));
}
function rbState(R, i) {
  const rb = R.rb, now = Date.now(), playing = R.started && !R.over, P = R.players, my = P[i] ? P[i].hand : [];
  return {
    game: 'rainbow', room: R.code, you: i, host: true, started: R.started, over: R.over, status: playing ? 'play' : (R.over ? 'over' : 'lobby'),
    top: rb ? rb.top : null, color: rb ? rb.color : 0, dir: rb ? rb.dir : 1, cur: rb ? rb.cur : 0, deck: rb ? rb.deck.length : 0, pile: rb ? rb.disc.length : 0,
    hand: rb ? my : [], can: playing && rb.cur === i ? my.filter(c => (rb.drawn == null || c.id === rb.drawn) && rbOk(rb, c)).map(c => c.id) : [],
    drawn: playing && rb.cur === i ? rb.drawn : null, said: rb ? !!rb.said[i] : false,
    catch: rb && playing && rb.catch && now < rb.catch.until ? { i: rb.catch.i, ms: rb.catch.until - now } : null,
    left: playing ? Math.max(0, rb.end - now) : 0, turnMs: RB_MS, last: rb ? rb.last : null, seq: rb ? rb.seq : 0,
    winner: rb && rb.over ? rb.winner : null, rres: R.rres || null, max: RB_MAX,
    players: P.map(p => ({
      name: p.name, n: rb ? p.hand.length : 0, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - now) : 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak || 0, since: p.prof.since } : null
    })),
    log: R.log.slice(-30), logN: R.logN, radio: R.radio || null, now
  };
}

// ================= ЗАДАЧА ДНЯ =================
// Одна на весь клуб на день, одна попытка. Комната на одного: «Зоркий глаз» (15 пар на время), шахматы (мат в 2),
// боулинг (3 фрейма), бильярд (6 шаров, 5 ударов). Раскладка зависит от даты, поэтому у всех одинаковая.
const PUZZLES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'chess_puzzles.json'))); } catch { return []; } })();
const seeded = seed => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const EY_DAILY = 15, BL_DAILY = { balls: 6, shots: 5 };
async function dailyJoin(ws, m) {
  if (ws.R || ws.q) return;
  const g = gameOf(m), D = CL.dailyOf();
  if (D.type !== g) return err(ws, 'Сегодня задача дня в другой игре');
  let A; try { A = await auth(m, g); } catch (e) { return err(ws, 'Не удалось войти, попробуйте ещё раз'); }
  if (!A.prof) return err(ws, 'Задача дня доступна игрокам из Telegram');
  if (ws.readyState !== 1 || ws.R) return;
  const R0 = Object.values(rooms).find(R => R.daily && R.daily.uid === A.uid && !R.over);   // перезагрузили страницу посреди задачи
  if (R0) return ws.send(JSON.stringify({ ev: 'matched', room: R0.code }));
  if (await CL.dailyDoneBy(A.uid)) return err(ws, 'Вы уже прошли задачу дня. Новая будет завтра!');
  A.cl = await CL.get(A.uid, { name: A.prof.name, photo: A.prof.photo }).catch(() => null);
  const code = rcode(5), R = rooms[code] = { code, players: [], started: false, over: false, table: [], deck: [], loser: -1, log: [], logN: 0, mv: 0, game: g,
    daily: { type: g, day: D.day, seed: D.seed, n: D.n, uid: A.uid, t0: Date.now(), mv: 0 } };
  addPlayer(ws, A, m.name, R);
  if (g === 'eye') eyDailyStart(R); else if (g === 'chess') chDailyStart(R); else if (g === 'bowling') bwStart(R); else blDailyStart(R);
  sys(R, '🧩 Задача дня: ' + D.t + '. ' + D.d);
  CL.stat('dailytry');
  ws.send(JSON.stringify({ ev: 'matched', room: code }));
  send(R);
}
async function dailyDone(R, sc, m) {
  if (!R.daily || R.daily.fin) return; R.daily.fin = true;
  const res = await CL.dailyResult(R.daily.uid, sc, m).catch(e => { console.error('daily:', e.message); return null; });
  R.dres = res || { m }; send(R);
}
function eyDailyStart(R) {
  const rn = seeded(R.daily.seed), ids = EY_CARDS.map((_, k) => k);
  for (let k = ids.length - 1; k > 0; k--) { const j = rn() * (k + 1) | 0; [ids[k], ids[j]] = [ids[j], ids[k]]; }
  const deck = ids.slice(1, 1 + EY_DAILY);
  R.ey = { deck, center: deck.pop(), top: [ids[0]], cnt: [0], frz: [0], miss: [0], fast: [0], round: 1, total: EY_DAILY, seq: 0, sum: 0,
    readyAt: Date.now() + EY_START, last: null, over: false, win: null, botAt: null };
  R.started = true; R.over = false; R.rres = null; R.mv++;
}
function chDailyStart(R) {
  const P = PUZZLES.length ? PUZZLES[Math.floor(R.daily.n / 4) % PUZZLES.length] : { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4' };
  R.players.push({ name: 'Задача дня', hand: [], bot: true, ws: null });
  R.ch = new Chess(P.fen); const side = R.ch.turn();
  R.col = [side, chOther(side)];
  R.tc = 3; R.cl = { w: 180000, b: 180000, since: Date.now() };
  R.started = true; R.over = false; R.result = null; R.rres = null; R.draw = null; R.last = null; R.mv++;
}
function blDailyStart(R) {
  R.players.push({ name: 'Задача дня', hand: [], bot: true, ws: null });
  const rn = seeded(R.daily.seed), T = BL.T, balls = [], ids = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let k = ids.length - 1; k > 0; k--) { const j = rn() * (k + 1) | 0; [ids[k], ids[j]] = [ids[j], ids[k]]; }
  for (let id = 0; id < 16; id++) balls.push({ id, x: -100, y: -100, on: false });
  balls[0] = { id: 0, x: T.W / 2, y: T.L * .75, on: true };
  for (const id of ids.slice(0, BL_DAILY.balls)) for (let k = 0; k < 300; k++) {
    const x = 50 + rn() * (T.W - 100), y = 60 + rn() * (T.L * .6);
    if (BL.canPlace({ balls }, x, y) && Math.hypot(x - balls[0].x, y - balls[0].y) > 90 && T.PK.every(([px, py, pr]) => Math.hypot(px - x, py - y) > pr + 30)) { balls[id] = { id, x, y, on: true }; break; }
  }
  R.bl = { balls, turn: 0, breaker: 0, groups: [null, null], open: true, hand: false, shots: 0, over: false, winner: null, reason: '', to: [0, 0], end: Date.now() + BL_MS, seq: 0,
    msg: `Задача дня: ${BL_DAILY.shots} ударов, забейте как можно больше`, daily: { left: BL_DAILY.shots, pots: 0 } };
  R.started = true; R.over = false; R.rres = null; R.animUntil = 0; R.mv++;
}
function blDailyShot(R, i, a, p) {
  const bl = R.bl, sim = BL.simulate(bl.balls, a, p, true), pots = sim.pocketed.filter(id => id !== 0);
  bl.balls = sim.balls; bl.shots++; bl.daily.left--; bl.daily.pots += pots.length; bl.seq++; R.mv++;
  if (sim.cuePocketed) {   // биток упал: ставим обратно в «дом», рядом, если место занято
    const c = bl.balls[0], T = BL.T; c.on = true;
    for (let k = 0; k < 40; k++) { const x = T.W / 2 + ((k % 7) - 3) * 40, y = T.L * .75 + Math.floor(k / 7) * 36; if (BL.canPlace(bl, x, y)) { c.x = x; c.y = y; break; } }
  }
  bl.last = { by: i, pots, cue: !!sim.cuePocketed, foul: sim.cuePocketed ? 'биток упал в лузу' : null, assign: null, cont: pots.length > 0, rerack: false, end: false, seq: bl.seq };
  const left = bl.balls.filter(o => o.on && o.id).length;
  bl.msg = `Удар ${bl.shots} из ${BL_DAILY.shots} · забито ${bl.daily.pots}`;
  R.animUntil = Date.now() + sim.dur * 1000 + 700; bl.end = R.animUntil + BL_MS;
  bcast(R, { ev: 'shot', seq: bl.seq, frames: sim.frames, events: sim.events, by: i });
  if (!bl.daily.left || !left) { bl.winner = 0; bl.reason = `Забито ${bl.daily.pots} из ${BL_DAILY.balls}`; blEnd(R); }
  return true;
}
// ---------- друзья: кто где сейчас ----------
function roomMax(R) { return R.game == 'chess' || R.game == 'billiards' ? 2 : R.game == 'mafia' ? 12 : R.game == 'bowling' ? BW_MAX : R.game == 'eye' ? EY_MAX : R.game == 'rainbow' ? RB_MAX : 6; }
function presence(uid) {
  for (const R of Object.values(rooms)) {
    const p = R.players.find(q => q.uid === uid && !q.bot && !q.left && q.ws && q.ws.readyState === 1);
    if (p) return { g: R.game, room: R.code, lobby: !R.started || R.over, free: (!R.started || R.over) && !R.daily && R.players.length < roomMax(R), daily: !!R.daily };
  }
  for (const [g, Q] of Object.entries(MMQ)) if (Q.some(e => e.uid === uid && e.ws.readyState === 1)) return { g, q: 1 };
  return null;
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
  const st = stateFor0(R, i);
  if (R.daily) st.daily = { type: R.daily.type, res: R.dres || null };
  return st;
}
function stateFor0(R, i) {
  if (R.game === 'chess') return chState(R, i);
  if (R.game === 'mafia') return mfState(R, i);
  if (R.game === 'billiards') return blState(R, i);
  if (R.game === 'bowling') return bwState(R, i);
  if (R.game === 'eye') return eyState(R, i);
  if (R.game === 'rainbow') return rbState(R, i);
  return {
    game: 'durak', room: R.code, you: i, host: true, started: R.started, over: R.over, loser: R.loser,
    tc: R.tc, deck: R.deck.length, att: R.att, def: R.def, table: R.table,
    players: R.players.map(p => ({ name: p.name, n: p.hand.length, bot: p.bot, photo: p.photo || '', fr: p.fr || '', off: !!p.off, left: !!p.left, offIn: p.off ? Math.max(0, p.offUntil - Date.now()) : 0,
      prof: p.prof ? { rating: p.prof.rating, games: p.prof.games, wins: p.prof.wins, losses: p.prof.losses, streak: p.prof.streak, since: p.prof.since } : null })),
    result: R.result, radio: R.radio || null, now: Date.now(),
    idle: R.started && !R.over && R.idleKey === R.mv + ':' + actor(R) ? { i: actor(R), ms: Date.now() - R.idleSince, warn: AFK_WARN, fine: AFK_FINE, kick: AFK_KICK } : null,
    log: R.log.slice(-30), logN: R.logN,
    hand: R.players[i].hand
  };
}
function send(R) {
  if (R.game === 'rainbow') R.players.forEach(p => p.hand.sort((a, b) => a.c - b.c || rbVal(a) - rbVal(b)));   // рука по цветам
  else if (R.game === 'durak') R.players.forEach(p => p.hand.sort((a, b) => w(R, a) - w(R, b) || a.s - b.s));
  R.players.forEach((p, i) => { if (p.ws && p.ws.readyState == 1) p.ws.send(JSON.stringify(stateFor(R, i))); });
  clearTimeout(R.tm);
  if (R.game === 'chess') return chSchedule(R);
  if (R.game === 'mafia') return;
  if (R.game === 'billiards') return blSchedule(R);
  if (R.game === 'bowling') return bwSchedule(R);
  if (R.game === 'eye') return eySchedule(R);
  if (R.game === 'rainbow') return rbSchedule(R);
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
// новый игрок за столом; A — результат auth() с профилем клуба (A.cl): рамка аватара и редкий шар
function addPlayer(ws, A, name, R) {
  const cl = A.cl || null;
  ws.p = { name: String(name || 'Игрок').slice(0, 12), uid: A.uid, photo: A.prof ? A.prof.photo : '', prof: A.prof, hand: [], bot: false, ws, fr: (cl && cl.eq.frame) || '' };
  if (R.game === 'bowling') {   // у каждого свой шар по умолчанию, редкий из коллекции, если выбран
    const b = cl && /^ball_\d+$/.test(cl.eq.ball || '') ? +cl.eq.ball.slice(5) : -1;
    ws.p.ball = b >= BW.BASE && b < BW.BALLS.length && CL.has(cl, cl.eq.ball) ? b : R.players.length % BW.BASE;
  }
  ws.R = R; ws.quid = A.uid; R.players.push(ws.p); CL.touch(A.uid);
}
function mkBot(R) {
  const n = R.players.length;
  if (R.game === 'chess' || R.game === 'billiards') return { name: 'Компьютер', hand: [], bot: true, ws: null };
  if (R.game === 'mafia') return { name: MF_BOTN[n % MF_BOTN.length], hand: [], bot: true, ws: null };
  if (R.game === 'bowling') return bwBot(R);
  if (R.game === 'eye') return { name: EY_BOTN[n % EY_BOTN.length], hand: [], bot: true, ws: null };
  if (R.game === 'rainbow') return { name: RB_BOTN[n % RB_BOTN.length], hand: [], bot: true, ws: null };
  return { name: BOTN[n % BOTN.length], hand: [], bot: true, ws: null };
}
// ================= БЫСТРАЯ ИГРА =================
// Очередь по каждой игре. Подбираем людей с близким рейтингом (окно растёт с ожиданием). Если за MM_BOT
// никого нет, за стол садится компьютер. Мафия собирает всех, кто ищет, и добирает ботов до 7 игроков.
const MM_BOT = +process.env.MM_BOT_MS || 20000;
const MM = { durak: { max: 4, fill: 3 }, chess: { max: 2, fill: 2 }, billiards: { max: 2, fill: 2 }, bowling: { max: 4, fill: 2 }, mafia: { max: 12, fill: 7 }, eye: { max: 6, fill: 3 }, rainbow: { max: 4, fill: 4 } };
const MMQ = { durak: [], chess: [], mafia: [], billiards: [], bowling: [], eye: [], rainbow: [] };
function mmLeave(ws) { const Q = MMQ[ws.q]; if (Q) { const k = Q.findIndex(e => e.ws === ws); if (k >= 0) Q.splice(k, 1); } ws.q = null; }
async function mmJoin(ws, m) {
  if (ws.R || ws.q) return;
  const g = gameOf(m); let A;
  try { A = await auth(m, g); A.cl = A.prof ? await CL.get(A.uid, { name: A.prof.name, photo: A.prof.photo }).catch(() => null) : null; }
  catch (e) { console.error('auth:', e.message); return err(ws, 'Не удалось войти, попробуйте ещё раз'); }
  if (ws.readyState !== 1 || ws.R || ws.q) return;
  // уже играет в этой игре (например, приложение перезапустилось посреди партии): возвращаем за тот же стол
  const R0 = Object.values(rooms).find(R => R.game === g && R.started && !R.over && R.players.some(p => p.uid === A.uid && !p.left && !p.bot));
  if (R0) return ws.send(JSON.stringify({ ev: 'matched', room: R0.code }));
  for (const e of MMQ[g].filter(e => e.uid === A.uid)) { mmLeave(e.ws); err(e.ws, 'Поиск продолжается в другом окне'); }
  ws.q = g; ws.quid = A.uid; CL.touch(A.uid);
  MMQ[g].push({ ws, A, uid: A.uid, name: String(m.name || 'Игрок').slice(0, 12), r: A.prof ? A.prof.rating : RT.ELO.bot[g], t: Date.now() - Math.max(0, Math.min(+m.since || 0, 60000)) });
  mmTick(g);
}
function mmTick(only) {
  const now = Date.now();
  for (const g of only ? [only] : GAMES) {
    const Q = MMQ[g] = MMQ[g].filter(e => e.ws.readyState === 1 && e.ws.q === g && !e.ws.R);
    if (!Q.length) continue;
    Q.sort((a, b) => a.t - b.t);
    const cfg = MM[g], used = new Set(), win = e => 150 + (now - e.t) / 1000 * 25;
    for (const a of Q) {
      if (used.has(a)) continue;
      const wa = now - a.t;
      const mates = Q.filter(b => b !== a && !used.has(b) && b.uid !== a.uid && (g === 'mafia' || Math.abs(b.r - a.r) <= Math.max(win(a), win(b))))
        .sort((x, y) => Math.abs(x.r - a.r) - Math.abs(y.r - a.r)).slice(0, cfg.max - 1);
      const go = g === 'mafia' ? wa >= MM_BOT || mates.length + 1 >= cfg.max
        : cfg.max === 2 ? mates.length >= 1 || wa >= MM_BOT
        : mates.length + 1 >= cfg.max || (mates.length >= 1 && wa >= 5000) || wa >= MM_BOT;
      if (!go) continue;
      const grp = [a, ...mates]; grp.forEach(e => used.add(e));
      try { mmLaunch(g, grp); } catch (e) { console.error('quick:', e && e.stack || e); grp.forEach(x => err(x.ws, 'Не удалось начать игру, попробуйте ещё раз')); }
    }
    MMQ[g] = Q.filter(e => !used.has(e));
    for (const e of MMQ[g]) e.ws.send(JSON.stringify({ ev: 'mm', n: MMQ[g].length, w: now - e.t, bot: MM_BOT }));
  }
}
function mmLaunch(g, grp) {
  const code = rcode(5);
  const R = rooms[code] = { code, players: [], started: false, over: false, table: [], deck: [], loser: -1, log: [], logN: 0, mv: 0, game: g, quick: true };
  for (const e of grp) { e.ws.q = null; addPlayer(e.ws, e.A, e.name, R); }
  while (R.players.length < MM[g].fill) R.players.push(mkBot(R));
  const bots = R.players.some(p => p.bot);
  if (g === 'durak') start(R); else if (g === 'chess') chStart(R, 5); else if (g === 'mafia') mfStart(R); else if (g === 'billiards') blStart(R); else if (g === 'eye') eyStart(R); else if (g === 'rainbow') rbStart(R); else bwStart(R);
  (g === 'mafia' ? mfSys : sys)(R, !bots ? '⚡ Быстрая игра: соперники найдены' : grp.length > 1 ? '⚡ Быстрая игра: соперники найдены, свободные места заняли боты' : '⚡ Быстрая игра: живых соперников сейчас нет, играет компьютер');
  CL.stat('quick'); if (bots) CL.stat('quickbot');
  for (const e of grp) e.ws.send(JSON.stringify({ ev: 'matched', room: code }));
  send(R);
}
setInterval(() => { try { mmTick(); } catch (e) { console.error('mm:', e && e.stack || e); } }, 1000);
// сколько людей в клубе: за столами, в поиске и с открытым приложением за последние 5 минут
function online() {
  const seen = new Set(CL.activeNow()), at = new Set(), g = {}; let queue = 0, nr = 0;
  for (const R of Object.values(rooms)) {
    let any = false;
    for (const p of R.players) if (!p.bot && p.ws && p.ws.readyState === 1) { seen.add(p.uid); at.add(p.uid); g[R.game] = (g[R.game] || 0) + 1; any = true; }
    if (any) nr++;
  }
  for (const [k, Q] of Object.entries(MMQ)) for (const e of Q) if (e.ws.readyState === 1) { seen.add(e.uid); g[k] = (g[k] || 0) + 1; queue++; }
  return { all: seen.size, g, play: at.size, queue, rooms: nr };
}
// сообщение всем открытым окнам игрока (задание выполнено, фишки и т. п.)
function pushUser(uid, o) { const s = JSON.stringify(o); wss.clients.forEach(w => { if (w.readyState === 1 && w.quid === uid) w.send(s); }); }
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
      try { A = await auth(m, R.game); A.cl = A.prof ? await CL.get(A.uid, { name: A.prof.name, photo: A.prof.photo }).catch(() => null) : null; }
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
        const o = old.ws; old.ws = ws; ws.p = old; ws.R = R; ws.quid = uid; clearTimeout(R.gc); R.idleKey = null;
        if (old.off) { clearTimeout(old.tm); old.off = false; sys(R, old.name + ' вернулся'); }
        if (o && o !== ws) o.close();
        return send(R);
      }
      if (R.started && R.over) toLobby(R);
      if (R.started) return err(ws, 'Игра уже идет');
      if (R.players.length >= (R.game == 'chess' || R.game == 'billiards' ? 2 : R.game == 'mafia' ? 12 : R.game == 'bowling' ? BW_MAX : R.game == 'eye' ? EY_MAX : R.game == 'rainbow' ? RB_MAX : 6)) return err(ws, 'Комната заполнена');
      if (ws.q) mmLeave(ws);
      addPlayer(ws, A, m.name, R);
      return send(R);
    }
    if (m.t == 'quick') return mmJoin(ws, m);   // быстрая игра: подбор соперника
    if (m.t == 'daily') return dailyJoin(ws, m);   // задача дня
    if (m.t == 'unquick') { mmLeave(ws); return; }
    const R = ws.R; if (!R) return;
    const i = R.players.indexOf(ws.p); if (i < 0) return;
    if (m.t == 'call') {   // позвать через бота того, с кем уже играли
      const res = !ws.p.prof ? { err: 'Звать друзей могут игроки из Telegram' } : R.started ? { err: 'Позвать можно, пока партия не началась' }
        : await CL.call(ws.p.uid, String(m.to || ''), { game: R.game, room: R.code }).catch(e => ({ err: 'Не получилось: ' + e.message }));
      return ws.readyState === 1 && ws.send(JSON.stringify({ ev: 'callres', to: m.to, ...res }));
    }
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
    if (R.game === 'eye') { eyMsg(R, i, m); return send(R); }
    if (R.game === 'rainbow') { rbMsg(R, i, m); return send(R); }
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
    if (ws.q) mmLeave(ws);
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
// Render усыпляет и перезапускает сервер сигналом SIGTERM: успеваем сохранить фишки, задания и очки недели
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) return; stopping = true;
  Promise.race([CL.flushAll(), new Promise(r => setTimeout(r, 4000))]).catch(() => {}).then(() => process.exit(0));
});
srv.listen(process.env.PORT || 3000, () => {
  db.migrate().catch(e => console.error('migrate:', e.message));   // старые профили на новую шкалу рейтинга
  CL.init({ tg: TOKEN ? tgJ : null, push: pushUser, appUrl: APP_URL || '', link: appLink, presence });
  console.log('Дурак запущен на порту', process.env.PORT || 3000);
  if (TOKEN && APP_URL) {
    tg('setWebhook', { url: APP_URL + '/tg/' + TOKEN, allowed_updates: ['message', 'callback_query', 'inline_query', 'my_chat_member'] });
    tgJ('getMe', {}).then(r => {
      if (!r.ok) return;
      if (r.result.username) BOT = r.result.username;
      if (!r.result.supports_inline_queries) console.log('Подсказка: включите инлайн-режим в @BotFather (/setinline), тогда друзей можно звать через @' + BOT + ' в любом чате');
    });
    tg('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [{ command: 'play', description: 'Выбрать игру для чата' }, { command: 'durak', description: 'Стол для дурака' }, { command: 'chess', description: 'Партия в шахматы' }, { command: 'mafia', description: 'Город для мафии' }, { command: 'billiards', description: 'Стол для бильярда' }, { command: 'bowling', description: 'Дорожка для боулинга' }, { command: 'eye', description: 'Стол для «Зоркого глаза»' }, { command: 'rainbow', description: 'Стол для «Радуги»' }] });
    tg('setMyCommands', { commands: [{ command: 'start', description: 'Меню игр' }, { command: 'durak', description: 'Подкидной дурак' }, { command: 'chess', description: 'Шахматы' }, { command: 'mafia', description: 'Мафия' }, { command: 'billiards', description: 'Бильярд' }, { command: 'bowling', description: 'Боулинг' }, { command: 'eye', description: 'Зоркий глаз: найди пару' }, { command: 'rainbow', description: 'Радуга: карты на сброс' }, { command: 'rules', description: 'Правила игр' }] });
    tg('setMyDescription', { description: `♠️ Игровой клуб: подкидной дурак, шахматы, мафия, бильярд, боулинг, «Зоркий глаз» и «Радуга» онлайн

Играйте с друзьями или ботами прямо в Telegram: быстрый подбор соперника, задания дня, недельный турнир, коллекция украшений, чат и радио за столом, рейтинг с рангами в каждой игре.

Зовите друзей: напишите @${BOT} в любом чате или добавьте бота в группу.

Нажмите Start и выберите игру.

⏳ Первый вход может занять 30–60 секунд: сервер просыпается. Просто подождите, и игра откроется.` });
    tg('setMyShortDescription', { short_description: 'Дурак, шахматы, мафия, бильярд, боулинг, «Зоркий глаз», «Радуга»: друзья, боты, рейтинг ⏳' });
    tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: APP_URL + '/club' } } });   // кнопка «Играть» в чате открывает экран клуба
  }
});
