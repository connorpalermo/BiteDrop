import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Syne } from 'next/font/google';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { SkipLink } from '@/components/layout/SkipLink';
import '../styles/globals.css';

// Both are VARIABLE fonts — do NOT pass `weight`. next/font errors on a weight
// array for a variable face; the full range is available via font-weight in CSS.
// Syne: chunky, architectural, high-character display face for headlines and
// product names — the neo-brutalist direction's signature typeface, picked
// over the more generic "safe geometric sans" cluster (see phase doc Outcome).
const display = Syne({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});
const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'BiteDrop — What’s new in food',
  description: 'A discovery feed for new, unusual, and limited-time food releases.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans text-fg antialiased">
        <SkipLink />
        <Header />
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  );
}
