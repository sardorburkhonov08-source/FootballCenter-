-- ⭐ Admin foydalanuvchiga points qo'shadi yoki olib tashlaydi (egasi talabi).
-- users.points_admin — jami tuzatish (umumiy points'ga qo'shiladi), point_adjustments — jurnal (haftalik/oylik reyting shu sanadan).
ALTER TABLE users ADD COLUMN IF NOT EXISTS points_admin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS point_adjustments (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  amount      INTEGER NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_point_adjustments_created ON point_adjustments (created_at);
CREATE INDEX IF NOT EXISTS idx_point_adjustments_user ON point_adjustments (user_id);
