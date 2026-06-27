import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deactivateAccount } from "@/services/onboarding";

export async function POST(
  request: NextRequest,
  { params }: { params: { accountId: string } },
) {
  try {
    const result = await deactivateAccount(params.accountId, "system"); // TODO: extract from auth
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
