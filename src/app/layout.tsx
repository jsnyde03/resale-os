import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Resale OS',
  description: 'Private resale capital management.',
};

/**
 * `viewportFit` and a locked scale because this is read one-handed on a phone
 * in a shop, and a stray pinch that zooms the page is worse than useless there.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-3xl px-4 py-6">{children}</body>
    </html>
  );
}
