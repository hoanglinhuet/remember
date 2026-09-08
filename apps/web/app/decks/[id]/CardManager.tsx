'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import type { Deck, ReadingType } from '@/lib/domain/types';
import type { DeckCard, DeckCardsPage } from '@/lib/ports/queries';
import { humanInterval } from '@/lib/domain/day';
import { LEVELS } from '@/lib/domain/memory';
import { IconPencil, IconPlus, IconSearch, IconTrash } from '../../_components/Icons';

/** Form của một thẻ. `back` là văn bản nhiều dòng — mỗi dòng một nghĩa. */
interface Form {
  front: string;
  back: string;
  pos: string;
  reading: string;
  readingType: ReadingType;
  contextSentence: string;
  note: string;
  deckId: string;
}

const EMPTY: Form = {
  front: '', back: '', pos: '', reading: '', readingType: 'ipa',
  contextSentence: '', note: '', deckId: '',
};

function formOf(c: DeckCard): Form {
  return {
    front: c.front,
    back: c.back.join('\n'),
    pos: c.pos ?? '',
    reading: c.reading ?? '',
    readingType: c.readingType ?? 'ipa',
    contextSentence: c.contextSentence ?? '',
    note: c.note ?? '',
    deckId: c.deckId ?? '',
  };
}

const linesOf = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean);

/** Bậc độ nhớ của MỘT thẻ. Cùng ngôn ngữ hình với thanh phân bố ở trang chính. */
function LevelDots({ level }: { level: number }) {
  return (
    <span className="lvl" data-level={level} title={LEVELS[level - 1]!.name}>
      <span className="lvl-bars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => <i key={i} data-on={i <= level ? '1' : undefined} />)}
      </span>
    </span>
  );
}

/**
 * Thêm / sửa / xoá thẻ trong một bộ.
 *
 * Danh sách nạp theo trang (mặc định 50) và tìm kiếm chạy ở SERVER: một bộ thẻ vài
 * nghìn từ mà kéo hết về rồi filter ở client thì trang đầu tiên phải chờ cả bộ.
 *
 * Sửa xong cập nhật tại chỗ bằng thẻ server trả về, chỉ giữ lại phần tiến độ của
 * hàng cũ — sửa nội dung không đụng tới lịch FSRS, nên không được vẽ lại nó từ
 * giá trị mặc định.
 */
