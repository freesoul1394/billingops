import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listInvoices, syncInvoices } from "@/services/invoices";

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
    const invoices = await listInvoices(accountId, parseInt(year), parseInt(month));
    return NextResponse.json(invoices);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { accountId, year, month } = body;

  if (!accountId || !year || !month) {
    return NextResponse.json(
      { error: "accountId, year, and month are required" },
      { status: 400 },
    );
  }

  try {
    const result = await syncInvoices(accountId, year, month, body.operator ?? "system");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
