import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { claim, citation, verdict, why } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

    const client = new Anthropic({ apiKey });

    const prompt = `An academic claim has been rated "${verdict}". Suggest a minimal rewrite that is defensible based on what the source actually says.

ORIGINAL CLAIM: "${claim}"
CITATION: ${citation}
PROBLEM IDENTIFIED: ${why}

Rules for the rewrite:
- Change as few words as possible — preserve the author's voice
- Add hedging, qualifiers, or scope-narrowing where needed (e.g. "suggests" instead of "demonstrates", "some evidence indicates" instead of "research shows")
- Do not change the core argument or add information not implied by the original
- Output only the rewritten sentence — no preamble, no explanation, no quotation marks`;

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
