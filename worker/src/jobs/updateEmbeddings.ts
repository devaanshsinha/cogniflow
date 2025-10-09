import "dotenv/config";
import pino from "pino";
import { Prisma } from "@prisma/client";
import { prisma, disconnectPrisma } from "../prisma";

const log = pino({ level: process.env.LOG_LEVEL || "info" });

const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_CHAIN = process.env.EMBEDDING_CHAIN ?? "eth";
const TARGET_DIMENSION = Number.parseInt(
  process.env.EMBEDDING_DIM ?? "768",
  10,
);

if (!OPENAI_API_KEY) {
  log.warn(
    "OPENAI_API_KEY is not set. The embedding job will exit without changes.",
  );
  process.exit(0);
}

function resolveBatchSize(): number {
  const raw = Number.parseInt(process.env.EMBEDDING_BATCH_SIZE ?? "32", 10);
  if (Number.isFinite(raw) && raw > 0 && raw <= 128) {
    return raw;
  }
  return 32;
}

type TransferForEmbedding = {
  id: string;
  timestamp: Date;
  txHash: string;
  fromAddr: string;
  toAddr: string;
  amountDec: Prisma.Decimal;
  symbol: string | null;
  chain: string;
  token: string;
};

function toEmbeddingPrompt(transfer: TransferForEmbedding): string {
  const symbol = transfer.symbol ?? "UNKNOWN";
  const amount = transfer.amountDec.toString();
  const timestamp = transfer.timestamp.toISOString();

  return [
    `Transfer ${transfer.id}`,
    `Timestamp: ${timestamp}`,
    `Chain: ${transfer.chain}`,
    `Token: ${transfer.token}`,
    `Symbol: ${symbol}`,
    `Amount: ${amount}`,
    `From: ${transfer.fromAddr}`,
    `To: ${transfer.toAddr}`,
    `TxHash: ${transfer.txHash}`,
  ].join("\n");
}

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Embedding request failed (${response.status}): ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return json.data.map((item) => normalizeEmbedding(item.embedding));
}

function normalizeEmbedding(vector: number[]): number[] {
  if (!Number.isFinite(TARGET_DIMENSION) || TARGET_DIMENSION <= 0) {
    return vector;
  }
  if (vector.length === TARGET_DIMENSION) {
    return vector;
  }
  if (vector.length > TARGET_DIMENSION) {
    return vector.slice(0, TARGET_DIMENSION);
  }
  const padded = new Array(TARGET_DIMENSION).fill(0);
  for (let i = 0; i < vector.length; i += 1) {
    padded[i] = vector[i];
  }
  return padded;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const step = Math.max(1, size);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    batches.push(items.slice(i, i + step));
  }
  return batches;
}

async function main() {
  const batchSize = resolveBatchSize();

  const transfers = await prisma.transfer.findMany({
    where: {
      chain: DEFAULT_CHAIN,
      embedding: { is: null },
    },
    select: {
      id: true,
      timestamp: true,
      txHash: true,
      fromAddr: true,
      toAddr: true,
      amountDec: true,
      symbol: true,
      chain: true,
      token: true,
    },
    orderBy: { timestamp: "desc" },
    take: Number(process.env.EMBEDDING_MAX_RECORDS ?? 200),
  });

  if (transfers.length === 0) {
    log.info("No transfers require embeddings.");
    return;
  }

  log.info(
    { count: transfers.length, chain: DEFAULT_CHAIN, batchSize },
    "Generating embeddings",
  );

  let processed = 0;

  for (const batch of chunk(transfers, batchSize)) {
    const prompts = batch.map(toEmbeddingPrompt);
    try {
      const embeddings = await fetchEmbeddings(prompts);
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < batch.length; i += 1) {
          const transfer = batch[i];
          const embedding = embeddings[i];
          const vectorSql = Prisma.sql`ARRAY[${Prisma.join(
            embedding.map((value) => Prisma.sql`${value}`),
          )}]::vector`;
          const meta = {
            token: transfer.token,
            symbol: transfer.symbol,
            amountDec: transfer.amountDec.toString(),
            from: transfer.fromAddr,
            to: transfer.toAddr,
            chain: transfer.chain,
          } satisfies Record<string, unknown>;
          const metaJson = JSON.stringify(meta);

          await tx.$executeRaw`
            INSERT INTO "tx_embeddings" ("id", "embedding", "meta")
            VALUES (${transfer.id}, ${vectorSql}, ${metaJson}::jsonb)
            ON CONFLICT ("id") DO UPDATE SET
              "embedding" = EXCLUDED."embedding",
              "meta" = EXCLUDED."meta",
              "created_at" = CURRENT_TIMESTAMP
          `;
        }
      });
      processed += batch.length;
      log.info({ batch: batch.length, processed }, "Embeddings stored");
    } catch (error) {
      log.error({ err: error }, "Failed to generate embeddings for batch");
    }
  }

  log.info({ processed }, "Embedding job completed");
}

main()
  .catch((err) => {
    log.error({ err }, "Embedding job crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
