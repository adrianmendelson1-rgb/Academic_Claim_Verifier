import { NextRequest, NextResponse } from "next/server";
import { extractTextFromBase64, truncate, wordCount } from "@/lib/academic-apis";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { base64, name } = await req.json();

    if (!base64) {
      return NextResponse.json({ error: "base64 is required" }, { status: 400 });
    }

    let result: { text: string; wordCount: number };
    try {
      result = await extractTextFromBase64(base64);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            "Could not extract text from this PDF. It may be encrypted, corrupted, or an image-only scan.",
        },
        { status: 400 }
      );
    }

    if (result.wordCount < 50) {
      return NextResponse.json(
        {
          error: `Extracted only ${result.wordCount} words — this PDF appears to be a scanned image without a text layer and cannot be read automatically. Try a different version of the paper.`,
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
