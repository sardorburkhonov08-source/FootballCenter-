-- 011: 👥 Community postlariga reaksiyalar (👍 ⚽ 🔥) va 🎁 Premium sovg'a qilish.

-- Har bir a'zo postga bitta reaksiya qo'yadi (boshqasini bossa — almashadi, o'sha reaksiyani qayta bossa — olib tashlanadi)
CREATE TABLE IF NOT EXISTS community_post_reactions (
  post_id     INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL CHECK (reaction IN ('like', 'ball', 'fire')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- Sovg'a qilingan Premium: kim sovg'a qilgani (source = 'gift')
ALTER TABLE premium_purchases ADD COLUMN IF NOT EXISTS from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
