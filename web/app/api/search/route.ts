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
    const embedding = await getQueryEmbedding(parsed.data.q);
    const vectorSql = embeddingToSql(embedding);
    const addressCondition = parsed.data.address
      ? Prisma.sql`AND (t."from_addr" = ${parsed.data.address} OR t."to_addr" = ${parsed.data.address})`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<
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
        meta: Prisma.JsonValue | null;
      }>
    >(
      Prisma.sql`
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
          te."meta"
        FROM "tx_embeddings" te
        JOIN "transfers" t ON t."id" = te."id"
        WHERE t."chain" = ${parsed.data.chain}
          ${addressCondition}
        ORDER BY te.embedding <=> ${vectorSql}
        LIMIT ${limit}
      `,
    );
    const data = rows.map((row) => ({
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
