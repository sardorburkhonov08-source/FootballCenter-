-- 025: ⭐ Sevimli jamoa (Mini App'da o'yinlari tepada, gol va yakun haqida botda xabar).
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_team JSONB;   -- { id, name, logo }
CREATE INDEX IF NOT EXISTS idx_users_favorite_team ON users (((favorite_team->>'id')::int)) WHERE favorite_team IS NOT NULL;

-- Kuzatilayotgan o'yinlarning oxirgi ko'rilgan hisobi (gol va yakun xabari bir marta ketishi uchun)
CREATE TABLE IF NOT EXISTS fav_match_state (
  api_match_id  BIGINT PRIMARY KEY,
  home          INT NOT NULL DEFAULT 0,
  away          INT NOT NULL DEFAULT 0,
  state         TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
