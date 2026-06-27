import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildAttributionJoin } from "@/services/attribution";
import prisma from "@/db";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  const year = request.nextUrl.searchParams.get("year");
  const month = request.nextUrl.searchParams.get("month");

  if (!accountId || !year || !month) {
    return NextResponse.json(
      { error: "accountId, year, and month are required" },
      { status: 400 },
    );
  }

  try {
    const account = await prisma.onboardedAccount.findUnique({
      where: { accountId },
    });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const result = await buildAttributionJoin(account.id, parseInt(year), parseInt(month));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
