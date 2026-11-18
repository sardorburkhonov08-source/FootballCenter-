-- 010: 👥 Fan community'lar (egasi talabi bilan, SPEC'dan tashqari).
-- Foydalanuvchi klubi uchun community ochishni so'raydi → admin tasdiqlaydi (klubning keyingi community'si pullik,
-- pul tasdiqlanganda balansdan yechiladi). A'zolar — muxlislik kartasi shu klubniki bo'lganlar, har kim bitta community'da.

CREATE TABLE IF NOT EXISTS communities (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL,
  team_name       TEXT NOT NULL,
  team_logo       TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'closed')),
  price           BIGINT NOT NULL DEFAULT 0,          -- tasdiqlanganda yechilgan summa
  reject_reason   TEXT,
  wins            INTEGER NOT NULL DEFAULT 0,         -- haftalik fan reytingida necha marta 1-o'rin
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_communities_team ON communities (team_id, status);
-- Bir foydalanuvchining bir vaqtda faqat bitta ko'rib chiqilayotgan so'rovi
CREATE UNIQUE INDEX IF NOT EXISTS uq_communities_pending_owner ON communities (owner_user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS community_members (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,   -- har kim bitta community'da
  community_id  INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_members_c ON community_members (community_id);

-- Egasi chiqarib yuborgan a'zolar shu community'ga qayta qo'shila olmaydi
CREATE TABLE IF NOT EXISTS community_bans (
  community_id  INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

-- Egasining e'lonlari (kanal kabi)
CREATE TABLE IF NOT EXISTS community_posts (
  id            SERIAL PRIMARY KEY,
  community_id  INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_posts_c ON community_posts (community_id, created_at DESC);

-- Haftalik fan reytingi g'oliblari (bir hafta — bir marta)
CREATE TABLE IF NOT EXISTS community_weekly_winners (
  period_start  TIMESTAMPTZ PRIMARY KEY,
  period_end    TIMESTAMPTZ NOT NULL,
  community_id  INTEGER REFERENCES communities(id) ON DELETE SET NULL,
  points        INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
