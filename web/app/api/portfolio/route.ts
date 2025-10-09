import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";

const querySchema = z.object({
  address: z.string().min(1, "address is required"),
  chain: z.string().default("eth"),
  days: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
});

const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 7;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "error",
        message: "invalid_query_params",
        issues: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const normalizedAddress = parsed.data.address.toLowerCase();
  const chain = parsed.data.chain;
  const windowDays = Math.min(
    Math.max(parsed.data.days ?? DEFAULT_WINDOW_DAYS, 1),
    MAX_WINDOW_DAYS
  );
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  try {
    const [
      incomingGroups,
      outgoingGroups,
      incomingCount,
      outgoingCount,
      counterpartiesResult,
      wallet,
    ] =
      await Promise.all([
        prisma.transfer.groupBy({
          by: ["token", "symbol", "decimals"],
          where: {
            chain,
            timestamp: { gte: windowStart },
            toAddr: normalizedAddress,
          },
          _sum: { amountDec: true },
          orderBy: { token: "asc" },
        }),
        prisma.transfer.groupBy({
          by: ["token", "symbol", "decimals"],
          where: {
            chain,
            timestamp: { gte: windowStart },
            fromAddr: normalizedAddress,
          },
          _sum: { amountDec: true },
          orderBy: { token: "asc" },
        }),
        prisma.transfer.count({
          where: {
            chain,
            timestamp: { gte: windowStart },
            toAddr: normalizedAddress,
          },
        }),
        prisma.transfer.count({
          where: {
            chain,
            timestamp: { gte: windowStart },
            fromAddr: normalizedAddress,
          },
        }),
        prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT "from_addr" AS counterparty
            FROM "transfers"
            WHERE "chain" = ${chain} AND "timestamp" >= ${windowStart} AND "to_addr" = ${normalizedAddress}
            UNION
            SELECT "to_addr" AS counterparty
            FROM "transfers"
            WHERE "chain" = ${chain} AND "timestamp" >= ${windowStart} AND "from_addr" = ${normalizedAddress}
          ) AS counterparties`,
        prisma.wallet.findFirst({
          where: { chain, address: normalizedAddress },
          select: {
            lastSyncedBlock: true,
            lastSyncedAt: true,
          },
        }),
      ]);

    const holdingsMap = new Map<
      string,
      {
        token: string;
        symbol: string | null;
        decimals: number | null;
        incoming: Prisma.Decimal;
        outgoing: Prisma.Decimal;
      }
    >();

    function ensureHolding(
      token: string,
      symbol: string | null,
      decimals: number | null
    ) {
      if (!holdingsMap.has(token)) {
        holdingsMap.set(token, {
          token,
          symbol,
          decimals,
          incoming: new Prisma.Decimal(0),
          outgoing: new Prisma.Decimal(0),
        });
      }
      return holdingsMap.get(token)!;
    }

    incomingGroups.forEach((group) => {
      const entry = ensureHolding(group.token, group.symbol ?? null, group.decimals ?? null);
      entry.incoming = entry.incoming.plus(group._sum.amountDec ?? 0);
    });

    outgoingGroups.forEach((group) => {
      const entry = ensureHolding(group.token, group.symbol ?? null, group.decimals ?? null);
      entry.outgoing = entry.outgoing.plus(group._sum.amountDec ?? 0);
    });

    const holdings = Array.from(holdingsMap.values())
      .map((entry) => {
        const net = entry.incoming.minus(entry.outgoing);
        return {
          token: entry.token,
          symbol: entry.symbol,
          decimals: entry.decimals,
          incoming: entry.incoming.toString(),
          outgoing: entry.outgoing.toString(),
          net: net.toString(),
        };
      })
      .sort((a, b) => Number(b.net) - Number(a.net));

    const counterpartiesCount =
      Number(counterpartiesResult[0]?.count ?? 0);

    return NextResponse.json({
      status: "ok",
      data: {
        address: normalizedAddress,
        chain,
        windowDays,
        totals: {
          transfers: incomingCount + outgoingCount,
          incomingTransfers: incomingCount,
          outgoingTransfers: outgoingCount,
          counterparties: counterpartiesCount,
        },
        holdings,
        sync: wallet
          ? {
              lastSyncedBlock: wallet.lastSyncedBlock ?? null,
              lastSyncedAt: wallet.lastSyncedAt
                ? wallet.lastSyncedAt.toISOString()
                : null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("portfolio endpoint failed", error);
    return NextResponse.json(
      {
        status: "error",
        message: "internal_error",
      },
      { status: 500 }
    );
  }
}
