-- 022: Telegram profil rasmi manzili (Mini App initData.user.photo_url) — reyting podiumi va profil boshi uchun.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
