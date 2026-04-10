export type Verdict = "SUPPORTED" | "PARTIAL" | "OVERSTATED" | "NOT_SUPPORTED" | "UNVERIFIABLE";

export interface Claim {
  claim: string;
  citation: string;
  source_accessed: string;
  verdict: Verdict;
  why: string;
  fix: string;
}

export interface VerificationResult {
  claims: Claim[];
  summary: string;
}

export interface UploadedPDF {
  name: string;
  size: number;
  base64: string;
}

// ── Source-finding types ──────────────────────────────────────────────────────

export interface ParsedCitation {
  citationKey: string;   // "Smith et al., 2021" or "[1]"
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
}

export interface FoundSource {
  citationKey: string;
  title: string;
  year?: number;
  /** "Full text" = downloaded & extracted ≥50 words; "Abstract only" = no PDF; "Not found" = nothing */
  accessLevel: "Full text" | "Abstract only" | "Not found";
  text?: string;
  url?: string;
  source?: "semantic_scholar" | "unpaywall" | "arxiv" | "core" | "uploaded";
}

export interface MissingSource {
  citationKey: string;
  title?: string;
  year?: number;
  /** Human-readable explanation of why the paper wasn't found */
  reason: string;
  /** "abstract_only" = we have the abstract but not full text; "not_found" = nothing at all */
  kind: "abstract_only" | "not_found";
  /** Abstract text, only present when kind === "abstract_only" */
  abstract?: string;
}

export interface FindSourcesResult {
  /** Papers where full text was successfully downloaded and extracted */
  found: FoundSource[];
  /** Papers needing manual upload: both "abstract only" and "not found" */
  missing: MissingSource[];
}
