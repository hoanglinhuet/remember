/**
 * Remember - provider layer (M1)
 *
 * Theo ARCHITECTURE §7: mọi provider map về đúng một schema chung (LookupResult),
 * UI chỉ biết schema này. Thêm provider = thêm 1 hàm + 1 dòng trong CHAIN.
 *
 * LookupResult {
 *   source: 'dictionary' | 'mt'
 *   providerId, fetchedAt, fromCache
 *   detectedLang: string|null
 *   primary: string                     // bản dịch / nghĩa chính
 *   reading: string|null                // phiên âm, KHÔNG kèm dấu //
 *   readingType: 'ipa'|'translit'|null  // IPA thì UI bọc trong //, translit thì không
 *   audioUrl: string|null
 *   groups: [{
 *     pos: string|null,                 // khoá tiếng Anh đã chuẩn hoá (để UI dịch + tô màu)
 *     posRaw: string|null,              // chuỗi loại từ y như API trả về
 *     definition: { gloss, example? }|null,   // định nghĩa trong ngôn ngữ gốc
 *     senses: [{ gloss, example?, synonyms?, reverse? }]  // reverse = dịch ngược
 *   }]
 *   license: string|null
 * }
 *
 * ⚠️ GHI CHÚ PHÁP LÝ
 * `translate.googleapis.com/translate_a/single` là endpoint KHÔNG CHÍNH THỨC
 * (không key, không quota công bố, có thể chặn/đổi bất kỳ lúc nào, nằm ngoài ToS
 * của Google). Đây là nguồn duy nhất của Google trả về loại từ + phiên âm:
 * Cloud Translation API chính thức cần API key + billing và CHỈ trả bản dịch thuần.
 * Với bản phát hành công khai, xem REQUIREMENTS §6.5 - nên để user tự chọn bật.
 */

const TIMEOUT_MS = 4000;

/** Đổi thứ tự / bỏ provider ở đây. M1 sẽ đọc từ Settings thay vì hằng số. */
export const PROVIDER_ORDER = ['google', 'freedictionaryapi.com', 'MyMemory'];

/** POS chuẩn hoá về khoá tiếng Anh; UI tự dịch sang nhãn tiếng Việt. */
const POS_CANON = {
  noun: 'noun', n: 'noun', substantive: 'noun',
  verb: 'verb', v: 'verb',
  adjective: 'adjective', adj: 'adjective',
  adverb: 'adverb', adv: 'adverb',
  pronoun: 'pronoun', preposition: 'preposition', conjunction: 'conjunction',
  interjection: 'interjection', exclamation: 'interjection',
  determiner: 'determiner', article: 'determiner', numeral: 'numeral', number: 'numeral',
  phrase: 'phrase', idiom: 'idiom', abbreviation: 'abbreviation',
  prefix: 'affix', suffix: 'affix', particle: 'particle',
};

