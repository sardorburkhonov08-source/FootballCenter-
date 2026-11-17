-- 002: Tashqi API javoblari keshi (football-data.org). Deploy/restartdan keyin ham saqlanadi,
-- shuning uchun bir xil ma'lumot API'dan qayta-qayta so'ralmaydi.
CREATE TABLE IF NOT EXISTS api_cache (
  key        TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_cache_fetched ON api_cache (fetched_at);
