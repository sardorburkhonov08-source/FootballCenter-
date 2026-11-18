-- 004: Muxlislik kartasi. Karta raqami — users.id (ro'yxatdan o'tish tartibi).
ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_team_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_team_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_team_logo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fav_player TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fan_region TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fan_since INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fan_card_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_fav_team ON users (fav_team_id);
CREATE INDEX IF NOT EXISTS idx_users_fan_region ON users (fan_region);

-- Klub ranglari logotipdan avtomatik aniqlanadi (Premium karta uchun) va logotip shu yerda saqlanadi —
-- Stories rasmi chizilganda tashqi saytga qayta so'rov ketmaydi.
CREATE TABLE IF NOT EXISTS team_colors (
  team_id         INTEGER PRIMARY KEY,
  primary_color   TEXT NOT NULL,
  secondary_color TEXT,
  logo_png        TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
