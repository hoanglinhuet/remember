/**
 * Bộ icon inline, thay cho emoji ở topbar cũ.
 *
 * Emoji có ba vấn đề trên mobile: mỗi hệ điều hành vẽ một kiểu, không nhận màu
 * theo `currentColor`, và không canh được theo baseline chữ. SVG thì cả ba đều
 * giải quyết được, và ở đây tất cả đều dùng `currentColor` nên màu do CSS quyết.
 *
 * Mọi icon vẽ trong khung 24×24, nét 2px, đầu nét tròn.
 */

type P = { size?: number; className?: string };

function Svg({ size = 24, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Chồng thẻ — đúng thứ app này làm việc với. */
export const IconCards = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="3" width="14" height="10" rx="2.5" />
    <rect x="3" y="9" width="14" height="12" rx="2.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="M15.8 15.8 L20.5 20.5" />
  </Svg>
);

/** Cột tăng dần — cùng ngôn ngữ hình với thanh bậc độ nhớ. */
export const IconBars = (p: P) => (
  <Svg {...p}>
    <path d="M5 20V15" />
    <path d="M12 20V10" />
    <path d="M19 20V5" />
  </Svg>
);

export const IconPerson = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const IconChevron = (p: P) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconSpeaker = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12.5 5v14L7.5 14.5H4z" fill="currentColor" stroke="none" />
    <path d="M16 9.5a4 4 0 0 1 0 5" />
    <path d="M18.8 6.8a8 8 0 0 1 0 10.4" />
  </Svg>
);

/** Loa gạch chéo — dùng khi từ đang bị ẩn, không được phát ra đáp án. */
export const IconSpeakerSlow = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.5L12.5 5v14L7.5 14.5H4z" fill="currentColor" stroke="none" />
    <path d="M16 10.5a2.5 2.5 0 0 1 0 3" />
  </Svg>
);

export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2" />
    <circle cx="16" cy="7" r="2" />
    <path d="M4 17h6M14 17h6" />
    <circle cx="12" cy="17" r="2" />
  </Svg>
);

export const IconPlug = (p: P) => (
  <Svg {...p}>
    <path d="M9 3v4M15 3v4" />
    <path d="M6.5 7h11v3a5.5 5.5 0 0 1-11 0z" />
    <path d="M12 15.5V21" />
  </Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 13l4.5 4.5L19 7" />
  </Svg>
);
