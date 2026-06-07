-- Inventory search and facet performance indexes.
-- Keep statements idempotent because this migration folder existed but was empty.

CREATE INDEX IF NOT EXISTS "InventoryItem_ownerId_updatedAt_id_idx"
ON "InventoryItem" ("ownerId", "updatedAt" DESC, "id");

CREATE INDEX IF NOT EXISTS "InventoryItem_estatusInterno_expr_idx"
ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>'estatus_interno')), ''), 'SIN ESTATUS')));

CREATE INDEX IF NOT EXISTS "InventoryItem_marca_expr_idx"
ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>'marca')), ''), '')));

CREATE INDEX IF NOT EXISTS "InventoryItem_coche_expr_idx"
ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>'coche')), ''), '')));

CREATE INDEX IF NOT EXISTS "InventoryItem_pieza_expr_idx"
ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>'pieza')), ''), UPPER(TRIM(COALESCE("title", ''))), '')));

CREATE INDEX IF NOT EXISTS "InventoryItem_prestadoDebtor_expr_idx"
ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>'prestado_vendido_a')), ''), '')));

CREATE INDEX IF NOT EXISTS "InventoryItem_sku_norm_prefix_idx"
ON "InventoryItem" ((replace(replace(replace(lower(COALESCE("skuInternal", '')), '-', ''), ' ', ''), '_', '')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS "InventoryItem_mlItemId_norm_prefix_idx"
ON "InventoryItem" ((replace(replace(replace(lower(COALESCE("mlItemId", '')), '-', ''), ' ', ''), '_', '')) text_pattern_ops);

CREATE INDEX IF NOT EXISTS "InventoryItem_sellerCustomField_norm_prefix_idx"
ON "InventoryItem" ((replace(replace(replace(lower(COALESCE("sellerCustomField", '')), '-', ''), ' ', ''), '_', '')) text_pattern_ops);

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_trgm extension skipped because the database user lacks privileges.';
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS "InventoryItem_search_document_trgm_idx"
      ON "InventoryItem"
      USING GIN (
        (
          lower(
            concat_ws(
              ' ',
              COALESCE("skuInternal", ''),
              COALESCE("title", ''),
              COALESCE("mlItemId", ''),
              COALESCE("sellerCustomField", ''),
              COALESCE("extraData"->>'descripcion_local', ''),
              COALESCE("extraData"->>'descripcion_ml', ''),
              COALESCE("extraData"->>'estatus_interno', ''),
              COALESCE("extraData"->>'origen', ''),
              COALESCE("extraData"->>'coche', ''),
              COALESCE("extraData"->>'pieza', ''),
              COALESCE("extraData"->>'marca', ''),
              COALESCE("extraData"->>'ano_desde', ''),
              COALESCE("extraData"->>'ano_hasta', ''),
              COALESCE("extraData"->>'ubicacion', ''),
              COALESCE("extraData"->>'inventario', ''),
              COALESCE("extraData"->>'revision', ''),
              COALESCE("extraData"->>'facebook', ''),
              COALESCE("extraData"->>'prestado_vendido_a', ''),
              COALESCE("extraData"->>'fecha_prestamo_pago', ''),
              CAST(COALESCE("stock", 0) AS TEXT),
              CAST(COALESCE("price", 0) AS TEXT)
            )
          )
        ) gin_trgm_ops
      )
    $sql$;
  END IF;
END
$$;
