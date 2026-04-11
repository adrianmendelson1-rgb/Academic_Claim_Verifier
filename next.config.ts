import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "docx", "unpdf", "mammoth"],
};

export default nextConfig;
