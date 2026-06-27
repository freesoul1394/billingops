import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ensureMyCurExport, checkCurHealth, recreateCurExport } from "@/services/cur-provisioning";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const result = await checkCurHealth(accountId, "system");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { accountId, action } = body;

  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    if (action === "recreate") {
      const result = await recreateCurExport(accountId, body.operator ?? "system");
      return NextResponse.json(result);
    }
    const result = await ensureMyCurExport(accountId, body.operator ?? "system");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
