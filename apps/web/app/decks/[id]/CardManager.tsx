'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import type { DeckCard, DeckCardsPage } from '@/lib/ports/queries';
import { humanInterval } from '@/lib/domain/day';
import { LEVELS } from '@/lib/domain/memory';
import { IconSearch, IconTrash } from '../../_components/Icons';

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
 * Xem và XOÁ thẻ trong một bộ.
 *
 * Cố ý KHÔNG có sửa và thêm thẻ: thẻ sinh ra từ lúc đọc — bôi đen từ trên trang web
 * hoặc tra ở /lookup — nên ở đó mới có ngữ cảnh, phiên âm, loại từ và câu chứa từ.
 * Một form gõ tay trong màn quản lý chỉ dựng lại được phần vỏ của những thứ đó.
 *
 * Danh sách nạp theo trang (mặc định 50) và tìm kiếm chạy ở SERVER: một bộ vài nghìn
 * từ mà kéo hết về rồi filter ở client thì trang đầu phải chờ cả bộ.
 */
export default function CardManager({
  deckId, initial, pageSize,
}: {
  deckId: string | null;
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
  const [confirming, setConfirming] = useState<string | null>(null);

  const key = deckId ?? '';
  const oops = (e: unknown) => setErr(e instanceof ApiFail ? e.message : 'Không xong được');

  /** Nạp lại từ đầu — dùng sau khi tìm kiếm hoặc bỏ lọc. */
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

      {!cards.length && (
        <p className="empty">
          {applied
            ? 'Không tìm thấy thẻ nào.'
            : 'Bộ này chưa có thẻ. Thẻ được lưu khi bạn bôi đen từ trên web, hoặc tra từ ở tab Tra từ.'}
        </p>
      )}

      {cards.map((c) => (
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
                className="iconbtn danger"
                aria-label={`Xoá ${c.front}`}
                onClick={() => { setConfirming(confirming === c.id ? null : c.id); setFlash(null); }}
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
                      {new Date(c.due) <= new Date() ? 'đến hạn' : `sau ${humanInterval(c.due)}`}
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
      ))}

      {cards.length < total && (
        <button disabled={loading} onClick={() => void more()}>
          {loading ? 'Đang tải…' : `Xem thêm (còn ${total - cards.length})`}
        </button>
      )}
    </div>
  );
}
