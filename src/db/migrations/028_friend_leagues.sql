-- 028: 👥 Do'stlar ligasi (sinov): foydalanuvchi o'z ligasini ochadi, do'stlari havola orqali qo'shiladi va
-- faqat bir-biri bilan umumiy points bo'yicha bellashadi (haftalik / oylik / jami).
CREATE TABLE IF NOT EXISTS friend_leagues (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  owner_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friend_league_members (
  league_id   BIGINT NOT NULL REFERENCES friend_leagues(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_league_members_user ON friend_league_members (user_id);
