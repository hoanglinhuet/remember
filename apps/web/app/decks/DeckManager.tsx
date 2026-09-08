'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiFail } from '@/lib/client/api';
import type { DeckSummary } from '@/lib/domain/types';
import { IconChevron, IconPencil, IconPlus, IconTrash } from '../_components/Icons';

/** Nhóm thẻ mồ côi (deck đã bị xoá) dùng id rỗng ở read model; URL cần một tên. */
const NO_DECK = 'none';

type Busy = { id: string; what: 'rename' | 'delete' } | null;

/**
 * Thêm / sửa tên / xoá bộ thẻ.
 *
 * Danh sách giữ ở state chứ không chỉ dựa vào `router.refresh()`: refresh phải chờ
 * server render xong cả trang, trong khoảng đó danh sách vẫn hiện thứ vừa bị xoá.
 * Vẫn gọi refresh sau mỗi thay đổi để số đếm (đến hạn / mới) tính lại ở server.
 */
export default function DeckManager({ initial }: { initial: DeckSummary[] }) {
  const router = useRouter();
  const [decks, setDecks] = useState(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [err, setErr] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const oops = (e: unknown) => setErr(e instanceof ApiFail ? e.message : 'Không xong được');

  async function add() {
    const name = newName.replace(/\s+/g, ' ').trim();
    if (!name) return;
    setErr(null);
    setBusy({ id: 'new', what: 'rename' });
    try {
      const { deck, existed } = await api.createDeck(name);
      setNewName('');
      setAdding(false);
      if (existed) setErr(`Đã có bộ tên "${deck.name}"`);
      router.refresh();
      if (!existed) {
        setDecks((ds) => [
          ...ds,
          {
            id: deck.id, name: deck.name, parentId: null, sortOrder: ds.length,
            updatedAt: new Date().toISOString(),
            total: 0, due: 0, fresh: 0, suspended: 0, levels: [0, 0, 0, 0, 0],
          },
        ]);
      }
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }

  async function rename(id: string) {
    const name = editName.replace(/\s+/g, ' ').trim();
    if (!name) return;
    setErr(null);
    setBusy({ id, what: 'rename' });
    try {
      const { deck } = await api.renameDeck(id, name);
      setDecks((ds) => ds.map((d) => (d.id === id ? { ...d, name: deck.name } : d)));
      setEditing(null);
      router.refresh();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, mode: 'move' | 'delete') {
    setErr(null);
    setBusy({ id, what: 'delete' });
    try {
      const r = await api.deleteDeck(id, mode);
      setDecks((ds) => ds.filter((d) => d.id !== id));
      setConfirming(null);
      // Nói rõ thẻ đã đi đâu: xoá bộ thẻ là thao tác người dùng dễ hiểu sai nhất.
      if (r.cards) {
        setErr(
          mode === 'delete'
            ? `Đã xoá bộ thẻ và ${r.cards} thẻ trong đó`
            : `Đã xoá bộ thẻ, ${r.cards} thẻ chuyển sang "${r.movedTo?.name ?? 'Không có bộ'}"`,
        );
      }
      router.refresh();
    } catch (e) {
      oops(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {err && <p className="flash">{err}</p>}

      {adding ? (
        <div className="editform">
          <div className="field">
            <label htmlFor="deck-new">Tên bộ thẻ mới</label>
            <input
              id="deck-new"
              value={newName}
              autoFocus
              maxLength={60}
              placeholder="Ví dụ: Từ trong bài đọc"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
          </div>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => void add()}>
              Tạo bộ thẻ
            </button>
            <button className="ghost" onClick={() => { setAdding(false); setNewName(''); }}>
              Huỷ
            </button>
          </div>
        </div>
      ) : (
        <button className="addbtn" onClick={() => setAdding(true)}>
          <IconPlus size={20} />
          Thêm bộ thẻ
        </button>
      )}

      {!decks.length && <p className="empty">Chưa có bộ thẻ nào.</p>}

      {decks.map((d) => {
        const id = d.id || NO_DECK;
        const orphan = !d.id;

        if (editing === d.id && !orphan) {
          return (
            <div className="editform" key={id}>
              <div className="field">
                <label htmlFor={`deck-${id}`}>Tên bộ thẻ</label>
                <input
                  id={`deck-${id}`}
                  value={editName}
                  autoFocus
                  maxLength={60}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void rename(d.id)}
                />
              </div>
              <div className="row">
                <button className="primary" disabled={!!busy} onClick={() => void rename(d.id)}>
                  Lưu
                </button>
                <button className="ghost" onClick={() => setEditing(null)}>Huỷ</button>
              </div>
            </div>
          );
        }

        return (
          <div className="mrow" key={id}>
            <Link className="mrow-main" href={`/decks/${id}`}>
              <span className="deck-tile" aria-hidden="true">
                {(d.name.trim().charAt(0) || '?').toUpperCase()}
              </span>
              <span className="deck-main">
                <b>{d.name}</b>
                <span className="deck-counts">
                  <span className="n-zero">{d.total} thẻ</span>
                  {d.due > 0 && <span className="n-due">{d.due} đến hạn</span>}
                  {d.fresh > 0 && <span className="n-new">{d.fresh} mới</span>}
                </span>
              </span>
              <IconChevron size={20} className="chev" />
            </Link>

            {/* Nhóm "không có bộ" là ảo — không sửa tên, không xoá được. */}
            {!orphan && (
              <div className="mrow-acts">
                <button
                  className="iconbtn"
                  aria-label={`Đổi tên ${d.name}`}
                  onClick={() => { setEditing(d.id); setEditName(d.name); setConfirming(null); }}
                >
                  <IconPencil size={19} />
                </button>
                <button
                  className="iconbtn danger"
                  aria-label={`Xoá ${d.name}`}
                  onClick={() => { setConfirming(confirming === d.id ? null : d.id); setEditing(null); }}
                >
                  <IconTrash size={19} />
                </button>
              </div>
            )}

            {confirming === d.id && (
              <div className="confirm">
                <p>
                  Xoá <b>{d.name}</b>
                  {d.total > 0 && <> — trong đó có {d.total} thẻ</>}?
                </p>
                {d.total > 0 && (
                  <button disabled={!!busy} onClick={() => void remove(d.id, 'move')}>
                    Giữ thẻ, chuyển sang bộ khác
                  </button>
                )}
                <button
                  className="warn"
                  disabled={!!busy}
                  onClick={() => void remove(d.id, d.total > 0 ? 'delete' : 'move')}
                >
                  {d.total > 0 ? `Xoá cả ${d.total} thẻ` : 'Xoá bộ thẻ'}
                </button>
                <button className="ghost" onClick={() => setConfirming(null)}>Huỷ</button>
              </div>
            )}
          </div>
        );
      })}

      <p className="muted">
        Xoá thẻ là xoá mềm: lịch sử ôn được giữ lại, và bạn lưu lại đúng từ đó sau này
        vẫn được.
      </p>
    </div>
  );
}
