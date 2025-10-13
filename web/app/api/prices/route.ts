import { NextResponse } from "next/server";
import { authorizeJobRequest } from "@/lib/jobAuth";
import { updatePrices } from "../../../../shared/jobs/updatePrices";
import { createConsoleLogger } from "../../../../shared/logger";

export const runtime = "nodejs";

type PricesRequestBody = {
  chain?: string;
  tokens?: unknown;
  batchSize?: number;
};

export async function POST(request: Request) {
  const auth = authorizeJobRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  let payload: PricesRequestBody = {};
  try {
    payload = (await request.json()) as PricesRequestBody;
  } catch {
    // Empty payloads fall back to defaults.
  }

  let tokens: string[] | undefined;
  if (Array.isArray(payload.tokens)) {
    const stringTokens = payload.tokens.filter(
      (value): value is string => typeof value === "string",
    );
    if (stringTokens.length !== payload.tokens.length) {
      return NextResponse.json(
        { status: "error", message: "invalid_tokens" },
        { status: 400 },
      );
    }
    tokens = stringTokens;
  } else if (payload.tokens != null) {
    return NextResponse.json(
      { status: "error", message: "invalid_tokens" },
      { status: 400 },
    );
  }

  try {
    const logger = createConsoleLogger("[api/prices]");
    const result = await updatePrices({
      chain: payload.chain,
      batchSize: payload.batchSize,
      tokens,
      logger,
    });
    return NextResponse.json({
      status: "ok",
      ...result,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unexpected_error";
    console.error("Price job failed", error);
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}
