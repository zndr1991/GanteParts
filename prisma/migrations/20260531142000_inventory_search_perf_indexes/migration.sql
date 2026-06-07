-- Inventory search and facet performance indexes.
-- This migration is idempotent and defensive: if DB user cannot manage table ownership,
-- migration should continue without blocking production deploy.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'pg_trgm extension skipped because the database user lacks privileges.';
END
$$;

DO $$
DECLARE
  can_manage_inventory_table BOOLEAN := FALSE;
BEGIN
  SELECT pg_get_userbyid(c.relowner) = current_user
  INTO can_manage_inventory_table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'InventoryItem'
    AND n.nspname = current_schema()
    AND c.relkind = 'r';

  IF NOT COALESCE(can_manage_inventory_table, FALSE) THEN
    RAISE NOTICE 'Skipping inventory search indexes: current user is not owner of table InventoryItem.';
    RETURN;
  END IF;

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_ownerId_updatedAt_id_idx"
    ON "InventoryItem" ("ownerId", "updatedAt" DESC, "id")
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_estatusInterno_expr_idx"
    ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>''estatus_interno'')), ''''), ''SIN ESTATUS'')))
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_marca_expr_idx"
    ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>''marca'')), ''''), '''')))
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_coche_expr_idx"
    ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>''coche'')), ''''), '''')))
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_pieza_expr_idx"
    ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>''pieza'')), ''''), UPPER(TRIM(COALESCE("title", ''''))), '''')))
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_prestadoDebtor_expr_idx"
    ON "InventoryItem" ((COALESCE(NULLIF(UPPER(TRIM("extraData"->>''prestado_vendido_a'')), ''''), '''')))
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_sku_norm_prefix_idx"
    ON "InventoryItem" ((replace(replace(replace(lower(COALESCE("skuInternal", '''')), ''-'', ''''), '' '', ''''), ''_'', '''')) text_pattern_ops)
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_mlItemId_norm_prefix_idx"
    ON "InventoryItem" ((replace(replace(replace(lower(COALESCE("mlItemId", '''')), ''-'', ''''), '' '', ''''), ''_'', '''')) text_pattern_ops)
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS "InventoryItem_sellerCustomField_norm_prefix_idx"
    ON "InventoryItem" ((replace(replace(replace(lower(COALESCE("sellerCustomField", '''')), ''-'', ''''), '' '', ''''), ''_'', '''')) text_pattern_ops)
  ';

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS "InventoryItem_search_document_trgm_idx"
      ON "InventoryItem"
      USING GIN (
        (
          lower(
            concat_ws(
              '' '',
              COALESCE("skuInternal", ''''),
              COALESCE("title", ''''),
              COALESCE("mlItemId", ''''),
              COALESCE("sellerCustomField", ''''),
              COALESCE("extraData"->>''descripcion_local'', ''''),
              COALESCE("extraData"->>''descripcion_ml'', ''''),
              COALESCE("extraData"->>''estatus_interno'', ''''),
              COALESCE("extraData"->>''origen'', ''''),
              COALESCE("extraData"->>''coche'', ''''),
              COALESCE("extraData"->>''pieza'', ''''),
              COALESCE("extraData"->>''marca'', ''''),
              COALESCE("extraData"->>''ano_desde'', ''''),
              COALESCE("extraData"->>''ano_hasta'', ''''),
              COALESCE("extraData"->>''ubicacion'', ''''),
              COALESCE("extraData"->>''inventario'', ''''),
              COALESCE("extraData"->>''revision'', ''''),
              COALESCE("extraData"->>''facebook'', ''''),
              COALESCE("extraData"->>''prestado_vendido_a'', ''''),
              COALESCE("extraData"->>''fecha_prestamo_pago'', ''''),
              CAST(COALESCE("stock", 0) AS TEXT),
              CAST(COALESCE("price", 0) AS TEXT)
            )
          )
        ) gin_trgm_ops
      )
    ';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping inventory search indexes due to insufficient privileges for current DB user.';
END
$$;
