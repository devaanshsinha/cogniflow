import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      { status: "error", message: "database_unreachable" },
      { status: 500 }
    );
  }
}
