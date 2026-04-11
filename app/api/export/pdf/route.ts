import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";

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
  SUPPORTED: "SUPPORTED",
  PARTIAL: "PARTIAL",
  OVERSTATED: "OVERSTATED",
  NOT_SUPPORTED: "NOT SUPPORTED",
  UNVERIFIABLE: "UNVERIFIABLE",
};

const VERDICT_COLORS: Record<string, string> = {
  SUPPORTED: "#16a34a",
  PARTIAL: "#d97706",
  OVERSTATED: "#ea580c",
  NOT_SUPPORTED: "#dc2626",
  UNVERIFIABLE: "#6b7280",
};

export async function POST(req: NextRequest) {
  try {
    const result: VerificationResult = await req.json();
    const { claims, summary } = result;

    const supported = claims.filter((c) => c.verdict === "SUPPORTED").length;
    const issues = claims.filter((c) => c.verdict === "PARTIAL" || c.verdict === "OVERSTATED").length;
    const notSupported = claims.filter((c) => c.verdict === "NOT_SUPPORTED").length;
    const unverifiable = claims.filter((c) => c.verdict === "UNVERIFIABLE").length;

    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 60, size: "A4" });

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", resolve);
      doc.on("error", reject);

      const pageWidth = doc.page.width - 120; // accounting for margins

      // Title
      doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827");
      doc.text("Claim Verification Report", { align: "center", width: pageWidth });
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(11).fillColor("#6b7280");
      doc.text(
        `Generated: ${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`,
        { align: "center", width: pageWidth }
      );
      doc.moveDown(1.5);

      // Stats row
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
      doc.text("Summary Statistics", 60, doc.y, { width: pageWidth });
      doc.moveDown(0.5);

      const stats = [
        { label: "Total Claims", value: String(claims.length), color: "#374151" },
        { label: "Supported", value: String(supported), color: "#16a34a" },
        { label: "Issues", value: String(issues), color: "#d97706" },
        { label: "Not Supported", value: String(notSupported), color: "#dc2626" },
        { label: "Unverifiable", value: String(unverifiable), color: "#6b7280" },
      ];

      const colW = pageWidth / stats.length;
      const startX = 60;
      const boxY = doc.y;
      const boxH = 55;

      stats.forEach((stat, i) => {
        const x = startX + i * colW;
        doc.rect(x, boxY, colW - 6, boxH).fillColor("#f9fafb").fill();
        doc.font("Helvetica-Bold").fontSize(22).fillColor(stat.color);
        doc.text(stat.value, x, boxY + 8, { width: colW - 6, align: "center" });
        doc.font("Helvetica").fontSize(9).fillColor("#6b7280");
        doc.text(stat.label, x, boxY + 35, { width: colW - 6, align: "center" });
      });

      doc.y = boxY + boxH + 20;
      doc.moveDown(0.5);

      // Separator
      doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor("#e5e7eb").stroke();
      doc.moveDown(1);

      // Claims
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
      doc.text("Claim-by-Claim Analysis", 60, doc.y, { width: pageWidth });
      doc.moveDown(0.5);

      claims.forEach((claim, i) => {
        // Check if we need a new page
        if (doc.y > doc.page.height - 200) {
          doc.addPage();
        }

        const verdictColor = VERDICT_COLORS[claim.verdict] || "#6b7280";
        const verdictLabel = VERDICT_LABELS[claim.verdict] || claim.verdict;

        // Bug 3 fix: claim header with { continued: true } — use explicit coords on the
        // continued segment and then reset to explicit coords on the very next text call
        // so the x cursor doesn't drift after the chain ends.
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
        doc.text(`Claim ${i + 1}  `, 60, doc.y, { continued: true, width: pageWidth });
        doc.fillColor(verdictColor).text(verdictLabel, { width: pageWidth });
        doc.moveDown(0.3);

        // Bug 1 fix: always pass explicit x + { width: pageWidth } after the stats-box
        // manual doc.y positioning so the cursor can't drift.

        // Claim text
        doc.font("Helvetica-Oblique").fontSize(10).fillColor("#374151");
        doc.text(`"${claim.claim}"`, 60, doc.y, { width: pageWidth });
        doc.moveDown(0.3);

        // Bug 4 fix: replace the fragile multi-continued citation/source chain with a
        // single combined string in one font/color call.
        const citationLine = `Citation: ${claim.citation}   |   Source: ${claim.source_accessed}`;
        doc.font("Helvetica").fontSize(9).fillColor("#6b7280");
        doc.text(citationLine, 60, doc.y, { width: pageWidth });
        doc.moveDown(0.3);

        // Why — keep the continued chain but follow it with explicit coords
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151");
        doc.text("Assessment: ", 60, doc.y, { continued: true, width: pageWidth });
        doc.font("Helvetica").text(claim.why, { width: pageWidth });
        doc.moveDown(0.3);

        // Bug 2 fix: dynamic fix-box height instead of hardcoded 40px
        if (claim.fix && claim.fix !== "none needed") {
          const fixY = doc.y;
          const fullFixText = `Suggested Fix:  ${claim.fix}`;

          // Measure height with the body font at the text's actual width, then add padding
          doc.font("Helvetica").fontSize(9);
          const textH = doc.heightOfString(fullFixText, { width: pageWidth - 20 });
          const dynamicHeight = textH + 16; // 8px top + 8px bottom padding

          doc.rect(60, fixY, pageWidth, dynamicHeight).fillColor("#eff6ff").fill();

          // Render label in bold, then the rest of the fix text inline
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#1d4ed8");
          doc.text("Suggested Fix: ", 65, fixY + 8, { continued: true, width: pageWidth - 10 });
          doc.font("Helvetica").fillColor("#1e40af").text(claim.fix, { width: pageWidth - 10 });

          // Bug 2 fix: advance past the box using the measured height
          doc.y = fixY + dynamicHeight + 4;
        }

        doc.moveDown(0.5);
        doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor("#f3f4f6").stroke();
        doc.moveDown(0.5);
      });

      // Summary
      if (doc.y > doc.page.height - 150) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
      doc.text("Overall Summary", 60, doc.y, { width: pageWidth });
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10).fillColor("#374151");
      doc.text(summary, 60, doc.y, { width: pageWidth });

      doc.end();
    });

    const pdfBuffer = Buffer.concat(chunks);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="claim-verification-report.pdf"',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PDF export error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
