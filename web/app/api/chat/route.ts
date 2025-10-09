import { NextResponse } from "next/server";
import { z } from "zod";
import { listNamedQueries } from "@/lib/tools/sqlQueries";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  address: z
    .string()
    .regex(/^0x[a-f0-9]{40}$/i, "Address must be a 0x-prefixed hex string.")
    .transform((value) => value.toLowerCase())
    .optional(),
  chain: z.enum(["eth"]).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = requestSchema.parse(json);

    const placeholderPlan = {
      steps: [
        {
          description:
            "LLM analyzes the request and selects the appropriate named query.",
        },
        {
          description:
            "Server validates parameters against allowlisted schemas and executes the tool.",
        },
        {
          description:
            "LLM formats the final answer with tables/charts and cites data sources.",
        },
      ],
    };

    return NextResponse.json({
      status: "ok",
      data: {
        answer:
          "Chat orchestration is not live yet. Use the named tool endpoints directly while the deterministic planner is being finalized.",
        tables: [],
        chart: null,
        sources: [],
        debug: {
          receivedMessages: parsed.messages.length,
          availableQueries: listNamedQueries(),
          plan: placeholderPlan,
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
