-- CreateTable
CREATE TABLE "SkuNomenclature" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkuNomenclature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuNomenclaturePiece" (
    "id" TEXT NOT NULL,
    "nomenclatureId" TEXT NOT NULL,
    "piece" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkuNomenclaturePiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkuNomenclature_prefix_key" ON "SkuNomenclature"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "SkuNomenclaturePiece_piece_key" ON "SkuNomenclaturePiece"("piece");

-- CreateIndex
CREATE UNIQUE INDEX "SkuNomenclaturePiece_nomenclatureId_piece_key" ON "SkuNomenclaturePiece"("nomenclatureId", "piece");

-- CreateIndex
CREATE INDEX "SkuNomenclaturePiece_nomenclatureId_piece_idx" ON "SkuNomenclaturePiece"("nomenclatureId", "piece");

-- AddForeignKey
ALTER TABLE "SkuNomenclaturePiece" ADD CONSTRAINT "SkuNomenclaturePiece_nomenclatureId_fkey" FOREIGN KEY ("nomenclatureId") REFERENCES "SkuNomenclature"("id") ON DELETE CASCADE ON UPDATE CASCADE;
