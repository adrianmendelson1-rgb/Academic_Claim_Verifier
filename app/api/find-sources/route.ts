import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  delay,
  searchSemanticScholar,
  lookupUnpaywall,
  searchCORE,
  fetchAndExtractText,
  truncate,
} from "@/lib/academic-apis";
import { loadLibraryIndex, getLibraryPdfSignedUrl, type LibraryEntry } from "@/lib/supabase";
import type { ParsedCitation, FoundSource, MissingSource, FindSourcesResult } from "@/lib/types";

export const maxDuration = 120;

const MIN_WORDS = 50;
const MAX_WORDS = 2000;

// ── Phase A: Extract citations via Claude Haiku ───────────────────────────────

async function extractCitations(
  introText: string,
  references: string,
  apiKey: string
): Promise<{ citations: ParsedCitation[]; parseError?: string }> {
  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a citation parser. Your only job is to output a JSON array of citations.

INSTRUCTIONS:
1. Find every inline citation in the INTRODUCTION TEXT (e.g. "Smith et al., 2021", "(Jones, 2019)", "[1]", "[3,4]")
2. For each unique citation, look it up in the REFERENCE LIST to get the full title, authors, year, and DOI
3. Output ONLY a raw JSON array — no markdown fences, no explanation, no text before or after

OUTPUT FORMAT (JSON array, nothing else):
[{"citationKey":"Smith et al., 2021","title":"Full title from reference list","authors":["Smith"],"year":2021,"doi":"10.xxxx/yyyy"}]

Rules:
- One entry per unique citation
- If a citation key appears multiple times in the text, include it once
- Omit fields you cannot determine (e.g. no doi field if unknown)
- If the reference list uses numbers, match [1] → first reference, [2] → second, etc.`;

  const userMessage = `INTRODUCTION TEXT:\n${introText}\n\nREFERENCE LIST:\n${references || "(none provided)"}`;

  let response: Awaited<ReturnType<typeof client.messages.create>> | null = null;
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
      break;
    } catch (err: unknown) {
      const isOverload =
        (err instanceof Error && err.message.includes("overloaded")) ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.status === 529;
      if (isOverload && attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 6000));
        continue;
      }
      throw isOverload
        ? new Error("Claude is currently overloaded. Please wait a moment and try again.")
        : err;
    }
  }
  if (!response) throw new Error("Failed to get a response after retries.");

  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  console.log("[find-sources] Raw citation extraction response:", raw.slice(0, 500));

  // Strip markdown fences if present
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return { citations: parsed };
    // Wrapped in an object?
    const vals = Object.values(parsed);
    const arr = vals.find(Array.isArray);
    if (arr) return { citations: arr as ParsedCitation[] };
  } catch { /* fall through */ }

  // Try to find a JSON array anywhere in the response
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return { citations: parsed };
    } catch { /* fall through */ }
  }

  console.error("[find-sources] Could not parse citations from response:", raw);
  return { citations: [], parseError: `Citation extraction failed to return valid JSON. Raw response: ${raw.slice(0, 300)}` };
}

// ── Library matching helpers ──────────────────────────────────────────────────

/** Normalise a title for fuzzy comparison: lowercase, strip punctuation, collapse spaces. */
function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Returns the library entry that best matches the given citation, or undefined
 * if no confident match is found.
 *
 * Match criteria (both must pass):
 *   1. Title: normalised strings share ≥70% of their shorter length as a
 *      leading prefix, OR one fully contains the other.
 *   2. Year: if both are present they may differ by at most 1 (advance-online).
 */
function matchLibraryEntry(
  citation: ParsedCitation,
  library: LibraryEntry[]
): LibraryEntry | undefined {
  if (!citation.title || library.length === 0) return undefined;

  const needle = normTitle(citation.title);

  return library.find((entry) => {
    if (!entry.title) return false;
    const hay = normTitle(entry.title);

    // Year guard (soft: allow ±1 for advance-online publications)
    if (
      citation.year && entry.year &&
      Math.abs(citation.year - entry.year) > 1
    ) return false;

    // Exact match after normalisation
    if (needle === hay) return true;

    // Containment check (handles truncated or subtitle-less titles)
    if (hay.includes(needle) || needle.includes(hay)) return true;

    // Prefix overlap: the shorter title's first 70% must appear in the other
    const shorter = needle.length <= hay.length ? needle : hay;
    const longer  = needle.length <= hay.length ? hay    : needle;
    const prefixLen = Math.floor(shorter.length * 0.70);
    if (prefixLen >= 20 && longer.includes(shorter.slice(0, prefixLen))) return true;

    return false;
  });
}

// ── Phase B: Resolve one citation to a FoundSource or MissingSource ──────────

async function resolveCitation(
  citation: ParsedCitation,
  library: LibraryEntry[],
  s2ApiKey?: string,
  unpaywallEmail?: string,
  coreApiKey?: string
): Promise<{ found?: FoundSource; missing?: MissingSource }> {
  const { citationKey, title, authors = [], year, doi: knownDoi } = citation;

  // No title → can't search any API
  if (!title) {
    return {
      missing: {
        citationKey,
        year,
        reason: "Title not found in reference list — please upload manually",
        kind: "not_found",
      },
    };
  }

  // ── 0. Private Supabase library (papers/ folder) ──────────────────────────
  const libraryMatch = matchLibraryEntry(citation, library);
  if (libraryMatch) {
    const signedUrl = await getLibraryPdfSignedUrl(libraryMatch.folder);
    if (signedUrl) {
      const result = await tryExtract(signedUrl);
      if (result) {
        console.log(`[find-sources] library hit: ${libraryMatch.folder}`);
        return {
          found: {
            citationKey,
            title: libraryMatch.title ?? title,
            year: libraryMatch.year ?? year,
            accessLevel: "Full text",
            text: result,
            url: `supabase://papers/${libraryMatch.folder}/paper.pdf`,
            source: "uploaded" as const,
          },
        };
      }
    }
    // If signed-URL or extraction failed, fall through to web sources
    console.warn(`[find-sources] library match for "${libraryMatch.folder}" but PDF extraction failed — falling through`);
  }

  // ── 1. Semantic Scholar ────────────────────────────────────────────────────
  const s2 = await searchSemanticScholar(title, authors, year, s2ApiKey);
  const doi = knownDoi ?? s2.doi;

  // Try S2 open-access PDF
  if (s2.pdfUrl) {
    const result = await tryExtract(s2.pdfUrl);
    if (result) {
      return {
        found: {
          citationKey,
          title: s2.foundTitle ?? title,
          year,
          accessLevel: "Full text",
          text: result,
          url: s2.pdfUrl,
          source: "semantic_scholar",
        },
      };
    }
  }

  // Try arXiv PDF
  if (s2.arxivId) {
    const arxivUrl = `https://arxiv.org/pdf/${s2.arxivId}.pdf`;
    const result = await tryExtract(arxivUrl);
    if (result) {
      return {
        found: {
          citationKey,
          title: s2.foundTitle ?? title,
          year,
          accessLevel: "Full text",
          text: result,
          url: arxivUrl,
          source: "arxiv",
        },
      };
    }
  }

  // ── 2. Unpaywall (needs DOI + email) ──────────────────────────────────────
  if (doi && unpaywallEmail) {
    const { pdfUrl } = await lookupUnpaywall(doi, unpaywallEmail);
    if (pdfUrl) {
      const result = await tryExtract(pdfUrl);
      if (result) {
        return {
          found: {
            citationKey,
            title: s2.foundTitle ?? title,
            year,
            accessLevel: "Full text",
            text: result,
            url: pdfUrl,
            source: "unpaywall",
          },
        };
      }
    }
  }

  // ── 3. CORE ────────────────────────────────────────────────────────────────
  if (coreApiKey) {
    const { pdfUrl } = await searchCORE(title, coreApiKey);
    if (pdfUrl) {
      const result = await tryExtract(pdfUrl);
      if (result) {
        return {
          found: {
            citationKey,
            title: s2.foundTitle ?? title,
            year,
            accessLevel: "Full text",
            text: result,
            url: pdfUrl,
            source: "core",
          },
        };
      }
    }
  }

  // ── 4. Abstract only (from Semantic Scholar) ──────────────────────────────
  if (s2.abstract) {
    return {
      missing: {
        citationKey,
        title: s2.foundTitle ?? title,
        year,
        reason: "No open-access full text found — only abstract available",
        kind: "abstract_only",
        abstract: s2.abstract,
      },
    };
  }

  // ── 5. Nothing found ──────────────────────────────────────────────────────
  return {
    missing: {
      citationKey,
      title: s2.foundTitle ?? title,
      year,
      reason: s2.foundTitle
        ? "Paper found on Semantic Scholar but no open-access PDF available"
        : "Paper not found in any open-access database",
      kind: "not_found",
    },
  };
}

