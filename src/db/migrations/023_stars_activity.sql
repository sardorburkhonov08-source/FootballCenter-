-- 023: ⭐ Telegram Stars orqali Premium to'lovlari va 📊 kunlik faol foydalanuvchilar (web admin statistikasi).
CREATE TABLE IF NOT EXISTS star_payments (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  plan        TEXT NOT NULL,
  stars       INT NOT NULL,
  days        INT NOT NULL,
  charge_id   TEXT NOT NULL UNIQUE,          -- telegram_payment_charge_id (qayta hisoblanmasin)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_star_payments_user ON star_payments (user_id, created_at);

-- Kunlik faollik: bot yoki Mini App'dan foydalangan har bir foydalanuvchi kuniga bir marta (Toshkent kuni)
CREATE TABLE IF NOT EXISTS daily_active (
  day      DATE NOT NULL,
  user_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (day, user_id)
);
