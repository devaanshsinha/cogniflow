-- CreateTable
CREATE TABLE "blocks" (
    "number" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "parent_hash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "block_number" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "log_index" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "from_addr" TEXT NOT NULL,
    "to_addr" TEXT NOT NULL,
    "amount_raw" DECIMAL(78,0) NOT NULL,
    "amount_dec" DECIMAL(78,18) NOT NULL,
    "symbol" TEXT,
    "decimals" INTEGER,
    "chain" TEXT NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prices" (
    "chain" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "usd" DECIMAL(38,10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prices_pkey" PRIMARY KEY ("chain","token","ts")
);

-- CreateTable
CREATE TABLE "tx_embeddings" (
    "id" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tx_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocks_hash_key" ON "blocks"("hash");

-- CreateIndex
CREATE INDEX "transfers_to_addr_idx" ON "transfers"("to_addr");

-- CreateIndex
CREATE INDEX "transfers_from_addr_idx" ON "transfers"("from_addr");

-- CreateIndex
CREATE INDEX "transfers_token_idx" ON "transfers"("token");

-- CreateIndex
CREATE INDEX "transfers_block_number_idx" ON "transfers"("block_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_chain_address_key" ON "wallets"("user_id", "chain", "address");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_block_number_fkey" FOREIGN KEY ("block_number") REFERENCES "blocks"("number") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tx_embeddings" ADD CONSTRAINT "tx_embeddings_id_fkey" FOREIGN KEY ("id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
