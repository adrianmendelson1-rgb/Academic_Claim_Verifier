import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { FailureMode } from "@/lib/types";

export const maxDuration = 60;

interface RewriteRequest {
  claim: string;
  citation: string;
  verdict: string;
  why: string;
  evidence?: string;
  userInstruction?: string;
  /** New: failure_mode from the verification analysis. Drives the strategy. */
  failureMode?: FailureMode;
}

/** Failure modes where the problem is the citation / source choice, not the
 *  claim's wording. Rewriting the sentence here would distort author meaning. */
const CITATION_FAILURES: FailureMode[] = ["citation_problem", "construct_mismatch"];

/** Per-failure-mode rewrite guidance. The rewrite system follows the failure
 *  mode rather than the verdict label, so meaning-preserving strategies win
 *  over generic verdict-driven hedging. */
function strategyFor(failureMode: FailureMode | undefined, verdict: string): string {
  switch (failureMode) {
    case "scope_broadening":
      return `The claim generalises beyond what the source actually shows. Prefer the MINIMAL narrowing that makes the claim accurate (add a population qualifier, a setting, or a single hedge) — do not rewrite the sentence's main idea. If narrowing would damage the author's argument, prefer a small qualifying phrase ("in available studies", "to date") over a full rewrite.`;

    case "weaker_evidence":
      return `The claim is meaningfully stronger than the source's findings. Make the SMALLEST possible adjustment to align the strength — typically swapping one verb or adding one hedge word ("suggests", "may", "is associated with"). Do not pile on multiple hedges; do not rewrite anything except the strength language. Preserve the construct, population, direction, and outcome exactly.`;

    case "subtle_causation":
      return `The claim implies causation that the source's design cannot establish. Replace the causal verb with an associational one ("is associated with", "correlates with", "predicts" instead of "causes", "leads to", "produces"). Do not change anything else.`;

    case "compound_partial":
      return `The claim is a multi-part statement where some sub-findings are supported and others are not. Rewrite ONLY the unsupported sub-clause, leaving the supported parts intact. If you cannot do this without rewriting the whole sentence, prefer to remove the unsupported sub-clause rather than reworking the supported portions.`;

    case "abstract_insufficient":
      return `The claim relies on details the abstract doesn't establish. Hedge ONLY the specific element the abstract can't support (e.g. add "in available evidence" or convert a specific effect description into a general one). Do not weaken parts that the abstract does support.`;

    default:
      // No specific failure mode — fall back to a verdict-aware default that
      // is still conservative about meaning.
      if (verdict === "OVERSTATED") {
        return `Soften the claim only as much as needed to match what the source actually says. Change at most one or two words. Do not narrow scope unnecessarily and do not stack hedges.`;
      }
      if (verdict === "PARTIAL") {
        return `Make the smallest adjustment that aligns the claim with the supported portion of the evidence. Preserve the author's voice and central point.`;
      }
      if (verdict === "NOT_SUPPORTED") {
        return `The cited source does not support this claim. Suggest the smallest revision that reflects what the evidence actually allows — but do NOT invert the claim or replace it with a different argument. If the source genuinely contradicts, prefer a hedged version of the original (e.g. "evidence on this is mixed") over a substitute claim.`;
      }
      return `Make the minimal change that improves accuracy while preserving the author's meaning and academic voice.`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: RewriteRequest = await req.json();
    const { claim, citation, verdict, why, evidence, userInstruction, failureMode } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

    // ── Citation-problem branch ───────────────────────────────────────────────
    // If the failure is fundamentally that the wrong source is cited, do not
    // produce a rewritten sentence. Tell the caller this is a citation issue
    // so the UI can show the find-source flow instead of forcing a textual
    // rewrite that would distort author meaning. The user's explicit
    // userInstruction overrides this (they may still want to draft text).
    if (
      !userInstruction?.trim() &&
      failureMode &&
      CITATION_FAILURES.includes(failureMode)
    ) {
      const message =
        failureMode === "construct_mismatch"
          ? "The cited source studies a theoretically distinct system or intervention. The claim itself may be defensible — the most appropriate fix is to cite a source that matches the construct, rather than rewording the sentence."
          : "The claim itself may be defensible; the cited source just doesn't address it. Look for a source that does, instead of rewording the sentence.";

      return NextResponse.json({
        rewritten: null,
        citationIssue: {
          message,
          suggestion:
            "Use 'Find new source' below to look for a paper that actually addresses the claim. If you find one, the rewrite tool can then generate a sentence anchored to that source.",
        },
      });
    }

    const client = new Anthropic({ apiKey });

    const hasEvidence = !!evidence && evidence.trim().length > 0;
    const hasInstruction = !!userInstruction && userInstruction.trim().length > 0;

    let prompt: string;

    if (hasInstruction) {
      // User instruction takes priority but stays evidence-aware.
      prompt = `An academic claim needs to be revised. The user has given a specific instruction.

ORIGINAL CLAIM: "${claim}"
CITATION: ${citation}
VERDICT: ${verdict}${failureMode ? `\nFAILURE MODE: ${failureMode}` : ""}
PROBLEM: ${why}
${hasEvidence ? `\nACTUAL EVIDENCE FROM SOURCE:\n${evidence.slice(0, 3000)}` : ""}

USER INSTRUCTION: "${userInstruction}"

Apply the user's instruction to rewrite the claim. Stay grounded in what the evidence actually says.
${hasEvidence ? "Align the rewrite with the actual evidence provided above." : "Be conservative — hedge claims when evidence is uncertain."}

Rules:
- Follow the user's instruction as closely as possible
- Preserve the author's academic voice and style
- Do not add information not supported by the evidence
- Output only the rewritten text — no preamble, no explanation, no quotation marks`;
    } else {
      const guidance = strategyFor(failureMode, verdict);

      prompt = `An academic claim has been flagged. Suggest a minimal, meaning-preserving revision.

ORIGINAL CLAIM: "${claim}"
CITATION: ${citation}
VERDICT: ${verdict}${failureMode ? `\nFAILURE MODE: ${failureMode}` : ""}
PROBLEM: ${why}
${hasEvidence ? `\nACTUAL EVIDENCE FROM SOURCE:\n${evidence.slice(0, 3000)}` : ""}

REVISION STRATEGY:
${guidance}

UNIVERSAL RULES (override anything above if in conflict):
- Change as few words as possible. Preserve the author's voice and the
  argumentative role this sentence plays in the introduction.
- Do not invert the claim's meaning.
- Do not narrow the construct, population, or scope unless the strategy
  above explicitly calls for it.
- Do not stack hedges ("may possibly perhaps") — at most one hedge per
  edit. Avoid iterative weakening.
- Do not add information that is not implied by the original claim or
  supported by the evidence.
- Output only the rewritten sentence — no preamble, no explanation, no
  quotation marks.`;
    }

    // Rewrites are short, well-bounded edits — Haiku 4.5 handles them with
    // the same quality as Sonnet but ~5x faster (the popup feels snappy
    // instead of hanging for 20s).
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const rewritten = response.content.find((b) => b.type === "text")?.text?.trim() ?? "";
    return NextResponse.json({ rewritten });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
