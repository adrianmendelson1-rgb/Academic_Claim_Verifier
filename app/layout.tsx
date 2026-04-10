import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Academic Claim Verifier",
  description: "Verify whether claims in academic writing are accurately supported by cited sources",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-white text-gray-900">{children}</body>
    </html>
  );
}
