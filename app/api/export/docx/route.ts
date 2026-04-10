import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ShadingType,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";

interface Claim {
  claim: string;
  citation: string;
  source_accessed: string;
  verdict: "SUPPORTED" | "PARTIAL" | "OVERSTATED" | "NOT_SUPPORTED" | "UNVERIFIABLE";
  why: string;
  fix: string;
}

interface VerificationResult {
  claims: Claim[];
  summary: string;
}

const VERDICT_LABELS: Record<string, string> = {
  SUPPORTED: "✅ SUPPORTED",
  PARTIAL: "〜 PARTIAL",
  OVERSTATED: "⚠️ OVERSTATED",
  NOT_SUPPORTED: "❌ NOT SUPPORTED",
  UNVERIFIABLE: "❓ UNVERIFIABLE",
};

export async function POST(req: NextRequest) {
  try {
    const result: VerificationResult = await req.json();
    const { claims, summary } = result;

    const supported = claims.filter((c) => c.verdict === "SUPPORTED").length;
    const issues = claims.filter((c) => c.verdict === "PARTIAL" || c.verdict === "OVERSTATED").length;
    const notSupported = claims.filter((c) => c.verdict === "NOT_SUPPORTED").length;
    const unverifiable = claims.filter((c) => c.verdict === "UNVERIFIABLE").length;

    const children: (Paragraph | Table)[] = [];

    // Title
    children.push(
      new Paragraph({
        text: "Claim Verification Report",
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );

    // Date
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated: ${new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}`,
            color: "666666",
            size: 20,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // Stats
    children.push(
      new Paragraph({
        text: "Summary Statistics",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 200 },
      })
    );

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: "Total Claims", alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: "Supported", alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: "Issues", alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: "Not Supported", alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: "Unverifiable", alignment: AlignmentType.CENTER })] }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph({ text: String(claims.length), alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: String(supported), alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: String(issues), alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: String(notSupported), alignment: AlignmentType.CENTER })] }),
              new TableCell({ children: [new Paragraph({ text: String(unverifiable), alignment: AlignmentType.CENTER })] }),
            ],
          }),
        ],
      })
    );

    children.push(new Paragraph({ text: "", spacing: { after: 300 } }));

    // Claims
    children.push(
      new Paragraph({
        text: "Claim-by-Claim Analysis",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 200 },
      })
    );

    claims.forEach((claim, i) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Claim ${i + 1}: `, bold: true, size: 24 }),
            new TextRun({ text: VERDICT_LABELS[claim.verdict] || claim.verdict, bold: true, size: 24 }),
          ],
          spacing: { before: 300, after: 100 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
          },
        })
      );

      children.push(
        new Paragraph({
          children: [new TextRun({ text: `"${claim.claim}"`, italics: true })],
          spacing: { after: 100 },
        })
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Citation: ", bold: true }),
            new TextRun({ text: claim.citation }),
            new TextRun({ text: "   |   Source: ", bold: true }),
            new TextRun({ text: claim.source_accessed, color: "666666" }),
          ],
          spacing: { after: 100 },
        })
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Assessment: ", bold: true }),
            new TextRun({ text: claim.why }),
          ],
          spacing: { after: 100 },
        })
      );

      if (claim.fix && claim.fix !== "none needed") {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Suggested Fix: ", bold: true }),
              new TextRun({ text: claim.fix, color: "1A5276" }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "EBF5FB" },
            spacing: { after: 100 },
          })
        );
      }
    });

    // Overall summary
    children.push(
      new Paragraph({
        text: "Overall Summary",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      })
    );

    children.push(
      new Paragraph({
        text: summary,
        spacing: { after: 200 },
      })
    );

    const doc = new Document({
      sections: [{ children }],
    });

    const buffer = await Packer.toBuffer(doc);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="claim-verification-report.docx"',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("DOCX export error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
