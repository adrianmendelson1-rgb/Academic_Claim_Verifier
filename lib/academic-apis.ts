import { extractText } from "unpdf";

// ── Helpers ───────────────────────────────────────────────────────────────────

export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function truncate(text: string, maxWords = 2000): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

// ── PDF text extraction ───────────────────────────────────────────────────────

async function extractFromBuffer(buf: Uint8Array): Promise<{ text: string; wordCount: number }> {
  const { text } = await extractText(buf, { mergePages: true });
  const wc = wordCount(text);
  return { text, wordCount: wc };
}

/**
 * Download a PDF from a URL and extract its text.
 * Throws if the download fails, times out, or unpdf cannot extract text.
 */
export async function fetchAndExtractText(
  url: string
): Promise<{ text: string; wordCount: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return extractFromBuffer(buf);
}

/**
 * Extract text from a base64-encoded PDF string.
 */
export async function extractTextFromBase64(
  base64: string
): Promise<{ text: string; wordCount: number }> {
  const buf = new Uint8Array(Buffer.from(base64, "base64"));
  return extractFromBuffer(buf);
}

/**
 * Extract text from a base64-encoded .docx string using mammoth.
 */
export async function extractDocxFromBase64(
  base64: string
): Promise<{ text: string; wordCount: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth");
  const buf = Buffer.from(base64, "base64");
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = result.value as string;
  const wc = wordCount(text);
  return { text, wordCount: wc };
}

// ── Semantic Scholar ──────────────────────────────────────────────────────────

interface S2Result {
  pdfUrl?: string;
  doi?: string;
  abstract?: string;
  arxivId?: string;
  foundTitle?: string;
}

export async function searchSemanticScholar(
  title: string,
  authors: string[],
  year?: number,
  apiKey?: string
): Promise<S2Result> {
  const query = [title, authors[0], year].filter(Boolean).join(" ");
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/search` +
    `?query=${encodeURIComponent(query)}` +
    `&fields=title,authors,year,openAccessPdf,externalIds,abstract&limit=1`;

  const headers: Record<string, string> = {
    "User-Agent": "AcademicClaimVerifier/1.0",
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const tryFetch = async (): Promise<Response> => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (r.status === 429) {
      await delay(1000);
      return fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    }
    return r;
  };

  try {
    const res = await tryFetch();
    if (!res.ok) return {};
    const json = await res.json();
    const hit = json?.data?.[0];
    if (!hit) return {};

    return {
      pdfUrl: hit.openAccessPdf?.url,
      doi: hit.externalIds?.DOI,
      abstract: hit.abstract ?? undefined,
      arxivId: hit.externalIds?.ArXiv,
      foundTitle: hit.title,
    };
  } catch {
    return {};
  }
}

// ── Unpaywall ─────────────────────────────────────────────────────────────────

export async function lookupUnpaywall(
  doi: string,
  email: string
): Promise<{ pdfUrl?: string }> {
  try {
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return {};
    const json = await res.json();
    const pdfUrl: string | undefined = json?.best_oa_location?.url_for_pdf;
    if (pdfUrl && pdfUrl.toLowerCase().includes(".pdf")) return { pdfUrl };
    // Sometimes url_for_pdf is null but url works
    const fallback: string | undefined = json?.best_oa_location?.url;
    return { pdfUrl: fallback };
  } catch {
    return {};
  }
}

// ── CORE ──────────────────────────────────────────────────────────────────────

export async function searchCORE(
  title: string,
  apiKey: string
): Promise<{ pdfUrl?: string }> {
  try {
    const url =
      `https://api.core.ac.uk/v3/search/works` +
      `?q=${encodeURIComponent(title)}&limit=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return {};
    const json = await res.json();
    const pdfUrl: string | undefined = json?.results?.[0]?.downloadUrl;
    return { pdfUrl };
  } catch {
    return {};
  }
}

// ── Re-export truncate for use in routes ──────────────────────────────────────
export { truncate, wordCount };
