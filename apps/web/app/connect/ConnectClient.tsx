'use client';

import { useState } from 'react';
import { api, ApiFail } from '@/lib/client/api';

/**
 * Tạo mã ghép nối cho extension.
 *
 * Mã sống 10 phút và dùng MỘT lần. Bấm tạo lần nữa thì mã trước hết tác dụng —
 * nên không tồn đọng mã cũ còn dùng được.
 */
export default function ConnectClient() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      const res = await api.createPairingCode();
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : 'Không tạo được mã');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('Không sao chép được — bạn chọn và copy thủ công');
    }
  };

  const minutesLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000))
    : null;

  return (
    <div className="stack">
      <ol className="steps">
        <li>Bấm <b>Tạo mã kết nối</b> bên dưới.</li>
        <li>Mở popup extension → mục <b>Tài khoản</b> → dán mã vào.</li>
        <li>Xong. Từ đó extension lưu thẻ thẳng vào tài khoản này.</li>
      </ol>

      <button className="btn primary" onClick={() => void create()} disabled={busy}>
        {busy ? '…' : code ? 'Tạo mã mới' : 'Tạo mã kết nối'}
      </button>

      {err && <p className="err">✕ {err}</p>}

      {code && (
        <>
          <code className="paircode" onClick={() => void copy()} title="Bấm để sao chép">
            {code}
          </code>
          <div className="row">
            <button className="btn" onClick={() => void copy()}>
              {copied ? '✓ đã sao chép' : 'Sao chép'}
            </button>
            {minutesLeft !== null && (
              <span className="muted">hết hạn sau ~{minutesLeft} phút</span>
            )}
          </div>
          <p className="muted">
            Mã dùng <b>một lần</b>. Tạo mã mới thì mã này hết tác dụng ngay.
          </p>
        </>
      )}
    </div>
  );
}
