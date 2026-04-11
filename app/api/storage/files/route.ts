import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, BUCKET } from "@/lib/supabase";
import type { StoredFileMeta } from "../upload/route";

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId query parameter is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // List all objects under this session's folder
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(sessionId, { limit: 200 });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return NextResponse.json([]);

    // Read only the .meta.json files (the PDFs themselves are large)
    const metaFiles = data.filter((f) => f.name.endsWith(".meta.json"));

    const results: StoredFileMeta[] = [];
    for (const file of metaFiles) {
      const path = `${sessionId}/${file.name}`;
      const { data: raw, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(path);
      if (dlErr || !raw) continue;
      try {
        const text = await raw.text();
        const parsed: StoredFileMeta = JSON.parse(text);
        results.push(parsed);
      } catch {
        // skip corrupted meta
      }
    }

    // Sort newest first
    results.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    return NextResponse.json(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[storage/files]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
