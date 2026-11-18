-- 015: ⚔️ Duel o'yinlari (egasi talabi bilan, faqat Premium): Quiz duel va "Futbolchini top" 1v1.
-- Navbatma-navbat: ikkalasi bir xil raundlarni o'z vaqtida (24 soat ichida) o'ynaydi. Raqib — tasodifiy yoki do'st (havola).
CREATE TABLE IF NOT EXISTS duels (
  id               SERIAL PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('quiz', 'player')),
  mode             TEXT NOT NULL CHECK (mode IN ('random', 'invite')),
  code             TEXT NOT NULL UNIQUE,                  -- do'stni chaqirish havolasi uchun
  creator_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished', 'expired')),
  rounds           JSONB NOT NULL,                        -- raundlar (savol id'lari yoki futbolchilar)
  winner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_duels_waiting ON duels (kind, created_at) WHERE status = 'waiting' AND mode = 'random';
CREATE INDEX IF NOT EXISTS idx_duels_creator ON duels (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels (opponent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS duel_answers (
  duel_id      INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round        SMALLINT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at  TIMESTAMPTZ,
  answer       TEXT,
  correct      BOOLEAN,
  time_ms      INTEGER,
  PRIMARY KEY (duel_id, user_id, round)
);

-- Natijalar va berilgan points (reyting shu jadvaldan)
CREATE TABLE IF NOT EXISTS duel_results (
  duel_id     INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result      TEXT NOT NULL CHECK (result IN ('win', 'draw', 'loss')),
  score       SMALLINT NOT NULL,
  time_ms     INTEGER NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (duel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_duel_results_user ON duel_results (user_id, created_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS points_duel INTEGER NOT NULL DEFAULT 0;
