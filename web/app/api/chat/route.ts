import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  executeNamedQuery,
  listNamedQueries,
  type NamedQueryName,
} from "@/lib/tools/sqlQueries";
import prisma from "@/lib/prisma";
import { getQueryEmbedding } from "@/lib/embeddings";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  address: z
    .string()
    .regex(/^0x[a-f0-9]{40}$/i, "Address must be a 0x-prefixed hex string.")
    .transform((value) => value.toLowerCase()),
  chain: z.enum(["eth"]).default("eth"),
});

type ToolCall =
  | {
      kind: "topCounterparties";
      params: {
        address: string;
        chain: "eth";
        start: string;
        end: string;
        limit: number;
      };
    }
  | {
      kind: "netFlowSummary";
      params: {
        address: string;
        chain: "eth";
        start: string;
        end: string;
      };
    }
  | {
      kind: "semanticSearch";
      query: string;
      limit: number;
    };

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = requestSchema.parse(json);
    const userMessage = [...parsed.messages]
      .reverse()
      .find((message) => message.role === "user");

    if (!userMessage) {
      return NextResponse.json(
        {
          status: "error",
          message: "A user message is required for orchestration.",
        },
        { status: 400 },
      );
    }

    const window = inferWindow(userMessage.content);
    const toolCall = inferToolCall(userMessage.content, parsed, window);

    if (!toolCall) {
      return NextResponse.json({
        status: "ok",
        data: {
          answer:
            "I’m not sure which insight you need. Try asking for “Top counterparties last 7 days” or “Net flow last week”.",
          tables: [],
          chart: null,
          sources: [],
          debug: {
            availableQueries: listNamedQueries(),
            interpretedWindow: window,
            matchedIntent: null,
          },
        },
      });
    }

    let responsePayload:
      | ReturnType<typeof buildResponse>
      | ReturnType<typeof buildSearchResponse>;
    let matchedIntent: string = toolCall.kind;

    if (toolCall.kind === "semanticSearch") {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({
          status: "error",
          message:
            "Semantic search requires OPENAI_API_KEY. Configure it before using this capability.",
        });
      }
      const results = await runSemanticSearch({
        query: toolCall.query,
        limit: toolCall.limit,
        address: parsed.address,
        chain: parsed.chain,
      });
      responsePayload = buildSearchResponse(results, toolCall.query);
      matchedIntent = "semanticSearch";
    } else {
      const namedRequest = {
        name: toolCall.kind as NamedQueryName,
        params: toolCall.params,
      };
      const result = await executeNamedQuery(namedRequest);
      responsePayload = buildResponse(toolCall.kind, result, window);
    }

    return NextResponse.json({
      status: "ok",
      data: {
        ...responsePayload,
        debug: {
          availableQueries: listNamedQueries(),
          interpretedWindow: window,
          matchedIntent,
          ...(toolCall.kind === "semanticSearch"
            ? { searchQuery: toolCall.query }
            : {}),
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          status: "error",
          message: "Invalid request payload",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error ? error.message : "Unexpected server error",
      },
      { status: 500 },
    );
  }
}

type TimeWindow = {
  start: string;
  end: string;
  label: string;
  days: number;
};

function inferWindow(content: string): TimeWindow {
  const now = new Date();
  const lower = content.toLowerCase();
  const match = lower.match(/last\s+(\d+)\s+(day|days|week|weeks)/);
  if (match) {
    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    const days = unit.startsWith("week") ? value * 7 : value;
    const start = new Date(now);
    start.setUTCDate(now.getUTCDate() - days);
    return {
      start: start.toISOString(),
      end: now.toISOString(),
      label: `last ${value} ${unit}`,
      days,
    };
  }

  const matchMonth = lower.match(/last\s+(month|30\s+days)/);
  if (matchMonth) {
    const start = new Date(now);
    start.setUTCDate(now.getUTCDate() - 30);
    return {
      start: start.toISOString(),
      end: now.toISOString(),
      label: "last 30 days",
      days: 30,
    };
  }

  const defaultStart = new Date(now);
  defaultStart.setUTCDate(now.getUTCDate() - 7);
  return {
    start: defaultStart.toISOString(),
    end: now.toISOString(),
    label: "last 7 days",
    days: 7,
  };
}

function inferToolCall(
  content: string,
  parsed: z.infer<typeof requestSchema>,
  window: TimeWindow,
): ToolCall | null {
  const lower = content.toLowerCase();
  if (lower.includes("counterpart")) {
    const limitMatch = lower.match(/top\s+(\d{1,2})/);
    const limit =
      limitMatch != null
        ? Math.min(Math.max(Number.parseInt(limitMatch[1], 10), 1), 25)
        : 5;
    return {
      kind: "topCounterparties",
      params: {
        address: parsed.address,
        chain: parsed.chain,
        start: window.start,
        end: window.end,
        limit,
      },
    };
  }

  if (
    lower.includes("net flow") ||
    lower.includes("netflow") ||
    lower.includes("net position") ||
    (lower.includes("incoming") && lower.includes("outgoing")) ||
    lower.includes("gas spent")
  ) {
    return {
      kind: "netFlowSummary",
      params: {
        address: parsed.address,
        chain: parsed.chain,
        start: window.start,
        end: window.end,
      },
    };
  }

  if (
    lower.includes("search") ||
    lower.includes("find") ||
    lower.includes("look up") ||
    lower.includes("lookup") ||
    lower.includes("discover") ||
    lower.includes("similar") ||
    lower.includes("transactions")
  ) {
    const limitMatch = lower.match(/top\s+(\d{1,2})|first\s+(\d{1,2})/);
    const limit = limitMatch
      ? Math.min(Math.max(Number.parseInt(limitMatch[1] ?? limitMatch[2], 10), 1), 15)
      : 10;
    return {
      kind: "semanticSearch",
      query: content.trim(),
      limit,
    };
  }

  return null;
}

