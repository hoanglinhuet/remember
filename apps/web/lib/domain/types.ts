/**
 * Hợp đồng dữ liệu dùng chung giữa client và server.
 *
 * Đây là lý do chính chuyển sang TypeScript: bản JS trước phải chuyển đổi tay giữa 3 dạng
 * "card" khác nhau (hàng DB ↔ card của ts-fsrs ↔ payload export) và mỗi lần đổi tên field
 * là một lần phải grep. Ở đây một chỗ đổi là cả hai phía báo lỗi lúc compile.
 *
 * Quy ước: field ở DB là snake_case (Postgres), ở TypeScript là camelCase.
 * Việc chuyển đổi nằm gọn trong `lib/server/map.ts`, không rải rác.
 */

export type CardState = 'new' | 'learning' | 'review' | 'relearning';
export type ReadingType = 'ipa' | 'translit';
export type Rating = 1 | 2 | 3 | 4; // Again | Hard | Good | Easy

/**
 * Cách ôn một thẻ. Là "cách xem" chứ không phải thẻ con: một thẻ vẫn chỉ có MỘT
 * tiến độ FSRS dù ôn bằng mode nào (ADR-31). Danh sách nhãn ở `lib/domain/modes.ts`.
 */
export type StudyMode =
  | 'recognition' // thấy từ → tự nhớ → mở đáp án
  | 'typeVi'      // thấy từ → gõ nghĩa tiếng Việt
  | 'dictation'   // nghe → gõ lại từ
  | 'typeEn'      // thấy nghĩa Việt → gõ từ
  | 'cloze'       // câu khuyết → gõ từ còn thiếu
  | 'choice';     // chọn nghĩa đúng trong 4 đáp án

export interface Deck {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface Card {
  id: string;
  deckId: string | null;
  front: string;
  normalizedFront: string;
  back: string[];
  reading: string | null;
  readingType: ReadingType | null;
  pos: string | null;
  langFrom: string;
  langTo: string;
  contextSentence: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  tags: string[];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Tiến độ FSRS. Tách khỏi Card vì tần suất ghi và quy tắc merge khác nhau (ADR-7). */
export interface CardProgress {
  cardId: string;
  state: CardState;
  due: string | null;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  lastReview: string | null;
  suspended: boolean;
  updatedAt: string;
}

/** Một mục trong hàng đợi phiên học. */
export interface QueueItem {
  card: Card;
  progress: CardProgress | null;
}

/**
 * Một nghĩa để làm đáp án nhiễu cho trắc nghiệm.
 * Lấy từ CẢ deck, không chỉ hàng đợi hôm nay: hôm nay chỉ 2 thẻ đến hạn thì lấy
 * trong hàng đợi sẽ không đủ 3 nhiễu, và mode trắc nghiệm không bao giờ xuất hiện.
 */
export interface GlossOption {
  gloss: string;
  pos: string | null;
}

export interface StudyQueue {
  items: QueueItem[];
  /** Thẻ đang trong bậc thang learning/relearning, so bằng giờ chính xác. */
  learning: QueueItem[];
  counts: { due: number; fresh: number; learning: number };
  /** Kho nghĩa để dựng đáp án nhiễu — xem `GlossOption`. */
  glossPool: GlossOption[];
  room: DailyRoom;
  config: StudyConfig;
}

export interface DailyRoom {
  newLeft: number;
  reviewLeft: number;
  newToday: number;
  reviewsToday: number;
}

/** Mặc định lấy theo Anki để hành vi khớp với thứ người dùng đã quen. */
export interface StudyConfig {
  maxNew: number;
  maxReview: number;
  learnAheadMin: number;
  leechThreshold: number;
  leechAction: 'tag' | 'suspend';
  dayStartHour: number;
  retention: number;
  /** Ngưỡng bậc độ nhớ (ngày). Chỉ ảnh hưởng hiển thị, không ảnh hưởng lịch (ADR-26 giữ nguyên). */
  levelThresholds: [number, number, number];
  /**
   * Các mode được bật. Mỗi thẻ trong phiên rút ngẫu nhiên một mode trong
   * (đã bật ∩ dùng được với thẻ đó) — không phải thẻ nào cũng đủ dữ liệu cho
   * mọi mode, xem `availableModes()`.
   */
  modes: StudyMode[];
}

export const DEFAULT_CONFIG: StudyConfig = {
  maxNew: 20,
  maxReview: 200,
  learnAheadMin: 20,
  leechThreshold: 8,
  leechAction: 'tag',
  dayStartHour: 4,
  retention: 0.9,
  levelThresholds: [7, 30, 180],
  // Mặc định chỉ nhận biết: giống hành vi cũ, người dùng tự bật thêm khi muốn.
  modes: ['recognition'],
};

export interface DeckSummary extends Deck {
  total: number;
  due: number;
  fresh: number;
  suspended: number;
  levels: [number, number, number, number, number];
}

export interface Stats {
  cards: number;
  logs: number;
  today: number;
  due: number;
  learning: number;
  review: number;
  suspended: number;
  leeches: number;
  levels: [number, number, number, number, number];
}

export interface Me {
  user: { id: string; email: string | null; name: string; avatar: string | null } | null;
  config: StudyConfig;
  room: DailyRoom;
  serverSchema: number;
}

/** Kết quả chấm điểm trả về từ server (server tính FSRS - ADR-26). */
export interface AnswerResult {
  progress: CardProgress;
  leech: boolean;
  suspended: boolean;
  /** ms tới lúc thẻ quay lại trong phiên; null nghĩa là không quay lại. */
  backInMs: number | null;
}

/** Lỗi API có mã để client xử lý phân biệt, không phải đoán từ chuỗi. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'not_configured'
  | 'duplicate'
  | 'not_found'
  | 'invalid'
  | 'rate_limited'
  | 'server_error';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  /** Với `duplicate`: deck đang chứa thẻ trùng, để hiện "đã có sẵn trong X". */
  detail?: Record<string, unknown>;
}
