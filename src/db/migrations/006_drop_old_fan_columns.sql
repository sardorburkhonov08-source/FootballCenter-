-- 006: eski (004) muxlislik kartasi ustunlari olib tashlanadi — karta endi fan_cards jadvalida (005).
-- Indekslar (idx_users_fav_team, idx_users_fan_region) ustun bilan birga o'chadi.
ALTER TABLE users DROP COLUMN IF EXISTS fav_team_id;
ALTER TABLE users DROP COLUMN IF EXISTS fav_team_name;
ALTER TABLE users DROP COLUMN IF EXISTS fav_team_logo;
ALTER TABLE users DROP COLUMN IF EXISTS fav_player;
ALTER TABLE users DROP COLUMN IF EXISTS fan_region;
ALTER TABLE users DROP COLUMN IF EXISTS fan_since;
ALTER TABLE users DROP COLUMN IF EXISTS fan_card_updated_at;
