-- 024: 👥 Guruhlarda bot (kunlik guruh Quiz'i, guruh reytingi, haftalik guruh chempioni) va 🗳 "Kim yutadi?" ovoz berish (sinov).

CREATE TABLE IF NOT EXISTS group_chats (
  chat_id     BIGINT PRIMARY KEY,
  title       TEXT,
  language    TEXT NOT NULL DEFAULT 'uz',
  active      BOOLEAN NOT NULL DEFAULT true,
  added_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Guruhga yuborilgan Quiz savollari (kuniga bittadan)
CREATE TABLE IF NOT EXISTS group_quiz (
  id           BIGSERIAL PRIMARY KEY,
  chat_id      BIGINT NOT NULL REFERENCES group_chats(chat_id) ON DELETE CASCADE ON UPDATE CASCADE,
  day          DATE NOT NULL,
  question_id  BIGINT NOT NULL REFERENCES quiz_questions(id),
  order_map    TEXT NOT NULL,                 -- tugmalar tartibi, masalan 'CADB'
  message_id   BIGINT,
  posted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chat_id, day)
);

CREATE TABLE IF NOT EXISTS group_quiz_answers (
  group_quiz_id  BIGINT NOT NULL REFERENCES group_quiz(id) ON DELETE CASCADE,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option         CHAR(1) NOT NULL,
  correct        BOOLEAN NOT NULL,
  seconds        INT NOT NULL,                -- savol chiqqandan javobgacha (teng bo'lsa tezroq yutadi)
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_quiz_id, user_id)
);

-- Haftalik guruh chempioni (bir marta e'lon qilinadi)
CREATE TABLE IF NOT EXISTS group_weekly_winners (
  chat_id     BIGINT NOT NULL REFERENCES group_chats(chat_id) ON DELETE CASCADE ON UPDATE CASCADE,
  week_start  TIMESTAMPTZ NOT NULL,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  correct     INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, week_start)
);

-- 🗳 "Kim yutadi?" (sinov rejimi): Hisobni top o'yinlaridan kunning katta o'yini bo'yicha ovoz
CREATE TABLE IF NOT EXISTS poll_votes (
  game_id     INT NOT NULL REFERENCES score_games(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pick        CHAR(1) NOT NULL CHECK (pick IN ('H', 'D', 'A')),
  points      INT,                            -- NULL — hali hisoblanmagan
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  scored_at   TIMESTAMPTZ,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_scored ON poll_votes (scored_at) WHERE points > 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS points_poll INT NOT NULL DEFAULT 0;

-- Faqat guruhda javob bergan (botni hali ochmagan) foydalanuvchi: botga birinchi kirganda u "yangi" hisoblanadi
-- (sovg'a Premium va referral shunda beriladi)
ALTER TABLE users ADD COLUMN IF NOT EXISTS group_only BOOLEAN NOT NULL DEFAULT false;
