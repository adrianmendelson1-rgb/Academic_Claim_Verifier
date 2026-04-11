import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, BUCKET } from "@/lib/supabase";

export async function DELETE(req: NextRequest) {
  try {
    const { sessionId, citationKey } = await req.json();
    if (!sessionId || !citationKey) {
      return NextResponse.json(
        { error: "sessionId and citationKey are required" },
        { status: 400 }
      );
    }

    const safeKey = citationKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const supabase = getSupabaseAdmin();

    const paths = [
      `${sessionId}/${safeKey}.pdf`,
      `${sessionId}/${safeKey}.meta.json`,
    ];

    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, deleted: paths });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[storage/delete]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
