-- 018: 💥 Crossbar / ⚽ Keepy-uppy — botdan tashqari 🎲 tasodifiy raqib va 🤝 do'st bilan o'yin (egasi talabi bilan).
-- Ikkala o'yinchi bir xil parametrlarda (match.params) navbatma-navbat o'ynaydi, match 24 soat amal qiladi.
CREATE TABLE IF NOT EXISTS arcade_matches (
  id           SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('crossbar', 'keepy')),
  mode         TEXT NOT NULL CHECK (mode IN ('random', 'invite')),
  code         TEXT NOT NULL UNIQUE,
  creator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished', 'expired')),
  params       JSONB NOT NULL,
  winner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_arcade_matches_waiting ON arcade_matches (kind, created_at) WHERE status = 'waiting' AND mode = 'random';
CREATE INDEX IF NOT EXISTS idx_arcade_matches_creator ON arcade_matches (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_arcade_matches_opponent ON arcade_matches (opponent_id, created_at DESC);

-- O'yinchining shu match'dagi o'yini (bot o'yinlari — match_id NULL)
ALTER TABLE arcade_games ADD COLUMN IF NOT EXISTS match_id INTEGER REFERENCES arcade_matches(id) ON DELETE CASCADE;
ALTER TABLE arcade_games ALTER COLUMN bot_score DROP NOT NULL;
DROP INDEX IF EXISTS uq_arcade_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_arcade_active_bot ON arcade_games (user_id, kind) WHERE status = 'active' AND match_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_arcade_match_player ON arcade_games (match_id, user_id) WHERE match_id IS NOT NULL;
