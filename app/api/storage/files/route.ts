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

    // List immediate children of papers/ (subfolders have id === null)
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("papers", { limit: 1000 });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return NextResponse.json([]);

    // Only folders (id === null are virtual folders in Supabase Storage)
    const folders = data.filter((item) => item.id === null);

    const results: StoredFileMeta[] = [];
    for (const folder of folders) {
      const metaPath = `papers/${folder.name}/meta.json`;
      const { data: raw, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(metaPath);
      if (dlErr || !raw) continue;
      try {
        const parsed: StoredFileMeta = JSON.parse(await raw.text());
        // Only return files belonging to this session
        if (parsed.sessionId === sessionId) {
          results.push(parsed);
        }
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