export default function CardManager({
  deckId, decks, initial, pageSize,
}: {
  deckId: string | null;
  decks: Deck[];
  initial: DeckCardsPage;
  pageSize: number;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(initial.cards);
  const [total, setTotal] = useState(initial.total);

  const [term, setTerm] = useState('');       // ô tìm kiếm
  const [applied, setApplied] = useState(''); // từ khoá đang áp dụng cho danh sách
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [editing, setEditing] = useState<string | null>(null); // id thẻ, hoặc 'new'
  const [form, setForm] = useState<Form>(EMPTY);
  const [confirming, setConfirming] = useState<string | null>(null);

  const key = deckId ?? '';
  const oops = (e: unknown) => setErr(e instanceof ApiFail ? e.message : 'Không xong được');
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  /** Nạp lại từ đầu — dùng sau khi tìm kiếm, thêm thẻ, hoặc chuyển thẻ sang bộ khác. */
  async function reload(q: string) {
    setLoading(true);
    setErr(null);
    try {
      const page = await api.deckCards(key, { q, limit: pageSize, offset: 0 });
      setCards(page.cards);
      setTotal(page.total);
      setApplied(q);
    } catch (e) {
      oops(e);
    } finally {
      setLoading(false);
    }
  }

  async function more() {
    setLoading(true);
    try {
      const page = await api.deckCards(key, {
        q: applied, limit: pageSize, offset: cards.length,
      });
      setCards((cs) => [...cs, ...page.cards]);
      setTotal(page.total);
    } catch (e) {
      oops(e);
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    const back = linesOf(form.back);
    if (!form.front.trim() || !back.length) {
      setErr('Cần cả từ và ít nhất một nghĩa');
      return;
    }
    setErr(null);
    setBusy('new');
    try {
      await api.createCard({
        deckId: form.deckId || deckId,
        front: form.front.trim(),
        back,
        pos: form.pos.trim() || null,
        reading: form.reading.trim() || null,
        readingType: form.reading.trim() ? form.readingType : null,
        contextSentence: form.contextSentence.trim() || null,
        note: form.note.trim() || null,
        // Thẻ gõ tay: ngôn ngữ để mặc định như extension, dedupe mới khớp thẻ cũ.
        langFrom: 'auto',
        langTo: 'vi',
      });
      setEditing(null);
      setForm(EMPTY);
      setFlash('Đã thêm thẻ');
      await reload(applied);
      router.refresh();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }

  async function save(card: DeckCard) {
    const back = linesOf(form.back);
    if (!form.front.trim() || !back.length) {
      setErr('Cần cả từ và ít nhất một nghĩa');
      return;
    }
    setErr(null);
    setBusy(card.id);
    try {
      const { card: saved } = await api.updateCard(card.id, {
        deckId: form.deckId || null,
        front: form.front.trim(),
        back,
        pos: form.pos.trim() || null,
        reading: form.reading.trim() || null,
        readingType: form.reading.trim() ? form.readingType : null,
        contextSentence: form.contextSentence.trim() || null,
        note: form.note.trim() || null,
      });
      setEditing(null);

      // Chuyển sang bộ khác thì thẻ không còn thuộc danh sách này nữa.
      const moved = (saved.deckId ?? null) !== deckId;
      if (moved) {
        setCards((cs) => cs.filter((c) => c.id !== card.id));
        setTotal((n) => Math.max(0, n - 1));
        setFlash('Đã chuyển thẻ sang bộ khác');
      } else {
        setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, ...saved } : c)));
        setFlash('Đã lưu');
      }
      router.refresh();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(card: DeckCard) {
    setErr(null);
    setBusy(card.id);
    try {
      await api.deleteCard(card.id);
      setCards((cs) => cs.filter((c) => c.id !== card.id));
      setTotal((n) => Math.max(0, n - 1));
      setConfirming(null);
      setFlash(`Đã xoá "${card.front}"`);
      router.refresh();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }

  const fields = (onSave: () => void, saving: boolean) => (
    <div className="editform">
      <div className="field">
        <label>Từ</label>
        <input
          value={form.front}
          autoFocus
          maxLength={200}
          onChange={(e) => set({ front: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Nghĩa — mỗi dòng một nghĩa</label>
        <textarea
          className="lines"
          value={form.back}
          rows={3}
          onChange={(e) => set({ back: e.target.value })}
        />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Loại từ</label>
          <input
            value={form.pos}
            placeholder="danh từ…"
            onChange={(e) => set({ pos: e.target.value })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Phiên âm</label>
          <input
            value={form.reading}
            placeholder="/ˈbʊk/"
            onChange={(e) => set({ reading: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>Câu ngữ cảnh</label>
        <input
          value={form.contextSentence}
          placeholder="Câu chứa từ này — cần cho mode điền vào câu"
          onChange={(e) => set({ contextSentence: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Ghi chú</label>
        <input value={form.note} onChange={(e) => set({ note: e.target.value })} />
      </div>
      <div className="field">
        <label>Bộ thẻ</label>
        <select value={form.deckId} onChange={(e) => set({ deckId: e.target.value })}>
          {!deckId && <option value="">Không có bộ</option>}
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="row">
        <button className="primary" disabled={saving} onClick={onSave}>
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button className="ghost" onClick={() => { setEditing(null); setErr(null); }}>
          Huỷ
        </button>
      </div>
    </div>
  );

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => { e.preventDefault(); void reload(term.trim()); }}
      >
        <input
          className="lq"
          value={term}
          placeholder="Tìm trong bộ này"
          onChange={(e) => setTerm(e.target.value)}
        />
        <button className="iconbtn" type="submit" aria-label="Tìm">
          <IconSearch size={20} />
        </button>
        {applied && (
          <button className="ghost" type="button" onClick={() => { setTerm(''); void reload(''); }}>
            Bỏ lọc
          </button>
        )}
      </form>

      {err && <p className="err">✕ {err}</p>}
      {flash && !err && <p className="flash">{flash}</p>}

      {editing === 'new' ? (
        fields(() => void create(), busy === 'new')
      ) : (
        <button
          className="addbtn"
          onClick={() => {
            setForm({ ...EMPTY, deckId: deckId ?? '' });
            setEditing('new');
            setFlash(null);
          }}
        >
          <IconPlus size={20} />
          Thêm thẻ
        </button>
      )}

      {!cards.length && (
        <p className="empty">{applied ? 'Không tìm thấy thẻ nào.' : 'Bộ này chưa có thẻ.'}</p>
      )}

      {cards.map((c) => {
        if (editing === c.id) return <div key={c.id}>{fields(() => void save(c), busy === c.id)}</div>;

        return (
          <div className="cardrow" key={c.id}>
            <div className="cardrow-top">
              <div className="cardrow-main">
                <b>
                  {c.front}
                  {c.pos && <span className="pos" style={{ marginLeft: 8 }}>{c.pos}</span>}
                </b>
                <span className="cardrow-back">{c.back.join(' · ')}</span>
                {c.reading && <span className="ipa">{c.reading}</span>}
              </div>
              <div className="mrow-acts">
                <button
                  className="iconbtn"
                  aria-label={`Sửa ${c.front}`}
                  onClick={() => { setForm(formOf(c)); setEditing(c.id); setConfirming(null); setFlash(null); }}
                >
                  <IconPencil size={19} />
                </button>
                <button
                  className="iconbtn danger"
                  aria-label={`Xoá ${c.front}`}
                  onClick={() => setConfirming(confirming === c.id ? null : c.id)}
                >
                  <IconTrash size={19} />
                </button>
              </div>
            </div>

            <div className="cardrow-meta">
              <LevelDots level={c.level} />
              {c.suspended
                ? <span className="n-susp">treo</span>
                : !c.state || c.state === 'new'
                  ? <span className="n-new">mới</span>
                  : c.due
                    ? <span className={new Date(c.due) <= new Date() ? 'n-due' : 'n-zero'}>
                        {new Date(c.due) <= new Date()
                          ? 'đến hạn'
                          : `sau ${humanInterval(c.due)}`}
                      </span>
                    : null}
              {c.lapses > 0 && <span className="n-zero">quên {c.lapses} lần</span>}
            </div>

            {confirming === c.id && (
              <div className="confirm">
                <p>Xoá thẻ <b>{c.front}</b>?</p>
                <button className="warn" disabled={busy === c.id} onClick={() => void remove(c)}>
                  Xoá
                </button>
                <button className="ghost" onClick={() => setConfirming(null)}>Huỷ</button>
              </div>
            )}
          </div>
        );
      })}

      {cards.length < total && (
        <button disabled={loading} onClick={() => void more()}>
          {loading ? 'Đang tải…' : `Xem thêm (còn ${total - cards.length})`}
        </button>
      )}
    </div>
  );
}
