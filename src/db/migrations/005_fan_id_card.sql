-- 005: 🪪 Muxlislik kartasi — O'zbekiston ID kartasi uslubida (faqat Premium).
-- 004 dagi users.fav_* / fan_* ustunlari endi ishlatilmaydi (ma'lumot faollashtirishda qaytadan to'ldiriladi).

CREATE TABLE IF NOT EXISTS fan_cards (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id          INTEGER NOT NULL,
  team_name        TEXT NOT NULL,
  team_logo        TEXT,
  fan_number       INTEGER NOT NULL,           -- klubning nechanchi muxlisi (karta raqami va muxlis raqami)
  last_name        TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  birth_year       INTEGER NOT NULL,           -- kartada yosh ko'rsatiladi (o'zi hisoblanadi)
  gender           TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  goat             TEXT NOT NULL,
  fav_player       TEXT NOT NULL,
  region           TEXT NOT NULL,
  fan_since        INTEGER NOT NULL,
  photo_path       TEXT,                       -- NULL — admin rasmni o'chirgan, foydalanuvchi yangisini yuklaydi
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, fan_number)
);
CREATE INDEX IF NOT EXISTS idx_fan_cards_team ON fan_cards (team_id);

-- Har klub uchun oxirgi berilgan muxlis raqami: kimdir klubdan ketsa ham raqam qayta berilmaydi
CREATE TABLE IF NOT EXISTS fan_team_counters (
  team_id      INTEGER PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- Klubni almashtirish (pullik, balansdan yechiladi) tarixi
CREATE TABLE IF NOT EXISTS fan_card_club_changes (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_team_id     INTEGER NOT NULL,
  new_team_id     INTEGER NOT NULL,
  old_fan_number  INTEGER NOT NULL,
  new_fan_number  INTEGER NOT NULL,
  price           BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