function canonPos(raw) {
  if (!raw) return null;
  return POS_CANON[String(raw).trim().toLowerCase()] || String(raw).trim().toLowerCase();
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------- provider: Google Translate

/**
 * dj=1 -> JSON có tên field thay vì mảng lồng nhau.
 * hl=en -> nhãn loại từ trả về bằng tiếng Anh để canonPos() hiểu được
 *          (nếu để mặc định, Google trả nhãn theo ngôn ngữ đích).
 * dt: t=bản dịch · bd=từ điển (POS + nghĩa) · rm=transliteration
 *     md=định nghĩa · ex=ví dụ · ss=đồng nghĩa · at=bản dịch thay thế
 */
async function googleTranslate({ text, langTo }) {
  // Luôn sl=auto: thuộc tính lang của trang thường thiếu hoặc sai (trang tiếng Anh
  // nhưng đang chọn từ tiếng Pháp), detection của Google đáng tin hơn.
  const sl = 'auto';
  const to = langTo || 'vi';
  const dt = ['t', 'bd', 'rm', 'md', 'ex', 'ss', 'at'].map((d) => `dt=${d}`).join('&');
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&dj=1&hl=en`
    + `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(to)}&${dt}`
    + `&q=${encodeURIComponent(text)}`;

  const data = await getJson(url);

  const primary = (data.sentences || [])
    .map((s) => s.trans || '')
    .join('')
    .trim();
  if (!primary) return null;

  // Phiên âm: chỉ có khi chữ gốc không phải Latin (tiếng Nhật, Nga, Ả Rập…).
  // Tiếng Anh sẽ không có -> enrichFromDictionary() lấy IPA từ freedictionaryapi.com.
  const reading = (data.sentences || []).find((s) => s.src_translit)?.src_translit || null;
  // src_translit là chuyển tự (romaji, pinyin…), KHÔNG phải IPA -> UI không bọc //.
  const readingType = reading ? 'translit' : null;

  // Định nghĩa theo POS (ngôn ngữ gốc), lập chỉ mục để ghép vào nhóm tương ứng.
  const defByPos = new Map();
  for (const d of data.definitions || []) {
    const pos = canonPos(d.pos);
    const first = (d.entry || [])[0];
    if (!first?.gloss || defByPos.has(pos)) continue;
    defByPos.set(pos, { gloss: first.gloss, example: first.example || null, posRaw: d.pos || null });
  }

  const groups = [];

  // data.dict: các nghĩa dịch sang ngôn ngữ đích, đã nhóm theo loại từ.
  for (const d of data.dict || []) {
    const pos = canonPos(d.pos);
    const posRaw = d.pos || null;
    // Giữ tới 10 nghĩa: UI hiện 3, phần còn lại nằm sau nút "xem thêm".
    const senses = (d.entry || []).slice(0, 10).map((e) => ({
      gloss: e.word,
      // reverse_translation = các từ gốc dịch ngược lại, KHÔNG phải đồng nghĩa.
      // Đây chính là "reverse translation" ở FR-A1, dùng để kiểm chứng nghĩa.
      // Giữ tới 8: UI hiện 3, phần còn lại nằm sau nút "xem thêm".
      reverse: (e.reverse_translation || []).slice(0, 8),
    })).filter((s) => s.gloss);
    if (!senses.length) continue;
    groups.push({ pos, posRaw, definition: defByPos.get(pos) || null, senses });
    defByPos.delete(pos);
  }

  // POS chỉ có định nghĩa mà không có nghĩa dịch -> vẫn hiện, đừng bỏ.
  for (const [pos, definition] of defByPos) {
    groups.push({ pos, posRaw: definition.posRaw || pos, definition, senses: [{ gloss: definition.gloss }] });
  }

  // Bản dịch chính đôi khi KHÔNG nằm trong data.dict (vd "resilient" -> primary
  // "đàn hồi" nhưng dict chỉ có "bật lên"/"dội lên"). Không đưa vào thì nghĩa
  // thông dụng nhất lại không chọn được để làm mặt sau thẻ.
  // (Lỗi này đã sửa ở web app từ trước nhưng chưa port sang đây — đúng kiểu phân kỳ
  //  mà `packages/domain` dùng chung sinh ra để chặn.)
  const inSenses = groups.some((g) =>
    g.senses.some((x) => x.gloss.toLowerCase() === primary.toLowerCase()));
  if (groups.length && !inSenses) {
    groups.unshift({
      pos: null, posRaw: null, definition: null,
      senses: [{ gloss: primary }], isPrimary: true,
    });
  }

  // Cụm/câu: không có từ điển -> một nhóm không POS, kèm bản dịch thay thế.
  if (!groups.length) {
    const alts = (data.alternative_translations?.[0]?.alternative || [])
      .map((a) => String(a.word_postproc || '').trim())
      .filter((w, i, arr) => w && w.toLowerCase() !== primary.toLowerCase() && arr.indexOf(w) === i)
      .slice(0, 3);
    groups.push({
      pos: null,
      posRaw: null,
      definition: null,
      senses: [{ gloss: primary }, ...alts.map((w) => ({ gloss: w }))],
    });
  }

  // Ví dụ dùng từ trong ngôn ngữ gốc: gắn vào nhóm đầu nếu nhóm đó chưa có ví dụ.
  const example = (data.examples?.example || [])[0]?.text;
  if (example && groups[0] && !groups[0].definition?.example) {
    groups[0].senses[0].example = String(example).replace(/<\/?b>/g, '');
  }

  return {
    source: 'dictionary',
    providerId: 'Google Translate',
    detectedLang: data.src || null,
    primary,
    reading,
    readingType,
    audioUrl: null,
    groups,
    license: null,
  };
}

// ---------------------------------------------- provider: freedictionaryapi.com

/**
 * https://freedictionaryapi.com/api/v1/entries/en/{word}
 * Nguồn Wiktionary (CC BY-SA 4.0) - bắt buộc ghi công khi hiển thị.
 *
 * Shape thực tế (đã kiểm chứng):
 * { word, source, entries: [{
 *     language: { code, name },
 *     partOfSpeech: "adjective",
 *     pronunciations: [{ type: "ipa", text: "/ɹɪˈzɪl.jənt/", tags }],
 *     forms: [...],
 *     senses: [{ definition, examples?, quotes: [{ text, reference }], synonyms?, antonyms?, subsenses? }],
 *     synonyms: [...], antonyms: [...]
 * }] }
 */
const SINGLE_WORD = /^[a-zA-Z][a-zA-Z'-]*$/;

export function isSingleWord(text) {
  return SINGLE_WORD.test(text.trim());
}

async function fetchFreeDictionary(text) {
  if (!isSingleWord(text)) return null;
  const data = await getJson(
    `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(text.trim().toLowerCase())}`,
  );
  return Array.isArray(data?.entries) && data.entries.length ? data : null;
}

/** Lấy ví dụ: `examples` là mảng chuỗi, `quotes` là mảng object có .text. */
function senseExample(sense) {
  const ex = (sense.examples || []).find((e) => typeof e === 'string' ? e : e?.text);
  if (ex) return typeof ex === 'string' ? ex : ex.text;
  return (sense.quotes || [])[0]?.text || null;
}

/** Trả IPA đã bỏ dấu / hoặc [ ] ở hai đầu - UI tự bọc lại, tránh thành //x//. */
function firstIpa(entry) {
  const list = entry.pronunciations || [];
  const ipa = list.find((p) => String(p.type).toLowerCase() === 'ipa' && p.text);
  const raw = (ipa || list.find((p) => p.text))?.text;
  return raw ? String(raw).trim().replace(/^[/[]+|[/\]]+$/g, '').trim() || null : null;
}

/** Chuẩn hoá về LookupResult - dùng khi làm provider chính (từ đơn tiếng Anh). */
async function freeDictionary({ text, langFrom }) {
  if (langFrom !== 'en' && langFrom !== 'auto') return null;
  const data = await fetchFreeDictionary(text);
  if (!data) return null;

  const buckets = new Map();
  let reading = null;

  for (const entry of data.entries) {
    reading ||= firstIpa(entry);
    const pos = canonPos(entry.partOfSpeech);
    if (!buckets.has(pos)) buckets.set(pos, { posRaw: entry.partOfSpeech || null, senses: [] });
    const bucket = buckets.get(pos).senses;

    for (const sense of entry.senses || []) {
      if (!sense.definition || bucket.length >= 8) continue;
      if (bucket.some((x) => x.gloss === sense.definition)) continue;
      bucket.push({
        gloss: sense.definition,
        example: senseExample(sense),
        synonyms: (sense.synonyms?.length ? sense.synonyms : entry.synonyms || []).slice(0, 8),
      });
    }
  }

  const groups = [...buckets]
    .filter(([, b]) => b.senses.length)
    .map(([pos, b]) => ({ pos, posRaw: b.posRaw, definition: null, senses: b.senses }));
  if (!groups.length) return null;

  return {
    source: 'dictionary',
    providerId: 'freedictionaryapi.com',
    detectedLang: 'en',
    primary: groups[0].senses[0].gloss,
    reading,
    readingType: reading ? 'ipa' : null,
    audioUrl: null,
    groups,
    license: 'Wiktionary · CC BY-SA 4.0',
  };
}

/**
 * Bổ sung cho kết quả của provider chính (thường là Google, vốn không có IPA
 * cho chữ Latin): lấy IPA + định nghĩa gốc theo từng loại từ.
 * Chỉ áp dụng cho TỪ ĐƠN. Thất bại thì bỏ qua - đây là phần thêm, không phải điều kiện.
 */
export async function enrichFromDictionary(result, text) {
  if (!isSingleWord(text)) return;
  if (result.detectedLang && result.detectedLang !== 'en') return;

  const data = await fetchFreeDictionary(text);
  if (!data) return;

  // IPA
  for (const entry of data.entries) {
    const ipa = firstIpa(entry);
    if (!ipa) continue;
    // IPA thật đáng tin hơn chuyển tự của Google -> ghi đè cả khi đã có translit.
    if (!result.reading || result.readingType !== 'ipa') {
      result.reading = ipa;
      result.readingType = 'ipa';
    }
    break;
  }

  // Định nghĩa tiếng Anh, lập chỉ mục theo loại từ
  const defByPos = new Map();
  for (const entry of data.entries) {
    const pos = canonPos(entry.partOfSpeech);
    if (defByPos.has(pos)) continue;
    const sense = (entry.senses || []).find((x) => x.definition);
    if (sense) defByPos.set(pos, { gloss: sense.definition, example: senseExample(sense) });
  }

  for (const group of result.groups || []) {
    if (!group.definition && group.pos && defByPos.has(group.pos)) {
      group.definition = defByPos.get(group.pos);
    }
  }

  if (defByPos.size) {
    result.license = result.license
      ? `${result.license} · Wiktionary CC BY-SA 4.0`
      : 'Wiktionary · CC BY-SA 4.0';
  }
}

// -------------------------------------------------------- provider: MyMemory

/** Máy dịch thuần: không POS, không IPA. Chốt chặn cuối. */
async function myMemory({ text, langFrom, langTo }) {
  const from = langFrom && langFrom !== 'auto' ? langFrom : 'en';
  const to = langTo || 'vi';
  if (from === to) return null;

  const data = await getJson(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`,
  );
  const primary = data?.responseData?.translatedText?.trim();
  if (!primary || /^(NO QUERY SPECIFIED|MYMEMORY WARNING)/i.test(primary)) return null;

  const alts = (data.matches || [])
    .map((m) => String(m.translation || '').trim())
    .filter((t, i, arr) => t && t.toLowerCase() !== primary.toLowerCase() && arr.indexOf(t) === i)
    .slice(0, 3);

  return {
    source: 'mt',
    providerId: 'MyMemory',
    detectedLang: from,
    primary,
    reading: null,
    readingType: null,
    audioUrl: null,
    groups: [{ pos: null, posRaw: null, definition: null, senses: [{ gloss: primary }, ...alts.map((t) => ({ gloss: t }))] }],
    license: null,
  };
}

