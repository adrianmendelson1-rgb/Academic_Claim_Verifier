/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfkit", "docx", "unpdf", "mammoth"],
};

module.exports = nextConfig;
