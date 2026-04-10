import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "docx", "unpdf"],
};

export default nextConfig;