type SemanticSearchResult = {
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
};

async function runSemanticSearch(options: {
  query: string;
  limit: number;
  address: string;
  chain: "eth";
}): Promise<SemanticSearchResult[]> {
  const embedding = await getQueryEmbedding(options.query);
  const vectorSql = embeddingToSql(embedding);
  const addressCondition = Prisma.sql`
    AND (t."from_addr" = ${options.address} OR t."to_addr" = ${options.address})
  `;

  const rows = await prisma.$queryRaw<SemanticSearchResult[]>(
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
      WHERE t."chain" = ${options.chain}
        ${options.address ? addressCondition : Prisma.empty}
      ORDER BY te.embedding <=> ${vectorSql}
      LIMIT ${options.limit}
    `,
  );

  return rows;
}

function embeddingToSql(embedding: number[]) {
  return Prisma.sql`ARRAY[${Prisma.join(
    embedding.map((value) => Prisma.sql`${value}`),
  )}]::vector`;
}

function buildResponse(
  kind: ToolCall["kind"],
  result: unknown,
  window: TimeWindow,
) {
  if (kind === "topCounterparties") {
    const rows = Array.isArray(result)
      ? result.filter(isTopCounterpartyRow)
      : [];
    const table = rows.map((row, index) => ({
      rank: index + 1,
      counterparty: row.counterparty,
      incoming: row.incomingVolume,
      outgoing: row.outgoingVolume,
      net: row.totalVolume,
      transfers: row.transferCount,
    }));
    const topLine = table
      .slice(0, 3)
      .map(
        (row) =>
          `${row.rank}. ${row.counterparty.slice(0, 10)}… (${row.incoming} in, ${row.outgoing} out)`,
      )
      .join("; ");
    const answer =
      table.length > 0
        ? `Top counterparties ${window.label}: ${topLine}.`
        : `No counterparties found ${window.label}.`;

    return {
      answer,
      tables: [
        {
          title: `Top counterparties (${window.label})`,
          columns: ["Rank", "Counterparty", "Incoming", "Outgoing", "Net", "Transfers"],
          rows: table.map((row) => [
            row.rank,
            row.counterparty,
            row.incoming,
            row.outgoing,
            row.net,
            row.transfers,
          ]),
        },
      ],
      chart: null,
      sources: ["transfers"],
    };
  }

  if (kind === "netFlowSummary") {
    const summary = isNetFlowSummary(result)
      ? result
      : {
          incomingVolume: "0",
          outgoingVolume: "0",
          netVolume: "0",
          incomingCount: 0,
          outgoingCount: 0,
        };
    const answer = `Net flow ${window.label}: received ${summary.incomingVolume}, sent ${summary.outgoingVolume}, net ${summary.netVolume}.`;
    return {
      answer,
      tables: [
        {
          title: `Net flow (${window.label})`,
          columns: ["Direction", "Volume", "Transfers"],
          rows: [
            ["Incoming", summary.incomingVolume, summary.incomingCount],
            ["Outgoing", summary.outgoingVolume, summary.outgoingCount],
            ["Net", summary.netVolume, summary.incomingCount + summary.outgoingCount],
          ],
        },
      ],
      chart: null,
      sources: ["transfers"],
    };
  }

  return {
    answer: "Request completed.",
    tables: [],
    chart: null,
    sources: [],
  };
}

function buildSearchResponse(results: SemanticSearchResult[], query: string) {
  if (results.length === 0) {
    return {
      answer: `No similar transfers found for “${query}”. Try refining the query or widening the time range.`,
      tables: [],
      chart: null,
      sources: ["tx_embeddings"],
    } as const;
  }

  const tableRows = results.map((row) => [
    new Date(row.timestamp).toLocaleString(),
    `${row.from_addr.slice(0, 10)}…`,
    `${row.to_addr.slice(0, 10)}…`,
    row.amount_dec.toString(),
    row.symbol ?? "—",
    row.score.toFixed(3),
    `${row.tx_hash.slice(0, 12)}…`,
  ]);

  const top = results[0];
  const answer = `Found ${results.length} similar transfers. Top match: ${
    top.symbol ?? "token"
  } transfer of ${top.amount_dec.toString()} at ${new Date(top.timestamp).toLocaleString()}.`;

  return {
    answer,
    tables: [
      {
        title: `Semantic matches for “${query}”`,
        columns: [
          "Timestamp",
          "From",
          "To",
          "Amount",
          "Symbol",
          "Similarity",
          "Tx",
        ],
        rows: tableRows,
      },
    ],
    chart: null,
    sources: ["tx_embeddings", "transfers"],
  } as const;
}

type TopCounterpartyRow = {
  counterparty: string;
  incomingVolume: string;
  outgoingVolume: string;
  totalVolume: string;
  transferCount: number;
};

function isTopCounterpartyRow(value: unknown): value is TopCounterpartyRow {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.counterparty === "string" &&
    typeof candidate.incomingVolume === "string" &&
    typeof candidate.outgoingVolume === "string" &&
    typeof candidate.totalVolume === "string" &&
    typeof candidate.transferCount === "number"
  );
}

type NetFlowSummaryRow = {
  incomingVolume: string;
  outgoingVolume: string;
  netVolume: string;
  incomingCount: number;
  outgoingCount: number;
};

function isNetFlowSummary(value: unknown): value is NetFlowSummaryRow {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.incomingVolume === "string" &&
    typeof candidate.outgoingVolume === "string" &&
    typeof candidate.netVolume === "string" &&
    typeof candidate.incomingCount === "number" &&
    typeof candidate.outgoingCount === "number"
  );
}
