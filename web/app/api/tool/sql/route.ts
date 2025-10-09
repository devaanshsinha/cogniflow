import {
  executeNamedQuery,
  listNamedQueries,
  type NamedQueryName,
} from "@/lib/tools/sqlQueries";
import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  name: z.string(),
  params: z.record(z.unknown()).default({}),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = requestSchema.parse(json);
    if (!listNamedQueries().includes(parsed.name)) {
      return NextResponse.json(
        {
          status: "error",
          message: `Unknown query name: ${parsed.name}`,
        },
        { status: 400 },
      );
    }
    const payload = {
      name: parsed.name as NamedQueryName,
      params: parsed.params,
    } as Parameters<typeof executeNamedQuery>[0];
    const data = await executeNamedQuery(payload);
    return NextResponse.json({ status: "ok", data });
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

export async function GET() {
  return NextResponse.json({
    status: "ok",
    data: { queries: listNamedQueries() },
  });
}
