-- Default settings for a NEW database (local, CI, end-to-end, a new
-- environment). Never needed on production, which already has them.
--
-- These used to be inserted by the request-time DDL (ensureTables() in
-- lib/db.ts and ensureShopTables() in lib/shop-db.ts) on every cold start.
-- Same rows, same ON CONFLICT DO NOTHING: an admin's later choice is never
-- undone. Run with `npm run db:seed` after `npm run db:migrate`.

-- Public sign-ups paused for these weekdays until an admin opens them
-- (lib/constants.ts DEFAULT_PAUSED_DAYS).
INSERT INTO day_signup_settings (day, paused) VALUES ('wednesday', TRUE) ON CONFLICT (tenant_id, day) DO NOTHING;

-- The current club jersey, with zero stock until an admin enters it.
WITH jersey AS (
  INSERT INTO shop_products (slug, kind, name_en, name_vi, desc_en, desc_vi, price_cents, images, has_fit, has_sizes, sort)
  VALUES (
    'club-jersey-port-hills-dawn', 'jersey',
    'Club Jersey · Port Hills Dawn',
    'Áo CLB · Port Hills Dawn',
    'The official Three Wolves jersey on the Yonex crew V-neck: a sunrise fade from rose to amber, navy side panels and the Three Wolves crest. Collect it at your next play day.',
    'Áo đấu chính thức của Three Wolves trên nền áo Yonex cổ tim: chuyển màu bình minh từ hồng đến hổ phách, viền xanh navy và logo Three Wolves. Nhận áo tại buổi chơi tiếp theo.',
    3000,
    '["/uploads/shop/jersey-port-hills-dawn-front.webp", "/uploads/shop/jersey-port-hills-dawn-back.webp"]'::jsonb,
    TRUE, TRUE, 0
  )
  ON CONFLICT (tenant_id, slug) DO NOTHING
  RETURNING id
)
INSERT INTO shop_variants (product_id, fit, size)
SELECT jersey.id, f.fit, s.size
FROM jersey,
  (VALUES ('men'), ('women')) AS f(fit),
  (VALUES ('S', 1), ('M', 2), ('L', 3), ('XL', 4), ('2XL', 5), ('3XL', 6)) AS s(size, ord)
ORDER BY f.fit, s.ord
ON CONFLICT DO NOTHING;
