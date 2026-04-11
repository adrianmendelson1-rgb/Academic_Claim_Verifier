import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase admin client using the service role key.
 * ONLY call this from server-side code (API routes).
 * Never expose SUPABASE_SERVICE_KEY to the browser.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env.local"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export const BUCKET = "uploads";

// ── Library (papers/) helpers ─────────────────────────────────────────────────

/** Metadata stored in papers/{folder}/meta.json */
export interface LibraryEntry {
  folder: string;       // e.g. "stade_2025"
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  abstract?: string;
  [key: string]: unknown; // allow extra fields
}

/**
 * Reads every papers/{folder}/meta.json in the bucket and returns the parsed
 * entries. Folders that lack a readable meta.json are silently skipped.
 * Returns [] if Supabase is not configured or the papers/ folder is empty.
 */
export async function loadLibraryIndex(): Promise<LibraryEntry[]> {
  try {
    const supabase = getSupabaseAdmin();

    // List immediate children of papers/  (subfolders have id === null)
    const { data: items, error } = await supabase.storage
      .from(BUCKET)
      .list("papers", { limit: 1000 });

    if (error || !items) return [];

    const folders = items.filter((item) => item.id === null);

    const entries = await Promise.all(
      folders.map(async (folder) => {
        const metaPath = `papers/${folder.name}/meta.json`;
        const { data: blob, error: dlErr } = await supabase.storage
          .from(BUCKET)
          .download(metaPath);
        if (dlErr || !blob) return null;
        try {
          const meta = JSON.parse(await blob.text());
          return { folder: folder.name, ...meta } as LibraryEntry;
        } catch {
          return null;
        }
      })
    );

    return entries.filter((e): e is LibraryEntry => e !== null);
  } catch {
    // Supabase not configured or any other error — degrade gracefully
    return [];
  }
}

/**
 * Returns a short-lived signed URL for papers/{folder}/paper.pdf so that
 * server-side PDF extraction can download it without exposing the bucket publicly.
 */
export async function getLibraryPdfSignedUrl(folder: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(`papers/${folder}/paper.pdf`, 120); // 2-minute TTL
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}
