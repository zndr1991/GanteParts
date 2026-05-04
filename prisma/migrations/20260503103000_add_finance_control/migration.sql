-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "DebtMovementType" AS ENUM ('CHARGE', 'PAYMENT');

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "concept" TEXT NOT NULL,
    "code" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "creditorName" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtMovement" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "type" "DebtMovementType" NOT NULL,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceEntry_entryDate_idx" ON "FinanceEntry"("entryDate");

-- CreateIndex
CREATE INDEX "FinanceEntry_ownerId_entryDate_idx" ON "FinanceEntry"("ownerId", "entryDate");

-- CreateIndex
CREATE INDEX "Debt_ownerId_updatedAt_idx" ON "Debt"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "DebtMovement_debtId_movementDate_idx" ON "DebtMovement"("debtId", "movementDate");

-- AddForeignKey
ALTER TABLE "DebtMovement" ADD CONSTRAINT "DebtMovement_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
