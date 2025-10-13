import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeJobRequest } from "@/lib/jobAuth";
import { syncWalletTransfers } from "../../../../shared/ingestion/syncWalletTransfers";
import { createConsoleLogger } from "../../../../shared/logger";

export const runtime = "nodejs";

type IngestRequestBody = {
  address?: string;
  chain?: string;
};

export async function POST(request: Request) {
  const auth = authorizeJobRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  let payload: IngestRequestBody = {};
  try {
    payload = (await request.json()) as IngestRequestBody;
  } catch {
    // Empty body is fine; defaults will apply.
  }

  const chain = payload.chain ?? process.env.ETH_CHAIN ?? "eth";

  const where = {
    chain,
    ...(payload.address
      ? { address: payload.address.toLowerCase() }
      : undefined),
  };

  const wallets = await prisma.wallet.findMany({ where });

  if (wallets.length === 0) {
    return NextResponse.json({
      status: "ok",
      processed: 0,
      message: "no_wallets_matched",
    });
  }

  const failures: Array<{ walletId: string; address: string; error: string }> =
    [];
  let processed = 0;

  for (const wallet of wallets) {
    const logger = createConsoleLogger(`[api/ingest ${wallet.address}]`);
    try {
      await syncWalletTransfers(wallet, logger);
      processed += 1;
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
      });
    }
  }

  if (failures.length > 0) {
    return NextResponse.json(
      {
        status: "error",
        processed,
        failures,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "ok",
    processed,
  });
}