// ------------------------------------------------------------------- chain

const PROVIDERS = {
  google: googleTranslate,
  'freedictionaryapi.com': freeDictionary,
  MyMemory: myMemory,
};

/**
 * Chạy chuỗi provider theo PROVIDER_ORDER; lỗi hoặc null -> provider tiếp theo.
 * `onUsed(providerId)` trả false nếu hết budget ngày -> bỏ qua provider đó.
 * Trả { result, attempts }; attempts để UI hiện lý do khi thất bại (J5).
 */
export async function runChain(req, onUsed) {
  const attempts = [];

  for (const id of PROVIDER_ORDER) {
    const fn = PROVIDERS[id];
    if (!fn) continue;
    try {
      if (onUsed && (await onUsed(id)) === false) {
        attempts.push({ id, reason: 'hết hạn mức hôm nay' });
        continue;
      }
      const result = await fn(req);
      if (!result) {
        attempts.push({ id, reason: 'không có kết quả' });
        continue;
      }

      // Từ đơn: bù IPA + định nghĩa gốc từ freedictionaryapi.com.
      // Google không trả IPA cho chữ Latin. Bỏ qua nếu lỗi - không làm hỏng kết quả chính.
      if (id !== 'freedictionaryapi.com') {
        try {
          await enrichFromDictionary(result, req.text);
        } catch { /* IPA/định nghĩa là phần thêm, không phải điều kiện thành công */ }
      }
      return { result, attempts };
    } catch (e) {
      attempts.push({ id, reason: e?.name === 'AbortError' ? 'quá 4s' : String(e?.message || e) });
    }
  }
  return { result: null, attempts };
}
