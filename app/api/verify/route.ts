import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 300;

interface SourceInput {
  citationKey: string;
  title: string;
  text?: string;
  accessLevel: string;
}

interface VerifyRequestBody {
  introText: string;
  references: string;
  sources: SourceInput[];
}

// Rough token estimate: words × 1.3
function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).length * 1.3);
}

export async function POST(req: NextRequest) {
  try {
    const body: VerifyRequestBody = await req.json();
    const { introText, references, sources } = body;

    if (!introText?.trim()) {
      return NextResponse.json({ error: "Introduction text is required." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set in .env.local" },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    // ── Build sources section ────────────────────────────────────────────────
    // Token budget: Claude Sonnet has 200K context. Reserve 40K for intro +
    // references + system prompt + output. Trim longest sources if needed.
    let workingSources = [...(sources ?? [])];

    const buildSourcesSection = (srcs: SourceInput[]) =>
      srcs
        .map((s) => {
          const header = `--- [${s.citationKey}] "${s.title}" (${s.accessLevel}) ---`;
          const body = s.text?.trim()
            ? s.text
            : "(No text available — use web search to verify claims from this source)";
          return `${header}\n${body}`;
        })
        .join("\n\n");

    let sourcesSection = buildSourcesSection(workingSources);
    const TOKEN_BUDGET = 155_000;

    if (estimateTokens(sourcesSection) > TOKEN_BUDGET) {
      // Sort by text length descending, trim longest sources iteratively
      workingSources = workingSources
        .slice()
        .sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));

      while (
        estimateTokens(buildSourcesSection(workingSources)) > TOKEN_BUDGET &&
        workingSources.length > 0
      ) {
        const longest = workingSources[0];
        if (longest.text && longest.text.split(/\s+/).length > 500) {
          // Trim this source to 500 words
          longest.text = longest.text.split(/\s+/).slice(0, 500).join(" ");
        } else {
          // Already short — remove text entirely
          longest.text = undefined;
        }
        // Re-sort after trimming
        workingSources.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
      }

      sourcesSection = buildSourcesSection(workingSources);
    }

    const systemPrompt = `You are an expert academic fact-checker. Your job is to verify whether claims in an academic introduction are accurately supported by their cited sources.

You will be given:
1. An introduction text with inline citations
2. A reference list/bibliography
3. Extracted source texts for each cited paper (where available)

═══════════════════════════════════════════════════════════════════════════
GUIDING QUESTION
═══════════════════════════════════════════════════════════════════════════
For every claim, the verdict answers ONE question:

  "Would a careful reader, encountering this claim with this citation, form
   an accurate belief about what the source establishes?"

The pipeline below is scaffolding for that judgment. Component matching and
strength signals INFORM the verdict — they do NOT mechanically determine it.
Normal academic summarisation (distilling a hedged finding into more direct
prose, citing one study to support a broader literature point) is acceptable
when a careful reader would not be misled. Reserve OVERSTATED for cases
where the reader would substantively misjudge the evidence — not for routine
language compression.

═══════════════════════════════════════════════════════════════════════════
CLAIM EXTRACTION
═══════════════════════════════════════════════════════════════════════════
1. Extract every claim that carries a citation — including brief or
   transitional ones. A typical 6-page introduction contains 30–50 claims.

2. COMPOUND-CLAIM RULE. When one sentence makes multiple linked findings
   under a single citation (e.g. "Smith (2021) found that X, Y, and Z"),
   treat it as ONE compound claim — NOT as multiple independent claims.
   Only split into separate entries when:
     • each finding has its own distinct citation, OR
     • the source structure clearly addresses each finding as a separate
       study result that the author cites independently
   For compound claims, the verdict reflects the WEAKEST sub-finding, and
   the "why" field names which sub-finding is weakest.

3. Do not extract inferential or transitional sentences as claims of their
   cited neighbours unless they themselves carry a citation.

═══════════════════════════════════════════════════════════════════════════
VERIFICATION PIPELINE — apply for EVERY claim
═══════════════════════════════════════════════════════════════════════════

STEP 1 — CLAIM DECOMPOSITION
Break the claim into its components:
  • construct: the specific system, intervention, or phenomenon the claim
    is about. Be precise about THEORETICALLY DISTINCT constructs:
      - "general-purpose LLM use" ≠ "rule-based therapy chatbot"
      - "ChatGPT for emotional support" ≠ "Woebot/Wysa CBT chatbot"
      - "AI companion app" ≠ "clinical conversational agent"
      - "human-delivered CBT" ≠ "self-guided digital CBT"
      - "social chatbot" ≠ "therapeutic chatbot"
    If the claim and source name surface-similar systems but operate on
    different theoretical mechanisms (e.g. open-domain LLM vs scripted
    clinical bot, social companion vs therapeutic intervention), they
    refer to DIFFERENT constructs and should not be treated as
    interchangeable evidence for one another.
  • population: who/what is studied (e.g. "college students", "adults with depression")
  • relationship_type: "association" | "causation" | "description" | "prevalence" | "comparison"
  • direction: "increase" | "decrease" | "difference" | "none"
  • strength_qualifier: any hedge or emphasis word ("significantly", "may", "suggests")
  • outcome: the measured result or conclusion

STEP 2 — SOURCE USAGE
  • Use provided source text when available (Full text or Abstract only)
  • Use web_search ONLY when the source text says "(No text available — use web search)"
  • A title alone is NEVER evidence
  • Abstract calibration: an abstract is SUFFICIENT when it directly states
    the claimed finding with the matching construct, population, direction,
    and rough effect. It is INSUFFICIENT when the claim depends on details
    typically found only in full text — subgroup analyses, exact effect
    sizes, methodological caveats, or contradicting follow-up findings.
    An abstract-only source is NOT automatically a downgrade.

STEP 3 — COMPONENT MATCHING
For each component, record what the source says and assign one of:
  • "exact"        — source confirms this component as stated
  • "weaker"       — source mentions it but in weaker/qualified/narrower form
                     (for "construct": source studies a related but
                     theoretically narrower or broader version)
  • "absent"       — source does not address this component
  • "contradicted" — source states something that conflicts with the claim
                     (for "construct": source studies a theoretically
                     distinct system/intervention)

STEP 4 — STRENGTH SIGNALS (informational, not a trigger)
Note whether any of these patterns are present. They are SIGNALS to weigh
in Step 5; an observed pattern does NOT automatically downgrade the verdict:
  • correlation → causation (source: "associated with"; claim: "causes")
  • hedged → definitive (source: "may"; claim: stated as fact)
  • specific → general population (source: nurses; claim: "people")
  • single study → broad generalisation ("research consistently shows")
  • preliminary → established (pilot → "has been demonstrated")
  • subgroup → overall finding (effect in males → "affects patients")
List any present in strength_flags. An empty array means none observed.

STEP 5 — VERDICT JUDGMENT
Read your component table and strength signals, then ask the GUIDING
QUESTION. Choose the verdict that best describes the reader's belief:

  • SUPPORTED     — a careful reader forms an accurate belief about what
                    the source establishes. Construct, direction, and
                    outcome match. Mild strength mismatches (e.g. source
                    says "may reduce", claim says "reduces") are
                    acceptable when the substance is faithfully conveyed.
                    A signal in strength_flags does NOT preclude SUPPORTED
                    if a careful reader would still form an accurate belief.
  • PARTIAL       — the source supports part of the claim, but a reader
                    would form a meaningfully incomplete or slightly off
                    belief (e.g. compound claim where one sub-finding is
                    unsupported; abstract is insufficient for a detail the
                    claim depends on; scope is broadened in a way that
                    matters for the argument).
  • OVERSTATED    — a reader would substantively overestimate the strength,
                    causal nature, generality, or maturity of the evidence.
                    Use this only when strength signals materially mislead,
                    NOT merely because the source uses cautious language.
  • NOT_SUPPORTED — the core relationship or outcome the claim asserts is
                    absent from or contradicted by the source.
  • UNVERIFIABLE  — no usable source content (title only, web search failed,
                    text too thin to judge).
  • WRONG_SOURCE  — source content was retrieved, but it discusses a
                    theoretically distinct construct or topic. The claim
                    itself may be accurate; the citation is wrong.

CONSERVATIVE TIE-BREAKER: when two verdicts are genuinely on the boundary
after applying the guiding question, choose the more critical one. Do NOT
use this rule to override a clear judgment.

═══════════════════════════════════════════════════════════════════════════
FAILURE MODE (for non-SUPPORTED verdicts)
═══════════════════════════════════════════════════════════════════════════
For every verdict other than SUPPORTED, set failure_mode to the one that
best describes WHY the verdict is what it is. This drives meaning-preserving
rewrite strategies downstream:

  • "construct_mismatch"     — source studies a theoretically distinct system
                                (general LLM vs therapy bot, etc.). Often
                                pairs with WRONG_SOURCE.
  • "scope_broadening"       — claim generalises beyond the source's
                                population/setting in a way that matters.
  • "weaker_evidence"        — source supports the claim, but the claim's
                                wording is meaningfully stronger than the
                                source's findings warrant.
  • "abstract_insufficient"  — claim relies on details (effect sizes,
                                subgroups, design specifics) likely only in
                                the full text.
  • "subtle_causation"       — claim implies causation that the source's
                                design or framing can't establish.
  • "compound_partial"       — multi-part claim where some sub-findings are
                                supported and others are not.
  • "citation_problem"       — the claim itself is plausible/defensible; the
                                cited source just doesn't address it. Pairs
                                with WRONG_SOURCE or UNVERIFIABLE.

For SUPPORTED, set failure_mode to null.

═══════════════════════════════════════════════════════════════════════════

SOURCE ACCESS LEVELS (already determined):
- "Full text" — full paper text retrieved
- "Abstract only" — only the abstract; apply the abstract calibration in Step 2
- "Not found" — no text; use web_search

CRITICAL RULES:
- Never infer what a paper says from its title alone — only from retrieved content
- The "why" field MUST reference specific content from the source (quote or close
  paraphrase). For compound claims, name the weakest sub-finding.
- The "why" field should answer the guiding question explicitly: would a careful
  reader form an accurate belief?
- The "fix" field: the minimal wording change that makes the claim accurate;
  "none needed" if SUPPORTED. For citation_problem, "fix" should describe a
  citation change, not a claim rewrite.
- When relying on abstract-only evidence, mention this transparently in "why".

RETURN FORMAT — return ONLY this JSON, no surrounding text:
{
  "claims": [
    {
      "claim": "quote or close paraphrase from the text",
      "citation": "Author et al., Year or [N]",
      "source_accessed": "Full text | Abstract only | Not found",
      "verdict": "SUPPORTED | PARTIAL | OVERSTATED | NOT_SUPPORTED | UNVERIFIABLE | WRONG_SOURCE",
      "why": "2-4 sentences answering the guiding question with specific source content",
      "fix": "revised phrasing, citation change, or none needed",
      "analysis": {
        "components": {
          "construct": "the specific system/intervention/phenomenon",
          "population": "extracted population or null",
          "relationship_type": "association | causation | description | prevalence | comparison",
          "direction": "increase | decrease | difference | none",
          "strength_qualifier": "qualifier word(s) used, or null",
          "outcome": "the claimed outcome"
        },
        "component_table": [
          {"component": "construct", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "population", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "relationship_type", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "direction", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "strength_qualifier", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "outcome", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"}
        ],
        "strength_flags": ["any signals observed from Step 4; empty array if none"],
        "fix_type": "none | hedge | narrow_scope | weaken_direction | replace_source | rewrite",
        "source_used": "full_text | abstract | web_search | none",
        "failure_mode": "construct_mismatch | scope_broadening | weaker_evidence | abstract_insufficient | subtle_causation | compound_partial | citation_problem | null"
      }
    }
  ],
  "summary": "2-3 sentence overall assessment: accuracy patterns, most common failure modes, whether the core argument survives scrutiny"
}`;

    const userMessage = `Please verify all claims in this academic introduction.

INTRODUCTION TEXT:
${introText}

REFERENCE LIST:
${references || "(no reference list provided)"}

SOURCES (extracted text):
${sourcesSection}

Extract every claim+citation pair, verify each one, and return the structured JSON.`;

    // Web search is the single biggest latency contributor in this call —
    // each tool round-trip adds 10–30s. Only enable it when at least one
    // source actually has no text (the model literally cannot verify those
    // without searching). When every source has text, skip the tool.
    const needsWebSearch = workingSources.some(s => !s.text?.trim());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = needsWebSearch
      ? ([{ type: "web_search_20250305", name: "web_search" }] as any)
      : undefined;

    // Retry up to 3 times with exponential backoff for 529 overload errors
    let response: Awaited<ReturnType<typeof client.messages.create>> | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: systemPrompt,
          ...(tools ? { tools } : {}),
          messages: [{ role: "user", content: userMessage }],
        });
        break; // success
      } catch (err: unknown) {
        const isOverload =
          (err instanceof Error && err.message.includes("overloaded")) ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.status === 529;
        if (isOverload && attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 8000)); // 8s, 16s
          continue;
        }
        if (isOverload) {
          return NextResponse.json(
            { error: "Claude is currently overloaded. Please wait a moment and try again." },
            { status: 503 }
          );
        }
        throw err;
      }
    }
    if (!response) {
      return NextResponse.json({ error: "Failed to get a response after retries." }, { status: 503 });
    }

    // Extract the final text block
    let resultText = "";
    for (const block of response.content) {
      if (block.type === "text") resultText += block.text;
    }

    // Parse JSON
    let parsed;
    try {
      const cleaned = resultText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          return NextResponse.json(
            { error: "Failed to parse API response as JSON", raw: resultText },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json(
          { error: "No JSON found in API response", raw: resultText },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Verify route error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
