import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";
import { syncWalletTransfers } from "../../../../shared/ingestion/syncWalletTransfers";
import { createConsoleLogger } from "../../../../shared/logger";

export const runtime = "nodejs";

const requestSchema = z.object({
  address: z.string(),
  chain: z.string().optional(),
  ingest: z.boolean().optional(),
});

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function resolveChain(requested?: string | null): string {
  const source = requested ?? process.env.ETH_CHAIN ?? "eth";
  return source.trim().toLowerCase();
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient({ mutateCookies: true });
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return NextResponse.json(
      { status: "error", message: sessionError.message },
      { status: 500 },
    );
  }

  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { status: "error", message: "unauthorized" },
      { status: 401 },
    );
  }

  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json(
      { status: "error", message: "missing_email" },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "error",
        message: "invalid_request",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const chain = resolveChain(parsed.data.chain);
  const address = normalizeAddress(parsed.data.address);

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return NextResponse.json(
      {
        status: "error",
        message: "invalid_address",
      },
      { status: 400 },
    );
  }

  try {
    await prisma.user.upsert({
      where: { id: userId },
      update: { email },
      create: { id: userId, email },
    });

    const wallet = await prisma.wallet.upsert({
      where: {
        userId_chain_address: {
          userId,
          chain,
          address,
        },
      },
      update: {},
      create: {
        userId,
        chain,
        address,
      },
    });

    let ingested = false;
    let ingestionError: string | undefined;

    if (parsed.data.ingest !== false) {
      try {
        const logger = createConsoleLogger(`[api/wallets ${address}]`);
        await syncWalletTransfers(wallet, logger, {
          maxPages: Number(process.env.UI_SYNC_MAX_PAGES ?? "2"),
          lookbackBlocks: Number(process.env.UI_SYNC_LOOKBACK_BLOCKS ?? "1500"),
          skipIfSyncedWithinMs: Number(
            process.env.UI_SYNC_MIN_INTERVAL_MS ?? `${5 * 60 * 1000}`,
          ),
        });
        ingested = true;
      } catch (error) {
        ingestionError =
          error instanceof Error ? error.message : "unknown_ingestion_error";
      }
    }

    return NextResponse.json({
      status: ingestionError ? "partial" : "ok",
      walletId: wallet.id,
      chain,
      address,
      ingested,
      ...(ingestionError ? { ingestionError } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "wallet_upsert_failed";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}
