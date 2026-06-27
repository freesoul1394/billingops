import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getInvoicePdfUrl } from "@/services/invoices";

export async function GET(
  request: NextRequest,
  { params }: { params: { invoiceId: string } },
) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    const result = await getInvoicePdfUrl(accountId, params.invoiceId, "system");
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
