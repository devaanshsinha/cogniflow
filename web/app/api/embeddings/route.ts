import { NextResponse } from "next/server";
import { authorizeJobRequest } from "@/lib/jobAuth";
import { updateEmbeddings } from "../../../../shared/jobs/updateEmbeddings";
import { createConsoleLogger } from "../../../../shared/logger";

export const runtime = "nodejs";

type EmbeddingsRequestBody = {
  chain?: string;
  batchSize?: number;
  maxRecords?: number;
};

export async function POST(request: Request) {
  const auth = authorizeJobRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  let payload: EmbeddingsRequestBody = {};
  try {
    payload = (await request.json()) as EmbeddingsRequestBody;
  } catch {
    // Empty payloads use defaults.
  }

  try {
    const logger = createConsoleLogger("[api/embeddings]");
    const result = await updateEmbeddings({
      chain: payload.chain,
      batchSize: payload.batchSize,
      maxRecords: payload.maxRecords,
      logger,
    });
    return NextResponse.json({
      status: "ok",
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unexpected_error";
    console.error("Embedding job failed", error);
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}
