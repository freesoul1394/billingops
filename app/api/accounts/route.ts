import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { onboardAccount, listAccounts } from "@/services/onboarding";

export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country") ?? undefined;
  const accounts = await listAccounts(country);
  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const account = await onboardAccount({
      ...body,
      createdBy: body.createdBy ?? "system", // TODO: extract from auth
    });
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
