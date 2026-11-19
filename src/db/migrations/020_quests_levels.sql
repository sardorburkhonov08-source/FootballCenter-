-- 020: ✅ Kunlik vazifalar va 📈 shaxsiy daraja (egasi talabi bilan).
-- Har kuni (Toshkent) foydalanuvchiga 3 ta vazifa; hammasi bajarilsa mukofot points (ketma-ket kunlar uchun bonus).
CREATE TABLE IF NOT EXISTS user_quest_days (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  quests      JSONB NOT NULL,            -- tanlangan vazifalar id'lari
  reward      INTEGER,
  streak      INTEGER,
  claimed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_user_quest_claimed ON user_quest_days (claimed_at) WHERE claimed_at IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS points_quest INTEGER NOT NULL DEFAULT 0;
-- Shaxsiy daraja (0 — hali hisoblanmagan: birinchi tekshiruvda xabarsiz o'rnatiladi)
ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 0;
