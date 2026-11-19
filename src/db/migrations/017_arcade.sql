-- 017: 🎮 Taymingli o'yinlar (egasi talabi bilan, faqat Premium): 🥅 Crossbar challenge va ⚽ Keepy-uppy.
-- Server o'yin parametrlarini (tebranish davri, tushish vaqtlari) va botning natijasini beradi; o'yinchi bosish vaqtlarini
-- yuboradi, natija serverda qayta hisoblanadi. Kuniga settings.arcade_daily_games ta o'yin (har bir tur uchun).
CREATE TABLE IF NOT EXISTS arcade_games (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('crossbar', 'keepy')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  params       JSONB NOT NULL,
  bot_score    SMALLINT NOT NULL,
  score        SMALLINT,
  detail       JSONB,
  result       TEXT CHECK (result IN ('win', 'draw', 'loss')),
  points       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arcade_user ON arcade_games (user_id, kind, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arcade_active ON arcade_games (user_id, kind) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_arcade_finished ON arcade_games (kind, finished_at) WHERE status = 'finished';

ALTER TABLE users ADD COLUMN IF NOT EXISTS points_arcade INTEGER NOT NULL DEFAULT 0;
