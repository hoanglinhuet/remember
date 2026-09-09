# Test của extension

Chạy bằng **node thuần**, không có runner, không có dependency:

```bash
node extension/test/highlight-domain.test.mjs    # công tắc highlight theo tên miền
node extension/test/highlight-content.test.mjs   # máy trạng thái bật/tắt ở content script
node extension/test/highlight-matcher.test.mjs   # khớp từ: cụm/từ đơn, dấu tiếng Việt, escape
node extension/test/popup-scripts.test.mjs       # popup.js có thật sự chạy được không
node extension/test/context-menu.test.mjs        # menu chuột phải: đúng frame, và lùi về lưu thô khi cần
node extension/test/save-dedupe.test.mjs         # kiểm trùng khi lưu: nguồn nào, khoá nào
```

Exit code khác 0 = có case FAIL.

## Vì sao có mấy file này

Sáu file, và cả sáu đều tồn tại vì **cùng một lỗi quay lại nhiều lần**: tắt highlight mà
trang vẫn còn màu. Nguyên nhân không nằm ở một dòng code sai mà ở *trạng thái*: bộ từ lấy
từ nguồn nào, ai là nguồn sự thật, và một content script bị vô hiệu hoá thì để lại gì
trên trang. Đó là loại lỗi không đọc ra được, phải chạy mới thấy.

## Cách chúng chạy được ngoài browser

Không có Chrome, không có DOM — hai thứ đó bị **stub**:

- `highlight-domain.test.mjs` dựng `globalThis.chrome` (storage/runtime/alarms/…) và
  `fetch`, rồi `import` thẳng service worker. Service worker tự đăng ký
  `chrome.runtime.onMessage`, nên test bắt được listener đó và gọi đúng các message mà
  popup và content script vẫn gọi (`GET_HIGHLIGHT`, `SET_HIGHLIGHT_FOR_HOST`,
  `GET_HIGHLIGHT_STATE`). "Server" là một object trong bộ nhớ, chuẩn hoá host giống
  `apps/web/lib/domain/host.ts`.
- `highlight-content.test.mjs` dựng DOM giả (một `createTreeWalker` chạy trên vài text
  node), `CSS.highlights` giả ghi lại từng lời gọi `set`/`delete`, và `MutationObserver`
  giả. Nhờ vậy kiểm được cả ca khó nhất: **context extension đã chết** (vừa Reload
  extension mà tab chưa F5) thì script cũ phải tự xoá màu và ngắt observer.

Giới hạn phải biết: stub không phải browser. Những thứ chỉ browser mới trả lời được —
`::highlight()` có vẽ ra màu thật hay không, isolated world có dùng chung
`CSS.highlights` với trang hay không — vẫn phải thử tay trên một trang thật.
