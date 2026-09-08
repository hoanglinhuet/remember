/**
 * Remember — mobile redesign, Figma build script.
 *
 * HOW TO RUN (no MCP quota needed):
 *   1. Open the Figma file: https://www.figma.com/design/fipSXZKcMDe2flNalPjmpf
 *   2. Install the free "Scripter" plugin (Figma Community).
 *   3. Plugins -> Scripter, paste this whole file, press Cmd/Ctrl+Enter.
 *
 * Already done in the file, so this script does NOT redo it:
 *   - 44 variables in the "Remember" collection (bright palette + cat/* hues)
 *   - 16 text styles
 *   - Components: TabBar (4 variants), Button, GradeButton, LevelRamp, DeckCard, StatTile
 *
 * What this script builds:
 *   - page "01 Foundations": the token / type specimen sheet
 *   - page "03 Screens": 13 artboards at 390x844
 */

const PAGE_FOUNDATIONS = '0:1';
const PAGE_SCREENS = '2:6';
const TABSET_ID = '10:122';

/* ============================== preamble ============================== */

for (const s of ['Regular', 'Medium', 'SemiBold']) await figma.loadFontAsync({ family: 'Be Vietnam Pro', style: s });
for (const s of ['Regular', 'SemiBold', 'Italic']) await figma.loadFontAsync({ family: 'Source Serif 4', style: s });

const allVars = await figma.variables.getLocalVariablesAsync();
const V = {}; for (const v of allVars) V[v.name] = v;
const ST = {}; for (const s of await figma.getLocalTextStylesAsync()) ST[s.name] = s;

const paint = (n) => figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', V[n]);
const setFill = (n, k) => { n.fills = [paint(k)]; };
const setStroke = (n, k) => { n.strokes = [paint(k)]; };
const WHITE = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];

async function txt(chars, style, cv) {
  const t = figma.createText();
  await t.setTextStyleIdAsync(ST[style].id);
  t.characters = chars; setFill(t, cv); return t;
}
async function para(parent, chars, style, cv) {
  const t = await txt(chars, style, cv);
  t.textAutoResize = 'HEIGHT';
  parent.appendChild(t); t.layoutSizingHorizontal = 'FILL'; return t;
}
/**
 * figma.createAutoLayout() exists only inside the Figma MCP sandbox — it is NOT
 * part of the real Plugin API that Scripter runs against. Build the frame by hand.
 * layoutMode must be set BEFORE the sizing modes, or they are rejected.
 */
function autoLayout(direction, props) {
  const f = figma.createFrame();
  f.layoutMode = direction;
  f.primaryAxisSizingMode = 'AUTO';
  f.counterAxisSizingMode = 'AUTO';
  if (props) for (const k in props) f[k] = props[k];
  return f;
}
function col(name, gap, o) { const f = autoLayout('VERTICAL', Object.assign({ name, itemSpacing: gap }, o || {})); f.fills = []; return f; }
function row(name, gap, o) { const f = autoLayout('HORIZONTAL', Object.assign({ name, itemSpacing: gap }, o || {})); f.fills = []; return f; }
function pad(f, t, r, b, l) { f.paddingTop = t; f.paddingRight = r; f.paddingBottom = b; f.paddingLeft = l; }
// resize() resets sizing modes, so always resize FIRST then re-enable AUTO
function fixedW(f, w, h) { f.counterAxisSizingMode = 'FIXED'; f.resize(w, h); f.primaryAxisSizingMode = 'AUTO'; }
// layoutGrow is a FLAG in the real Plugin API: only 0 or 1 is accepted, never a
// weight and never a fraction. Proportional widths must be computed in pixels.
function grow(parent) { const s = figma.createFrame(); s.resize(4, 4); s.fills = []; parent.appendChild(s); s.layoutGrow = 1; return s; }
function vspace(parent, h) { const s = figma.createFrame(); s.resize(10, h); s.fills = []; parent.appendChild(s); s.layoutSizingHorizontal = 'FILL'; return s; }
function fixedRect(parent, w, h, r, cv) {
  const n = figma.createRectangle(); n.resize(w, h); n.cornerRadius = r === undefined ? 0 : r;
  if (cv) setFill(n, cv);
  if (parent) parent.appendChild(n);
  return n;
}
function iconFrame(name) { const f = figma.createFrame(); f.name = name; f.resize(24, 24); f.fills = []; f.clipsContent = true; return f; }

/* ------------------------------- icons -------------------------------- */
function icoCards(cv) {           // flashcard stack — the app's own object
  const f = iconFrame('icon/cards');
  const back = fixedRect(f, 15, 11, 2.5); back.x = 5.5; back.y = 2.5;
  back.fills = []; setStroke(back, cv); back.strokeWeight = 1.8;
  const front = fixedRect(f, 15, 12, 2.5, cv); front.x = 3.5; front.y = 9;
  return f;
}
/**
 * Magnifier. The glyph is centred by arithmetic, not by eye:
 *   ring  14 wide at 3.5 -> spans 3.5..17.5, and the 2.4 stroke is CENTRE-aligned
 *         so it actually paints 2.3..18.7
 *   handle 7.2 long, centred (18.3,18.3) at 45deg -> paints ~14.9..21.7
 *   union 2.3..21.7, midpoint 12.0 = the centre of the 24x24 box
 * The previous values put the union midpoint at 10.3, i.e. 1.7px up and left,
 * which is what read as off-centre inside the search button.
 */
function icoSearch(cv) {
  const f = iconFrame('icon/search');
  const ring = figma.createEllipse(); ring.resize(14, 14); ring.x = 3.5; ring.y = 3.5;
  ring.fills = []; setStroke(ring, cv); ring.strokeWeight = 2.4;
  ring.strokeAlign = 'CENTER';
  f.appendChild(ring);
  bar(f, 18.3, 18.3, 7.2, 2.4, 45, cv);
  return f;
}
function icoBars(cv) {            // ascending bars — echoes the level ramp
  const f = iconFrame('icon/bars');
  const a = fixedRect(f, 4.5, 7, 1.4, cv); a.x = 3.5; a.y = 14;
  const b = fixedRect(f, 4.5, 12, 1.4, cv); b.x = 9.75; b.y = 9;
  const c = fixedRect(f, 4.5, 17, 1.4, cv); c.x = 16; c.y = 4;
  return f;
}
function icoPerson(cv) {
  const f = iconFrame('icon/person');
  const head = figma.createEllipse(); head.resize(8, 8); head.x = 8; head.y = 2.5;
  setFill(head, cv); f.appendChild(head);
  const sh = fixedRect(f, 19, 13, 9.5, cv); sh.x = 2.5; sh.y = 13;
  return f;
}
/**
 * Place a bar of w×h with its CENTRE exactly at (cx,cy), rotated by `deg`.
 *
 * Setting `relativeTransform` directly instead of `.rotation` — `.rotation` pivots
 * around a corner, not the centre, which on the first run silently produced a "<"
 * where a "✕" belonged and vice versa. This is deterministic.
 */
function bar(parent, cx, cy, w, h, deg, cv) {
  const n = figma.createRectangle();
  n.resize(w, h); n.cornerRadius = h / 2;
  setFill(n, cv);
  parent.appendChild(n);
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  n.relativeTransform = [
    [c, -s, cx - (c * w / 2 - s * h / 2)],
    [s, c, cy - (s * w / 2 + c * h / 2)],
  ];
  return n;
}
const DIAG = 9.9;   // length of a 7x7 diagonal stroke
function icoBack(cv) {            // "<"  — both strokes meet at (7,12)
  const f = iconFrame('icon/back');
  bar(f, 10.5, 8.5, DIAG, 2, -45, cv);
  bar(f, 10.5, 15.5, DIAG, 2, 45, cv);
  return f;
}
function icoChevron(cv) {         // ">"  — both strokes meet at (17,12)
  const f = iconFrame('icon/chevron');
  bar(f, 13.5, 8.5, DIAG, 2, 45, cv);
  bar(f, 13.5, 15.5, DIAG, 2, -45, cv);
  return f;
}
function icoClose(cv) {           // "✕"  — both strokes share centre (12,12)
  const f = iconFrame('icon/close');
  bar(f, 12, 12, 16, 2, 45, cv);
  bar(f, 12, 12, 16, 2, -45, cv);
  return f;
}
function icoTick(cv) {
  const f = iconFrame('icon/tick');
  bar(f, 7.25, 14.75, 6.4, 2, 45, cv);
  bar(f, 13.75, 12, 13.1, 2, -49.6, cv);
  return f;
}
/**
 * Speaker, built only from axis-aligned rectangles: body + a three-step cone +
 * two sound bars. The earlier version used createPolygon().rotation for the cone
 * and stroked ellipses for the waves; both rendered as an unreadable smudge.
 * `scale` lets the 88px listen button carry a proportionate glyph.
 */
