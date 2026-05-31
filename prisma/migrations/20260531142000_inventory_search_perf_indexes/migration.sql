-- Performance indexes for inventory search (code-oriented lookups).

CREATE INDEX IF NOT EXISTS "InventoryItem_skuInternal_idx"
ON "InventoryItem" ("skuInternal");

CREATE INDEX IF NOT EXISTS "InventoryItem_mlItemId_idx"
ON "InventoryItem" ("mlItemId");

CREATE INDEX IF NOT EXISTS "InventoryItem_sellerCustomField_idx"
ON "InventoryItem" ("sellerCustomField");

CREATE INDEX IF NOT EXISTS "InventoryItem_sku_normalized_prefix_idx"
ON "InventoryItem" ((regexp_replace(lower(coalesce("skuInternal", '')), '[^a-z0-9]+', '', 'g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS "InventoryItem_mlItem_normalized_prefix_idx"
ON "InventoryItem" ((regexp_replace(lower(coalesce("mlItemId", '')), '[^a-z0-9]+', '', 'g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS "InventoryItem_seller_normalized_prefix_idx"
ON "InventoryItem" ((regexp_replace(lower(coalesce("sellerCustomField", '')), '[^a-z0-9]+', '', 'g')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS "InventoryItem_title_normalized_prefix_idx"
ON "InventoryItem" ((regexp_replace(lower(coalesce("title", '')), '[^a-z0-9]+', '', 'g')) text_pattern_ops);
