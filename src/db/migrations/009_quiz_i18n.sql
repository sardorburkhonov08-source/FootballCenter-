-- 009: Quiz savollari 4 tilda. Asosiy ustunlar (question, option_a..d) — o'zbek (lotin);
-- i18n — boshqa tillar: { "uz_cyrl": { "q": ..., "a": ..., "b": ..., "c": ..., "d": ... }, "ru": {...}, "en": {...} }.
ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS i18n JSONB;

-- Inglizcha (Open Trivia DB) savollar navbati tozalanadi — endi 4 tilli savollar bazasi ishlatiladi.
-- E'lon qilinganlari (javoblar bog'langan) saqlanadi.
DELETE FROM quiz_questions WHERE source = 'api' AND published_at IS NULL;
