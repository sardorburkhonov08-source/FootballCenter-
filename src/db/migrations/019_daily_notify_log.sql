-- 019: Kunlik bir martalik bildirishnomalar jurnali (masalan, 🧠 yangi Quiz savoli — kuniga 1 marta, egasi talabi bilan).
CREATE TABLE IF NOT EXISTS daily_notify_log (
  kind        TEXT NOT NULL,
  day         DATE NOT NULL,          -- Toshkent sanasi
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, day)
);
