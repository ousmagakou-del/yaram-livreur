-- ════════════════════════════════════════════════════════
-- YARAM — RPCs atomiques pour counters (banner click + review helpful)
-- ════════════════════════════════════════════════════════
-- Remplace le pattern "SELECT puis UPDATE" qui :
--   1. Fait 2 round-trips au lieu d'1
--   2. A des race conditions (2 users → 1 perdu)
-- Par un UPDATE atomique côté DB qui résout les 2 problèmes.
-- ════════════════════════════════════════════════════════

-- ─── 1. Increment banner click count ───
CREATE OR REPLACE FUNCTION increment_banner_click(banner_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE banners
  SET click_count = COALESCE(click_count, 0) + 1
  WHERE id = banner_id;
$$;

GRANT EXECUTE ON FUNCTION increment_banner_click(UUID) TO anon, authenticated;

-- ─── 2. Increment review helpful count ───
CREATE OR REPLACE FUNCTION increment_review_helpful(review_id UUID)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE reviews
  SET helpful_count = COALESCE(helpful_count, 0) + 1
  WHERE id = review_id;
$$;

GRANT EXECUTE ON FUNCTION increment_review_helpful(UUID) TO anon, authenticated;

-- ─── Vérification ───
SELECT 'RPCs atomic counters créées ✅' AS status,
       proname AS function_name
FROM pg_proc
WHERE proname IN ('increment_banner_click', 'increment_review_helpful');
