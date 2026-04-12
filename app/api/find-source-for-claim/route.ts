import { NextRequest, NextResponse } from "next/server";
import {
  searchSemanticScholar,
  lookupUnpaywall,
  searchCORE,
  fetchAndExtractText,
  truncate,
} from "@/lib/academic-apis";

export const maxDuration = 60;

const MIN_WORDS = 50;
const MAX_WORDS = 2000;

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

export interface FindSourceForClaimResult {
  status: "found_full_text" | "found_abstract" | "not_found";
  title?: string;
  year?: number;
  url?: string;
  source?: string;
  text?: string;
  abstract?: string;
  message: string;
}

export async function POST(req: NextRequest) {
  try {
    const { claim, citation } = await req.json();

    if (!claim?.trim()) {
      return NextResponse.json({ error: "claim is required" }, { status: 400 });
    }

    const s2ApiKey = process.env.SEMANTIC_SCHOLAR_API_KEY || undefined;
    const unpaywallEmail = process.env.UNPAYWALL_EMAIL || undefined;
    const coreApiKey = process.env.CORE_API_KEY || undefined;

    // Use the citation as the search query — it typically contains author + year
    // Fall back to the claim text itself for topical search
    const searchQuery = citation && citation !== "No citation" ? citation : claim;

    // 1. Semantic Scholar
    const s2 = await searchSemanticScholar(searchQuery, [], undefined, s2ApiKey);

    // Try S2 open-access PDF
    if (s2.pdfUrl) {
      const text = await tryExtract(s2.pdfUrl);
      if (text) {
        return NextResponse.json<FindSourceForClaimResult>({
          status: "found_full_text",
          title: s2.foundTitle,
          url: s2.pdfUrl,
          source: "semantic_scholar",
          text,
          message: "Full text retrieved from Semantic Scholar.",
        });
      }
    }

    // Try arXiv
    if (s2.arxivId) {
      const arxivUrl = `https://arxiv.org/pdf/${s2.arxivId}.pdf`;
      const text = await tryExtract(arxivUrl);
      if (text) {
        return NextResponse.json<FindSourceForClaimResult>({
          status: "found_full_text",
          title: s2.foundTitle,
          url: arxivUrl,
          source: "arxiv",
          text,
          message: "Full text retrieved from arXiv.",
        });
      }
    }

    // 2. Unpaywall
    if (s2.doi && unpaywallEmail) {
      const { pdfUrl } = await lookupUnpaywall(s2.doi, unpaywallEmail);
      if (pdfUrl) {
        const text = await tryExtract(pdfUrl);
        if (text) {
          return NextResponse.json<FindSourceForClaimResult>({
            status: "found_full_text",
            title: s2.foundTitle,
            url: pdfUrl,
            source: "unpaywall",
            text,
            message: "Full text retrieved from Unpaywall.",
          });
        }
      }
    }

    // 3. CORE
    if (coreApiKey) {
      const { pdfUrl } = await searchCORE(searchQuery, coreApiKey);
      if (pdfUrl) {
        const text = await tryExtract(pdfUrl);
        if (text) {
          return NextResponse.json<FindSourceForClaimResult>({
            status: "found_full_text",
            title: s2.foundTitle,
            url: pdfUrl,
            source: "core",
            text,
            message: "Full text retrieved from CORE.",
          });
        }
      }
    }

    // 4. Abstract only
    if (s2.abstract) {
      return NextResponse.json<FindSourceForClaimResult>({
        status: "found_abstract",
        title: s2.foundTitle,
        abstract: s2.abstract,
        source: "semantic_scholar",
        message: "Only abstract available — full text not openly accessible. Upload the full paper for confident verification.",
      });
    }

    // 5. Nothing
    return NextResponse.json<FindSourceForClaimResult>({
      status: "not_found",
      title: s2.foundTitle,
      message: "No open-access source found. Try uploading the paper manually.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("find-source-for-claim error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
