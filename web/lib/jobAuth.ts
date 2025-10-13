import { NextResponse } from "next/server";

const EXPECTED_SECRET = process.env.INGESTION_SECRET?.trim();

export function authorizeJobRequest(request: Request):
  | { ok: true }
  | { ok: false; response: ReturnType<typeof NextResponse.json> } {
  if (!EXPECTED_SECRET) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          status: "error",
          message: "server_not_configured",
        },
        { status: 500 },
      ),
    };
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${EXPECTED_SECRET}`) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          status: "error",
          message: "unauthorized",
        },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}
