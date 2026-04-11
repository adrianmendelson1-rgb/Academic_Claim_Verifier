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

YOUR TASK:
1. Extract EVERY claim that has a citation — no matter how brief, transitional, or seemingly minor. Do not skip claims. A 6-page introduction typically contains 30–50 verifiable claims. Include them all.
2. Each citation in the text should generate at least one claim entry. If a single sentence makes multiple distinct claims citing the same paper, create a separate entry for each.
3. For each claim, apply the 5-step reasoning pipeline described below.
4. Return ONLY valid JSON — no markdown, no explanation outside the JSON.

═══════════════════════════════════════════════════════════════════════════
VERIFICATION PIPELINE — apply these 5 steps for EVERY claim
═══════════════════════════════════════════════════════════════════════════

STEP 1 — CLAIM DECOMPOSITION
Break the claim into its core components:
  • population: who/what is being studied (e.g. "college students", "adults with depression")
  • relationship_type: "association", "causation", "description", "prevalence", "comparison"
  • direction: "increase", "decrease", "difference", "none"
  • strength_qualifier: any hedge or emphasis word (e.g. "significantly", "strongly", "suggests", "may")
  • outcome: the measured result or conclusion

STEP 2 — SOURCE USAGE
  • Use the provided source text if available (accessLevel = "Full text" or "Abstract only")
  • Only use the web_search tool if the source says "(No text available — use web search)"
  • A paper title alone is NEVER valid evidence — you must have actual content
  • If using an abstract, note this explicitly: abstract evidence may not support claims requiring full-text data (e.g. specific effect sizes, subgroup analyses)

STEP 3 — COMPONENT MATCHING
For each component from Step 1, determine:
  • "exact"        — the source confirms this component as stated
  • "weaker"       — the source mentions this but in weaker/qualified form
  • "absent"       — the source does not address this component
  • "contradicted" — the source states something that conflicts with this component

Record what the source actually says for each component (quote or paraphrase).

STEP 4 — STRENGTH CALIBRATION
Check whether the claim is stronger than the evidence. Flag ANY of these patterns:
  • correlation → causation (source says "associated with", claim says "causes" or "leads to")
  • hedged → definitive (source says "may", "suggests"; claim states it as fact)
  • specific population → general population (source studied nurses; claim says "people")
  • single study → broad generalization (one RCT → "research consistently shows")
  • preliminary → established (pilot study → "has been demonstrated")
  • subgroup finding → overall finding (effect in males only → "affects patients")

STEP 5 — VERDICT ASSIGNMENT
Based on the component matching and strength calibration, assign exactly ONE verdict:
  • SUPPORTED     — ALL components match exactly, no exaggeration, no strength flags
  • PARTIAL       — some components supported, others missing or weaker; OR abstract-only evidence for a claim needing full text
  • OVERSTATED    — evidence exists but claim is stronger than source (any strength flag from Step 4 triggers this)
  • NOT_SUPPORTED — core components (relationship or outcome) are absent or contradicted
  • UNVERIFIABLE  — no usable source content (title only, web search failed, no text available)
  • WRONG_SOURCE  — the cited source is topically unrelated to the claim being made

CONSERVATIVE RULE: when in doubt between two adjacent verdicts, always choose the more critical one.

═══════════════════════════════════════════════════════════════════════════

SOURCE ACCESS LEVELS (already determined for you):
- "Full text" — you have the full paper text; high confidence possible
- "Abstract only" — only the abstract; flag if the claim requires full-text evidence
- "Not found" — no text; use web_search

CRITICAL RULES:
- Never infer what a paper says from its title alone — only from retrieved content
- The "why" field MUST reference specific content from the source (quote or close paraphrase), not general assumptions
- The "fix" field: the minimal wording change that makes the claim accurate; "none needed" if SUPPORTED or UNVERIFIABLE
- Every explanation must clearly justify WHY the verdict was chosen over adjacent verdicts

RETURN FORMAT — return ONLY this JSON, no surrounding text:
{
  "claims": [
    {
      "claim": "quote or close paraphrase from the text",
      "citation": "Author et al., Year or [N]",
      "source_accessed": "Full text | Abstract only | Not found",
      "verdict": "SUPPORTED | PARTIAL | OVERSTATED | NOT_SUPPORTED | UNVERIFIABLE | WRONG_SOURCE",
      "why": "2-4 sentences: (1) what the source actually says, (2) how it compares to the claim, (3) why this verdict and not an adjacent one",
      "fix": "revised phrasing or none needed",
      "analysis": {
        "components": {
          "population": "extracted population or null",
          "relationship_type": "association | causation | description | prevalence | comparison",
          "direction": "increase | decrease | difference | none",
          "strength_qualifier": "the qualifier word(s) used, or null",
          "outcome": "the claimed outcome"
        },
        "component_table": [
          {"component": "population", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "relationship_type", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "direction", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "strength_qualifier", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"},
          {"component": "outcome", "claim_value": "...", "source_value": "...", "match": "exact | weaker | absent | contradicted"}
        ],
        "strength_flags": ["list of triggered flags from Step 4, e.g. 'correlation → causation'; empty array if none"],
        "fix_type": "none | hedge | narrow_scope | weaken_direction | replace_source | rewrite",
        "source_used": "full_text | abstract | web_search | none"
      }
    }
  ],
  "summary": "2-3 sentence overall assessment: accuracy patterns, most common issues, whether the core argument survives scrutiny"
}`;

    const userMessage = `Please verify all claims in this academic introduction.

INTRODUCTION TEXT:
${introText}

REFERENCE LIST:
${references || "(no reference list provided)"}

SOURCES (extracted text):
${sourcesSection}

Extract every claim+citation pair, verify each one, and return the structured JSON.`;

    // Retry up to 3 times with exponential backoff for 529 overload errors
    let response: Awaited<ReturnType<typeof client.messages.create>> | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 16000,
          system: systemPrompt,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
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
