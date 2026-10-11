import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Mayflower', description: 'Your beliefs, ruled on.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <main className="mx-auto max-w-5xl px-5 py-10">
          <a href="/" className="mb-8 block text-lg font-semibold tracking-tight text-indigo-600">Mayflower</a>
          {children}
        </main>
      </body>
    </html>
  );
}
