import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Google_Sans, Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fonts for the per-provider chat themes (see [data-theme] blocks in globals.css).
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const sourceSerif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"] });
const googleSans = Google_Sans({ variable: "--font-google-sans", subsets: ["latin"], adjustFontFallback: false });

export const metadata: Metadata = {
  title: "Orbit AI",
  description: "GPT, Claude, Gemini and Grok in one place for Western students.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#05060b" },
    { media: "(prefers-color-scheme: light)", color: "#f5f8ff" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${sourceSerif.variable} ${googleSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-surface-000 text-ink">{children}</body>
    </html>
  );
}