function icoSpeaker(cv, size) {
  const s = (size || 24) / 24;
  const f = iconFrame('icon/speaker');
  f.resize(24 * s, 24 * s);
  const R = (x, y, w, h, r) => { const n = fixedRect(f, w * s, h * s, r * s, cv); n.x = x * s; n.y = y * s; };
  R(3.5, 9.5, 4, 5, 1);           // body
  R(7.5, 7.5, 2, 9, 0.6);         // cone, stepped
  R(9.5, 5.5, 2, 13, 0.6);
  R(11.5, 3.5, 2, 17, 0.6);
  R(16.5, 8.5, 2, 7, 1);          // sound
  R(19.5, 6, 2, 12, 1);
  return f;
}
function icoSliders(cv) {
  const f = iconFrame('icon/sliders');
  for (const [y, w] of [[5, 16], [11, 11], [17, 6]]) { const b = fixedRect(f, w, 2.4, 1.2, cv); b.x = 4; b.y = y; }
  return f;
}
function icoPlug(cv) {
  const f = iconFrame('icon/plug');
  for (const x of [9, 13.2]) { const p = fixedRect(f, 2.2, 6, 1.1, cv); p.x = x; p.y = 2.5; }
  const body = fixedRect(f, 12, 7.5, 2.5, cv); body.x = 6; body.y = 9;
  const tail = fixedRect(f, 3.4, 5, 1.4, cv); tail.x = 10.3; tail.y = 16;
  return f;
}

