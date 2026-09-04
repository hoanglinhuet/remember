import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro, Source_Serif_4 } from 'next/font/google';
import { TabBar } from './_components/TabBar';
import './globals.css';

/**
 * HAI HỌ CHỮ, MỖI HỌ MỘT VAI TRÒ THÔNG TIN.
 *
 * Be Vietnam Pro cho giao diện: chọn vì phủ đủ dấu tiếng Việt xếp tầng, thứ mà
 * stack `-apple-system` dựng khá tệ ở cỡ 11-13px — mà cỡ đó là toàn bộ nhãn nhỏ
 * của app này. Không phải variable font nên phải khai weight rời.
 */
const sans = Be_Vietnam_Pro({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

/**
 * Source Serif 4 CHỈ dùng cho từ tiếng Anh đang học và phiên âm của nó.
 * Serif = nội dung phải nhớ, sans = giao diện. Mắt tách được hai lớp mà không
 * cần thêm khung viền nào. Variable font, cần cả italic cho câu ngữ cảnh.
 */
const serif = Source_Serif_4({
  subsets: ['latin', 'latin-ext', 'vietnamese'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Remember',
  description: 'Ôn flashcard bằng spaced repetition (FSRS).',
  // Cùng lý do như bên extension: translate_tts trả 404 + text/html khi có Referer,
  // rồi Chrome áp ORB. Ảnh avatar của Google cũng chặn hotlink.
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#6b3bf5',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <div className="app">{children}</div>
        <TabBar />
      </body>
    </html>
  );
}
