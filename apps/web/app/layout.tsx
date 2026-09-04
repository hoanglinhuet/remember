import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Remember',
  description: 'Ôn flashcard bằng spaced repetition (FSRS).',
  // Cùng lý do như bên extension: translate_tts trả 404 + text/html khi có Referer,
  // rồi Chrome áp ORB. Ảnh avatar của Google cũng chặn hotlink.
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#6d4aff',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <div className="app">{children}</div>
      </body>
    </html>
  );
}
