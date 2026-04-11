import { NextRequest, NextResponse } from "next/server";
import { extractTextFromBase64, extractDocxFromBase64, truncate, wordCount } from "@/lib/academic-apis";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { base64, name } = await req.json();

    if (!base64) {
      return NextResponse.json({ error: "base64 is required" }, { status: 400 });
    }

    const isDocx = typeof name === "string" && name.toLowerCase().endsWith(".docx");

    let result: { text: string; wordCount: number };
    try {
      result = isDocx
        ? await extractDocxFromBase64(base64)
        : await extractTextFromBase64(base64);
    } catch (err) {
      return NextResponse.json(
        {
          error: isDocx
            ? "Could not extract text from this Word document. It may be corrupted or unsupported."
            : "Could not extract text from this PDF. It may be encrypted, corrupted, or an image-only scan.",
        },
        { status: 400 }
      );
    }

    if (result.wordCount < 50) {
      return NextResponse.json(
        {
          error: `Extracted only ${result.wordCount} words — this file appears to contain very little readable text.`,
        },
        { status: 400 }
      );
    }

    const text = truncate(result.text, 2000);
    const wc = wordCount(text);

    return NextResponse.json({ text, wordCount: wc, name });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
