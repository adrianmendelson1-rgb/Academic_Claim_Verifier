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
      doc.text("Claim Verification Report", { align: "center" });
      doc.moveDown(0.3);

      doc.font("Helvetica").fontSize(11).fillColor("#6b7280");
      doc.text(
        `Generated: ${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`,
        { align: "center" }
      );
      doc.moveDown(1.5);

      // Stats row
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
      doc.text("Summary Statistics");
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
      doc.text("Claim-by-Claim Analysis");
      doc.moveDown(0.5);

      claims.forEach((claim, i) => {
        // Check if we need a new page
        if (doc.y > doc.page.height - 200) {
          doc.addPage();
        }

        const verdictColor = VERDICT_COLORS[claim.verdict] || "#6b7280";
        const verdictLabel = VERDICT_LABELS[claim.verdict] || claim.verdict;

        // Claim header
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
        doc.text(`Claim ${i + 1}  `, { continued: true });
        doc.fillColor(verdictColor).text(verdictLabel);
        doc.moveDown(0.3);

        // Claim text
        doc.font("Helvetica-Oblique").fontSize(10).fillColor("#374151");
        doc.text(`"${claim.claim}"`);
        doc.moveDown(0.3);

        // Citation + source
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#6b7280");
        doc.text(`Citation: `, { continued: true });
        doc.font("Helvetica").text(claim.citation, { continued: true });
        doc.font("Helvetica-Bold").text(`   |   Source: `, { continued: true });
        doc.font("Helvetica").text(claim.source_accessed);
        doc.moveDown(0.3);

        // Why
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151");
        doc.text("Assessment: ", { continued: true });
        doc.font("Helvetica").text(claim.why);
        doc.moveDown(0.3);

        // Fix
        if (claim.fix && claim.fix !== "none needed") {
          const fixY = doc.y;
          doc.rect(60, fixY, pageWidth, 40).fillColor("#eff6ff").fill();
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#1d4ed8");
          doc.text("Suggested Fix: ", 65, fixY + 8, { continued: true });
          doc.font("Helvetica").fillColor("#1e40af").text(claim.fix, { width: pageWidth - 10 });
          doc.y = fixY + 48;
        }

        doc.moveDown(0.5);
        doc.moveTo(60, doc.y).lineTo(60 + pageWidth, doc.y).strokeColor("#f3f4f6").stroke();
        doc.moveDown(0.5);
      });

      // Summary
      if (doc.y > doc.page.height - 150) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(14).fillColor("#111827");
      doc.text("Overall Summary");
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10).fillColor("#374151");
      doc.text(summary);

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
