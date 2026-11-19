-- 021: 🏆 Haftalik va oylik g'oliblar — har o'yin alohida emas, umumiy points bo'yicha (egasi talabi bilan).
-- Sovrinlar endi "overall" (umumiy reyting) uchun ham kiritiladi.
ALTER TABLE prizes DROP CONSTRAINT IF EXISTS prizes_kind_check;
ALTER TABLE prizes ADD CONSTRAINT prizes_kind_check CHECK (kind IN ('manager', 'quiz', 'overall'));
