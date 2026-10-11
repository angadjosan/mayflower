import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "Mayflower", description: "Your personal AI hedge fund for prediction markets" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight">⛵ Mayflower</Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link href="/">Dashboard</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-6 flex-1">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted">Prediction-market contracts can lose their full cost. Mayflower never trades without your explicit approval and never holds your funds.</footer>
      </body>
    </html>
  );
}
