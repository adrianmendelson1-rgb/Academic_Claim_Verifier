/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["pdfkit", "docx", "unpdf"],
};

module.exports = nextConfig;
