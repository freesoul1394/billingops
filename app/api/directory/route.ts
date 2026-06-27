import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  searchDirectory,
  getNeedsMappingQueue,
  upsertDirectoryEntry,
} from "@/services/attribution";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q");
  const needsMapping = request.nextUrl.searchParams.get("needsMapping");

  try {
    if (needsMapping === "true") {
      const entries = await getNeedsMappingQueue();
      return NextResponse.json(entries);
    }
    if (query) {
      const entries = await searchDirectory(query);
      return NextResponse.json(entries);
    }
    // Default: return needs-mapping queue
    const entries = await getNeedsMappingQueue();
    return NextResponse.json(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entry = await upsertDirectoryEntry(body);
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
