import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { claim, citation, verdict, why, evidence, userInstruction } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

    const client = new Anthropic({ apiKey });

    // Build context-aware prompt based on verdict and available evidence
    const hasEvidence = evidence && evidence.trim().length > 0;
    const hasInstruction = userInstruction && userInstruction.trim().length > 0;

    let prompt: string;

    if (hasInstruction) {
      // User provided a specific instruction — honor it while staying evidence-aware
      prompt = `An academic claim needs to be revised. The user has given a specific instruction.

ORIGINAL CLAIM: "${claim}"
CITATION: ${citation}
VERDICT: ${verdict}
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
      // Default evidence-aware rewrite based on verdict
      const verdictGuidance: Record<string, string> = {
        PARTIAL: `The claim is partially supported. Make it more precise — narrow the scope to what the evidence actually confirms. Remove or qualify parts that lack support.`,
        OVERSTATED: `The claim overstates the evidence. Weaken the language to match the source's actual strength (e.g., "suggests" instead of "demonstrates", "may contribute" instead of "leads to").`,
        NOT_SUPPORTED: `The claim is not supported by the cited source. Rewrite it based on what the evidence actually says. If the evidence says something different, write a corrected claim that reflects the real findings.`,
        WRONG_SOURCE: `The cited source does not address this claim. Suggest a corrected claim that reflects what the source actually discusses, or flag that a different source is needed.`,
      };

      const guidance = verdictGuidance[verdict] ?? "Rewrite to be more accurate and defensible.";

      prompt = `An academic claim has been rated "${verdict}". Suggest a minimal, evidence-grounded rewrite.

ORIGINAL CLAIM: "${claim}"
CITATION: ${citation}
PROBLEM IDENTIFIED: ${why}
${hasEvidence ? `\nACTUAL EVIDENCE FROM SOURCE:\n${evidence.slice(0, 3000)}` : ""}

REWRITE STRATEGY: ${guidance}

Rules for the rewrite:
- Change as few words as possible — preserve the author's voice
${hasEvidence
  ? "- Ground every assertion in the actual evidence provided above"
  : "- Add hedging, qualifiers, or scope-narrowing where evidence is uncertain"}
- Do not add information not implied by the original or evidence
- For NOT_SUPPORTED: propose what the claim SHOULD say based on the evidence, not just weaker language
- Output only the rewritten sentence — no preamble, no explanation, no quotation marks`;
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const rewritten = response.content.find((b) => b.type === "text")?.text?.trim() ?? "";
    return NextResponse.json({ rewritten });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
