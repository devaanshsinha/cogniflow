import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeJobRequest } from "@/lib/jobAuth";
import {
  syncWalletTransfers,
  type SyncWalletResult,
} from "../../../../shared/ingestion/syncWalletTransfers";
import { createConsoleLogger } from "../../../../shared/logger";

export const runtime = "nodejs";

type IngestRequestBody = {
  address?: string;
  chain?: string;
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export async function POST(request: Request) {
  const auth = authorizeJobRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  let payload: IngestRequestBody = {};
  try {
    payload = (await request.json()) as IngestRequestBody;
  } catch {
    // empty body acceptable
  }

  const chain = payload.chain ?? process.env.ETH_CHAIN ?? "eth";
  const batchSize = parseIntEnv("INGESTION_BATCH_SIZE", 1);
  const maxPages = parseIntEnv("INGESTION_MAX_PAGES", 8);
  const maxBlockSpan = parseIntEnv("INGESTION_MAX_BLOCK_SPAN", 50_000);
  const skipRecentMs = parseIntEnv("INGESTION_SKIP_RECENT_MS", 10 * 60 * 1000);

  const where = {
    chain,
    ...(payload.address
      ? { address: payload.address.toLowerCase() }
      : undefined),
  };

  const wallets = await prisma.wallet.findMany({
    where,
    orderBy: payload.address
      ? undefined
      : [
          { lastSyncedAt: "asc" },
          { createdAt: "asc" },
        ],
    take: payload.address ? 1 : batchSize,
  });

  if (wallets.length === 0) {
    return NextResponse.json({
      status: "ok",
      processed: 0,
      remaining: 0,
      message: "no_wallets_matched",
      results: { successes: [], failures: [] },
      done: true,
    });
  }

  const totalCount = payload.address
    ? wallets.length
    : await prisma.wallet.count({ where });

  const successes: Array<SyncWalletResult & { durationMs: number }> = [];
  const failures: Array<{
    walletId: string;
    address: string;
    error: string;
    durationMs: number;
  }> = [];

  for (const wallet of wallets) {
    const logger = createConsoleLogger(`[api/ingest ${wallet.address}]`);
    const start = Date.now();
    try {
      const result = await syncWalletTransfers(wallet, logger, {
        maxPages,
        maxBlockSpan,
        skipIfSyncedWithinMs: skipRecentMs,
      });
      successes.push({
        ...result,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          walletId: wallet.id,
        },
        "Failed to ingest wallet via API",
      );
      failures.push({
        walletId: wallet.id,
        address: wallet.address,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
    }
  }

  const processed = successes.length;
  const remaining =
    payload.address || totalCount <= processed
      ? Math.max(
          successes.some((item) => item.hasMore) ? 1 : 0,
          failures.length > 0 ? 1 : 0,
        )
      : Math.max(totalCount - processed, 0);
  const done =
    payload.address != null
      ? failures.length === 0 &&
        successes.length > 0 &&
        !successes.some((item) => item.hasMore)
      : remaining === 0;

  if (failures.length > 0) {
    return NextResponse.json(
      {
        status: "error",
        processed,
        remaining,
        done,
        results: {
          successes,
          failures,
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "ok",
    processed,
    remaining,
    done,
    results: {
      successes,
      failures,
    },
  });
}
