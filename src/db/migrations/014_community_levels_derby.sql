-- 014: 👥 Community darajalari (XP — a'zolar to'plagan jami points) va ⚔️ haftalik klub derbisi.
-- XP: tugagan haftalar points'i communities.xp ga qo'shiladi; joriy hafta points'i "jonli" qo'shib ko'rsatiladi.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0;

-- Hafta tugaganda XP bir marta qo'shilganini belgilash
CREATE TABLE IF NOT EXISTS community_xp_weeks (
  period_start  TIMESTAMPTZ PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Derbi juftliklari: har hafta boshida reytingdagi qo'shni community'lar juftlanadi (1–2, 3–4, ...)
CREATE TABLE IF NOT EXISTS community_derby_weeks (
  period_start  TIMESTAMPTZ PRIMARY KEY,
  period_end    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_derbies (
  id            SERIAL PRIMARY KEY,
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  home_id       INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  away_id       INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  home_points   INTEGER,
  away_points   INTEGER,
  winner_id     INTEGER REFERENCES communities(id) ON DELETE SET NULL,   -- durang — NULL
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  UNIQUE (period_start, home_id),
  UNIQUE (period_start, away_id)
);
CREATE INDEX IF NOT EXISTS idx_community_derbies_status ON community_derbies (status, period_end);
