import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ensureLogger, type Logger } from "../logger";

const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const DEFAULT_CHAIN = process.env.EMBEDDING_CHAIN ?? "eth";
const TARGET_DIMENSION = Number.parseInt(
  process.env.EMBEDDING_DIM ?? "768",
  10,
);

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

export type UpdateEmbeddingsOptions = {
  chain?: string;
  logger?: Logger;
  batchSize?: number;
  maxRecords?: number;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  targetDimension?: number;
};

export type UpdateEmbeddingsResult = {
  chain: string;
  processed: number;
  batches: number;
};

function toEmbeddingPrompt(transfer: TransferForEmbedding): string {
  const symbol = transfer.symbol ?? "UNKNOWN";
  const amount = transfer.amountDec.toString();
  const timestamp = transfer.timestamp.toISOString();

  const bucket = categorizeAmount(transfer.amountDec);

  return [
    `Transfer ${transfer.id}`,
    `Timestamp: ${timestamp}`,
    `Chain: ${transfer.chain}`,
    `Token: ${transfer.token}`,
    `Symbol: ${symbol}`,
    `Amount: ${amount}`,
    `Amount bucket: ${bucket}`,
    `From: ${transfer.fromAddr}`,
    `To: ${transfer.toAddr}`,
    `TxHash: ${transfer.txHash}`,
  ].join("\n");
}

function categorizeAmount(amount: Prisma.Decimal): string {
  const value = Number(amount.toString());
  if (!Number.isFinite(value)) return "unknown";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return "very large";
  if (abs >= 100_000) return "large";
  if (abs >= 10_000) return "medium";
  if (abs >= 1_000) return "small";
  return "very small";
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

async function fetchEmbeddings(
  texts: string[],
  options: {
    apiKey: string;
    model: string;
    baseUrl: string;
    targetDimension: number;
  },
): Promise<number[][]> {
  const response = await fetch(`${options.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
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
  return json.data.map((item) =>
    normalizeEmbedding(item.embedding, options.targetDimension),
  );
}

function normalizeEmbedding(vector: number[], targetDimension: number): number[] {
  if (!Number.isFinite(targetDimension) || targetDimension <= 0) {
    return vector;
  }
  if (vector.length === targetDimension) {
    return vector;
  }
  if (vector.length > targetDimension) {
    return vector.slice(0, targetDimension);
  }
  const padded = new Array(targetDimension).fill(0);
  for (let i = 0; i < vector.length; i += 1) {
    padded[i] = vector[i];
  }
  return padded;
}

export async function updateEmbeddings(
  options: UpdateEmbeddingsOptions = {},
): Promise<UpdateEmbeddingsResult> {
  const log = ensureLogger(options.logger);
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it before running the embedding job.",
    );
  }

  const chain = options.chain ?? DEFAULT_CHAIN;
  const batchSize = options.batchSize ?? resolveBatchSize();
  const model = options.model ?? EMBEDDING_MODEL;
  const baseUrl = options.baseUrl ?? OPENAI_BASE_URL;
  const targetDimension = options.targetDimension ?? TARGET_DIMENSION;
  const maxRecords =
    options.maxRecords ??
    Number.parseInt(process.env.EMBEDDING_MAX_RECORDS ?? "200", 10);

  const transfers = await prisma.transfer.findMany({
    where: {
      chain,
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
    take: maxRecords,
  });

  if (transfers.length === 0) {
    log.info({ chain }, "No transfers require embeddings.");
    return { chain, processed: 0, batches: 0 };
  }

  log.info(
    { count: transfers.length, chain, batchSize, model },
    "Generating embeddings",
  );

  let processed = 0;
  let batches = 0;

  for (const batch of chunk(transfers, batchSize)) {
    const prompts = batch.map(toEmbeddingPrompt);
    try {
      const embeddings = await fetchEmbeddings(prompts, {
        apiKey,
        model,
        baseUrl,
        targetDimension,
      });
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
      batches += 1;
      log.info({ batch: batch.length, processed }, "Embeddings stored");
    } catch (error) {
      log.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Failed to generate embeddings for batch",
      );
    }
  }

  log.info({ processed, batches }, "Embedding job completed");

  return { chain, processed, batches };
}