/** Try to fetch and extract text; return truncated text or null on failure. */
async function tryExtract(url: string): Promise<string | null> {
  try {
    const { text, wordCount } = await fetchAndExtractText(url);
    if (wordCount < MIN_WORDS) return null;
    return truncate(text, MAX_WORDS);
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { introText, references } = await req.json();

    if (!introText?.trim()) {
      return NextResponse.json({ error: "introText is required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
    }

    const s2ApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY || undefined;
    const unpaywallEmail = process.env.UNPAYWALL_EMAIL || undefined;
    const coreApiKey = process.env.CORE_API_KEY || undefined;

    // Phase A: extract citations
    const { citations, parseError } = await extractCitations(introText, references ?? "", apiKey);

    if (parseError) {
      return NextResponse.json({ error: parseError }, { status: 500 });
    }

    if (citations.length === 0) {
      return NextResponse.json<FindSourcesResult>({ found: [], missing: [] });
    }

    // Load the private library index once — shared across all citation lookups.
    // Gracefully returns [] if Supabase is unconfigured or the folder is empty.
    const library = await loadLibraryIndex();
    if (library.length > 0) {
      console.log(`[find-sources] library loaded: ${library.length} entries (${library.map(e => e.folder).join(", ")})`);
    }

    // Phase B: resolve in parallel with stagger
    const results = await Promise.all(
      citations.map(async (citation, i) => {
        await delay(i * 60); // 60ms stagger
        return resolveCitation(citation, library, s2ApiKey, unpaywallEmail, coreApiKey);
      })
    );

    const found: FoundSource[] = results.flatMap((r) => (r.found ? [r.found] : []));
    const missing: MissingSource[] = results.flatMap((r) => (r.missing ? [r.missing] : []));

    return NextResponse.json<FindSourcesResult>({ found, missing });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("find-sources error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
