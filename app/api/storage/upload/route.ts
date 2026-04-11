import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, BUCKET } from "@/lib/supabase";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Sanitise a citation key into a safe filename segment
function safeKey(citationKey: string): string {
  return citationKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

export interface StoredFileMeta {
  citationKey: string;
  title: string;
  year?: number;
  text: string;           // extracted text (up to ~2 000 words)
  pdfPath: string;        // uploads/{sessionId}/{safeKey}.pdf
  metaPath: string;       // uploads/{sessionId}/{safeKey}.meta.json
  uploadedAt: string;     // ISO timestamp
  fileSizeBytes: number;
}

export async function POST(req: NextRequest) {
  try {
    const { base64, citationKey, title, sessionId, text } =
      await req.json();
    const year: number | undefined = undefined; // reserved for future use

    if (!base64 || !citationKey || !sessionId) {
      return NextResponse.json(
        { error: "base64, citationKey, and sessionId are required" },
        { status: 400 }
      );
    }

    // Validate it's actually a PDF
    const header = Buffer.from(base64.slice(0, 8), "base64").toString("ascii");
    if (!header.startsWith("%PDF")) {
      return NextResponse.json(
        { error: "Only PDF files are accepted" },
        { status: 400 }
      );
    }

    const pdfBuffer = Buffer.from(base64, "base64");
    if (pdfBuffer.length > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File exceeds the 10 MB limit" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const sk = safeKey(citationKey);
    const pdfPath = `${sessionId}/${sk}.pdf`;
    const metaPath = `${sessionId}/${sk}.meta.json`;

    // Upload PDF (upsert so duplicate filenames just overwrite)
    const { error: pdfErr } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (pdfErr) throw new Error(`PDF upload failed: ${pdfErr.message}`);

    // Upload metadata JSON (includes extracted text for fast restoration)
    const meta: StoredFileMeta = {
      citationKey,
      title: title ?? citationKey,
      year,
      text: text ?? "",
      pdfPath,
      metaPath,
      uploadedAt: new Date().toISOString(),
      fileSizeBytes: pdfBuffer.length,
    };

    const { error: metaErr } = await supabase.storage
      .from(BUCKET)
      .upload(metaPath, JSON.stringify(meta), {
        contentType: "application/json",
        upsert: true,
      });
    if (metaErr) throw new Error(`Metadata upload failed: ${metaErr.message}`);

    return NextResponse.json(meta);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[storage/upload]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
