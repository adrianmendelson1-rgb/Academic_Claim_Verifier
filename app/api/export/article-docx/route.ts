import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ShadingType,
  BorderStyle,
} from "docx";

interface Claim {
  claim: string;
  citation: string;
  source_accessed: string;
  verdict: "SUPPORTED" | "PARTIAL" | "OVERSTATED" | "NOT_SUPPORTED" | "UNVERIFIABLE" | "WRONG_SOURCE";
  why: string;
  fix: string;
}

interface ArticleExportPayload {
  draft: string;
  references: string;
  claims: Claim[];
  acceptedRewrites: Record<string, string>;
}

const VERDICT_TINT: Record<string, string> = {
  SUPPORTED: "ECFDF5",
  PARTIAL: "FFFBEB",
  OVERSTATED: "FFF7ED",
  NOT_SUPPORTED: "FEF2F2",
  UNVERIFIABLE: "F9FAFB",
  WRONG_SOURCE: "F5F3FF",
};

const VERDICT_LABEL: Record<string, string> = {
  SUPPORTED: "Supported",
  PARTIAL: "Partially supported",
  OVERSTATED: "Overstated",
  NOT_SUPPORTED: "Not supported by source",
  UNVERIFIABLE: "Unverifiable",
  WRONG_SOURCE: "Wrong source cited",
};

/**
 * Locate each claim verbatim in the draft. Returns ordered, non-overlapping
 * matches so we can rebuild the article with the corrected sentences inline.
 */
function locateClaims(text: string, claims: Claim[]): { start: number; end: number; idx: number }[] {
  const matches: { start: number; end: number; idx: number }[] = [];
  for (let idx = 0; idx < claims.length; idx++) {
    const needle = claims[idx].claim.slice(0, 80).toLowerCase();
    if (needle.length < 8) continue;
    const at = text.toLowerCase().indexOf(needle);
    if (at !== -1) {
      matches.push({ start: at, end: Math.min(at + claims[idx].claim.length, text.length), idx });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  // Drop overlaps
  const clean: typeof matches = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) { clean.push(m); cursor = m.end; }
  }
  return clean;
}

