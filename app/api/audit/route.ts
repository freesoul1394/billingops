import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import prisma from "@/db";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "100");

  const where: Record<string, unknown> = {};
  if (accountId) {
    const account = await prisma.onboardedAccount.findUnique({ where: { accountId } });
    if (account) where.onboardedAccountId = account.id;
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { ts: "desc" },
    take: limit,
  });

  return NextResponse.json(logs);
}
