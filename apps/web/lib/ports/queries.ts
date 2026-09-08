import type {
  Card, CardState, DailyRoom, Deck, DeckSummary, GlossOption, QueueItem, Stats, StudyConfig,
} from '@/lib/domain/types';
import type { MemoryLevel } from '@/lib/domain/memory';

/**
 * PORTS — tầng ĐỌC (read model).
 *
 * Tách khỏi repository theo tinh thần CQRS ở mức nhẹ: đây là các truy vấn tổng hợp
 * phục vụ hiển thị, không map về một thực thể nào và không bao giờ ghi.
 *
 * Lợi ích thực dụng: sau này muốn thêm materialized view, cache, hay đổi sang
 * một SQL khác hẳn cho `stats` thì không đụng đường ghi.
 */
export interface StudyQueries {
  /**
   * Cài đặt học. Bên đọc dùng cái này chứ không mở transaction ghi riêng —
   * cài đặt bị đọc ở gần như mọi endpoint nên adapter memoize theo request.
   */
  settings(): Promise<StudyConfig>;
  deckSummaries(now?: Date): Promise<DeckSummary[]>;
  dailyRoom(now?: Date): Promise<DailyRoom>;
  buildQueue(opts: { deckId?: string | null }, now?: Date): Promise<QueueResult>;
  stats(now?: Date): Promise<Stats>;
  /** Thẻ mới nhất, kèm tên deck — cho popup extension. */
  recentCards(limit: number): Promise<RecentCard[]>;

  /**
   * Các thẻ ĐÃ CÓ của một từ — để lúc tra từ biết ngay nghĩa nào đã lưu.
   * Trả theo từ (không lọc pos/nghĩa) vì UI cần đối chiếu từng nghĩa một.
   */
  cardsByFront(front: string, langFrom: string, langTo: string): Promise<ExistingCard[]>;

  /**
   * Dạng chuẩn hoá của MỌI từ đã lưu, không trùng lặp.
   *
   * Cho tính năng highlight của extension: nó cần biết "từ này đã có thẻ chưa" cho
   * từng từ trên trang, nên phải là cả bộ, và chỉ cần `normalized_front` — không
   * kéo về nghĩa, IPA, tiến độ. Một bộ vài nghìn từ chỉ vài chục KB.
   */
  savedFronts(): Promise<string[]>;

  /** Một deck theo id — để trang quản lý biết mình đang mở deck nào (hoặc 404). */
  deck(deckId: string): Promise<Deck | null>;

  /**
   * Thẻ trong một deck, có phân trang — màn hình quản lý thẻ.
   *
   * KHÔNG dùng `buildQueue` cho việc này: hàng đợi bỏ thẻ bị treo, bỏ thẻ chưa đến
   * hạn và cắt theo hạn mức ngày. Quản lý thì phải thấy đủ, kể cả thẻ treo.
   *
   * `deckId = null` là nhóm "không có deck" (thẻ mồ côi sau khi xoá deck).
   */
  deckCards(opts: DeckCardsQuery): Promise<DeckCardsPage>;
}

export interface DeckCardsQuery {
  deckId: string | null;
  /** Lọc theo từ hoặc nghĩa; đã chuẩn hoá chữ thường ở adapter. */
  q?: string;
  limit: number;
  offset: number;
}

/** Thẻ kèm phần tiến độ mà màn hình quản lý cần — không phải cả `CardProgress`. */
export interface DeckCard extends Card {
  state: CardState | null;
  due: string | null;
  suspended: boolean;
  reps: number;
  lapses: number;
  level: MemoryLevel;
}

export interface DeckCardsPage {
  cards: DeckCard[];
  /** Tổng số thẻ KHỚP bộ lọc, để biết còn trang sau hay không. */
  total: number;
}

export interface ExistingCard {
  id: string;
  pos: string | null;
  back: string[];
  /** Dạng chuẩn hoá của `back` — so trực tiếp với `senseKey()` ở client. */
  backKey: string;
  deckName: string | null;
  createdAt: string;
}

export interface RecentCard extends Card {
  deckName: string | null;
}

export interface QueueResult {
  items: QueueItem[];
  learning: QueueItem[];
  counts: { due: number; fresh: number; learning: number };
  /** Nghĩa của mọi thẻ trong deck, để client dựng đáp án nhiễu cho trắc nghiệm. */
  glossPool: GlossOption[];
  /**
   * Hạn mức trong ngày và cài đặt, tính SẴN trong cùng transaction với hàng đợi.
   * Trả kèm ở đây để route không phải gọi `dailyRoom()`/`readConfig()` riêng —
   * mỗi lần gọi riêng là một transaction, tức 4 round trip.
   */
  room: DailyRoom;
  config: StudyConfig;
}
