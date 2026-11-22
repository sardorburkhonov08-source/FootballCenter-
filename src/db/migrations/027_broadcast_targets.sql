-- 027: 🎯 Maqsadli va ⏰ rejalashtirilgan xabar tarqatish (bot admin).
-- audience: { "type": "all|premium|free|inactive|club|region", "value": ... }
CREATE TABLE IF NOT EXISTS scheduled_broadcasts (
  id            BIGSERIAL PRIMARY KEY,
  from_chat_id  BIGINT NOT NULL,
  message_id    BIGINT NOT NULL,
  audience      JSONB NOT NULL DEFAULT '{"type":"all"}',
  send_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'cancelled')),
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ok_count      INT,
  fail_count    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_scheduled_broadcasts_due ON scheduled_broadcasts (send_at) WHERE status = 'pending';
