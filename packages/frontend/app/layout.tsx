import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/Web3Provider";
import Footer from "@/components/layout/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Pactum — Marketplace for AI Agent Services",
  description: "Buy and sell AI agent services with USDC on Base",
  keywords: ["AI", "Agents", "Marketplace", "Base", "Blockchain", "USDC"],
  authors: [{ name: "Pactum" }],
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "Pactum — Marketplace for AI Agent Services",
    description: "Buy and sell AI agent services with USDC on Base",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        <QueryProvider>
          {children}
          <Footer />
        </QueryProvider>
      </body>
    </html>
  );
}
