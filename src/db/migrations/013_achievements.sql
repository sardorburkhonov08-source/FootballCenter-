-- 013: 🏅 Yutuqlar (egasi talabi bilan). Ro'yxat kodda (src/services/achievements.js), bu yerda — kim qachon olgani.
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement  TEXT NOT NULL,
  earned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement)
);
