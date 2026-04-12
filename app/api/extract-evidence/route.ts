import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

export interface EvidenceResult {
  quotes: Array<{
    text: string;
    context?: string;
    section?: string;
    relevance: "direct" | "partial" | "tangential";
  }>;
  summary: string;
  confidence: "high" | "medium" | "low";
}

export async function POST(req: NextRequest) {
  try {
    const { claim, sourceText, sourceTitle } = await req.json();

    if (!claim?.trim() || !sourceText?.trim()) {
      return NextResponse.json(
        { error: "claim and sourceText are required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key" }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });

    const prompt = `You are an academic evidence extractor. Given a claim and a source text, find the exact passages that support (or fail to support) the claim.

CLAIM: "${claim}"
SOURCE: "${sourceTitle ?? "Unknown"}"

SOURCE TEXT:
${sourceText.slice(0, 8000)}

INSTRUCTIONS:
1. Find 1-3 exact quotes from the source that are most relevant to the claim
2. For each quote, provide:
   - "text": the exact quote (1-3 sentences, verbatim from source)
   - "context": 1 sentence explaining how this quote relates to the claim
   - "section": section name or approximate location if identifiable (e.g. "Abstract", "Results", "Discussion"), or null
   - "relevance": "direct" if it directly addresses the claim, "partial" if it partially relates, "tangential" if only loosely related
3. Provide a brief "summary" (1-2 sentences) of whether the source supports the claim
4. Rate overall "confidence": "high" if clear direct evidence exists, "medium" if evidence is indirect or partial, "low" if evidence is weak or tangential

Return ONLY valid JSON with this structure:
{
  "quotes": [...],
  "summary": "...",
  "confidence": "high|medium|low"
}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content.find((b) => b.type === "text")?.text ?? "";
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return NextResponse.json(parsed);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return NextResponse.json(JSON.parse(jsonMatch[0]));
        } catch {
          // fall through
        }
      }
      return NextResponse.json({
        quotes: [],
        summary: "Could not extract evidence.",
        confidence: "low",
      });
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
