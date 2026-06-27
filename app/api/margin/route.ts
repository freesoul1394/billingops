import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getMargin, enumerateChargeTypes } from "@/services/margin";

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
    const results = await getMargin(accountId, parseInt(year), parseInt(month), "system");
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
