-- 026: Banner media o'lchami (Mini App'da banner shu nisbatda ko'rsatiladi — qirqilmaydi)
ALTER TABLE banners ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS height INTEGER;