/* ---------------------------- shared blocks --------------------------- */
function screen(name, x, y) {
  const f = figma.createFrame(); f.name = name; f.resize(390, 844);
  f.layoutMode = 'VERTICAL'; f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
  f.itemSpacing = 0; f.clipsContent = true; f.x = x; f.y = y;
  setFill(f, 'bg/paper'); return f;
}
async function statusBar(parent) {
  const sb = row('StatusBar', 0, { counterAxisAlignItems: 'CENTER' });
  pad(sb, 0, 20, 0, 20);
  sb.counterAxisSizingMode = 'FIXED'; sb.resize(390, 50);
  parent.appendChild(sb); sb.layoutSizingHorizontal = 'FILL'; sb.layoutSizingVertical = 'FIXED';
  sb.appendChild(await txt('9:41', 'ui/micro', 'text/primary'));
  grow(sb);
  const d = row('indicators', 4, { counterAxisAlignItems: 'CENTER' });
  sb.appendChild(d);
  for (const w of [13, 12, 22]) fixedRect(d, w, 9, 2, 'text/tertiary');
  return sb;
}
async function titleBar(parent, title, sub) {
  const h = col('Header', 2); pad(h, 4, 20, 16, 20);
  parent.appendChild(h); h.layoutSizingHorizontal = 'FILL';
  h.appendChild(await txt(title, 'ui/title', 'text/primary'));
  if (sub) h.appendChild(await txt(sub, 'ui/meta', 'text/secondary'));
  return h;
}
async function topBar(parent, title) {
  const h = row('TopBar', 6, { counterAxisAlignItems: 'CENTER' });
  pad(h, 2, 20, 14, 12);
  parent.appendChild(h); h.layoutSizingHorizontal = 'FILL';
  const btn = row('back', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  btn.counterAxisSizingMode = 'FIXED'; btn.resize(40, 40); btn.primaryAxisSizingMode = 'FIXED';
  btn.appendChild(icoBack('text/primary'));
  h.appendChild(btn);
  h.appendChild(await txt(title, 'ui/title', 'text/primary'));
  return h;
}
/**
 * THE SIGNATURE ELEMENT. Memory levels 1..5 are ordinal, so one sequential ramp,
 * pale to deep — not five unrelated hues as the shipped CSS has it.
 *
 * Segment widths are computed in pixels, NOT via layoutGrow: the real Plugin API
 * only accepts layoutGrow 0 or 1 (a flag, not a weight — the MCP sandbox is looser).
 * Rounding remainder goes into the last visible segment so the row lands exactly
 * on totalWidth with no sub-pixel gap at the right edge.
 */
const RAMP_GAP = 2;
function levelRamp(weights, height, totalWidth) {
  const bar = row('LevelRamp', RAMP_GAP);
  const visible = [];
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const avail = totalWidth - RAMP_GAP * Math.max(0, weights.filter((w) => w > 0).length - 1);
  weights.forEach((w, i) => { if (w > 0) visible.push([i, Math.max(3, Math.round(avail * w / sum))]); });
  if (visible.length) {
    const used = visible.reduce((a, x) => a + x[1], 0);
    visible[visible.length - 1][1] += avail - used;
  }
  for (const [i, wpx] of visible) fixedRect(bar, wpx, height, height / 2, 'level/' + (i + 1));
  bar.resize(totalWidth, height);
  bar.counterAxisSizingMode = 'FIXED';
  bar.primaryAxisSizingMode = 'FIXED';
  return bar;
}
async function levelBadge(level) {
  const wrap = row('LevelBadge', 8, { counterAxisAlignItems: 'CENTER' });
  const bars = row('bars', 2.5, { counterAxisAlignItems: 'MAX' });
  bars.counterAxisSizingMode = 'FIXED'; bars.resize(30, 14);
  for (let i = 1; i <= 5; i++) fixedRect(bars, 4, 4 + i * 2, 1.5, i <= level ? 'level/' + level : 'bg/sunken');
  wrap.appendChild(bars);
  const names = ['Chưa nhớ', 'Mới thuộc', 'Nhớ ngắn hạn', 'Nhớ vững', 'Nhớ lâu dài'];
  wrap.appendChild(await txt(names[level - 1], 'ui/micro', 'text/secondary'));
  return wrap;
}
async function actionButton(parent, label, height) {
  const b = row('Button/Primary', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  b.counterAxisSizingMode = 'FIXED'; b.resize(350, height || 52); b.primaryAxisSizingMode = 'FIXED';
  b.cornerRadius = 12; setFill(b, 'bg/action');
  parent.appendChild(b); b.layoutSizingHorizontal = 'FILL'; b.layoutSizingVertical = 'FIXED';
  b.appendChild(await txt(label, 'ui/item', 'text/on-action'));
  return b;
}
async function quietButton(parent, label, height) {
  const b = row('Button/Secondary', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  b.counterAxisSizingMode = 'FIXED'; b.resize(350, height || 52); b.primaryAxisSizingMode = 'FIXED';
  b.cornerRadius = 12; setFill(b, 'bg/surface'); setStroke(b, 'border/strong'); b.strokeWeight = 1;
  parent.appendChild(b); b.layoutSizingHorizontal = 'FILL'; b.layoutSizingVertical = 'FIXED';
  b.appendChild(await txt(label, 'ui/item', 'text/primary'));
  return b;
}
async function chip(parent, label, textVar, bgVar) {
  const c = row('chip', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  pad(c, 4, 9, 4, 9); c.cornerRadius = 7; setFill(c, bgVar);
  c.appendChild(await txt(label, 'ui/micro', textVar));
  parent.appendChild(c); return c;
}
function iconTile(parent, iconNode, hueSoft, size) {
  const t = row('iconTile', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  t.counterAxisSizingMode = 'FIXED'; t.resize(size || 38, size || 38); t.primaryAxisSizingMode = 'FIXED';
  t.cornerRadius = 12; setFill(t, hueSoft);
  t.appendChild(iconNode); parent.appendChild(t); return t;
}
async function tabBar(parent, activeLabel) {
  const set = await figma.getNodeByIdAsync(TABSET_ID);
  const variant = set.children.find((c) => c.name === 'Active=' + activeLabel);
  const inst = variant.createInstance();
  parent.appendChild(inst); inst.layoutSizingHorizontal = 'FILL'; return inst;
}
// Counts are coloured numerals with the noun attached, so no legend is needed,
// and a zero stays quiet in tertiary instead of shouting inside a pill.
async function deckCard(name, due, fresh, susp, weights, hue, hueSoft) {
  const c = col('Deck/' + name, 12);
  fixedW(c, 350, 60); pad(c, 14, 16, 14, 14); c.cornerRadius = 16;
  setFill(c, 'bg/surface'); setStroke(c, 'border/hairline'); c.strokeWeight = 1;
  const top = row('top', 12, { counterAxisAlignItems: 'CENTER' });
  c.appendChild(top); top.layoutSizingHorizontal = 'FILL';
  const tile = row('tile', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  tile.counterAxisSizingMode = 'FIXED'; tile.resize(42, 42); tile.primaryAxisSizingMode = 'FIXED';
  tile.cornerRadius = 13; setFill(tile, hueSoft);
  tile.appendChild(await txt(name.trim().charAt(0).toUpperCase(), 'ui/heading', hue));
  top.appendChild(tile);
  const tcol = col('t', 3); top.appendChild(tcol); tcol.layoutGrow = 1;
  const n = await txt(name, 'ui/item', 'text/primary');
  tcol.appendChild(n); n.layoutSizingHorizontal = 'FILL';
  const counts = row('counts', 12);
  tcol.appendChild(counts); counts.layoutSizingHorizontal = 'FILL';
  counts.appendChild(await txt(due + ' đến hạn', 'ui/meta', due ? 'signal/due' : 'text/tertiary'));
  counts.appendChild(await txt(fresh + ' mới', 'ui/meta', fresh ? 'accent' : 'text/tertiary'));
  if (susp) counts.appendChild(await txt(susp + ' treo', 'ui/meta', 'text/tertiary'));
  // 350 card - 16 right - 14 left padding = 320 of usable width
  c.appendChild(levelRamp(weights, 6, 320));
  return c;
}
function skel(parent, w, h, r) { return fixedRect(parent, w, h, r === undefined ? 6 : r, 'bg/sunken'); }
function skelOnViolet(parent, w, h, r, op) {
  const s = fixedRect(parent, w, h, r === undefined ? 6 : r);
  s.fills = WHITE; s.opacity = op === undefined ? 0.32 : op; return s;
}

const madeScreens = [];
const METER_W = 145; // (350 - 40 padding - 20 gap) / 2

/* ====================== page 01: foundations sheet ==================== */
const foundationsPage = await figma.getNodeByIdAsync(PAGE_FOUNDATIONS);
await figma.setCurrentPageAsync(foundationsPage);
// idempotent: a failed run leaves half-built frames behind, and Figma then
// exports the survivors as "name-1.png". Clear before rebuilding.
for (const n of [...foundationsPage.children]) if (n.name === 'Foundations') n.remove();

const sheet = figma.createFrame();
sheet.name = 'Foundations';
sheet.resize(1240, 1500);
sheet.layoutMode = 'VERTICAL'; sheet.counterAxisSizingMode = 'FIXED'; sheet.primaryAxisSizingMode = 'AUTO';
sheet.itemSpacing = 40; pad(sheet, 48, 48, 56, 48);
sheet.x = 0; sheet.y = 0; setFill(sheet, 'bg/paper');

const fHead = col('head', 8);
sheet.appendChild(fHead); fHead.layoutSizingHorizontal = 'FILL';
fHead.appendChild(await txt('Remember — hệ thống thị giác cho mobile', 'ui/title', 'text/primary'));
const lede = await para(fHead,
  'Nền sáng, sạch, hơi lạnh; màu chia làm hai lớp không lẫn nhau. Lớp NHẬN DIỆN — tím, xanh mòng, hồng, xanh dương — dùng cho icon, thẻ deck và cách ôn, để giao diện đọc ra màu chứ không phải nền xám. Lớp DỮ LIỆU — đến hạn, bốn mức chấm, năm bậc độ nhớ — không bao giờ dùng chung sắc với lớp nhận diện, nên một con số có màu thì luôn có nghĩa.',
  'ui/body', 'text/secondary');
lede.resize(800, lede.height); lede.layoutSizingHorizontal = 'FIXED';

async function sectionTitle(parent, t, note) {
  const c = col('st', 4);
  parent.appendChild(c); c.layoutSizingHorizontal = 'FILL';
  c.appendChild(await txt(t, 'ui/heading', 'text/primary'));
  if (note) { const n = await para(c, note, 'ui/meta', 'text/secondary'); n.resize(800, n.height); n.layoutSizingHorizontal = 'FIXED'; }
  return c;
}
async function swatchRow(parent, items) {
  const r = row('swatches', 14);
  parent.appendChild(r);
  for (const [varName, light, dark] of items) {
    const c = col('sw', 8); r.appendChild(c);
    const box = fixedRect(c, 112, 76, 12, varName);
    box.strokes = [paint('border/hairline')]; box.strokeWeight = 1;
    const l = col('labels', 1); c.appendChild(l);
    l.appendChild(await txt(varName, 'ui/micro', 'text/primary'));
    l.appendChild(await txt(light, 'ui/micro', 'text/tertiary'));
    l.appendChild(await txt('dark ' + dark, 'ui/micro', 'text/tertiary'));
  }
  return r;
}

const cSec = col('Colour', 20);
sheet.appendChild(cSec); cSec.layoutSizingHorizontal = 'FILL';
await sectionTitle(cSec, 'Màu',
  'Gói Figma starter chỉ cho một mode mỗi collection, nên biến chỉ giữ giá trị Light. Giá trị Dark ghi ngay dưới mỗi ô và trong description của từng biến — map thẳng sang khối @media (prefers-color-scheme: dark).');
await swatchRow(cSec, [
  ['bg/paper', '#F7F8FC', '#101223'], ['bg/surface', '#FFFFFF', '#1B1E33'],
  ['bg/sunken', '#EEF0F8', '#15172A'], ['bg/action', '#6B3BF5', '#8B63FF'],
  ['border/hairline', '#E6E9F3', '#2A2E45'], ['border/strong', '#CDD2E2', '#3D4259'],
]);
await swatchRow(cSec, [
  ['text/primary', '#16182E', '#EDEDF7'], ['text/secondary', '#5A6079', '#A5AAC2'],
  ['text/tertiary', '#8A90A8', '#767C96'], ['accent/soft', '#EFE9FE', '#251F45'],
  ['signal/due', '#E08A00', '#FFC14D'], ['signal/due-soft', '#FFF3D6', '#332810'],
]);

const catSec = col('Categories', 16);
sheet.appendChild(catSec); catSec.layoutSizingHorizontal = 'FILL';
await sectionTitle(catSec, 'Màu theo khu vực',
  'Mỗi đích điều hướng và mỗi cách ôn có một sắc riêng, để icon và thẻ deck đọc ra màu chứ không phải nền xám. Năm sắc này chỉ dùng cho NHẬN DIỆN — chúng không bao giờ mang dữ liệu, nên không đụng vào dải bậc nhớ, màu đến hạn hay bốn màu chấm. Sắc thứ năm (indigo) thêm vào khi Bộ thẻ thành một tab riêng: năm đích thì cần năm nhận diện.');
await swatchRow(catSec, [
  ['cat/violet', '#6B3BF5', '#9B7BFF'], ['cat/violet-soft', '#EFE9FE', '#261F49'],
  ['cat/teal', '#00A6A0', '#2FD3CC'], ['cat/teal-soft', '#D8F6F4', '#0E332F'],
  ['cat/rose', '#EE3D7C', '#FF7BA8'], ['cat/rose-soft', '#FFE3ED', '#3A1424'],
]);
await swatchRow(catSec, [
  ['cat/blue', '#1D7BFF', '#67A8FF'], ['cat/blue-soft', '#E0EDFF', '#0F2340'],
  ['cat/indigo', '#4C5FD7', '#8F9DFA'], ['cat/indigo-soft', '#E5E8FB', '#1B2044'],
]);

const lSec = col('Levels', 16);
sheet.appendChild(lSec); lSec.layoutSizingHorizontal = 'FILL';
await sectionTitle(lSec, 'Bậc độ nhớ — thang tuần tự',
  'Bậc 1–5 là dữ liệu CÓ THỨ TỰ, nên phải là một dải cùng sắc, nhạt đến đậm. Bản hiện tại dùng năm màu không liên quan (xám, cam, xanh dương, lục, tím) cho một thang có thứ tự, nên mắt đọc ra năm phạm trù thay vì một tiến trình. Bậc 1 để xám không sắc là có ý: chưa có gì để nhớ.');
const rampDemo = row('ramp', 3);
rampDemo.counterAxisSizingMode = 'FIXED'; rampDemo.resize(1144, 14);
lSec.appendChild(rampDemo); rampDemo.layoutSizingHorizontal = 'FILL';
const LNAMES = [
  ['level/1', 'Chưa nhớ', 'chưa ôn lần nào', '#CBD0E2', '#454A66'],
  ['level/2', 'Mới thuộc', 'nhớ được trong tuần', '#B9A8FA', '#6E5BD0'],
  ['level/3', 'Nhớ ngắn hạn', 'nhớ được trong tháng', '#9276F7', '#8A6DF5'],
  ['level/4', 'Nhớ vững', 'nhớ được nửa năm', '#6B3BF5', '#A184FF'],
  ['level/5', 'Nhớ lâu dài', 'từ nửa năm trở lên', '#4718BE', '#C6B0FF'],
];
for (const [v] of LNAMES) {
  const seg = fixedRect(rampDemo, 200, 14, 7, v);
  seg.layoutGrow = 1; seg.layoutSizingVertical = 'FILL';
}
const lLabels = row('lvlLabels', 14);
lSec.appendChild(lLabels); lLabels.layoutSizingHorizontal = 'FILL';
for (const [, name, hint, light, dark] of LNAMES) {
  const c = col('l', 3); lLabels.appendChild(c); c.layoutGrow = 1;
  c.appendChild(await txt(name, 'ui/body-strong', 'text/primary'));
  c.appendChild(await txt(hint, 'ui/micro', 'text/tertiary'));
  c.appendChild(await txt(light + '  ·  dark ' + dark, 'ui/micro', 'text/tertiary'));
}

const rSec = col('Ratings', 16);
sheet.appendChild(rSec); rSec.layoutSizingHorizontal = 'FILL';
await sectionTitle(rSec, 'Bốn mức chấm — thang phân kỳ',
  'Đây là phạm trù có sắc thái (quên hẳn đến nhớ ngay), nên bốn sắc khác nhau là ĐÚNG ở chỗ này. Chúng được giữ xa dải tím để một thanh bậc và một hàng nút chấm không bao giờ đọc lẫn nhau.');
await swatchRow(rSec, [
  ['rating/again', '#EE2F58', '#FF6B8A'], ['rating/hard', '#E58A00', '#FFB03D'],
  ['rating/good', '#00A879', '#2BD3A0'], ['rating/easy', '#1D7BFF', '#67A8FF'],
]);

const tSec = col('Type', 18);
sheet.appendChild(tSec); tSec.layoutSizingHorizontal = 'FILL';
await sectionTitle(tSec, 'Chữ',
  'Be Vietnam Pro cho giao diện — chọn vì phủ đủ dấu tiếng Việt xếp tầng, thứ mà stack -apple-system dựng khá tệ ở cỡ nhỏ. Source Serif 4 chỉ dùng cho từ tiếng Anh đang học và phiên âm: serif là nội dung phải nhớ, sans là giao diện. Nhãn nhỏ dùng sentence case, không IN HOA.');
const SAMPLES = [
  ['word/term', 'resilience', 'Source Serif 4 SemiBold 34/42'],
  ['word/reading', '/rɪˈzɪliəns/', 'Source Serif 4 Regular 15/20'],
  ['word/sentence', 'Her resilience under pressure surprised everyone.', 'Source Serif 4 Italic 14/22'],
  ['ui/title', 'Thống kê', 'Be Vietnam Pro SemiBold 22/28'],
  ['ui/ask', 'sự bền bỉ', 'Be Vietnam Pro SemiBold 22/30'],
  ['ui/gloss', 'khả năng phục hồi', 'Be Vietnam Pro Regular 20/28'],
  ['ui/item', 'Từ vựng học thuật', 'Be Vietnam Pro Medium 17/24'],
  ['ui/body', 'Mỗi thẻ rút ngẫu nhiên một cách hỏi trong những cách đã bật.', 'Be Vietnam Pro Regular 15/22'],
  ['ui/meta', 'hôm nay đã ôn 26 lượt', 'Be Vietnam Pro Regular 13/18'],
  ['ui/micro', 'chạm để xem nghĩa', 'Be Vietnam Pro Medium 11/15'],
  ['num/hero', '248', 'Be Vietnam Pro SemiBold 30/34'],
];
for (const [styleName, sample, spec] of SAMPLES) {
  const r = row('sample', 24, { counterAxisAlignItems: 'BASELINE' });
  tSec.appendChild(r); r.layoutSizingHorizontal = 'FILL';
  const nm = await txt(styleName, 'ui/micro', 'text/tertiary');
  nm.textAutoResize = 'HEIGHT'; r.appendChild(nm); nm.resize(120, nm.height);
  const sm = await txt(sample, styleName, 'text/primary');
  r.appendChild(sm); sm.layoutGrow = 1;
  r.appendChild(await txt(spec, 'ui/micro', 'text/tertiary'));
}

const sSec = col('Scales', 16);
sheet.appendChild(sSec); sSec.layoutSizingHorizontal = 'FILL';
await sectionTitle(sSec, 'Bán kính & khoảng cách',
  'Bán kính có phân cấp: bề mặt càng lớn, bán kính càng lớn. Một giá trị cho mọi thứ là dấu hiệu điển hình của bộ card dựng sẵn.');
const radRow = row('radii', 16, { counterAxisAlignItems: 'MAX' });
sSec.appendChild(radRow);
for (const [r, label] of [[8, 'sm · chip'], [12, 'md · nút, ô nhập'], [16, 'lg · thẻ'], [24, 'xl · mặt thẻ học'], [999, 'full · pill']]) {
  const c = col('r', 8); radRow.appendChild(c);
  const b = fixedRect(c, 96, 72, Math.min(r, 36), 'bg/surface');
  b.strokes = [paint('border/strong')]; b.strokeWeight = 1;
  c.appendChild(await txt(String(r), 'ui/body-strong', 'text/primary'));
  c.appendChild(await txt(label, 'ui/micro', 'text/tertiary'));
}
const spRow = row('spacing', 16, { counterAxisAlignItems: 'MAX' });
sSec.appendChild(spRow);
for (const n of [4, 8, 12, 16, 20, 24, 32]) {
  const c = col('s', 6, { counterAxisAlignItems: 'CENTER' }); spRow.appendChild(c);
  const b = fixedRect(c, n, 44, 2, 'accent'); b.opacity = 0.35;
  c.appendChild(await txt(String(n), 'ui/micro', 'text/tertiary'));
}

/* ========================= page 03: the screens ======================= */
const screensPage = await figma.getNodeByIdAsync(PAGE_SCREENS);
await figma.setCurrentPageAsync(screensPage);
for (const n of [...screensPage.children]) n.remove();

/* ------------------------- 01 Trang chính ----------------------------- */
const home = screen('01 · Trang chính', 0, 0); madeScreens.push(home);
await statusBar(home);
await titleBar(home, 'Remember', '248 thẻ trong 4 bộ');

const hBody = col('Body', 12); pad(hBody, 0, 20, 0, 20);
home.appendChild(hBody); hBody.layoutSizingHorizontal = 'FILL'; hBody.layoutGrow = 1;

// HERO — all the boldness of the screen spent in one saturated violet block.
// Everything below stays quiet so this reads first.
const hero = col('Hero/Hôm nay', 18);
fixedW(hero, 350, 60); pad(hero, 20, 20, 20, 20);
hero.cornerRadius = 24; setFill(hero, 'bg/action');
hBody.appendChild(hero); hero.layoutSizingHorizontal = 'FILL';
const heroTop = col('top', 4);
hero.appendChild(heroTop); heroTop.layoutSizingHorizontal = 'FILL';
const hLabel = await txt('Hôm nay', 'ui/micro', 'text/on-action'); hLabel.opacity = 0.75;
heroTop.appendChild(hLabel);
const figRow = row('figure', 8, { counterAxisAlignItems: 'BASELINE' });
heroTop.appendChild(figRow);
figRow.appendChild(await txt('32', 'num/hero', 'text/on-action'));
const hUnit = await txt('thẻ đến hạn', 'ui/body', 'text/on-action'); hUnit.opacity = 0.8;
figRow.appendChild(hUnit);

// Daily budget, drawn. Replaces the old "6/20 thẻ mới · 26/200 lượt ôn" text line.
async function heroMeter(label, used, cap) {
  const m = col('meter/' + label, 6);
  const head = row('head', 6, { counterAxisAlignItems: 'CENTER' });
  m.appendChild(head); head.layoutSizingHorizontal = 'FILL';
  const l = await txt(label, 'ui/meta', 'text/on-action'); l.opacity = 0.85; head.appendChild(l);
  grow(head);
  const v = await txt(used + '/' + cap, 'ui/meta', 'text/on-action'); v.opacity = 0.65; head.appendChild(v);
  const track = row('track', 0);
  track.counterAxisSizingMode = 'FIXED'; track.resize(METER_W, 4);
  track.cornerRadius = 2;
  // Opacity goes on the PAINT, not the node: node opacity cascades to children,
  // which made the white fill bar the same tone as its own track — invisible.
  track.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.32 }];
  m.appendChild(track); track.layoutSizingHorizontal = 'FILL';
  const f = fixedRect(track, Math.max(4, Math.round(METER_W * used / cap)), 4, 2);
  f.fills = WHITE; f.layoutSizingVertical = 'FILL';
  return m;
}
const meters = row('meters', 20);
hero.appendChild(meters); meters.layoutSizingHorizontal = 'FILL';
const hm1 = await heroMeter('Thẻ mới', 6, 20); meters.appendChild(hm1); hm1.layoutSizingHorizontal = 'FILL';
const hm2 = await heroMeter('Lượt ôn', 26, 200); meters.appendChild(hm2); hm2.layoutSizingHorizontal = 'FILL';

const cta = row('CTA', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
cta.counterAxisSizingMode = 'FIXED'; cta.resize(310, 52); cta.primaryAxisSizingMode = 'FIXED';
cta.cornerRadius = 12; setFill(cta, 'bg/surface');
hero.appendChild(cta); cta.layoutSizingHorizontal = 'FILL'; cta.layoutSizingVertical = 'FIXED';
cta.appendChild(await txt('Ôn ngay', 'ui/item', 'bg/action'));

vspace(hBody, 4);
const decks = col('Decks', 12);
hBody.appendChild(decks); decks.layoutSizingHorizontal = 'FILL';
const DECKS = [
  ['Từ vựng học thuật', 12, 5, 0, [10, 22, 28, 24, 16], 'cat/violet', 'cat/violet-soft'],
  ['Phrasal verbs', 8, 0, 0, [26, 30, 24, 14, 6], 'cat/teal', 'cat/teal-soft'],
  ['Kinh tế & tài chính', 0, 12, 0, [44, 22, 18, 10, 6], 'cat/blue', 'cat/blue-soft'],
  ['Tiếng Anh y khoa', 12, 0, 3, [8, 14, 24, 28, 26], 'cat/rose', 'cat/rose-soft'],
];
for (const d of DECKS) { const c = await deckCard(d[0], d[1], d[2], d[3], d[4], d[5], d[6]); decks.appendChild(c); c.layoutSizingHorizontal = 'FILL'; }
await tabBar(home, 'Học');

/* --------------------------- 02 Chưa có thẻ --------------------------- */
const empty = screen('02 · Chưa có thẻ', 440, 0); madeScreens.push(empty);
await statusBar(empty);
await titleBar(empty, 'Remember');
const eBody = col('Body', 0, { primaryAxisAlignItems: 'CENTER' }); pad(eBody, 0, 20, 0, 20);
empty.appendChild(eBody); eBody.layoutSizingHorizontal = 'FILL'; eBody.layoutGrow = 1;
const ecard = col('Empty', 14, { counterAxisAlignItems: 'CENTER' });
fixedW(ecard, 350, 60); pad(ecard, 32, 24, 28, 24); ecard.cornerRadius = 24;
setFill(ecard, 'bg/surface'); setStroke(ecard, 'border/strong'); ecard.strokeWeight = 1; ecard.dashPattern = [6, 5];
eBody.appendChild(ecard); ecard.layoutSizingHorizontal = 'FILL';
// draw the state being described: five empty notches
const eRamp = row('ramp/empty', 3);
eRamp.counterAxisSizingMode = 'FIXED'; eRamp.resize(150, 8);
for (let i = 0; i < 5; i++) { const seg = fixedRect(eRamp, 26, 8, 4, 'bg/sunken'); seg.layoutGrow = 1; seg.layoutSizingVertical = 'FILL'; }
ecard.appendChild(eRamp);
const eTitle = await txt('Chưa có thẻ nào', 'ui/heading', 'text/primary');
ecard.appendChild(eTitle); eTitle.textAlignHorizontal = 'CENTER';
const eB = await para(ecard, 'Lưu thẻ ngay khi đang đọc bằng extension, hoặc tra một từ rồi chọn nghĩa bạn muốn nhớ.', 'ui/body', 'text/secondary');
eB.textAlignHorizontal = 'CENTER';
vspace(ecard, 2);
const eAct = col('actions', 10);
ecard.appendChild(eAct); eAct.layoutSizingHorizontal = 'FILL';
await actionButton(eAct, 'Tra từ đầu tiên', 52);
await quietButton(eAct, 'Kết nối extension', 52);
await tabBar(empty, 'Học');

/* ---------------------------- 03 Đang tải ----------------------------- */
const load = screen('03 · Đang tải', 880, 0); madeScreens.push(load);
await statusBar(load);
const lh = col('Header', 8); pad(lh, 4, 20, 16, 20);
load.appendChild(lh); lh.layoutSizingHorizontal = 'FILL';
lh.appendChild(await txt('Remember', 'ui/title', 'text/primary'));
skel(lh, 150, 12);
const lBody = col('Body', 12); pad(lBody, 0, 20, 0, 20);
load.appendChild(lBody); lBody.layoutSizingHorizontal = 'FILL'; lBody.layoutGrow = 1;
// the skeleton keeps the hero's violet, so the screen never flashes grey then colour
const lhero = col('Hero', 18);
fixedW(lhero, 350, 60); pad(lhero, 20, 20, 20, 20);
lhero.cornerRadius = 24; setFill(lhero, 'bg/action');
lBody.appendChild(lhero); lhero.layoutSizingHorizontal = 'FILL';
const lheroTop = col('top', 10);
lhero.appendChild(lheroTop); lheroTop.layoutSizingHorizontal = 'FILL';
const llab = await txt('Hôm nay', 'ui/micro', 'text/on-action'); llab.opacity = 0.75;
lheroTop.appendChild(llab);
skelOnViolet(lheroTop, 132, 30, 8);
const lmeters = row('meters', 20);
lhero.appendChild(lmeters); lmeters.layoutSizingHorizontal = 'FILL';
for (let i = 0; i < 2; i++) {
  const mm = col('m', 8); lmeters.appendChild(mm); mm.layoutSizingHorizontal = 'FILL';
  const a = skelOnViolet(mm, 70, 10, 5); a.layoutSizingHorizontal = 'FILL';
  const b = skelOnViolet(mm, 70, 4, 2); b.layoutSizingHorizontal = 'FILL';
}
const lcta = skelOnViolet(lhero, 310, 52, 12, 0.4); lcta.layoutSizingHorizontal = 'FILL';
vspace(lBody, 4);
const ldecks = col('Decks', 12);
lBody.appendChild(ldecks); ldecks.layoutSizingHorizontal = 'FILL';
// skeleton mirrors the real card exactly — same tile, two lines, ramp — so
// nothing shifts position when the data lands
for (const w of [200, 150, 175]) {
  const c = col('Deck/skeleton', 12);
  fixedW(c, 350, 60); pad(c, 14, 16, 14, 14); c.cornerRadius = 16;
  setFill(c, 'bg/surface'); setStroke(c, 'border/hairline'); c.strokeWeight = 1;
  ldecks.appendChild(c); c.layoutSizingHorizontal = 'FILL';
  const top = row('top', 12, { counterAxisAlignItems: 'CENTER' });
  c.appendChild(top); top.layoutSizingHorizontal = 'FILL';
  skel(top, 42, 42, 13);
  const tcol = col('t', 7); top.appendChild(tcol); tcol.layoutGrow = 1;
  skel(tcol, w, 14); skel(tcol, 110, 10);
  const rs = skel(c, 318, 6, 3); rs.layoutSizingHorizontal = 'FILL';
}
await tabBar(load, 'Học');

/* ============================ study flow ============================== */
// The study flow hides the tab bar entirely: one job, and the only exit is X.
const SY = 940;
const MODE_HUE = {
  'Nhớ nghĩa của từ': ['cat/violet', 'cat/violet-soft'],
  'Gõ nghĩa tiếng Việt': ['cat/teal', 'cat/teal-soft'],
  'Nghe và gõ lại từ': ['cat/rose', 'cat/rose-soft'],
  'Gõ từ tiếng Anh': ['cat/blue', 'cat/blue-soft'],
  'Điền từ còn thiếu': ['signal/due', 'signal/due-soft'],
  'Chọn nghĩa đúng': ['rating/good', 'bg/sunken'],
};
async function studyShell(name, x, remaining, relearn, pct, showSpeaker) {
  const s = screen(name, x, SY); madeScreens.push(s);
  await statusBar(s);
  const bar = row('SessionBar', 10, { counterAxisAlignItems: 'CENTER' });
  pad(bar, 0, 14, 10, 12);
  s.appendChild(bar); bar.layoutSizingHorizontal = 'FILL';
  const x1 = row('close', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  x1.counterAxisSizingMode = 'FIXED'; x1.resize(40, 40); x1.primaryAxisSizingMode = 'FIXED';
  x1.appendChild(icoClose('text/secondary'));
  bar.appendChild(x1);
  if (remaining) bar.appendChild(await txt('còn ' + remaining + ' thẻ', 'ui/meta', 'text/secondary'));
  if (relearn) bar.appendChild(await txt(relearn + ' học lại', 'ui/meta', 'text/tertiary'));
  grow(bar);
  if (showSpeaker) {
    const sp = row('speak', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
    sp.counterAxisSizingMode = 'FIXED'; sp.resize(40, 40); sp.primaryAxisSizingMode = 'FIXED';
    sp.appendChild(icoSpeaker('text/secondary'));
    bar.appendChild(sp);
  }
  const tw = row('progressWrap', 0); pad(tw, 0, 20, 12, 20);
  s.appendChild(tw); tw.layoutSizingHorizontal = 'FILL';
  const track = row('track', 0);
  track.counterAxisSizingMode = 'FIXED'; track.resize(350, 3);
  track.cornerRadius = 2; setFill(track, 'bg/sunken');
  tw.appendChild(track); track.layoutSizingHorizontal = 'FILL';
  if (pct > 0) { const f = fixedRect(track, Math.max(3, Math.round(350 * pct)), 3, 2, 'bg/action'); f.layoutSizingVertical = 'FILL'; }
  const b = col('Body', 12); pad(b, 0, 20, 20, 20);
  s.appendChild(b); b.layoutSizingHorizontal = 'FILL'; b.layoutGrow = 1;
  return { s, body: b };
}
/**
 * The card the question lives on.
 *
 * It FILLS the space between the progress bar and the bottom action, with its
 * content centred. Two earlier attempts were worse: letting it stretch while the
 * mode chip stayed in the flow stranded the chip at the top of a tall empty card,
 * and letting it hug its content left ~350px of bare paper below it, so the card
 * read as a small box floating at the top. The chip is pulled out of the flow
 * (absolute) so the centred block is genuinely centred.
 */
function face(parent) {
  const f = col('Face', 10, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  f.counterAxisSizingMode = 'FIXED'; f.resize(350, 340); f.primaryAxisSizingMode = 'FIXED';
  pad(f, 20, 20, 24, 20);
  f.cornerRadius = 24; setFill(f, 'bg/surface');
  setStroke(f, 'border/hairline'); f.strokeWeight = 1;
  parent.appendChild(f); f.layoutSizingHorizontal = 'FILL'; f.layoutGrow = 1;
  return f;
}
// each of the six modes owns a hue: you can tell what the card is asking
// before you read a word of it
async function modeBadge(parent, label) {
  const hue = MODE_HUE[label] || ['text/tertiary', 'bg/sunken'];
  const c = await chip(parent, label, hue[0], hue[1]);
  c.layoutPositioning = 'ABSOLUTE';
  c.x = 20; c.y = 18;
  return c;
}
async function gradeRow(parent) {
  const g = row('Grades', 10);
  parent.appendChild(g); g.layoutSizingHorizontal = 'FILL';
  for (const [label, cv, hint] of [
    ['Lại', 'rating/again', 'dưới 1 phút'], ['Khó', 'rating/hard', '3 ngày'],
    ['Được', 'rating/good', '9 ngày'], ['Dễ', 'rating/easy', '21 ngày'],
  ]) {
    const b = col('Grade/' + label, 2, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
    b.counterAxisSizingMode = 'FIXED'; b.resize(80, 64); b.primaryAxisSizingMode = 'FIXED';
    b.cornerRadius = 12; setFill(b, 'bg/surface'); setStroke(b, cv); b.strokeWeight = 1.5;
    g.appendChild(b); b.layoutSizingHorizontal = 'FILL';
    b.appendChild(await txt(label, 'ui/item', cv));
    b.appendChild(await txt(hint, 'ui/micro', 'text/tertiary'));
  }
  return g;
}
async function answerBlock(f) {
  await chip(f, 'danh từ', 'accent', 'accent/soft');
  // level shows only AFTER reveal: seeing it first skews how you grade yourself
  const lb = await levelBadge(3); f.appendChild(lb);
  fixedRect(f, 44, 1, 0, 'border/hairline');
  const glosses = col('glosses', 3, { counterAxisAlignItems: 'CENTER' });
  f.appendChild(glosses);
  glosses.appendChild(await txt('sự bền bỉ', 'ui/gloss', 'text/primary'));
  glosses.appendChild(await txt('khả năng phục hồi', 'ui/gloss', 'text/primary'));
  const ctxWrap = col('ctx', 0);
  f.appendChild(ctxWrap); ctxWrap.layoutSizingHorizontal = 'FILL';
  pad(ctxWrap, 2, 0, 2, 12);
  setStroke(ctxWrap, 'accent');
  ctxWrap.strokeLeftWeight = 2;
  ctxWrap.strokeTopWeight = 0; ctxWrap.strokeRightWeight = 0; ctxWrap.strokeBottomWeight = 0;
  await para(ctxWrap, 'Her resilience under pressure surprised everyone.', 'word/sentence', 'text/secondary');
  return f;
}
async function inputField(parent, value, isPlaceholder) {
  const i = row('Input', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  i.counterAxisSizingMode = 'FIXED'; i.resize(300, 50); i.primaryAxisSizingMode = 'FIXED';
  i.cornerRadius = 12; setFill(i, 'bg/paper');
  setStroke(i, isPlaceholder ? 'border/strong' : 'accent'); i.strokeWeight = isPlaceholder ? 1 : 1.8;
  parent.appendChild(i);
  i.appendChild(await txt(value, 'ui/item', isPlaceholder ? 'text/tertiary' : 'text/primary'));
  return i;
}

/* 04 câu hỏi */ {
  const { body } = await studyShell('04 · Học · câu hỏi', 0, 18, 3, 0.28, true);
  const f = face(body);
  await modeBadge(f, 'Nhớ nghĩa của từ');
  f.appendChild(await txt('resilience', 'word/term', 'text/primary'));
  f.appendChild(await txt('/rɪˈzɪliəns/', 'word/reading', 'text/secondary'));
  vspace(f, 12);
  f.appendChild(await txt('chạm để xem nghĩa', 'ui/micro', 'text/tertiary'));
  await actionButton(body, 'Xem nghĩa', 60);
}
/* 05 đáp án */ {
  const { body } = await studyShell('05 · Học · đáp án', 440, 18, 3, 0.28, true);
  const f = face(body);
  await modeBadge(f, 'Nhớ nghĩa của từ');
  f.appendChild(await txt('resilience', 'word/term', 'text/primary'));
  f.appendChild(await txt('/rɪˈzɪliəns/', 'word/reading', 'text/secondary'));
  await answerBlock(f);
  await gradeRow(body);
}
/* 06 gõ nghĩa + chấm */ {
  const { body } = await studyShell('06 · Học · gõ nghĩa', 880, 17, 3, 0.33, true);
  const f = face(body);
  await modeBadge(f, 'Gõ nghĩa tiếng Việt');
  f.appendChild(await txt('resilience', 'word/term', 'text/primary'));
  await inputField(f, 'su ben bi', false);
  // documents a real feature: diacritics are stripped before matching
  const ck = row('check', 6, { counterAxisAlignItems: 'CENTER' });
  f.appendChild(ck);
  ck.appendChild(icoTick('rating/good'));
  ck.appendChild(await txt('Đúng — gõ không dấu vẫn tính đúng', 'ui/micro', 'rating/good'));
  await answerBlock(f);
  await gradeRow(body);
  const note = await para(body, 'Gõ đúng vẫn phải tự chấm: chỉ bạn biết vừa rồi là nhớ ngay hay phải nghĩ mãi.', 'ui/micro', 'text/tertiary');
  note.textAlignHorizontal = 'CENTER';
}
/* 07 nghe rồi gõ */ {
  const { body } = await studyShell('07 · Học · nghe rồi gõ', 1320, 16, 2, 0.39, false);
  const f = face(body);
  await modeBadge(f, 'Nghe và gõ lại từ');
  const listen = col('listen', 14, { counterAxisAlignItems: 'CENTER' });
  f.appendChild(listen);
  const big = row('listenBtn', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  big.counterAxisSizingMode = 'FIXED'; big.resize(88, 88); big.primaryAxisSizingMode = 'FIXED';
  big.cornerRadius = 44; setFill(big, 'cat/rose-soft');
  big.appendChild(icoSpeaker('cat/rose', 40));
  listen.appendChild(big);
  const slow = row('slow', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  pad(slow, 0, 16, 0, 16);
  slow.counterAxisSizingMode = 'FIXED'; slow.resize(140, 40); slow.primaryAxisSizingMode = 'FIXED';
  slow.cornerRadius = 12; slow.fills = [];
  setStroke(slow, 'border/strong'); slow.strokeWeight = 1;
  slow.appendChild(await txt('Phát chậm', 'ui/body-strong', 'text/secondary'));
  listen.appendChild(slow);
  vspace(f, 8);
  // the word itself stays hidden — otherwise there is nothing to work out
  await inputField(f, 'gõ từ tiếng Anh…', true);
  await actionButton(body, 'Kiểm tra', 60);
}
/* 08 xong phiên */ {
  const { body } = await studyShell('08 · Học · xong phiên', 1760, 0, 0, 1, false);
  const wrap = col('Done', 16, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  body.appendChild(wrap); wrap.layoutSizingHorizontal = 'FILL'; wrap.layoutGrow = 1;
  // the ramp at full saturation is the reward graphic — on-brand, and no emoji
  wrap.appendChild(levelRamp([1, 1, 1, 1, 1], 10, 220));
  vspace(wrap, 4);
  wrap.appendChild(await txt('Xong phiên', 'ui/title', 'text/primary'));
  const fr = row('fig', 8, { counterAxisAlignItems: 'BASELINE' });
  wrap.appendChild(fr);
  fr.appendChild(await txt('24', 'num/hero', 'text/primary'));
  fr.appendChild(await txt('lượt ôn', 'ui/body', 'text/secondary'));
  const p = await para(wrap, 'FSRS sẽ nhắc lại đúng lúc, trước khi bạn quên.', 'ui/body', 'text/secondary');
  p.textAlignHorizontal = 'CENTER';
  await actionButton(body, 'Về trang chính', 52);
}
/* 09 đang tải hàng đợi */ {
  const { body } = await studyShell('09 · Học · đang tải', 2200, 0, 0, 0, false);
  const f = face(body);
  const sk = col('sk', 14, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  f.appendChild(sk); sk.layoutSizingHorizontal = 'FILL';
  skel(sk, 190, 34, 8);
  skel(sk, 120, 14, 6);
  const btn = skel(body, 350, 60, 12); btn.layoutSizingHorizontal = 'FILL';
}

/* ===================== lookup / stats / settings / account ============ */
const RY = 1880;

/* 10 Tra từ */ {
  const s = screen('10 · Tra từ', 0, RY); madeScreens.push(s);
  await statusBar(s);
  await titleBar(s, 'Tra từ');
  const body = col('Body', 14); pad(body, 0, 20, 0, 20);
  s.appendChild(body); body.layoutSizingHorizontal = 'FILL'; body.layoutGrow = 1;

  const sr = row('Search', 10, { counterAxisAlignItems: 'CENTER' });
  body.appendChild(sr); sr.layoutSizingHorizontal = 'FILL';
  const field = row('field', 0, { counterAxisAlignItems: 'CENTER' });
  field.counterAxisSizingMode = 'FIXED'; field.resize(280, 50); field.primaryAxisSizingMode = 'FIXED';
  pad(field, 0, 14, 0, 14);
  field.cornerRadius = 12; setFill(field, 'bg/surface');
  setStroke(field, 'border/strong'); field.strokeWeight = 1;
  sr.appendChild(field); field.layoutGrow = 1;
  field.appendChild(await txt('resilience', 'ui/item', 'text/primary'));
  const sbtn = row('go', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  sbtn.counterAxisSizingMode = 'FIXED'; sbtn.resize(50, 50); sbtn.primaryAxisSizingMode = 'FIXED';
  sbtn.cornerRadius = 12; setFill(sbtn, 'cat/teal');
  sbtn.appendChild(icoSearch('text/on-action'));
  sr.appendChild(sbtn);

  const head = row('ResultHead', 12, { counterAxisAlignItems: 'CENTER' });
  body.appendChild(head); head.layoutSizingHorizontal = 'FILL';
  const hcol = col('t', 2); head.appendChild(hcol); hcol.layoutGrow = 1;
  hcol.appendChild(await txt('resilience', 'word/term-sm', 'text/primary'));
  hcol.appendChild(await txt('/rɪˈzɪliəns/', 'word/reading', 'text/secondary'));
  const spk = row('speak', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  spk.counterAxisSizingMode = 'FIXED'; spk.resize(46, 46); spk.primaryAxisSizingMode = 'FIXED';
  spk.cornerRadius = 23; setFill(spk, 'cat/teal-soft');
  spk.appendChild(icoSpeaker('cat/teal'));
  head.appendChild(spk);

  const g = col('Group/noun', 10);
  fixedW(g, 350, 60); pad(g, 14, 14, 12, 14);
  g.cornerRadius = 16; setFill(g, 'bg/surface');
  setStroke(g, 'border/hairline'); g.strokeWeight = 1;
  body.appendChild(g); g.layoutSizingHorizontal = 'FILL';
  const posRow = row('pos', 8, { counterAxisAlignItems: 'CENTER' });
  g.appendChild(posRow); posRow.layoutSizingHorizontal = 'FILL';
  await chip(posRow, 'danh từ', 'accent', 'accent/soft');
  await chip(posRow, 'bản dịch chính', 'rating/good', 'bg/sunken');
  grow(posRow);
  posRow.appendChild(await txt('xem thêm 4', 'ui/micro', 'cat/teal'));
  const defWrap = col('def', 0);
  g.appendChild(defWrap); defWrap.layoutSizingHorizontal = 'FILL';
  pad(defWrap, 0, 0, 4, 10);
  await para(defWrap, 'the capacity to recover quickly from difficulties', 'ui/meta', 'text/secondary');
  const senses = col('senses', 4);
  g.appendChild(senses); senses.layoutSizingHorizontal = 'FILL';
  for (const [n, gloss, ex, state] of [
    ['1', 'sự bền bỉ', 'She showed great resilience.', 'selected'],
    ['2', 'khả năng phục hồi', null, 'selected'],
    ['3', 'tính đàn hồi', null, 'saved'],
    ['4', 'sức chịu đựng', null, 'plain'],
  ]) {
    const r = row('sense', 8, { counterAxisAlignItems: 'MIN' });
    pad(r, 8, 10, 8, 8); r.cornerRadius = 10;
    if (state === 'selected') setFill(r, 'accent/soft');
    else if (state === 'saved') setFill(r, 'bg/sunken');
    else r.fills = [];
    senses.appendChild(r); r.layoutSizingHorizontal = 'FILL';
    const mark = row('mark', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
    mark.counterAxisSizingMode = 'FIXED'; mark.resize(18, 20); mark.primaryAxisSizingMode = 'FIXED';
    if (state === 'selected') mark.appendChild(icoTick('accent'));
    else if (state === 'saved') mark.appendChild(icoTick('rating/good'));
    else mark.appendChild(await txt(n + '.', 'ui/meta', 'text/tertiary'));
    r.appendChild(mark);
    const tcol = col('t', 2); r.appendChild(tcol); tcol.layoutGrow = 1;
    tcol.appendChild(await txt(gloss, 'ui/body-strong', 'text/primary'));
    if (ex) await para(tcol, ex, 'word/sentence', 'text/tertiary');
    if (state === 'saved') tcol.appendChild(await txt('đã lưu trong Từ vựng học thuật', 'ui/micro', 'rating/good'));
  }
  const sticky = col('SaveBar', 0); pad(sticky, 12, 20, 12, 20);
  setFill(sticky, 'bg/paper');
  s.appendChild(sticky); sticky.layoutSizingHorizontal = 'FILL';
  await actionButton(sticky, 'Lưu 2 nghĩa đã chọn', 52);
  await tabBar(s, 'Tra từ');
}

/* 11 Thống kê */ {
  const s = screen('11 · Thống kê', 440, RY); madeScreens.push(s);
  await statusBar(s);
  await titleBar(s, 'Thống kê');
  const body = col('Body', 10); pad(body, 0, 20, 0, 20);
  s.appendChild(body); body.layoutSizingHorizontal = 'FILL'; body.layoutGrow = 1;
  await para(body, 'Bậc độ nhớ dựa trên stability của FSRS — nhớ được bao lâu mà không cần ôn. Chỉ để xem, không ảnh hưởng lịch ôn.', 'ui/meta', 'text/secondary');
  vspace(body, 2);
  // the legend encodes the ordering itself: bar width grows with the level
  const lvWrap = col('Levels', 8);
  body.appendChild(lvWrap); lvWrap.layoutSizingHorizontal = 'FILL';
  const LV = [
    ['Chưa nhớ', 'chưa ôn lần nào', 41, 16], ['Mới thuộc', 'nhớ được trong tuần', 58, 24],
    ['Nhớ ngắn hạn', 'nhớ được trong tháng', 72, 32], ['Nhớ vững', 'nhớ được nửa năm', 49, 40],
    ['Nhớ lâu dài', 'nhớ từ nửa năm trở lên', 28, 48],
  ];
  for (let i = 0; i < LV.length; i++) {
    const [name, hint, count, barW] = LV[i];
    const r = row('level', 12, { counterAxisAlignItems: 'CENTER' });
    r.counterAxisSizingMode = 'FIXED'; r.resize(350, 58); r.primaryAxisSizingMode = 'FIXED';
    pad(r, 0, 16, 0, 16);
    r.cornerRadius = 14; setFill(r, 'bg/surface');
    setStroke(r, 'border/hairline'); r.strokeWeight = 1;
    lvWrap.appendChild(r); r.layoutSizingHorizontal = 'FILL';
    const gauge = row('gauge', 0);
    gauge.counterAxisSizingMode = 'FIXED'; gauge.resize(48, 6); gauge.primaryAxisSizingMode = 'FIXED';
    fixedRect(gauge, barW, 6, 3, 'level/' + (i + 1));
    r.appendChild(gauge);
    const tcol = col('t', 1); r.appendChild(tcol); tcol.layoutGrow = 1;
    tcol.appendChild(await txt(name, 'ui/body-strong', 'text/primary'));
    tcol.appendChild(await txt(hint, 'ui/micro', 'text/tertiary'));
    r.appendChild(await txt(String(count), 'num/count', 'text/primary'));
  }
  vspace(body, 6);
  const grid = col('Tiles', 10);
  body.appendChild(grid); grid.layoutSizingHorizontal = 'FILL';
  // the figure carries the hue, and only where the hue MEANS something:
  // amber = owed now, green = done, red = trouble. Neutral counts stay ink.
  const TILES = [
    ['248', 'tổng số thẻ', 'text/primary'], ['32', 'đến hạn', 'signal/due'],
    ['26', 'đã ôn hôm nay', 'rating/good'], ['9', 'đang học', 'text/primary'],
    ['1 204', 'tổng lượt ôn', 'text/primary'], ['3', 'thẻ leech', 'rating/again'],
  ];
  for (let i = 0; i < TILES.length; i += 2) {
    const gr = row('tileRow', 10);
    grid.appendChild(gr); gr.layoutSizingHorizontal = 'FILL';
    for (const [n, lab, hue] of TILES.slice(i, i + 2)) {
      const t = col('tile', 2);
      fixedW(t, 167, 60); pad(t, 14, 16, 16, 16);
      t.cornerRadius = 16; setFill(t, 'bg/surface');
      gr.appendChild(t); t.layoutGrow = 1;
      t.appendChild(await txt(n, 'num/hero', hue));
      const l = await txt(lab, 'ui/meta', 'text/secondary');
      t.appendChild(l); l.layoutSizingHorizontal = 'FILL';
    }
  }
  await tabBar(s, 'Thống kê');
}

/* 12 Cài đặt */ {
  const s = screen('12 · Cài đặt', 880, RY); madeScreens.push(s);
  await statusBar(s);
  await topBar(s, 'Cài đặt');
  const body = col('Body', 18); pad(body, 0, 20, 0, 20);
  s.appendChild(body); body.layoutSizingHorizontal = 'FILL'; body.layoutGrow = 1;
  const sec1 = col('Section/modes', 8);
  body.appendChild(sec1); sec1.layoutSizingHorizontal = 'FILL';
  sec1.appendChild(await txt('Cách ôn tập', 'ui/label', 'text/primary'));
  await para(sec1, 'Mỗi thẻ rút ngẫu nhiên một cách hỏi trong những cách đã bật.', 'ui/micro', 'text/tertiary');
  const modeWrap = col('modes', 8);
  sec1.appendChild(modeWrap); modeWrap.layoutSizingHorizontal = 'FILL';
  const MODES = [
    ['Nhận biết', 'thấy từ, tự nhớ nghĩa, rồi mở đáp án', true, 'cat/violet', 'cat/violet-soft'],
    ['Gõ nghĩa Việt', 'thấy từ, gõ nghĩa tiếng Việt', true, 'cat/teal', 'cat/teal-soft'],
    ['Nghe rồi gõ', 'nghe phát âm, gõ lại từ tiếng Anh', true, 'cat/rose', 'cat/rose-soft'],
    ['Gõ ngược', 'thấy nghĩa Việt, gõ từ tiếng Anh', false, 'cat/blue', 'cat/blue-soft'],
    ['Điền vào câu', 'câu có chỗ trống, gõ từ còn thiếu', false, 'signal/due', 'signal/due-soft'],
    ['Trắc nghiệm', 'chọn nghĩa đúng trong 4 đáp án', false, 'rating/good', 'bg/sunken'],
  ];
  for (const [name, hint, on, hue, hueSoft] of MODES) {
    const r = row('mode', 12, { counterAxisAlignItems: 'CENTER' });
    pad(r, 11, 14, 11, 12); r.cornerRadius = 12;
    setFill(r, on ? hueSoft : 'bg/surface');
    setStroke(r, on ? hue : 'border/hairline'); r.strokeWeight = on ? 1.5 : 1;
    modeWrap.appendChild(r); r.layoutSizingHorizontal = 'FILL';
    const box = row('box', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
    box.counterAxisSizingMode = 'FIXED'; box.resize(21, 21); box.primaryAxisSizingMode = 'FIXED';
    box.cornerRadius = 6;
    if (on) { setFill(box, hue); box.appendChild(icoTick('text/on-action')); }
    else { setFill(box, 'bg/surface'); setStroke(box, 'border/strong'); box.strokeWeight = 1.5; }
    r.appendChild(box);
    const tcol = col('t', 1); r.appendChild(tcol); tcol.layoutGrow = 1;
    tcol.appendChild(await txt(name, 'ui/body-strong', 'text/primary'));
    tcol.appendChild(await txt(hint, 'ui/micro', 'text/tertiary'));
  }
  const sec2 = col('Section/limits', 10);
  body.appendChild(sec2); sec2.layoutSizingHorizontal = 'FILL';
  sec2.appendChild(await txt('Hạn mức mỗi ngày', 'ui/label', 'text/primary'));
  for (const [label, value] of [['Thẻ mới mỗi ngày', '20'], ['Thẻ ôn mỗi ngày', '200']]) {
    const r = row('field', 12, { counterAxisAlignItems: 'CENTER' });
    r.counterAxisSizingMode = 'FIXED'; r.resize(350, 56); r.primaryAxisSizingMode = 'FIXED';
    pad(r, 0, 12, 0, 16);
    r.cornerRadius = 14; setFill(r, 'bg/surface');
    setStroke(r, 'border/hairline'); r.strokeWeight = 1;
    sec2.appendChild(r); r.layoutSizingHorizontal = 'FILL';
    r.appendChild(await txt(label, 'ui/body', 'text/primary'));
    grow(r);
    const box = row('val', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
    box.counterAxisSizingMode = 'FIXED'; box.resize(72, 40); box.primaryAxisSizingMode = 'FIXED';
    box.cornerRadius = 10; setFill(box, 'bg/paper');
    setStroke(box, 'border/strong'); box.strokeWeight = 1;
    box.appendChild(await txt(value, 'num/count', 'text/primary'));
    r.appendChild(box);
  }
  await tabBar(s, 'Tài khoản');
}

/* 13 Tài khoản */ {
  const s = screen('13 · Tài khoản', 1320, RY); madeScreens.push(s);
  await statusBar(s);
  await titleBar(s, 'Tài khoản');
  const body = col('Body', 12); pad(body, 0, 20, 0, 20);
  s.appendChild(body); body.layoutSizingHorizontal = 'FILL'; body.layoutGrow = 1;
  const acc = row('Account', 14, { counterAxisAlignItems: 'CENTER' });
  acc.counterAxisSizingMode = 'FIXED'; acc.resize(350, 82); acc.primaryAxisSizingMode = 'FIXED';
  pad(acc, 0, 16, 0, 16);
  acc.cornerRadius = 16; setFill(acc, 'bg/surface');
  setStroke(acc, 'border/hairline'); acc.strokeWeight = 1;
  body.appendChild(acc); acc.layoutSizingHorizontal = 'FILL';
  const av = row('avatar', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  av.counterAxisSizingMode = 'FIXED'; av.resize(48, 48); av.primaryAxisSizingMode = 'FIXED';
  av.cornerRadius = 24; setFill(av, 'cat/blue');
  av.appendChild(await txt('L', 'ui/heading', 'text/on-action'));
  acc.appendChild(av);
  const acol = col('t', 2); acc.appendChild(acol); acol.layoutGrow = 1;
  acol.appendChild(await txt('Hoàng Linh', 'ui/item', 'text/primary'));
  acol.appendChild(await txt('hoanglinhuet@gmail.com', 'ui/meta', 'text/secondary'));
  await para(body, 'Dữ liệu học nằm trên server, nên bạn dùng được ở cả điện thoại và máy tính.', 'ui/meta', 'text/secondary');
  vspace(body, 2);
  const rows = col('rows', 10);
  body.appendChild(rows); rows.layoutSizingHorizontal = 'FILL';
  for (const [label, meta, ico, soft] of [
    ['Cài đặt', '6 cách ôn', icoSliders('cat/violet'), 'cat/violet-soft'],
    ['Kết nối extension', null, icoPlug('cat/teal'), 'cat/teal-soft'],
  ]) {
    const r = row('Row/' + label, 12, { counterAxisAlignItems: 'CENTER' });
    r.counterAxisSizingMode = 'FIXED'; r.resize(350, 64); r.primaryAxisSizingMode = 'FIXED';
    pad(r, 0, 14, 0, 14);
    r.cornerRadius = 16; setFill(r, 'bg/surface');
    setStroke(r, 'border/hairline'); r.strokeWeight = 1;
    rows.appendChild(r); r.layoutSizingHorizontal = 'FILL';
    iconTile(r, ico, soft, 38);
    r.appendChild(await txt(label, 'ui/item', 'text/primary'));
    grow(r);
    if (meta) r.appendChild(await txt(meta, 'ui/meta', 'text/tertiary'));
    r.appendChild(icoChevron('text/tertiary'));
  }
  vspace(body, 4);
  const out = row('SignOut', 0, { primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER' });
  out.counterAxisSizingMode = 'FIXED'; out.resize(350, 52); out.primaryAxisSizingMode = 'FIXED';
  out.cornerRadius = 12; setFill(out, 'bg/surface');
  setStroke(out, 'border/hairline'); out.strokeWeight = 1;
  body.appendChild(out); out.layoutSizingHorizontal = 'FILL';
  out.appendChild(await txt('Đăng xuất', 'ui/item', 'rating/again'));
  await tabBar(s, 'Tài khoản');
}

figma.currentPage.selection = madeScreens;
figma.viewport.scrollAndZoomIntoView(madeScreens);
console.log('Built ' + madeScreens.length + ' screens + the foundations sheet.');
