import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";

const querySchema = z.object({
  address: z.string().min(1, "address is required"),
  chain: z.string().default("eth"),
  direction: z.enum(["incoming", "outgoing", "all"]).default("all"),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  cursor: z.string().optional(),
});

function buildWhereClause(address: string, direction: "incoming" | "outgoing" | "all", chain: string): Prisma.TransferWhereInput {
  const normalized = address.toLowerCase();
  const base: Prisma.TransferWhereInput = {
    chain,
  };

  if (direction === "incoming") {
    base.toAddr = normalized;
  } else if (direction === "outgoing") {
    base.fromAddr = normalized;
  } else {
    base.OR = [{ toAddr: normalized }, { fromAddr: normalized }];
  }

  return base;
}

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

  const { address, chain, direction, limit: limitMaybe, cursor } = parsed.data;
  const limit = Math.min(Math.max(limitMaybe ?? 50, 1), 100);
  const where = buildWhereClause(address, direction, chain);

  try {
    const items = await prisma.transfer.findMany({
      where,
      orderBy: [{ timestamp: "desc" }, { logIndex: "desc" }],
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      select: {
        id: true,
        timestamp: true,
        txHash: true,
        logIndex: true,
        token: true,
        fromAddr: true,
        toAddr: true,
        amountRaw: true,
        amountDec: true,
        symbol: true,
        decimals: true,
        chain: true,
        stale: true,
      },
    });

    const hasMore = items.length > limit;
    const data = items.slice(0, limit).map((row) => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      txHash: row.txHash,
      logIndex: row.logIndex,
      token: row.token,
      from: row.fromAddr,
      to: row.toAddr,
      amountRaw: row.amountRaw.toString(),
      amount: row.amountDec.toString(),
      symbol: row.symbol,
      decimals: row.decimals,
      chain: row.chain,
      stale: row.stale,
    }));
    const nextCursor = hasMore ? items[limit].id : null;

    return NextResponse.json({
      status: "ok",
      data,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error("transfers endpoint failed", error);
    return NextResponse.json(
      {
        status: "error",
        message: "internal_error",
      },
      { status: 500 }
    );
  }
}
