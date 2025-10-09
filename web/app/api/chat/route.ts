import { NextResponse } from "next/server";
import { z } from "zod";
import {
  executeNamedQuery,
  listNamedQueries,
  type NamedQueryName,
} from "@/lib/tools/sqlQueries";

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

    const namedRequest = {
      name: toolCall.kind as NamedQueryName,
      params: toolCall.params,
    };

    const result = await executeNamedQuery(namedRequest);
    const responsePayload = buildResponse(toolCall.kind, result, window);

    return NextResponse.json({
      status: "ok",
      data: {
        ...responsePayload,
        debug: {
          availableQueries: listNamedQueries(),
          interpretedWindow: window,
          matchedIntent: toolCall.kind,
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

  return null;
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
