import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listRelationships, syncRelationships } from "@/services/relationships";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const sourceAccountId = request.nextUrl.searchParams.get("sourceAccountId") ?? undefined;

  try {
    const relationships = await listRelationships(accountId, { status, sourceAccountId });
    return NextResponse.json(relationships);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { accountId } = body;
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const result = await syncRelationships(accountId, body.operator ?? "system");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
