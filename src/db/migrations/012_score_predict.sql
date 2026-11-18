-- 012: 🎯 "Hisobni top" — admin belgilagan o'yinlar uchun aniq hisobni taxmin qilish (egasi talabi bilan, faqat Premium).
-- Ball: aniq hisob — settings.score_exact_points, faqat natija (g'alaba/durang/mag'lubiyat) — settings.score_outcome_points.
-- Ballar umumiy points'ga qo'shiladi (users.points_score).

CREATE TABLE IF NOT EXISTS score_games (
  id               SERIAL PRIMARY KEY,
  api_match_id     BIGINT NOT NULL UNIQUE,
  home_team_id     INTEGER,
  home_team_name   TEXT NOT NULL,
  home_team_crest  TEXT,
  away_team_id     INTEGER,
  away_team_name   TEXT NOT NULL,
  away_team_crest  TEXT,
  competition      TEXT,
  kickoff_at       TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'locked', 'finished')),
  result           JSONB,                       -- { home, away }
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_score_games_kickoff ON score_games (kickoff_at);

CREATE TABLE IF NOT EXISTS score_predictions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id        INTEGER NOT NULL REFERENCES score_games(id) ON DELETE CASCADE,
  home           SMALLINT NOT NULL CHECK (home BETWEEN 0 AND 20),
  away           SMALLINT NOT NULL CHECK (away BETWEEN 0 AND 20),
  points_earned  INTEGER,                       -- hisoblangach
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_score_predictions_game ON score_predictions (game_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS points_score INTEGER NOT NULL DEFAULT 0;
