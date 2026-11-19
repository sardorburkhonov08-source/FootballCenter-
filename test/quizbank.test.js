// 🧠 4 tilli Quiz savollar bazasi (src/data/quiz-bank)
const test = require('node:test');
const assert = require('node:assert');
const { db, resetDb } = require('./helpers');
const { migrate } = require('../src/db/migrate');
const bank = require('../src/services/quizBank');
const quiz = require('../src/services/quiz');

test.before(async () => { await resetDb(); });
test.after(async () => { await db.pool.end(); });

test('bazada 1900+ savol, har biri 4 tilda, 4 xil variant bilan', () => {
  const list = bank.load();
  assert.ok(list.length >= 1900, `savollar soni: ${list.length}`);
  const seen = new Set();
  const letters = { A: 0, B: 0, C: 0, D: 0 };
  for (const x of list) {
    const where = `${x.file}#${x.index}`;
    assert.ok('ABCD'.includes(x.correct), where);
    letters[x.correct] += 1;
    for (const lang of ['uz', 'uz_cyrl', 'ru', 'en']) {
      const r = x[lang];
      const opts = [r.a, r.b, r.c, r.d];
      assert.ok(r.q && r.q.length <= 300, `${where} ${lang}: savol`);
      assert.ok(opts.every((o) => o && String(o).trim() && String(o).length <= 80), `${where} ${lang}: variantlar`);
      assert.strictEqual(new Set(opts.map((o) => String(o).toLowerCase())).size, 4, `${where} ${lang}: takror variant`);
    }
    assert.match(x.uz_cyrl.q, /[а-яўқғҳ]/i, `${where}: kirill matni`);
    for (const lang of ['uz', 'uz_cyrl', 'ru', 'en']) assert.ok(!/[⟦⟧]/.test(x[lang].q), `${where} ${lang}: ⟦⟧ belgisi qolgan`);
    assert.match(x.ru.q, /[а-я]/i, `${where}: rus matni`);
    assert.ok(!seen.has(x.en.q.toLowerCase()), `${where}: takror savol`);
    seen.add(x.en.q.toLowerCase());
  }
  // To'g'ri javob harflari bir tekis taqsimlangan (taxmin qilib bo'lmaydi)
  for (const [l, n] of Object.entries(letters)) assert.ok(n / list.length > 0.18, `${l}: ${n}`);
});

test("savollar bir marta qo'shiladi (qayta ishga tushirish xavfsiz)", async () => {
  const count = async () => (await db.one("SELECT count(*)::int AS c FROM quiz_questions WHERE source = 'bank'")).c;
  const before = await count();
  assert.strictEqual(before, bank.load().length);
  await migrate();
  assert.strictEqual(await count(), before);
});

test("e'lon: avval admin savoli, keyin baza; tashqi inglizcha API standart holatda ishlatilmaydi", async () => {
  let apiCalls = 0;
  quiz.setFetch(async () => { apiCalls += 1; return { ok: true, json: async () => ({ results: [] }) }; });
  await db.query("INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, source) VALUES ('Admin savoli?', '1', '2', '3', '4', 'B', 'manual')");
  const first = await quiz.publishNext();
  assert.strictEqual(first.source, 'manual');
  const second = await quiz.publishNext();
  assert.strictEqual(second.source, 'bank');
  assert.strictEqual(apiCalls, 0);
  // Tilga qarab
  const ru = quiz.publicQuestion(second, 'ru');
  assert.strictEqual(ru.question, second.i18n.ru.q);
  assert.strictEqual(quiz.publicQuestion(second, 'uz').question, second.question);
  assert.strictEqual(quiz.publicQuestion(first, 'en').question, 'Admin savoli?', "tarjimasi yo'q — asosiy matn");
});

test("baza tugasa — eng eski savol nusxa sifatida qayta chiqadi (30 kun ichida chiqqanlari emas)", async () => {
  await db.query("UPDATE quiz_questions SET published_at = now() - interval '40 days' WHERE published_at IS NULL OR source = 'bank'");
  await db.query("UPDATE quiz_questions SET published_at = now() - interval '50 days' WHERE id = (SELECT min(id) FROM quiz_questions WHERE source = 'bank')");
  const oldest = await db.one("SELECT * FROM quiz_questions WHERE source = 'bank' ORDER BY published_at ASC, id ASC LIMIT 1");
  const again = await quiz.publishNext();
  assert.strictEqual(again.source, 'bank_repeat');
  assert.strictEqual(again.question, oldest.question);
  assert.strictEqual(again.correct_option, oldest.correct_option);
  assert.deepStrictEqual(again.i18n, oldest.i18n);
  assert.notStrictEqual(again.id, oldest.id, 'yangi qator — javoblar alohida yoziladi');
  // Yaqinda chiqqan savol qayta tanlanmaydi
  const next = await quiz.publishNext();
  assert.notStrictEqual(next.question, again.question);
});

test("deploydan oldin chiqqan inglizcha (API) savol soat kutmasdan 4 tilli savolga almashtiriladi", async () => {
  const { quizTick } = require('../src/jobs/scheduler');
  await db.query("UPDATE quiz_questions SET published_at = now() - interval '60 days' WHERE published_at IS NOT NULL");
  const old = await db.one(
    `INSERT INTO quiz_questions (question, option_a, option_b, option_c, option_d, correct_option, source, published_at)
     VALUES ('Who won the 1930 World Cup (API)?', 'Uruguay', 'Brazil', 'Italy', 'Spain', 'A', 'api', now() - interval '5 minutes') RETURNING *`,
  );
  assert.strictEqual((await quiz.current()).id, old.id);
  await quizTick();
  const cur = await quiz.current();
  assert.notStrictEqual(cur.id, old.id);
  assert.ok(['bank', 'bank_repeat'].includes(cur.source));
  // 4 tilli savol esa soat to'lmaguncha almashtirilmaydi
  await quizTick();
  assert.strictEqual((await quiz.current()).id, cur.id);
});
