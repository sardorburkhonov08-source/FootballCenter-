-- 003: Ligalar ommabopligi (avtomatik tartib uchun). Faqat umumiy son saqlanadi:
-- qaysi liga, qaysi kuni nechta noyob foydalanuvchi qiziqdi — kimligi saqlanmaydi.
CREATE TABLE IF NOT EXISTS league_popularity (
  league_id INTEGER NOT NULL,
  day       DATE NOT NULL,
  users     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, day)
);

CREATE INDEX IF NOT EXISTS idx_league_popularity_day ON league_popularity (day);
