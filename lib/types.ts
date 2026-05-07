export type Verdict = "SUPPORTED" | "PARTIAL" | "OVERSTATED" | "NOT_SUPPORTED" | "UNVERIFIABLE" | "WRONG_SOURCE";

/** Per-component match result used in the analysis breakdown.
 *  For the `construct` component, "exact" = same construct, "weaker" = related
 *  but theoretically narrower/broader, "absent" = source doesn't address this
 *  construct, "contradicted" = source studies a theoretically distinct construct. */
export interface ComponentMatch {
  component: string;          // e.g. "construct", "population", "direction", "strength qualifier"
  claim_value: string;        // what the claim states
  source_value: string;       // what the source actually says (or "not mentioned")
  match: "exact" | "weaker" | "absent" | "contradicted";
}

/** A specific failure mode — surfaced when the verdict is anything other than
 *  SUPPORTED, to let the rewrite system pick a meaning-preserving strategy
 *  rather than blindly applying verdict-driven hedging. */
export type FailureMode =
  | "construct_mismatch"        // source studies a theoretically different system/intervention
  | "scope_broadening"          // claim generalizes beyond what the source's population/setting supports
  | "weaker_evidence"           // source supports the claim but is more cautious than the claim's wording
  | "abstract_insufficient"     // claim relies on details typically only in full text
  | "subtle_causation"          // claim implies causation that the source's design can't establish
  | "compound_partial"          // multi-part claim is partly supported, partly not
  | "citation_problem"          // the claim itself is fine; the cited source is the wrong one
  | null;

/** Structured reasoning that powers the verdict — lives alongside the
 *  existing UI-facing fields so the frontend can progressively adopt it. */
export interface ClaimAnalysis {
  /** Decomposed claim components (Step 1) */
  components: {
    /** The specific system, intervention, or phenomenon the claim is about
     *  (e.g. "general-purpose LLM use for emotional support",
     *  "rule-based therapy chatbot", "human-delivered CBT"). */
    construct?: string;
    population?: string;
    relationship_type?: string;   // "association" | "causation" | "description" | etc.
    direction?: string;           // "increase" | "decrease" | "difference" | "none"
    strength_qualifier?: string;  // "significantly" | "strongly" | "suggests" | etc.
    outcome?: string;
  };
  /** Per-component matching table (Step 3) — includes a `construct` row */
  component_table: ComponentMatch[];
  /** Strength-calibration signals (Step 4) — empty array if none observed.
   *  These INFORM the verdict; they no longer auto-downgrade it. */
  strength_flags: string[];
  /** What category of fix is needed */
  fix_type: "none" | "hedge" | "narrow_scope" | "weaken_direction" | "replace_source" | "rewrite";
  /** Which source material the verdict was based on */
  source_used: "full_text" | "abstract" | "web_search" | "none";
  /** Lightweight diagnostic that disambiguates non-SUPPORTED verdicts and
   *  drives meaning-preserving rewrite strategies. Null when SUPPORTED. */
  failure_mode?: FailureMode;
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

// ── Evidence extraction types ───────────────────────────────────────────────

export interface EvidenceQuote {
  text: string;
  context?: string;
  section?: string;
  relevance: "direct" | "partial" | "tangential";
}

export interface EvidenceResult {
  quotes: EvidenceQuote[];
  summary: string;
  confidence: "high" | "medium" | "low";
}

// ── Per-claim source search result ──────────────────────────────────────────

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
