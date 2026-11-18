/* eslint-disable */
(function (root) {
// O'zbek lotin -> kirill transliteratsiyasi (1995-yilgi rasmiy alifbo qoidalari asosida).
// {placeholder}, HTML teglar, havolalar, @username va brend nomlari o'zgartirilmaydi.

const KEEP = ['FootballCenter', 'Football Quiz', 'Mini Manager', 'Referral League', 'Web App', 'Quiz', 'Premium',
  'Username', 'Points', 'Telegram ID', 'Humo', 'Uzcard', 'Visa', 'Mastercard', 'Broadcast', 'FAQ', 'CSV',
  'ON', 'OFF', 'AI', 'ID', 'FOOTBALL2026', 'GOAT', 'Stories', 'points'];

const PROTECT = new RegExp(
  '(\\{[a-z_0-9]+\\}|<[^>]+>|&[a-z]+;|https?:\\/\\/\\S+|@\\w+|\\/\\w+|'
  + KEEP.map((w) => w.replace(/ /g, '\\s')).sort((a, b) => b.length - a.length).map((w) => (w.length > 3 ? `\\b${w}` : `\\b${w}\\b`)).join('|')
  + ')',
);

const APOS = "['ʻ’ʼ`‘]";
const VOWELS = 'aeiouAEIOU';

const MULTI = [
  [new RegExp(`o${APOS}`, 'g'), 'ў'], [new RegExp(`O${APOS}`, 'g'), 'Ў'],
  [new RegExp(`g${APOS}`, 'g'), 'ғ'], [new RegExp(`G${APOS}`, 'g'), 'Ғ'],
  [/sh/g, 'ш'], [/Sh/g, 'Ш'], [/SH/g, 'Ш'],
  [/ch/g, 'ч'], [/Ch/g, 'Ч'], [/CH/g, 'Ч'],
  [/yo/g, 'ё'], [/Yo/g, 'Ё'], [/YO/g, 'Ё'],
  [/yu/g, 'ю'], [/Yu/g, 'Ю'], [/YU/g, 'Ю'],
  [/ya/g, 'я'], [/Ya/g, 'Я'], [/YA/g, 'Я'],
  [/ye/g, 'е'], [/Ye/g, 'Е'], [/YE/g, 'Е'],
];

const SINGLE = {
  a: 'а', b: 'б', c: 'ц', d: 'д', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з',
};

function translitPlain(text) {
  let s = text;
  // So'z boshidagi "e" -> "э", boshqa joyda "е"
  s = s.replace(/(^|[^A-Za-zʻ’'`‘])([eE])/g, (_, pre, e) => pre + (e === 'e' ? 'э' : 'Э'));
  for (const [re, rep] of MULTI) s = s.replace(re, rep);
  // Tutuq belgisi (unli/undoshdan keyin) -> ъ
  s = s.replace(new RegExp(`([A-Za-zа-яА-ЯўғқҳЎҒҚҲ])${APOS}(?=[A-Za-zа-яА-Я])`, 'g'), '$1ъ');
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    if (lower === 'e') { out += ch === 'e' ? 'е' : 'Е'; continue; }
    if (SINGLE[lower]) out += ch === lower ? SINGLE[lower] : SINGLE[lower].toUpperCase();
    else out += ch;
  }
  return out;
}

function translit(text) {
  if (typeof text !== 'string') return text;
  return text.split(PROTECT).map((part, i) => (i % 2 === 1 ? part : translitPlain(part))).join('');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { translit, VOWELS };
else root.FCTranslit = { translit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
