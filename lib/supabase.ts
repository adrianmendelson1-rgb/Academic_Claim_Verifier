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
