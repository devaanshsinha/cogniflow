import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getQueryEmbedding } from "@/lib/embeddings";

const querySchema = z.object({
  q: z.string().min(3),
  address: z
    .string()
    .regex(/^0x[a-f0-9]{40}$/i)
    .transform((value) => value.toLowerCase())
    .optional(),
  chain: z.enum(["eth"]).default("eth"),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
});

function embeddingToSql(embedding: number[]) {
  return Prisma.sql`ARRAY[${Prisma.join(
    embedding.map((value) => Prisma.sql`${value}`),
  )}]::vector`;
}

async function buildPriceMap(
  chain: string,
  tokens: string[],
): Promise<Map<string, { usd: Prisma.Decimal; timestamp: Date | null }>> {
  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) {
    return new Map();
  }

  const rows = await prisma.priceSnapshot.findMany({
    where: {
      chain,
      token: { in: unique },
    },
    orderBy: { timestamp: "desc" },
  });

  const map = new Map<
    string,
    { usd: Prisma.Decimal; timestamp: Date | null }
  >();
  for (const row of rows) {
    const key = row.token.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { usd: row.usd, timestamp: row.timestamp ?? null });
    }
  }

  return map;
}

function computeUsd(
  token: string,
  amount: Prisma.Decimal,
  priceMap: Map<string, { usd: Prisma.Decimal; timestamp: Date | null }>,
) {
  const priceInfo = priceMap.get(token.toLowerCase());
  if (!priceInfo) return null;
  const usdValue = priceInfo.usd.mul(amount);
  return usdValue.toString();
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
      { status: 400 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        status: "error",
        message: "OPENAI_API_KEY is not configured",
      },
      { status: 503 },
    );
  }

  try {
    const limit = Math.min(Math.max(parsed.data.limit ?? 10, 1), 25);
    const fetchLimit = Math.min(limit * 5, 200);
    const embedding = await getQueryEmbedding(parsed.data.q);
    const vectorSql = embeddingToSql(embedding);

    const queryLower = parsed.data.q.toLowerCase();
    const wantsLarge = /\b(biggest|largest|large|high|huge|massive|million|billions|big|heavy|volume|value|usd)\b/.test(
      queryLower,
    );

    type RawRow = {
      id: string;
      score: number;
      timestamp: Date;
      tx_hash: string;
      from_addr: string;
      to_addr: string;
      amount_dec: Prisma.Decimal;
      symbol: string | null;
      chain: string;
      token: string;
      meta: Prisma.JsonValue | null;
    };

    let rows: RawRow[] | null = null;

    if (parsed.data.address) {
      rows = await prisma.$queryRaw<
        Array<{
          id: string;
          score: number;
          timestamp: Date;
          tx_hash: string;
          from_addr: string;
          to_addr: string;
          amount_dec: Prisma.Decimal;
          symbol: string | null;
          chain: string;
          token: string;
          meta: Prisma.JsonValue | null;
        }>
      >`
        SELECT
          te.id,
          1 - (te.embedding <=> ${vectorSql}) AS score,
          t."timestamp",
          t."tx_hash",
          t."from_addr",
          t."to_addr",
          t."amount_dec",
          t."symbol",
          t."chain",
          t."token",
          te."meta"
        FROM "tx_embeddings" te
        JOIN "transfers" t ON t."id" = te."id"
        WHERE t."chain" = ${parsed.data.chain}
          AND (t."from_addr" = ${parsed.data.address} OR t."to_addr" = ${parsed.data.address})
        ORDER BY te.embedding <=> ${vectorSql}
        LIMIT ${fetchLimit}
      `;
    } else {
      rows = await prisma.$queryRaw<
        Array<{
          id: string;
          score: number;
          timestamp: Date;
          tx_hash: string;
          from_addr: string;
          to_addr: string;
          amount_dec: Prisma.Decimal;
          symbol: string | null;
          chain: string;
          token: string;
          meta: Prisma.JsonValue | null;
        }>
      >`
        SELECT
          te.id,
          1 - (te.embedding <=> ${vectorSql}) AS score,
          t."timestamp",
          t."tx_hash",
          t."from_addr",
          t."to_addr",
          t."amount_dec",
          t."symbol",
          t."chain",
          t."token",
          te."meta"
        FROM "tx_embeddings" te
        JOIN "transfers" t ON t."id" = te."id"
        WHERE t."chain" = ${parsed.data.chain}
        ORDER BY te.embedding <=> ${vectorSql}
        LIMIT ${fetchLimit}
      `;
    }

    const priceMap = await buildPriceMap(
      parsed.data.chain,
      rows.map((row) => row.token?.toLowerCase() ?? ""),
    );

    const wantsLatest = /\b(latest|recent|newest|today|past|recently|most\s+recent)\b/.test(
      queryLower,
    );
    const wantsOldest = /\b(oldest|earliest|first|beginning|historic)\b/.test(
      queryLower,
    );
    const wantsSmall = /\b(smallest|lowest|small|tiny|min(?:imum)?|least|cheap)\b/.test(
      queryLower,
    );
    const wantsIncoming = /\b(incoming|received|receive|deposits?|inflow|credit|from\s+others)\b/.test(
      queryLower,
    );
    const wantsOutgoing = /\b(outgoing|sent|send|spent|withdraw|outflow|debit|to\s+others|paid)\b/.test(
      queryLower,
    );

    const enriched = rows.map((row) => {
      const amount = Number(row.amount_dec.toString());
      const usdValueString = row.token
        ? computeUsd(row.token, row.amount_dec, priceMap)
        : null;
      const usdValue = usdValueString ? Number(usdValueString) : null;
      const priceInfo =
        row.token != null
          ? priceMap.get(row.token.toLowerCase()) ?? null
          : null;
      const direction =
        parsed.data.address != null
          ? row.to_addr === parsed.data.address
            ? "incoming"
            : row.from_addr === parsed.data.address
              ? "outgoing"
              : "external"
          : "external";
      return {
        row,
        amount,
        usdValue,
        timestampMs: row.timestamp.getTime(),
        priceInfo,
        direction,
      };
    });

    let filtered = enriched;
    if (parsed.data.address) {
      if (wantsIncoming && !wantsOutgoing) {
        filtered = filtered.filter((entry) => entry.direction === "incoming");
      } else if (wantsOutgoing && !wantsIncoming) {
        filtered = filtered.filter((entry) => entry.direction === "outgoing");
      }
    }

    const dedupedMap = new Map<
      string,
      (typeof enriched)[number]
    >();
    const valueForEntry = (entry: (typeof enriched)[number]) => {
      const numeric = entry.usdValue != null ? Math.abs(entry.usdValue) : Math.abs(entry.amount);
      return Number.isFinite(numeric) ? numeric : 0;
    };
    for (const entry of filtered) {
      const key =
        parsed.data.address != null
          ? `${entry.row.tx_hash}-${entry.direction}-${entry.row.symbol ?? ""}`
          : `${entry.row.tx_hash}-${entry.row.symbol ?? ""}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, entry);
      } else {
        const existing = dedupedMap.get(key)!;
        const existingVal = valueForEntry(existing);
        const entryVal = valueForEntry(entry);
        if (
          entryVal > existingVal ||
          (entryVal === existingVal && entry.row.score > existing.row.score)
        ) {
          dedupedMap.set(key, entry);
        }
      }
    }

    let deduped = Array.from(dedupedMap.values());
    if (wantsLarge) {
      deduped = deduped.filter(
        (entry) => valueForEntry(entry) > 0,
      );
    }

    let sorted = deduped.slice();
    if (wantsLatest) {
      sorted.sort((a, b) => b.timestampMs - a.timestampMs || b.row.score - a.row.score);
    } else if (wantsOldest) {
      sorted.sort((a, b) => a.timestampMs - b.timestampMs || b.row.score - a.row.score);
    } else if (wantsLarge) {
      sorted.sort((a, b) => {
        const aVal = valueForEntry(a);
        const bVal = valueForEntry(b);
        if (bVal === aVal) {
          return b.row.score - a.row.score;
        }
        return bVal - aVal;
      });
    } else if (wantsSmall) {
      sorted.sort((a, b) => {
        const aVal = valueForEntry(a);
        const bVal = valueForEntry(b);
        if (aVal === bVal) {
          return b.row.score - a.row.score;
        }
        return aVal - bVal;
      });
    } else {
      sorted.sort((a, b) => b.row.score - a.row.score || b.timestampMs - a.timestampMs);
    }

    sorted = sorted.slice(0, limit);

    const data = sorted.map(({ row, usdValue, priceInfo }) => ({
      id: row.id,
      score: row.score,
      timestamp: row.timestamp.toISOString(),
      txHash: row.tx_hash,
      from: row.from_addr,
      to: row.to_addr,
      amount: row.amount_dec.toString(),
      symbol: row.symbol,
      chain: row.chain,
      meta: row.meta,
      amountUsd: usdValue != null ? usdValue.toString() : null,
      priceUsd: priceInfo?.usd?.toString() ?? null,
      priceTimestamp: priceInfo?.timestamp
        ? priceInfo.timestamp.toISOString()
        : null,
    }));

    return NextResponse.json({
      status: "ok",
      data,
    });
  } catch (error) {
    console.error("search endpoint failed", error);
    return NextResponse.json(
      {
        status: "error",
        message: "internal_error",
      },
      { status: 500 },
    );
  }
}
