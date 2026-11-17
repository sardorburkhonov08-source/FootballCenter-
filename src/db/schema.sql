-- FootballCenter sxemasi. Idempotent: har ishga tushishda xavfsiz qayta bajariladi.

CREATE TABLE IF NOT EXISTS users (
  id                  BIGSERIAL PRIMARY KEY,
  telegram_id         BIGINT UNIQUE NOT NULL,
  username            TEXT,
  first_name          TEXT,
  last_name           TEXT,
  language            TEXT,                     -- uz | uz_cyrl | ru | en (NULL = hali tanlanmagan)
  balance             BIGINT NOT NULL DEFAULT 0,
  points_manager      INTEGER NOT NULL DEFAULT 0,
  points_quiz         INTEGER NOT NULL DEFAULT 0,
  tariff              TEXT NOT NULL DEFAULT 'free',   -- free | premium
  premium_expires_at  TIMESTAMPTZ,
  registered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_blocked          BOOLEAN NOT NULL DEFAULT false,
  is_admin            BOOLEAN NOT NULL DEFAULT false,
  ref_code            TEXT UNIQUE,
  referred_by         BIGINT REFERENCES users(id),
  coach_name          TEXT,
  notify              JSONB NOT NULL DEFAULT '{}'::jsonb,
  referral_earned     BIGINT NOT NULL DEFAULT 0,
  premium_reminder_sent_for TIMESTAMPTZ,
  bonus_ready_notified BOOLEAN NOT NULL DEFAULT true,
  last_seen_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Bot suhbat holati (ko'p bosqichli oqimlar uchun) — server qayta ishga tushsa ham saqlanadi
CREATE TABLE IF NOT EXISTS user_states (
  telegram_id BIGINT PRIMARY KEY,
  state       TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('premium','balance')),
  value        INTEGER NOT NULL CHECK (value > 0),
  max_uses     INTEGER NOT NULL CHECK (max_uses > 0),
  used_count   INTEGER NOT NULL DEFAULT 0,
  starts_at    TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  premium_only BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promo_code_uses (
  id            BIGSERIAL PRIMARY KEY,
  promo_code_id BIGINT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, user_id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id           BIGSERIAL PRIMARY KEY,
  referrer_id  BIGINT NOT NULL REFERENCES users(id),
  referred_id  BIGINT NOT NULL UNIQUE REFERENCES users(id),
  is_active    BOOLEAN NOT NULL DEFAULT false,
  bonus_amount BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS donations (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id),
  amount                BIGINT NOT NULL,
  card_type             TEXT NOT NULL,
  receipt_image         TEXT NOT NULL,          -- Telegram file_id
  comment               TEXT,
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason         TEXT,
  is_anonymous          BOOLEAN,
  announce_deadline     TIMESTAMPTZ,
  announced_in_channel  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at            TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS balance_topups (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  amount        BIGINT NOT NULL,
  card_type     TEXT NOT NULL,
  receipt_image TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bonuses_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  amount     BIGINT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS premium_purchases (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  amount     BIGINT NOT NULL,
  days       INTEGER NOT NULL,
  source     TEXT NOT NULL,          -- purchase | promo | referral_league
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  question   TEXT NOT NULL,
  answer     TEXT,
  counted    BOOLEAN NOT NULL,       -- mavzudan tashqari savollar limitdan kamaytirmaydi
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rules (
  key          TEXT PRIMARY KEY,
  text_uz      TEXT,
  text_uz_cyrl TEXT,
  text_ru      TEXT,
  text_en      TEXT
);

-- Admin tahrirlaydigan boshqa matnlar (tarif taqqoslash, premium tavsifi)
CREATE TABLE IF NOT EXISTS texts (
  key          TEXT PRIMARY KEY,
  text_uz      TEXT,
  text_uz_cyrl TEXT,
  text_ru      TEXT,
  text_en      TEXT
);

CREATE TABLE IF NOT EXISTS faq (
  id           BIGSERIAL PRIMARY KEY,
  q_uz TEXT, q_uz_cyrl TEXT, q_ru TEXT, q_en TEXT,
  a_uz TEXT, a_uz_cyrl TEXT, a_ru TEXT, a_en TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  admin_reply TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','answered')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS banners (
  id               BIGSERIAL PRIMARY KEY,
  media_path       TEXT NOT NULL,
  media_type       TEXT NOT NULL CHECK (media_type IN ('image','video','animation','lottie')),
  link             TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 8,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prizes (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('manager','quiz')),
  period     TEXT NOT NULL CHECK (period IN ('weekly','monthly')),
  text       TEXT NOT NULL,
  media_path TEXT,
  media_type TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS period_winners (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,            -- manager | quiz | referral
  period       TEXT NOT NULL,            -- weekly | monthly
  period_start TIMESTAMPTZ NOT NULL,
  period_end   TIMESTAMPTZ NOT NULL,
  user_id      BIGINT REFERENCES users(id),
  points       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, period, period_start)
);

CREATE TABLE IF NOT EXISTS mini_manager_games (
  id             BIGSERIAL PRIMARY KEY,
  api_match_id   BIGINT UNIQUE NOT NULL,
  home_team_id   BIGINT,
  home_team_name TEXT,
  home_team_crest TEXT,
  away_team_id   BIGINT,
  away_team_name TEXT,
  away_team_crest TEXT,
  competition    TEXT,
  kickoff_at     TIMESTAMPTZ NOT NULL,
  week_start     TIMESTAMPTZ NOT NULL,
  week_end       TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','locked','finished')),
  result         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mini_manager_predictions (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id),
  game_id              BIGINT NOT NULL REFERENCES mini_manager_games(id) ON DELETE CASCADE,
  coach_name           TEXT,
  tactic_home          TEXT NOT NULL,
  tactic_away          TEXT NOT NULL,
  lineup_home          JSONB NOT NULL,
  lineup_away          JSONB NOT NULL,
  -- NULL = taxmin qilinmagan, 0 = "bo'lmaydi", >0 = futbolchi API id
  scorer_home BIGINT, scorer_away BIGINT,
  assist_home BIGINT, assist_away BIGINT,
  red_card_home BIGINT, red_card_away BIGINT,
  yellow_card_home BIGINT, yellow_card_away BIGINT,
  predicted_score_home INTEGER NOT NULL,
  predicted_score_away INTEGER NOT NULL,
  predicted_winner     TEXT NOT NULL CHECK (predicted_winner IN ('HOME','AWAY','DRAW')),
  points_earned        INTEGER,
  points_breakdown     JSONB,
  is_locked            BOOLEAN NOT NULL DEFAULT false,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id             BIGSERIAL PRIMARY KEY,
  question       TEXT NOT NULL,
  option_a       TEXT NOT NULL,
  option_b       TEXT NOT NULL,
  option_c       TEXT NOT NULL,
  option_d       TEXT NOT NULL,
  correct_option CHAR(1) NOT NULL CHECK (correct_option IN ('A','B','C','D')),
  source         TEXT NOT NULL DEFAULT 'api',
  source_hash    TEXT UNIQUE,
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  id                    BIGSERIAL PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id),
  question_id           BIGINT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  selected_option       CHAR(1),
  response_time_seconds NUMERIC(6,2),
  points_earned         INTEGER NOT NULL DEFAULT 0,
  answered_at           TIMESTAMPTZ,
  UNIQUE (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS match_subscriptions (
  user_id      BIGINT NOT NULL REFERENCES users(id),
  api_match_id BIGINT NOT NULL,
  kickoff_at   TIMESTAMPTZ NOT NULL,
  title        TEXT,
  notified     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, api_match_id)
);

CREATE TABLE IF NOT EXISTS webapp_visits (
  user_id    BIGINT NOT NULL REFERENCES users(id),
  visit_date DATE NOT NULL,
  PRIMARY KEY (user_id, visit_date)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));
CREATE INDEX IF NOT EXISTS idx_ai_requests_user ON ai_requests (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bonuses_user ON bonuses_log (user_id, claimed_at);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_time ON quiz_answers (answered_at);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id, activated_at);
