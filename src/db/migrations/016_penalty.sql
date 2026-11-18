-- 016: 🥅 Penalty (sinov, egasi talabi bilan, faqat Premium): botga qarshi seriya — 5 ta zarba urasiz va 5 tasini qaytarasiz.
-- Teng bo'lsa — "sudden death" (5 juftgacha), so'ng durang. Kuniga settings.penalty_daily_games ta o'yin.
CREATE TABLE IF NOT EXISTS penalty_games (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  kicks        JSONB NOT NULL DEFAULT '[]',   -- [{ by: 'user'|'bot', shot, dive, goal }]
  user_goals   SMALLINT NOT NULL DEFAULT 0,
  bot_goals    SMALLINT NOT NULL DEFAULT 0,
  result       TEXT CHECK (result IN ('win', 'draw', 'loss')),
  points       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_penalty_user ON penalty_games (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_penalty_active ON penalty_games (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_penalty_finished ON penalty_games (finished_at) WHERE status = 'finished';

ALTER TABLE users ADD COLUMN IF NOT EXISTS points_penalty INTEGER NOT NULL DEFAULT 0;
