export type Verdict = "SUPPORTED" | "PARTIAL" | "OVERSTATED" | "NOT_SUPPORTED" | "UNVERIFIABLE" | "WRONG_SOURCE";

/** Per-component match result used in the analysis breakdown. */
export interface ComponentMatch {
  component: string;          // e.g. "population", "direction", "strength qualifier"
  claim_value: string;        // what the claim states
  source_value: string;       // what the source actually says (or "not mentioned")
  match: "exact" | "weaker" | "absent" | "contradicted";
}

/** Structured reasoning that powers the verdict — lives alongside the
 *  existing UI-facing fields so the frontend can progressively adopt it. */
export interface ClaimAnalysis {
  /** Decomposed claim components (Step 1) */
  components: {
    population?: string;
    relationship_type?: string;   // "association" | "causation" | "description" | etc.
    direction?: string;           // "increase" | "decrease" | "difference" | "none"
    strength_qualifier?: string;  // "significantly" | "strongly" | "suggests" | etc.
    outcome?: string;
  };
  /** Per-component matching table (Step 3) */
  component_table: ComponentMatch[];
  /** Strength-calibration flags (Step 4) — empty array if none triggered */
  strength_flags: string[];
  /** What category of fix is needed */
  fix_type: "none" | "hedge" | "narrow_scope" | "weaken_direction" | "replace_source" | "rewrite";
  /** Which source material the verdict was based on */
  source_used: "full_text" | "abstract" | "web_search" | "none";
}

export interface Claim {
  claim: string;
  citation: string;
  source_accessed: string;
  verdict: Verdict;
  why: string;
  fix: string;
  /** Structured analysis breakdown — present when the enhanced pipeline is used */
  analysis?: ClaimAnalysis;
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