export async function POST(req: NextRequest) {
  try {
    const { draft, references, claims, acceptedRewrites }: ArticleExportPayload = await req.json();

    const placements = locateClaims(draft, claims);
    const children: Paragraph[] = [];

    // Title
    children.push(
      new Paragraph({
        text: "Verified Article",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
    );

    // Subtitle: change summary
    const acceptedCount = Object.keys(acceptedRewrites).length;
    const issueCount = claims.filter(c => c.verdict !== "SUPPORTED").length;
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}  ·  ${acceptedCount} revision${acceptedCount === 1 ? "" : "s"} applied  ·  ${issueCount} flagged claim${issueCount === 1 ? "" : "s"}`,
            color: "666666",
            size: 20,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }),
    );

    // Walk the draft, splitting into paragraphs and substituting claims
    // with corrected text + verdict tint. We keep paragraph breaks (\n\n).

    // Build a single string with the rewrites applied so paragraph splitting
    // still works naturally; metadata for each placement is tracked separately.
    type Span = { text: string; claimIdx?: number };
    const spans: Span[] = [];
    let pos = 0;
    for (const m of placements) {
      if (m.start > pos) spans.push({ text: draft.slice(pos, m.start) });
      const corrected = acceptedRewrites[String(m.idx)];
      const finalText = corrected ?? draft.slice(m.start, m.end);
      spans.push({ text: finalText, claimIdx: m.idx });
      pos = m.end;
    }
    if (pos < draft.length) spans.push({ text: draft.slice(pos) });

    // Group consecutive spans into paragraphs by splitting on \n\n inside text spans.
    // We render each paragraph as one Paragraph with multiple TextRuns; claim spans
    // get verdict-tinted shading via a separate paragraph if they span multiple
    // lines — simplest robust approach: emit a fresh paragraph per claim sentence
    // so the shading wraps the whole sentence cleanly.

    // Reassemble with claim sentences as their own paragraphs (visually distinct,
    // and because shading at the run level is not well supported in docx readers).
    const paragraphs: { runs: { text: string; claimIdx?: number }[] }[] = [{ runs: [] }];

    for (const span of spans) {
      if (span.claimIdx === undefined) {
        // Plain text — split on paragraph breaks
        const parts = span.text.split(/\n\s*\n/);
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) paragraphs.push({ runs: [] });
          if (parts[i].length > 0) {
            paragraphs[paragraphs.length - 1].runs.push({ text: parts[i] });
          }
        }
      } else {
        // Claim — treat as inline run inside current paragraph
        paragraphs[paragraphs.length - 1].runs.push({ text: span.text, claimIdx: span.claimIdx });
      }
    }

    for (const p of paragraphs) {
      if (p.runs.length === 0) continue;
      // If the paragraph contains a flagged or revised claim, render the
      // paragraph normally (no full-paragraph shading), but set the claim
      // run's text with shading & color. If the run is a corrected one, mark
      // it with a small superscript revision indicator.
      const runs: TextRun[] = [];
      for (const r of p.runs) {
        if (r.claimIdx === undefined) {
          runs.push(new TextRun({ text: r.text }));
        } else {
          const c = claims[r.claimIdx];
          const corrected = acceptedRewrites[String(r.claimIdx)] !== undefined;
          const isIssue = c.verdict !== "SUPPORTED";
          const tint = isIssue ? VERDICT_TINT[c.verdict] : undefined;
          runs.push(
            new TextRun({
              text: r.text,
              shading: tint ? { type: ShadingType.CLEAR, color: "auto", fill: tint } : undefined,
            }),
          );
          if (corrected) {
            runs.push(new TextRun({ text: " ⟲", color: "059669", bold: true, size: 16 }));
          } else if (isIssue) {
            runs.push(new TextRun({ text: " ⚑", color: "B45309", bold: true, size: 16 }));
          }
        }
      }
      children.push(
        new Paragraph({
          children: runs,
          spacing: { after: 160, line: 320 },
        }),
      );
    }

    // ── Margin notes / change log ──────────────────────────────────────────
    // List every flagged / revised claim with a short note.
    const noteWorthy = claims
      .map((c, idx) => ({ c, idx }))
      .filter(({ c, idx }) => c.verdict !== "SUPPORTED" || acceptedRewrites[String(idx)] !== undefined);

    if (noteWorthy.length > 0) {
      children.push(
        new Paragraph({
          text: "Revision notes",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 160 },
        }),
      );
      for (const { c, idx } of noteWorthy) {
        const corrected = acceptedRewrites[String(idx)];
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `[${idx + 1}] `, bold: true }),
              new TextRun({ text: VERDICT_LABEL[c.verdict] ?? c.verdict, bold: true, color: "B45309" }),
              new TextRun({ text: ` — ${c.citation}`, color: "666666" }),
            ],
            spacing: { before: 120, after: 40 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" } },
          }),
        );
        children.push(
          new Paragraph({
            children: [new TextRun({ text: c.why, size: 20 })],
            spacing: { after: 60 },
          }),
        );
        if (corrected) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: "Revised to: ", bold: true, color: "047857" }),
                new TextRun({ text: corrected, italics: true, color: "065F46" }),
              ],
              shading: { type: ShadingType.CLEAR, color: "auto", fill: "ECFDF5" },
              spacing: { after: 120 },
            }),
          );
        }
      }
    }

    // ── References ────────────────────────────────────────────────────────
    if (references && references.trim().length > 0) {
      children.push(
        new Paragraph({
          text: "References",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 160 },
        }),
      );
      const refLines = references.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
      for (const line of refLines) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 20 })],
            spacing: { after: 100, line: 280 },
          }),
        );
      }
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="verified-article.docx"',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Article DOCX export error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
