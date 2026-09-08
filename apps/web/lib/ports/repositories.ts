import type {
  Card, CardProgress, CardState, Deck, Rating, ReadingType, StudyConfig,
} from '@/lib/domain/types';

/**
 * PORTS — tầng bền vững, tách theo trách nhiệm.
 *
 * Trước đây một interface `StudyRepo` gom 13 phương thức: vừa CRUD thực thể, vừa
 * báo cáo tổng hợp, vừa dựng hàng đợi. Đó không phải repository mà là "mọi thứ liên
 * quan tới DB". Tách ra vì hai lý do thực dụng:
 *
 *   1. Đọc và ghi có hình dạng khác nhau. `deckSummaries`/`stats` là READ MODEL —
 *      join nhiều bảng, tổng hợp, không map về một thực thể nào. Ép chúng vào
 *      repository buộc repository phải biết cả nhu cầu hiển thị.
 *   2. Muốn thay cách đọc (thêm view, cache, materialized view) mà không đụng
 *      đường ghi, và ngược lại.
 *
 * Repository ở đây CỐ Ý không có `findAll`, `findBy(criteria)` hay generic
 * `Repository<T>`: interface chung chung nhất luôn là interface tệ nhất cho cả hai phía.
 */

export interface CardRepository {
  create(input: NewCardInput, deckId: string): Promise<Card>;
  exists(cardId: string): Promise<boolean>;
  addTag(cardId: string, tag: string): Promise<void>;
  /**
   * Tìm thẻ trùng theo khoá dedupe (FR-B3).
   * Khoá gồm: từ + loại từ + bộ nghĩa + cặp ngôn ngữ — nên `book` (danh từ) và
   * `book` (động từ) là hai thẻ khác nhau, và hai bộ nghĩa khác nhau cũng vậy.
   */
  findDuplicate(key: DedupeKey): Promise<{ id: string; deckName: string | null } | null>;
  get(cardId: string): Promise<Card | null>;
  /**
   * Sửa thẻ. Chỉ những khoá CÓ MẶT trong patch bị ghi — `undefined` là "đừng đụng",
   * `null` là "xoá giá trị". Hai thứ đó không thể trộn thành một: sửa nghĩa mà vô
   * tình xoá luôn IPA là mất dữ liệu không lấy lại được.
   *
   * Sửa `front`/`pos`/`back` là đổi khoá dedupe, nên cài đặt phải kiểm trùng lại
   * và ném `DuplicateCard` — giống lúc tạo.
   */
  update(cardId: string, patch: CardPatch): Promise<Card | null>;
  /** Xoá mềm: đặt `deleted_at`. Thẻ đã xoá không chặn việc lưu lại từ đó về sau. */
  softDelete(cardId: string): Promise<boolean>;
  /** Dồn mọi thẻ của một deck sang deck khác (null = về nhóm "không có deck"). */
  moveAll(fromDeckId: string, toDeckId: string | null): Promise<number>;
  softDeleteAllInDeck(deckId: string): Promise<number>;
}

export interface DeckRepository {
  list(): Promise<Deck[]>;
  /** Luôn tồn tại ít nhất một deck: "deck đầu tiên" là mặc định khi lưu thẻ. */
  ensureAtLeastOne(): Promise<Deck[]>;
  create(name: string, sortOrder: number): Promise<Deck>;
  rename(deckId: string, name: string): Promise<Deck | null>;
  /** Xoá mềm deck. Thẻ bên trong do use case định đoạt TRƯỚC, xem `deleteDeck()`. */
  softDelete(deckId: string): Promise<boolean>;
}

export interface ProgressRepository {
  get(cardId: string): Promise<CardProgress | null>;
  save(progress: CardProgress): Promise<void>;
  /** Tạo tiến độ rỗng cho thẻ mới; không ghi đè nếu đã có. */
  initIfMissing(cardId: string): Promise<void>;
}

/** Append-only: cố ý KHÔNG có update/delete — tính bất biến cưỡng chế ngay ở interface. */
export interface ReviewLogRepository {
  append(cardId: string, log: ReviewLogInput): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<StudyConfig>;
  save(patch: Partial<StudyConfig>): Promise<StudyConfig>;
}

/** Bộ repository của MỘT user, đã gắn với một transaction. */
export interface Repos {
  cards: CardRepository;
  decks: DeckRepository;
  progress: ProgressRepository;
  logs: ReviewLogRepository;
  settings: SettingsRepository;
}

/**
 * UNIT OF WORK — ranh giới transaction thuộc về tầng use case, không phải repository.
 *
 * Đây không phải pattern cho đẹp: nó sửa một lỗi thật. Trước đây `writeAnswer()` gói
 * tiến độ + log trong transaction riêng của nó, còn `addLeechTag()` là lời gọi thứ hai
 * BÊN NGOÀI. Ghi hỏng giữa hai lời gọi thì thẻ đã thành leech mà không được gắn tag.
 *
 * Với UoW, use case tự quyết cái gì phải nguyên tử cùng nhau.
 */
export interface UnitOfWork {
  transaction<T>(userId: string, fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export interface DedupeKey {
  normalizedFront: string;
  pos: string | null;
  /** Dạng chuẩn hoá của `back` — xem `senseKey()` trong lib/domain/day.ts. */
  backKey: string;
  langFrom: string;
  langTo: string;
}

export interface NewCardInput {
  id?: string;
  deckId?: string | null;
  front: string;
  back: string[];
  reading?: string | null;
  readingType?: 'ipa' | 'translit' | null;
  pos?: string | null;
  langFrom?: string;
  langTo?: string;
  contextSentence?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  note?: string | null;
}

/**
 * Phần sửa được của một thẻ. Cố ý KHÔNG có `id`, `normalizedFront`, `langFrom`,
 * `langTo`: hai cái sau là một phần khoá dedupe và đổi chúng nghĩa là thẻ khác,
 * còn `normalizedFront` là dẫn xuất của `front` nên adapter tự tính lại.
 */
export interface CardPatch {
  deckId?: string | null;
  front?: string;
  back?: string[];
  reading?: string | null;
  readingType?: ReadingType | null;
  pos?: string | null;
  contextSentence?: string | null;
  note?: string | null;
}

export interface ReviewLogInput {
  rating: Rating;
  reviewedAt: string;
  scheduledDays: number;
  elapsedDays: number;
  stateBefore: CardState;
}

/** Lỗi MIỀN. Adapter dịch mã lỗi riêng của nhà cung cấp sang đây; use case chỉ biết cái này. */
export class DuplicateCard extends Error {
  constructor(readonly cardId: string | null, readonly deckName: string | null) {
    super('Thẻ đã có sẵn');
    this.name = 'DuplicateCard';
  }
}
