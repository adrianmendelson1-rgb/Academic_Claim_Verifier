import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// Download a file from Google Drive given its fileId and an access token
export async function POST(req: NextRequest) {
  try {
    const { fileId, accessToken } = await req.json();

    if (!fileId || !accessToken) {
      return NextResponse.json(
        { error: "fileId and accessToken are required" },
        { status: 400 }
      );
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const drive = google.drive({ version: "v3", auth });

    // Get file metadata
    const meta = await drive.files.get({ fileId, fields: "name,mimeType,size" });
    const fileName = meta.data.name || "file.pdf";

    // Download file content
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(res.data as ArrayBuffer);
    const base64 = buffer.toString("base64");

    return NextResponse.json({ name: fileName, base64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Drive download error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
