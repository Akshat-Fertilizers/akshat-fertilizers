import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akshat Fertilizer — B2B Distribution Portal',
  description: 'Dealer indents, godown stock, credit and Tally-synced invoicing for Akshat Fertilizer.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-gray-50 text-gray-800 antialiased">{children}</body>
    </html>
  );
}
