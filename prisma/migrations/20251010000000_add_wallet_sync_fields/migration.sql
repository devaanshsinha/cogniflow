-- Add wallet sync metadata for ingestion cursors
ALTER TABLE "wallets"
ADD COLUMN     "last_synced_block" INTEGER,
ADD COLUMN     "last_synced_at" TIMESTAMP(3);
