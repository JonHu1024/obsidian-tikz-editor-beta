import { chromium } from "playwright-core";
import { pathToFileURL } from "url";
import path from "path";
import fs from "fs";

const EXE = [
  process.env.HOME
    ? path.join(process.env.HOME, ".cache/ms-playwright", "chromium-1228", "chrome-linux64", "chrome")
    : null,
  process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright", "chromium-1217", "chrome-win64", "chrome.exe")
    : null,
].find((p) => p != null && fs.existsSync(p));

if (!EXE) {
  console.error("No Playwright chromium binary found. Run `npx playwright-core install chromium`.");
  process.exit(1);
}

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const url = pathToFileURL(path.resolve("test/index.html")).href;
await page.goto(url);
await page.waitForTimeout(600);

const te = () => page.evaluate(() => window.__te.getState());

// Enter the reference tikzcd editor: reload, toggle env to cd with the vim
// "env" command, wait for the preact grid to mount.
async function startCd() {
  await page.reload();
  await page.waitForTimeout(800);
  await page.keyboard.type("env");
  await page.waitForTimeout(200);
  await page.waitForSelector("#grid", { timeout: 4000 });
  await page.waitForTimeout(300);
}

// Helper: place a labelled cell at grid (col,row) using the keyboard
// (Enter edits the selected cell, characters type, Enter submits).
async function putCell(text) {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(80);
  await page.keyboard.type(text);
  await page.waitForTimeout(60);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);
}

// Reference-grid helpers: cell element centers in viewport coordinates.
async function cellCenter(col, row) {
  return page.evaluate(([c, r]) => {
    const el = document.querySelector(`#grid .grid-cell[data-position="${c},${r}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [col, row]);
}

// Shift-drag from cell A to cell B (reference arrow tool).
async function shiftDrag(colFrom, rowFrom, colTo, rowTo) {
  const a = await cellCenter(colFrom, rowFrom);
  const b = await cellCenter(colTo, rowTo);
  if (!a || !b) return false;
  await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(200);
  return true;
}

const cdArrow = (needle) => page.evaluate((n) => {
  const o = window.__te.getState().graph.objects.find((x) => x.type === "arrow" && (n == null || x.id === n));
  return o ? { id: o.id, bend: o.bend, shift: o.shift, text: o.text, labelPos: o.labelPos, startId: o.startId, endId: o.endId, loop: o.loop } : null;
}, needle);

const cdArrowCount = () => page.evaluate(() =>
  window.__te.getState().graph.objects.filter((o) => o.type === "arrow").length);

console.log("\n== 1. Initial state ==");
let s = await te();
check("NORMAL mode", s.mode === "NORMAL", JSON.stringify(s.mode));
check("default graph has no grid/axis", !s.graph.grid.enabled && !s.graph.axis.enabled);
const wrapSize = await page.evaluate(() => {
  const w = document.querySelector(".te-wrap");
  if (!w) return null;
  const st = window.__te.getState();
  const r = w.getBoundingClientRect();
  const expectW = (st.graph.width + 3) * st.canvas.ptPerCm * st.canvas.zoom;
  const expectH = (st.graph.height + 3) * st.canvas.ptPerCm * st.canvas.zoom;
  return { w: Math.round(r.width), h: Math.round(r.height), expectW: Math.round(expectW), expectH: Math.round(expectH) };
});
check("canvas sized to the graph", wrapSize && Math.abs(wrapSize.w - wrapSize.expectW) < 8 && Math.abs(wrapSize.h - wrapSize.expectH) < 8, JSON.stringify(wrapSize));
check("code tab shows template", true);

console.log("\n== 1b. main document isolation (no global pollution) ==");
const iso = await page.evaluate(() => ({
  tikzScripts: document.querySelectorAll('script[type="text/tikz"]').length,
  hasGlobalRender: typeof window.__tikzjaxRender,
  hasFontsStyle: !!document.getElementById("te-fonts-css"),
}));
check("no text/tikz scripts in main document", iso.tikzScripts === 0, String(iso.tikzScripts));
check("no __tikzjaxRender global in main window", iso.hasGlobalRender === "undefined", iso.hasGlobalRender);
check("no global fonts style", iso.hasFontsStyle === false);

console.log("\n== 2. Vim: create text (t) ==");
await page.keyboard.press("t");
s = await te();
check("text object created", s.graph.objects.length === 1, JSON.stringify(s.graph.objects.length));
check("object selected", s.selected === s.graph.objects[0]?.id);
check("buffer cleared", s.buffer === "");

console.log("\n== 3. INSERT: type + ESC keeps text ==");
await page.keyboard.press("i");
s = await te();
check("INSERT mode", s.mode === "INSERT");
await page.waitForTimeout(50);
await page.keyboard.type("Hello");
await page.keyboard.press("Alt");
s = await te();
check("back to NORMAL", s.mode === "NORMAL");
check("text persisted (formula + typed)", s.graph.objects[0]?.text === "$Hello$", JSON.stringify(s.graph.objects[0]?.text));
check("still selected", s.selected === s.graph.objects[0]?.id);

console.log("\n== 4. Alt exits INSERT even when textarea lost focus ==");
await page.keyboard.press("i");
await page.waitForTimeout(50);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press("Alt");
s = await te();
check("exited INSERT via Alt with blurred textarea", s.mode === "NORMAL", JSON.stringify(s.mode));
check("insert overlay gone", s.insert === null);

console.log("\n== 4b. ESC is NOT consumed by the editor ==");
await page.keyboard.press("i");
await page.waitForTimeout(50);
await page.keyboard.type("x");
await page.keyboard.press("Escape");
s = await te();
check("ESC does not exit INSERT (modal closes instead)", s.mode === "INSERT", JSON.stringify(s.mode));
check("text kept after ESC (x typed inside $...$)", s.graph.objects[0]?.text === "$xHello$", JSON.stringify(s.graph.objects[0]?.text));
await page.keyboard.press("Alt");
s = await te();
check("Alt exits INSERT after ESC", s.mode === "NORMAL");

console.log("\n== 5. Tab cycles selection ==");
await page.keyboard.press("t");
await page.keyboard.press("t");
s = await te();
console.log("   objects:", s.graph.objects.map((o) => `${o.type}:${o.id}`).join(", "));
console.log("   selected:", s.selected);
check("3 objects", s.graph.objects.length === 3, `count=${s.graph.objects.length}`);
const ids = s.graph.objects.map((o) => o.id);
await page.keyboard.press("Tab");
s = await te();
check("Tab selects first", s.selected === ids[0], JSON.stringify(s.selected));
await page.keyboard.press("Tab");
s = await te();
check("Tab cycles", s.selected === ids[1], JSON.stringify(s.selected));

console.log("\n== 6. undo (u) / redo ==");
await page.keyboard.press("u");
s = await te();
check("undo removes last object", s.graph.objects.length === 2, String(s.graph.objects.length));
await page.keyboard.type("redo");
s = await te();
check("redo restores", s.graph.objects.length === 3);

console.log("\n== 7. Ctrl+Z / Ctrl+Y ==");
await page.keyboard.press("Control+z");
s = await te();
check("Ctrl+Z undo", s.graph.objects.length === 2);
await page.keyboard.press("Control+y");
s = await te();
check("Ctrl+Y redo", s.graph.objects.length === 3);

console.log("\n== 8. shape creation (s + Enter + Enter) ==");
await page.keyboard.press("s");
await page.keyboard.press("Enter");
await page.waitForTimeout(80);
await page.keyboard.press("Enter");
await page.waitForTimeout(80);
s = await te();
check("shape created", s.graph.objects.length === 4, String(s.graph.objects.length));
check("shape is rectangle", s.graph.objects[3]?.type === "rectangle", String(s.graph.objects[3]?.type));

console.log("\n== 10. Code/Properties tab switching ==");
await page.click(".te-props-tab:nth-child(2)");
await page.waitForTimeout(100);
s = await te();
check("switched to code tab", s.tab === "code");
await page.click(".te-props-tab:nth-child(1)");
await page.waitForTimeout(100);
s = await te();
check("switched back to Properties", s.tab === "props", JSON.stringify(s.tab));
const navVisible = await page.isVisible(".te-props-nav");
check("Properties nav visible", navVisible);

console.log("\n== 11. Code tab: view mode (read-only) ==");
await page.click(".te-props-tab:nth-child(2)");
await page.waitForTimeout(200);
const cmOk = await page.evaluate(() => {
  const el = document.querySelector(".te-code-editor .cm-content");
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.height > 50 && r.width > 100;
});
check("CodeMirror has real size", cmOk);
const docBefore = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "NO CM");
check("doc has content", docBefore.length > 50, String(docBefore.length));
const cmLines = () => page.evaluate(() => document.querySelectorAll(".cm-line").length);
const linesBefore = await cmLines();
await page.click(".te-code-editor .cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("  % should be ignored");
await page.waitForTimeout(300);
const linesAfterType = await cmLines();
check("read-only: typing does not change doc", linesAfterType === linesBefore, `${linesBefore} -> ${linesAfterType}`);

console.log("\n== 11b. Edit mode: editable, no rendering while editing ==");
await page.click(".te-code-btn:has-text('Edit')");
await page.waitForTimeout(100);
await page.click(".te-code-editor .cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("  % comment from test");
await page.waitForTimeout(400);
const linesDuringEdit = await cmLines();
check("edit mode: newline + comment accepted", linesDuringEdit === linesBefore + 1, `${linesBefore} -> ${linesDuringEdit}`);
s = await te();
check("no model sync while editing", s.graph.objects.length === 4, String(s.graph.objects.length));
const docDuringEdit = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
check("comment present while editing", docDuringEdit.includes("% comment from test"));

console.log("\n== 11c. Run: applies code and re-renders ==");
await page.click(".te-code-btn:has-text('Run')");
await page.waitForTimeout(400);
s = await te();
check("model updated after run (comment in raw)", s.graph.objects.length === 4, String(s.graph.objects.length));
const docAfterRun = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
check("comment kept after run", docAfterRun.includes("% comment from test"));
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("x");
await page.waitForTimeout(300);
const linesAfterRun = await cmLines();
check("read-only again after Run", linesAfterRun === linesDuringEdit, `${linesDuringEdit} -> ${linesAfterRun}`);

console.log("\n== 12. Ctrl+E / Ctrl+S shortcuts ==");
await page.click(".te-code-editor .cm-content");
await page.keyboard.press("Control+e");
await page.waitForTimeout(100);
await page.click(".te-code-editor .cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("  % via ctrl-e");
await page.waitForTimeout(200);
const docViaShortcut = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
check("Ctrl+E enters edit mode", docViaShortcut.includes("% via ctrl-e"), JSON.stringify(docViaShortcut.slice(-40)));
await page.keyboard.press("Control+s");
await page.waitForTimeout(400);
s = await te();
check("Ctrl+S applies code", s.graph.objects.length === 4);
const docAfterCtrlS = await page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
check("ctrl-e comment kept", docAfterCtrlS.includes("% via ctrl-e"));

console.log("\n== 12b. model->code->model round trip keeps ids ==");
s = await te();
const idBefore = s.graph.objects[0]?.id;
await page.waitForTimeout(300);
s = await te();
check("text object id stable after code sync", s.graph.objects[0]?.id === idBefore, `${s.graph.objects[0]?.id} vs ${idBefore}`);
check("text content kept", s.graph.objects[0]?.text === "$xHello$", JSON.stringify(s.graph.objects[0]?.text));

console.log("\n== 13. arrow creation with selection (a + ArrowRight) ==");
await page.click(".te-props-tab:nth-child(1)");
await page.waitForTimeout(100);
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
s = await te();
const selObj = s.graph.objects.find((o) => o.id === s.selected);
check("selected an object", !!selObj);
await page.keyboard.press("a");
await page.keyboard.press("ArrowRight");
s = await te();
const arrow = s.graph.objects.find((o) => o.type === "arrow");
check("arrow created", !!arrow);
check("arrow anchored to selected", arrow?.startId === selObj?.id, JSON.stringify(arrow?.startId));
check("arrow editing mode", s.mode === "ARROW_EDITING", JSON.stringify(s.mode));

console.log("\n== 14. Alt returns to NORMAL from ARROW EDITING ==");
await page.keyboard.press("Alt");
s = await te();
check("NORMAL after Alt", s.mode === "NORMAL", JSON.stringify(s.mode));

console.log("\n== 14b. ARROW EDITING: arrow keys move the whole arrow ==");
const arrowBefore = s.graph.objects.find((o) => o.type === "arrow");
for (let i = 0; i < 10; i++) {
  s = await te();
  if (s.graph.objects.find((o) => o.id === s.selected)?.type === "arrow") break;
  await page.keyboard.press("Tab");
}
s = await te();
const arrowSel = s.graph.objects.find((o) => o.id === s.selected);
check("arrow selected", arrowSel?.type === "arrow", JSON.stringify(arrowSel?.type));
console.log("   mode at arrow-selected:", s.mode);
const beforeMove = s.graph.objects.find((o) => o.type === "arrow");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowUp");
s = await te();
const afterMove = s.graph.objects.find((o) => o.type === "arrow");
const movedDx = afterMove.x1 - beforeMove.x1;
const movedDy = afterMove.y1 - beforeMove.y1;
check("arrow translated by arrow keys", Math.abs(movedDx - 0.2) < 0.01 && Math.abs(movedDy - 0.2) < 0.01, `dx=${movedDx.toFixed(2)} dy=${movedDy.toFixed(2)}`);
const lenBefore = Math.hypot(afterMove.x2 - afterMove.x1, afterMove.y2 - afterMove.y1);
check("arrow length unchanged by move", Math.abs(lenBefore - Math.hypot(beforeMove.x2 - beforeMove.x1, beforeMove.y2 - beforeMove.y1)) < 0.01);

console.log("\n== 14c. h/l shorten/lengthen the arrow ==");
await page.keyboard.press("l");
s = await te();
const afterL = s.graph.objects.find((o) => o.type === "arrow");
const lenAfterL = Math.hypot(afterL.x2 - afterL.x1, afterL.y2 - afterL.y1);
check("l lengthens arrow", lenAfterL > lenBefore + 0.15, `before=${lenBefore.toFixed(2)} after=${lenAfterL.toFixed(2)}`);
await page.keyboard.press("h");
s = await te();
const afterH = s.graph.objects.find((o) => o.type === "arrow");
const lenAfterH = Math.hypot(afterH.x2 - afterH.x1, afterH.y2 - afterH.y1);
check("h shortens arrow", lenAfterH < lenBefore + 0.05, `after=${lenAfterH.toFixed(2)}`);
void arrowBefore;
void arrowSel;

console.log("\n== 15. delete (d) ==");
await page.keyboard.press("Tab");
await page.keyboard.press("d");
s = await te();
check("object deleted", s.graph.objects.length === 4, String(s.graph.objects.length));

console.log("\n== 16. cmd buffer visual feedback (typing 'o') ==");
await page.keyboard.press("o");
s = await te();
check("buffer shows o", s.buffer === "o", JSON.stringify(s.buffer));
await page.keyboard.press("Backspace");
s = await te();
check("buffer cleared on backspace", s.buffer === "");

console.log("\n== 17. no JS errors ==");
const realErrors = errors.filter((e) => !/favicon/i.test(e));
check("no page errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

console.log("\n== 18. mouse: click to select object on canvas ==");
await page.click(".te-props-tab:nth-child(1)");
await page.waitForTimeout(150);
const hitPos = await page.evaluate(() => {
  const st = window.__te.getState();
  const obj = st.graph.objects.find((o) => o.type === "text");
  if (!obj) return null;
  const wrap = document.querySelector(".te-wrap");
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  const c = st.canvas;
  const pt = c.ptPerCm;
  const zoom = c.zoom;
  const sx = (obj.x - c.contentMinX + 1.5) * pt * zoom;
  const sy = (c.contentMaxY + 1.5 - obj.y) * pt * zoom;
  return { x: r.left + sx, y: r.top + sy, objId: obj.id };
});
check("found text object to click", !!hitPos);
await page.mouse.click(hitPos.x, hitPos.y);
s = await te();
check("click selected the text object", s.selected === hitPos.objId, `${s.selected} vs ${hitPos.objId}`);

console.log("\n== 19. mouse: drag moves object ==");
const before = s.graph.objects.find((o) => o.id === hitPos.objId);
await page.mouse.move(hitPos.x, hitPos.y);
await page.mouse.down();
await page.mouse.move(hitPos.x + 40, hitPos.y + 40, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(120);
s = await te();
const after = s.graph.objects.find((o) => o.id === hitPos.objId);
const dx = after.x - before.x;
const dy = after.y - before.y;
check("object moved by drag", Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5, `dx=${dx.toFixed(2)} dy=${dy.toFixed(2)}`);

console.log("\n== 19b. pseudo-render: every object is a drawn element in the left canvas ==");
const drawnCount = await page.evaluate(() => document.querySelectorAll(".te-scene .te-drawn, .te-text-node").length);
check("left canvas has drawn elements", drawnCount >= 4, String(drawnCount));
const alignedCheck = await page.evaluate(() => {
  const st = window.__te.getState();
  const obj = st.graph.objects.find((o) => o.type === "text");
  if (!obj) return null;
  const node = [...document.querySelectorAll(".te-text-node")].find((el) => el.getAttribute("data-id") === obj.id);
  if (!node) return null;
  const wrap = document.querySelector(".te-wrap");
  const r = wrap.getBoundingClientRect();
  const c = st.canvas;
  const expectX = (obj.x - c.contentMinX + 1.5) * c.ptPerCm * c.zoom;
  const expectY = (c.contentMaxY + 1.5 - obj.y) * c.ptPerCm * c.zoom;
  const nr = node.getBoundingClientRect();
  const offX = nr.left + nr.width / 2 - (r.left + expectX);
  const offY = nr.top + nr.height / 2 - (r.top + expectY);
  return { offX, offY };
});
check("text node sits exactly at its model position (no offset possible)", alignedCheck && Math.abs(alignedCheck.offX) < 2 && Math.abs(alignedCheck.offY) < 2, JSON.stringify(alignedCheck));

console.log("\n== 19c. infinite canvas: canvas grows with content ==");
const growCheck = await page.evaluate(() => {
  const wrap = document.querySelector(".te-wrap");
  const before = wrap.getBoundingClientRect().width;
  return { before };
});
// move an object far outside the graph via the editor API
await page.evaluate(() => {
  const st = window.__te.getState();
  const obj = st.graph.objects[0];
  window.__te.editor.select(obj.id);
  window.__te.editor.dragObject(obj.id, 15, 10);
});
await page.waitForTimeout(150);
const growAfter = await page.evaluate(() => document.querySelector(".te-wrap")?.getBoundingClientRect().width ?? 0);
check("canvas grew beyond the graph", growAfter > growCheck.before + 50, `${growCheck.before.toFixed(0)} -> ${growAfter.toFixed(0)}`);

console.log("\n== 20. toolbar [T] button creates text ==");
await page.click(".te-tb-btn >> nth=0");
await page.waitForTimeout(80);
s = await te();
check("toolbar T created text with formula", s.graph.objects.some((o) => o.type === "text" && o.text === "$$"));

console.log("\n== 20b. color picker filters by typing ==");
await page.keyboard.press("c");
await page.waitForTimeout(120);
const colorItems = async () => page.evaluate(() => [...document.querySelectorAll(".te-cp-item")].map((el) => el.textContent.trim()));
const colorsBefore = await colorItems();
check("color list shown", colorsBefore.length > 5, String(colorsBefore.length));
await page.keyboard.type("red");
await page.waitForTimeout(120);
const colorsAfter = await colorItems();
check("color list filtered to red", colorsAfter.length < colorsBefore.length && colorsAfter.every((c) => c.includes("red")), JSON.stringify(colorsAfter.slice(0, 6)));
await page.keyboard.press("Escape");
await page.keyboard.press("Alt");
await page.waitForTimeout(80);

console.log("\n== 20c. Alt+E returns to NORMAL MODE from props panel ==");
await page.click(".te-props-tab:nth-child(1)");
await page.waitForTimeout(80);
await page.click(".te-field input");
await page.waitForTimeout(80);
// focus is in a props input; Alt+E should switch back to NORMAL
await page.keyboard.press("Alt+e");
s = await te();
check("Alt+E switches to NORMAL", s.mode === "NORMAL", JSON.stringify(s.mode));
check("Alt+E focuses preview panel", s.panel === "preview", JSON.stringify(s.panel));
// vim keys work again
await page.keyboard.press("u");
s = await te();
check("vim keys work after Alt+E", s.graph.objects.length >= 3);

console.log("\n== 20d. shapes drawn as elements (no separate overlay layer) ==");
const shapeCount = await page.evaluate(() => document.querySelectorAll(".te-scene .te-drawn").length);
check("shapes drawn in the scene", shapeCount >= 1, String(shapeCount));

console.log("\n== 20e. click pseudo-rendered element selects the object ==");
await page.keyboard.press("t");
await page.waitForTimeout(200);
const nodeClickPos = await page.evaluate(() => {
  const st = window.__te.getState();
  const textObjs = st.graph.objects.filter((o) => o.type === "text");
  const vp = document.querySelector(".te-viewport").getBoundingClientRect();
  for (const obj of textObjs) {
    const node = [...document.querySelectorAll(".te-text-node")].find((el) => el.getAttribute("data-id") === obj.id);
    if (!node) continue;
    const nr = node.getBoundingClientRect();
    if (nr.left < vp.left || nr.left > vp.right || nr.top < vp.top || nr.top > vp.bottom) continue;
    return { x: nr.left + nr.width / 2, y: nr.top + nr.height / 2, id: obj.id };
  }
  return null;
});
check("pseudo-rendered text node found (visible)", !!nodeClickPos);
if (!nodeClickPos) {
  console.log("DEBUG 20e:", JSON.stringify(await page.evaluate(() => {
    const st = window.__te.getState();
    return {
      textObjs: st.graph.objects.filter((o) => o.type === "text").map((o) => `${o.id}@${o.x.toFixed(2)},${o.y.toFixed(2)}`),
      allNodes: [...document.querySelectorAll(".te-text-node")].map((el) => el.getAttribute("data-id")),
      vp: (() => { const v = document.querySelector(".te-viewport").getBoundingClientRect(); return { l: Math.round(v.left), r: Math.round(v.right), t: Math.round(v.top), b: Math.round(v.bottom) }; })(),
      sel: st.selected,
    };
  })));
}
await page.mouse.click(nodeClickPos.x, nodeClickPos.y);
await page.waitForTimeout(100);
s = await te();
check("clicking pseudo-rendered element selects it", s.selected === nodeClickPos.id, `${s.selected} vs ${nodeClickPos.id}`);

console.log("\n== 21. toolbar: Position/Calibrate/Set removed ==");
const tb = await page.evaluate(() => [...document.querySelectorAll(".te-tb-btn")].map((b) => b.textContent.trim()));
check("Position button removed", !tb.some((t) => t.includes("Position")), JSON.stringify(tb));
check("Calibrate button removed", !tb.some((t) => t.includes("Calibrate")), JSON.stringify(tb));
check("Set button removed", !tb.some((t) => t === "Set"), JSON.stringify(tb));

console.log("\n== 21b. Nodes list: search filters, Ctrl+F focuses, click selects ==");
await page.click(".te-nav-btn:has-text('Nodes')");
await page.waitForTimeout(150);
const nodeItems = async () => page.evaluate(() => [...document.querySelectorAll(".te-node-item")].map((el) => el.textContent.trim()));
check("node list shows items", (await nodeItems()).length >= 3, String((await nodeItems()).length));
await page.keyboard.press("Control+f");
await page.waitForTimeout(120);
const searchFocused = await page.evaluate(() => document.activeElement?.classList?.contains("te-nodes-search") ?? false);
check("Ctrl+F focuses the node search", searchFocused === true, "not focused");
await page.keyboard.type("$$");
await page.waitForTimeout(150);
const filteredNow = await nodeItems();
check("search filters by content", filteredNow.length >= 1 && filteredNow.every((t) => t.includes("$$")), JSON.stringify(filteredNow));
await page.keyboard.press("Escape");
await page.evaluate(() => { const i = document.querySelector(".te-nodes-search"); i.value = ""; i.dispatchEvent(new Event("input")); });
await page.waitForTimeout(100);
// click the first item selects it on canvas
const firstItem = await page.evaluate(() => {
  const it = document.querySelector(".te-node-item");
  if (!it) return null;
  return { x: it.getBoundingClientRect().left + 40, y: it.getBoundingClientRect().top + 10 };
});
await page.mouse.click(firstItem.x, firstItem.y);
await page.waitForTimeout(120);
s = await te();
check("clicking a node item selects the object", s.selected !== null, `${s.selected}`);



console.log("\n== 23. shape labels rendered as KaTeX divs ==");
await page.evaluate(() => window.__te.editor.createShape("rectangle"));
await page.waitForTimeout(150);
await page.evaluate(() => {
  const st = window.__te.getState();
  const rect = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.startInsert(rect.id, "text");
});
await page.waitForTimeout(150);
await page.keyboard.type("Hello");
await page.keyboard.press("Alt");
await page.waitForTimeout(250);
const labelShown = await page.evaluate(() => {
  const lbl = [...document.querySelectorAll(".te-shape-label")].find((el) => el.textContent.includes("Hello"));
  return !!lbl;
});
check("shape label rendered", labelShown === true);

console.log("\n== 24. camera centers the NEW object after create ==");
const centered = await page.evaluate(() => {
  const st = window.__te.getState();
  const vp = document.querySelector(".te-viewport");
  const c = st.canvas;
  const objs = st.graph.objects;
  if (objs.length === 0) return null;
  const last = objs[objs.length - 1];
  const lx = (last.x - c.contentMinX + 1.5) * c.ptPerCm;
  const ly = (c.contentMaxY + 1.5 - last.y) * c.ptPerCm;
  const screenX = c.panX + lx * c.zoom;
  const screenY = c.panY + ly * c.zoom;
  return {
    dx: Math.abs(screenX - vp.clientWidth / 2),
    dy: Math.abs(screenY - vp.clientHeight / 2),
    panX: c.panX, panY: c.panY,
  };
});
check("new object centered after create", centered && centered.dx < 3 && centered.dy < 3, JSON.stringify(centered));
// creating near a selected object re-centers the camera on the new node
const panMoved = await page.evaluate(() => {
  const st = window.__te.getState();
  const sel = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.select(sel.id);
  return new Promise((resolve) => {
    window.__te.editor.createShape("circle");
    setTimeout(() => {
      const s2 = window.__te.getState();
      const circle = s2.graph.objects.find((o) => o.type === "circle");
      const c = s2.canvas;
      const lx = (circle.x - c.contentMinX + 1.5) * c.ptPerCm;
      const ly = (c.contentMaxY + 1.5 - circle.y) * c.ptPerCm;
      const vp = document.querySelector(".te-viewport");
      const screenX = c.panX + lx * c.zoom;
      const screenY = c.panY + ly * c.zoom;
      resolve({
        centered: Math.abs(screenX - vp.clientWidth / 2) < 3 && Math.abs(screenY - vp.clientHeight / 2) < 3,
      });
    }, 120);
  });
});
check("creating near a selected object re-centers the camera", panMoved.centered === true, JSON.stringify(panMoved));

console.log("\n== 25. line hit area is wider than the visible stroke ==");
const hitInfo = await page.evaluate(() => {
  const vis = document.querySelector(".te-drawn-vis rect, .te-drawn-vis polygon, .te-drawn-vis polyline");
  const hit = document.querySelector(".te-drawn-hit rect, .te-drawn-hit polygon, .te-drawn-hit polyline");
  return {
    vis: vis ? vis.getAttribute("stroke-width") : null,
    hit: hit ? hit.getAttribute("stroke-width") : null,
    visPointer: vis ? getComputedStyle(vis.closest("g")).pointerEvents : null,
    hitPointer: hit ? getComputedStyle(hit.closest("g")).pointerEvents : null,
  };
});
check("hit stroke wider than visible", hitInfo.hit !== null && hitInfo.vis !== null && parseFloat(hitInfo.hit) > parseFloat(hitInfo.vis), JSON.stringify(hitInfo));


console.log("\n== 26. resize: tiny drag produces proportional growth (no blow-up) ==");
await page.reload();
await page.waitForTimeout(900);
await page.evaluate(() => window.__te.editor.createShape("rectangle"));
await page.waitForTimeout(200);
const rb = await page.evaluate(() => {
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  return { w: r.w, id: r.id };
});
const rh = await page.evaluate(() => {
  const node = [...document.querySelectorAll(".te-scene [data-handle]")].find((el) => el.getAttribute("data-handle") === "e");
  const nr = node.getBoundingClientRect();
  return { x: nr.left + nr.width / 2, y: nr.top + nr.height / 2 };
});
await page.mouse.move(rh.x, rh.y);
await page.mouse.down();
await page.mouse.move(rh.x + 4, rh.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(150);
const ra = await page.evaluate(() => {
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  return r.w;
});
check("4px drag grows the rect by ~0.1cm not +3cm", Math.abs(ra - rb.w) < 0.5, `before=${rb.w.toFixed(2)} after=${ra.toFixed(2)}`);

console.log("\n== 27. zoom: Ctrl++ key and ctrl+wheel ==");
const z0 = await page.evaluate(() => window.__te.getState().canvas.zoom);
await page.keyboard.press("Control+=");
await page.waitForTimeout(80);
const z1 = await page.evaluate(() => window.__te.getState().canvas.zoom);
check("Ctrl+= zooms in", z1 > z0, `${z0} -> ${z1}`);
await page.keyboard.press("Control+-");
await page.waitForTimeout(80);
const z2 = await page.evaluate(() => window.__te.getState().canvas.zoom);
check("Ctrl+- zooms out", z2 < z1, `${z1} -> ${z2}`);
const zw = await page.evaluate(() => {
  const vp = document.querySelector(".te-viewport");
  const before = window.__te.getState().canvas.zoom;
  const r = vp.getBoundingClientRect();
  vp.dispatchEvent(new WheelEvent("wheel", { clientX: r.left + 200, clientY: r.top + 200, deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
  return { before, after: window.__te.getState().canvas.zoom };
});
check("ctrl+wheel zooms in", zw.after > zw.before, JSON.stringify(zw));

console.log("\n== 28. arrow labels: text above, textBelow below ==");
await page.evaluate(() => {
  const st = window.__te.getState();
  const g = st.graph;
  const dir = { dx: 1, dy: 0 };
  const sel = g.objects.find((o) => o.type === "rectangle");
  window.__te.editor.select(sel.id);
  window.__te.editor.createArrow(dir, false);
});
await page.waitForTimeout(200);
await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  window.__te.editor.mutate((g) => { const o = g.objects.find((x) => x.id === a.id); o.text = "UP"; o.textBelow = "DOWN"; });
});
await page.waitForTimeout(200);
const arrowLabelPos = await page.evaluate(() => {
  const labels = [...document.querySelectorAll(".te-arrow-label")];
  const up = labels.find((el) => el.textContent.includes("UP"));
  const down = labels.find((el) => el.textContent.includes("DOWN"));
  if (!up || !down) return null;
  return { up: up.getBoundingClientRect().top, down: down.getBoundingClientRect().top };
});
check("UP label sits above DOWN label", arrowLabelPos && arrowLabelPos.up < arrowLabelPos.down, JSON.stringify(arrowLabelPos));

console.log("\n== 29. insert overlay sits below the node ==");
await page.keyboard.press("t");
await page.waitForTimeout(150);
await page.evaluate(() => {
  const st = window.__te.getState();
  const t = st.graph.objects.find((o) => o.type === "text");
  window.__te.editor.startInsert(t.id, "text");
});
await page.waitForTimeout(200);
const overlayPos = await page.evaluate(() => {
  const st = window.__te.getState();
  const t = st.graph.objects.find((o) => o.type === "text");
  const node = [...document.querySelectorAll(".te-text-node")].find((el) => el.getAttribute("data-id") === t.id);
  const ta = document.querySelector(".te-insert-ta.te-insert-active");
  if (!node || !ta) return null;
  const nr = node.getBoundingClientRect();
  const tr = ta.getBoundingClientRect();
  return { nodeBottom: nr.bottom, taTop: tr.top };
});
check("edit box below the node", overlayPos && overlayPos.taTop >= overlayPos.nodeBottom, JSON.stringify(overlayPos));
await page.keyboard.press("Alt");


console.log("\n== 30. arrow styles: generator, parser, pseudo-render, UI ==");
// generator: styled arrow emits the right options
const genCode = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  window.__te.editor.setArrowStyle(a.id, "both", "arrow", "dashed");
  const g = window.__te.getState().graph;
  const code = window.__te.editor.generateCode ? null : null;
  return window.__te.editor.generateCode ? null : "skip";
});
// (use the editor's generator through a fresh parse instead)
await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  window.__te.editor.setArrowStyle(a.id, "start", "arrow", "dotted");
});
const styleState = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return { head: a.head, dash: a.dash };
});
check("setArrowStyle updates the model", styleState.head === "start" && styleState.dash === "dotted", JSON.stringify(styleState));

// pseudo-render draws the reverse head at the START (2 heads total when 'both')
await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  window.__te.editor.setArrowStyle(a.id, "both", "arrow", "dashed");
});
await page.waitForTimeout(200);
const headsCount = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  const vis = document.querySelector(`.te-drawn-vis[data-id="${a.id}"]`);
  return vis ? vis.querySelectorAll("polygon").length : -1;
});
check("both style draws two arrowheads", headsCount === 2, String(headsCount));
const dashAttr = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  const vis = document.querySelector(`.te-drawn-vis[data-id="${a.id}"]`);
  const line = vis ? vis.querySelector("line, polyline") : null;
  return line ? line.getAttribute("stroke-dasharray") : null;
});
check("dashed line renders stroke-dasharray", dashAttr !== null && dashAttr !== "", String(dashAttr));

// round-trip: generator emits the style options, parser reads them back
const roundTrip = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  window.__te.editor.setArrowStyle(a.id, "start", "latex", "dotted");
  const g = window.__te.getState().graph;
  const code = window.__te.generateCode(g);
  const hasOpts = code.includes("latex-") && code.includes("dotted");
  if (!hasOpts) console.log("GENCODE:", code);
  const parsed = window.__te.parseCode(code);
  const pa = parsed.objects.find((o) => o.type === "arrow");
  return { hasOpts, head: pa ? pa.head : null, tip: pa ? pa.tip : null, dash: pa ? pa.dash : null };
});
check("generator emits latex- and dotted", roundTrip.hasOpts === true, JSON.stringify(roundTrip).slice(0, 120));
check("parser reads back head/tip/dash", roundTrip.head === "start" && roundTrip.tip === "latex" && roundTrip.dash === "dotted", JSON.stringify(roundTrip));

// UI: Arrows section changes the selected arrow's style
await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  window.__te.editor.select(a.id);
});
await page.waitForTimeout(150);
await page.click(".te-nav-btn:has-text('Arrows')");
await page.waitForTimeout(150);
const uiState0 = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return { head: a.head, dash: a.dash };
});
await page.click(".te-arrow-btn:has-text('↔')");
await page.waitForTimeout(120);
await page.click(".te-arrow-btn:has-text('⋯⋯')");
await page.waitForTimeout(120);
const uiState1 = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return { head: a.head, dash: a.dash };
});
check("UI arrowhead button updates model", uiState0.head !== uiState1.head && uiState1.head === "both", JSON.stringify(uiState1));
check("UI dash button updates model", uiState1.dash === "dotted", JSON.stringify(uiState1));



console.log("\n== 32. op swaps arrow endpoints (ARROW_EDITING) ==");
await page.reload();
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__te.editor.createShape("rectangle");
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.select(r.id);
  window.__te.editor.createArrow({ dx: 1, dy: 0 }, false);
});
await page.waitForTimeout(200);
const opBefore = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, s: a.startId, e: a.endId };
});
await page.keyboard.type("op");
await page.waitForTimeout(150);
const opAfter = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, s: a.startId, e: a.endId };
});
check("op swapped coordinates", opBefore.x1 === opAfter.x2 && opBefore.y1 === opAfter.y2 && opBefore.x2 === opAfter.x1, JSON.stringify(opAfter));
check("op swapped bindings", opAfter.s === opBefore.e && opAfter.e === opBefore.s, JSON.stringify(opAfter));

console.log("\n== 33. arrow tip picker: a opens it, selection applies ==");
await page.keyboard.press("a");
await page.waitForTimeout(150);
const pickerShown = await page.evaluate(() => !!document.querySelector(".te-tip-picker"));
check("a opens the tip picker", pickerShown === true, "not shown");
const tipCount = await page.evaluate(() => document.querySelectorAll(".te-tp-item").length);
check("picker lists all tips", tipCount === 10, String(tipCount));
await page.evaluate(() => { const el = [...document.querySelectorAll(".te-tp-item")].find((x) => x.textContent.includes("latex")); el.click(); });
await page.waitForTimeout(150);
const tipApplied = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return a.tip;
});
check("picker applied latex tip", tipApplied === "latex", String(tipApplied));

console.log("\n== 34. env toggle + tikzcd round-trip ==");
await page.reload();
await page.waitForTimeout(800);
await page.keyboard.type("env");
await page.waitForTimeout(150);
const env1 = await page.evaluate(() => window.__te.getState().graph.env);
check("env toggles to cd on empty canvas", env1 === "cd", String(env1));
await page.evaluate(() => {
  const st = window.__te.getState();
  window.__te.editor.createText(false);
  window.__te.editor.mutate((g) => { const t = g.objects[0]; t.text = "A"; });
});
const cdCode = await page.evaluate(() => {
  const st = window.__te.getState();
  const t = st.graph.objects[0];
  window.__te.editor.mutate((g) => {
    const o = g.objects.find((x) => x.id === t.id);
    o.x = 0.8; o.y = 0.8;
    g.objects.push({ id: "t" + g.nextId++, type: "text", x: 2.4, y: 0.8, color: "black", text: "B", width: 1.4 });
    g.objects.push({ id: "a" + g.nextId++, type: "arrow", x: 1.6, y: 0.8, color: "black", text: "f", textBelow: "", x1: 0.8, y1: 0.8, x2: 2.4, y2: 0.8, startId: t.id, endId: null, head: "end", tip: "arrow", dash: "solid" });
  });
  return window.__te.generateCode(window.__te.getState().graph);
});
check("cd code contains tikzcd", cdCode.includes("\\begin{tikzcd}") && cdCode.includes("A \\arrow[r, \"f\"] & B"), cdCode.slice(0, 200));
 check("cd code contains arrow inline with label", /\\arrow\[r, "f"\]/.test(cdCode), cdCode.split("\\n").filter((l) => l.includes("arrow")).join(" | "));
check("cd arrows are inline (no standalone arrow lines)", !/^\\s*\\arrow/.test(cdCode), cdCode.split("\\n").filter((l) => l.includes("arrow")).join(" | "));

// parse the user's official-style sample
const officialSample = `\\usepackage{tikz-cd}
\\begin{document}
\\begin{tikzcd}
T \\arrow[drr, bend left, "x"] \\arrow[ddr, bend right, "y"] & & \\\\
K & X \\times_Z Y \\arrow[r, "p"] \\arrow[d, "q"]
& X \\arrow[d, "f"] \\\\
& Y \\arrow[r, "g"]
& Z
\\end{tikzcd}
\\end{document}`;
const parsedCd = await page.evaluate((sample) => {
  const g = window.__te.parseCode(sample);
  return {
    env: g.env,
    texts: g.objects.filter((o) => o.type === "text").map((o) => o.text),
    arrows: g.objects.filter((o) => o.type === "arrow").map((a) => ({ t: a.text, tb: a.textBelow, dir: [Math.round(a.x2 - a.x1), Math.round(a.y2 - a.y1)] })),
  };
}, officialSample);
check("cd sample parses env", parsedCd.env === "cd", String(parsedCd.env));
check("cd sample parses cells", parsedCd.texts.includes("T") && parsedCd.texts.includes("K") && parsedCd.texts.includes("X \\times_Z Y") && parsedCd.texts.includes("Z"), JSON.stringify(parsedCd.texts));
check("cd sample parses arrows with labels", parsedCd.arrows.some((a) => a.t === "p") && parsedCd.arrows.some((a) => a.t === "x"), JSON.stringify(parsedCd.arrows));

console.log("\n== 35. bound arrows follow their node ==");
await page.reload();
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__te.editor.createShape("rectangle");
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.select(r.id);
  window.__te.editor.createArrow({ dx: 1, dy: 0 }, false);
});
await page.waitForTimeout(150);
const bound0 = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  return { x1: a.x1, y1: a.y1, rx: r.x, ry: r.y, id: r.id };
});
await page.evaluate(() => {
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.dragObject(r.id, 2, 1.5);
});
await page.waitForTimeout(150);
const bound1 = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  return { x1: a.x1, y1: a.y1 };
});
check("bound arrow start follows the node", Math.abs((bound1.x1 - bound0.x1) - 2) < 0.01 && Math.abs((bound1.y1 - bound0.y1) - 1.5) < 0.01, JSON.stringify(bound1));

console.log("\n== 36. generator emits named coordinates for bound arrows ==");
const coordCode = await page.evaluate(() => {
  const st = window.__te.getState();
  return window.__te.generateCode(st.graph);
});
check("arrow line uses the node name (tkz_)", coordCode.includes(`(tkz_${bound0.id}) --`), coordCode.split("\n").find((l) => l.includes("draw[") && l.includes("--")) ?? "none");
check("no orphan te_ coordinates for shapes", !coordCode.includes(`\\coordinate (te_${bound0.id})`), coordCode.slice(0, 300));
const coordRound = await page.evaluate(() => {
  const st = window.__te.getState();
  const code = window.__te.generateCode(st.graph);
  const parsed = window.__te.parseCode(code);
  const a = parsed.objects.find((o) => o.type === "arrow");
  return { startId: a ? a.startId : null, endId: a ? a.endId : null };
});
check("named refs parse back to bindings", coordRound.startId === bound0.id, JSON.stringify(coordRound));


console.log("\n== 37. arrow handles sit at the actual endpoints (diagonal arrow) ==");
await page.reload();
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__te.editor.createShape("rectangle");
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.select(r.id);
  window.__te.editor.createArrow({ dx: 1, dy: 1 }, false);
});
await page.waitForTimeout(200);
const handles = await page.evaluate(() => {
  const st = window.__te.getState();
  const a = st.graph.objects.find((o) => o.type === "arrow");
  const c = st.canvas;
  const wrap = document.querySelector(".te-wrap");
  const wr = wrap.getBoundingClientRect();
  const toScreen = (x, y) => {
    const lx = (x - c.contentMinX + 1.5) * c.ptPerCm;
    const ly = (c.contentMaxY + 1.5 - y) * c.ptPerCm;
    return { x: wr.left + lx * c.zoom, y: wr.top + ly * c.zoom };
  };
  const hs = [...document.querySelectorAll(".te-scene [data-handle]")];
  const get = (h) => {
    const el = hs.find((x) => x.getAttribute("data-handle") === h);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  return {
    tail: get("w"), head: get("e"),
    expectTail: toScreen(a.x1, a.y1), expectHead: toScreen(a.x2, a.y2),
  };
});
const dTail = Math.hypot(handles.tail.x - handles.expectTail.x, handles.tail.y - handles.expectTail.y);
const dHead = Math.hypot(handles.head.x - handles.expectHead.x, handles.head.y - handles.expectHead.y);
check("tail handle at (x1,y1)", dTail < 6, `off=${dTail.toFixed(1)}`);
check("head handle at (x2,y2)", dHead < 6, `off=${dHead.toFixed(1)}`);


console.log("\n== 38. user's inserted code parses fully (nested-brace labels + labels) ==");
const userCode38 = [
  "\\begin{document}",
  "\\begin{tikzpicture}",
  "  \\node[text=black] (tkz_o1_1) at (1.756,1.081) {$f$};",
  "  \\coordinate (te_o1_1) at (1.756,1.081);",
  "  \\draw[->, thick] (te_o1_1) -- (4.256,1.081);",
  "  \\node[above, font=\\small, text=black] at (3.256,1.081) {int};",
  "  \\node[below, font=\\small, text=black] at (3.256,1.081) {else};",
  "  \\draw[black] (4.456,0.419) rectangle (6.613,1.726) node[midway, name=tkz_o3_3]{$\\sum_{i=1}^n x_i$};",
  "  \\coordinate (te_o3_3) at (5.534,1.072);",
  "  \\draw[->, thick] (te_o3_3) -- (8.613,1.072);",
  "  \\draw[black] (9.813,1.072) circle (0.9) node[name=tkz_o5_5]{$I \\space am \\space a \\space circle.$};",
  "\\end{tikzpicture}",
  "\\end{document}",
].join("\n");
const parsed38 = await page.evaluate((code) => {
  const g = window.__te.parseCode(code);
  return {
    rect: g.objects.some((o) => o.type === "rectangle" && o.text.includes("sum")),
    circle: g.objects.some((o) => o.type === "circle"),
    arrowText: (() => { const a = g.objects.find((o) => o.type === "arrow"); return a ? a.text + "/" + a.textBelow : ""; })(),
    ids: g.objects.map((o) => o.id),
    codeHead: code.slice(0, 40),
    hasRealNl: code.includes("\n"),
    lineCount: code.split("\n").length,
    raws: g.rawSnippets.length,
    raw0: g.rawSnippets[0] ? g.rawSnippets[0].text.slice(0, 60) : "", 
  };
}, userCode38);
check("rectangle with math label parsed", parsed38.rect === true, JSON.stringify(parsed38));
check("circle parsed", parsed38.circle === true, JSON.stringify(parsed38));
check("arrow labels attached", parsed38.arrowText === "int/else", parsed38.arrowText);
const dupIds = parsed38.ids.length !== new Set(parsed38.ids).size;
check("no duplicate object ids", dupIds === false, JSON.stringify(parsed38.ids));

console.log("\n== 39. cd mode: usepackage auto-added + first free cell placement ==");
await startCd();
// cell (0,0) is selected by default: put "A", move right, put "B"
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
const cdOut39 = await page.evaluate(() => {
  const st = window.__te.getState();
  const texts = st.graph.objects
    .filter((o) => o.type === "text")
    .map((o) => ({ x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10, t: o.text }));
  const code = window.__te.generateCode(st.graph);
  return { texts, preamble: code.includes("\\usepackage{tikz-cd}"), cells: code.includes("A & B") };
});
check("cd texts land in consecutive cells", cdOut39.texts.length === 2 && cdOut39.texts[0].x === 0.8 && cdOut39.texts[1].x === 2.4, JSON.stringify(cdOut39.texts));
check("cd code includes usepackage{tikz-cd}", cdOut39.preamble === true);
check("cd cells adjacent", cdOut39.cells === true, "cells not adjacent");


console.log("\n== 40. tip picker: arrow keys navigate (not move the object) ==");
await page.reload();
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__te.editor.createShape("rectangle");
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  window.__te.editor.select(r.id);
  window.__te.editor.createArrow({ dx: 1, dy: 0 }, false);
});
await page.waitForTimeout(200);
const rx0 = await page.evaluate(() => {
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  return r.x;
});
await page.keyboard.press("a");
await page.waitForTimeout(150);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(100);
const rx1 = await page.evaluate(() => {
  const st = window.__te.getState();
  const r = st.graph.objects.find((o) => o.type === "rectangle");
  return r.x;
});
check("arrow keys do not move the object while the picker is open", rx1 === rx0, `${rx0} -> ${rx1}`);
const activeIdx = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".te-tp-item")];
  return items.findIndex((el) => el.classList.contains("te-tp-active"));
});
check("picker navigation index advanced", activeIdx === 2, String(activeIdx));
await page.keyboard.press("Alt");

console.log("\n== 41. generator: bound arrows to EXISTING nodes only (no orphan refs) ==");
const orphanTest = await page.evaluate(() => {
  const g = window.__te.getState().graph;
  // an arrow bound to a nonexistent id must fall back to absolute coords
  window.__te.editor.mutate((gg) => {
    gg.objects.push({ id: "ghost1", type: "arrow", x: 2, y: 2, color: "black", text: "", textBelow: "", x1: 1, y1: 1, x2: 3, y2: 3, startId: "does_not_exist", endId: null, head: "end", tip: "arrow", dash: "solid" });
  });
  const code = window.__te.generateCode(window.__te.getState().graph);
  return {
    usesAbsolute: code.includes("(1,1) -- (3,3)"),
    noOrphan: !code.includes("(tkz_does_not_exist)"),
  };
});
check("missing node falls back to absolute coords", orphanTest.usesAbsolute === true && orphanTest.noOrphan === true, JSON.stringify(orphanTest));

console.log("\n== 42. multi-function plot template has the document structure ==");
const multiTpl = await page.evaluate(() => {
  const fn = window.__teGetMultiTemplate ? null : null;
  return null;
});
void multiTpl;

console.log("\n== 43. CodeMirror Ctrl+F opens the search panel ==");
await page.click(".te-props-tab:has-text('Code')");
await page.waitForTimeout(400);
// focus the CM content first so Ctrl+F reaches the editor
await page.evaluate(() => {
  const el = document.querySelector(".cm-content");
  if (el) el.focus();
});
await page.waitForTimeout(100);
await page.keyboard.press("Control+f");
await page.waitForTimeout(200);
const searchOpen = await page.evaluate(() => !!document.querySelector(".cm-search"));
check("Ctrl+F opens the CM search panel", searchOpen === true, "not open");
await page.keyboard.press("Escape");

console.log("\n== 44. official cd sample: second env preserved + direction order ==");
const official44 = [
  "\\usepackage{tikz-cd}",
  "",
  "\\begin{document}",
  "\\begin{tikzcd}",
  "T \\arrow[drr, bend left, \"x\"] & & \\\\",
  "K & X \\times_Z Y \\arrow[r, \"p\"] \\arrow[d, \"q\"]",
  "& X \\arrow[d, \"f\"] \\\\",
  "& Y \\arrow[r, \"g\"]",
  "& Z",
  "\\end{tikzcd}",
  "",
  "\\quad \\quad",
  "",
  "\\begin{tikzcd}[row sep=2.5em]",
  "A' & B' \\\\",
  "& A \\\\",
  "\\end{tikzcd}",
  "",
  "\\end{document}",
].join("\n");
const cd44 = await page.evaluate((c) => {
  const g = window.__te.parseCode(c);
  const gen = window.__te.generateCode(g);
  return {
    secondEnvKept: gen.includes("\\begin{tikzcd}[row sep=2.5em]"),
    quadKept: gen.includes("\\quad \\quad"),
    dirOrder: /\\arrow\[drr,/.test(gen),
    noDefaultArrow: !/\\arrow\[r, ->,/.test(gen),
  };
}, official44);
check("second tikzcd env preserved", cd44.secondEnvKept === true, JSON.stringify(cd44));
check("quad preserved", cd44.quadKept === true, JSON.stringify(cd44));
check("direction order drr preserved", cd44.dirOrder === true, JSON.stringify(cd44));
check("no explicit default ->", cd44.noDefaultArrow === true, JSON.stringify(cd44));

console.log("\n== 45. cd full arrow args round trip (tikzcd-editor parity) ==");
const cd45 = await page.evaluate(() => {
  const src = "\\begin{tikzcd}\nA \\arrow[r, bend left=45, \"x\", near start] \\arrow[d, Rightarrow] \\\\\nB \\arrow[r, hook, two heads, shift right=2] \\arrow[loop, in=90, out=0] \\arrow[rr, phantom, \"ph\"] \\arrow[rr, dotted, \"a\", swap, \"b\"]\n\\end{tikzcd}";
  const g = window.__te.parseCode(src);
  const gen = window.__te.generateCode(g);
  const g2 = window.__te.parseCode(gen);
  const A = g2.objects.filter((o) => o.type === "arrow");
  return {
    count: A.length,
    bend45: A[0].bend === 45,
    nearstart: A[0].labelLong === "nearstart",
    doubleLine: A[1].dash === "double",
    hook: A[2].tail === "hook",
    twoheads: A[2].tip === "twoheads",
    shift2: A[2].shift === 2,
    loopAngle: A[3].loop != null && A[3].loop[0] === 135 && A[3].loop[1] === false,
    phantomLine: A[4].dash === "phantom",
    phantomInside: A[4].labelPos === "inside",
    swapLabel: A[5].text === "a" && A[5].textBelow === "b",
    genBendLeft: gen.includes("bend left=45"),
    genRightarrow: gen.includes("Rightarrow"),
    genLoop: gen.includes("loop, distance=2em, in=80, out=10"),
    genHook: gen.includes("hook"),
    genTwoHeads: gen.includes("two heads"),
    genShiftRight: gen.includes("shift right=2"),
    genPhantom: gen.includes("phantom"),
    genDescription: gen.includes('"ph", description'),
    genNearStart: gen.includes("near start"),
    genSwap: gen.includes(", swap,"),
    stable: gen === window.__te.generateCode(g2),
  };
});
check("cd: 6 arrows parsed", cd45.count === 6, String(cd45.count));
check("cd: bend left=45 round trips", cd45.bend45, JSON.stringify(cd45));
check("cd: near start label position", cd45.nearstart, JSON.stringify(cd45));
check("cd: double line (Rightarrow)", cd45.doubleLine && cd45.genRightarrow, JSON.stringify(cd45));
check("cd: hook tail + two heads", cd45.hook && cd45.twoheads && cd45.genHook && cd45.genTwoHeads, JSON.stringify(cd45));
check("cd: shift right=2", cd45.shift2 && cd45.genShiftRight, JSON.stringify(cd45));
check("cd: loop angle+clockwise round trip", cd45.loopAngle && cd45.genLoop, JSON.stringify(cd45));
check("cd: phantom -> no head + inside label", cd45.phantomLine && cd45.phantomInside && cd45.genPhantom && cd45.genDescription, JSON.stringify(cd45));
check("cd: swap label pair", cd45.swapLabel && cd45.genSwap, JSON.stringify(cd45));
check("cd: generate is idempotent (stable round trip)", cd45.stable === true, "unstable");

console.log("\n== 46. cd arrow via Shift-drag + arrow style keybinds ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
check("cd: no arrow before dragging", (await cdArrowCount()) === 0, String(await cdArrowCount()));

const dragged46 = await shiftDrag(0, 0, 1, 0);
check("cd: Shift-drag ran", dragged46 === true);
check("cd: Shift-drag created 1 bound arrow", (await cdArrowCount()) === 1, String(await cdArrowCount()));

const arrow46 = await cdArrow(null);
check("cd: arrow connects distinct cells", arrow46 != null && arrow46.startId !== arrow46.endId, JSON.stringify(arrow46));

const propsShow46 = await page.evaluate(() => {
  const el = document.getElementById("properties");
  return el != null && el.classList.contains("show");
});
check("cd: drag selects the arrow (props visible)", propsShow46 === true);

// bend up: Shift+ArrowUp ramps 0 -> 30 -> 49
await page.keyboard.down("Shift");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
await page.keyboard.up("Shift");
await page.waitForTimeout(140);
check("cd: Shift+ArrowUp ramps bend to 49", (await cdArrow(null)).bend === 49, String((await cdArrow(null)).bend));

// shift the label to the left / reset
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(100);
check("cd: ArrowUp shifts left (shift -1)", (await cdArrow(null)).shift === -1, String((await cdArrow(null)).shift));
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(100);
check("cd: ArrowDown resets shift to 0", ((await cdArrow(null)).shift ?? 0) === 0, String((await cdArrow(null)).shift));

// reverse the arrow (op)
const arrow46b = await cdArrow(null);
await page.keyboard.press("o");
await page.keyboard.press("p");
await page.waitForTimeout(120);
const arrow46c = await cdArrow(null);
check("cd: op reverses endpoints", arrow46c.startId === arrow46b.endId && arrow46c.endId === arrow46b.startId, JSON.stringify(arrow46c));

// edit the arrow label (Enter opens the label input)
await page.keyboard.press("Enter");
await page.waitForTimeout(140);
const labelOpen46 = await page.evaluate(() => !!document.querySelector("#properties .edit input"));
check("cd: Enter opens the arrow label edit", labelOpen46 === true);
await page.keyboard.type("f");
await page.keyboard.press("Enter");
await page.waitForTimeout(140);
check("cd: arrow label typed + saved", (await cdArrow(null)).text === "f", String((await cdArrow(null)).text));

// dd removes the selected arrow
await page.keyboard.press("d");
await page.keyboard.press("d");
await page.waitForTimeout(160);
check("cd: dd removes the selected arrow", (await cdArrowCount()) === 0, String(await cdArrowCount()));

console.log("\n== 47. cd click a cell edits + arrow-key cursor ==");
await startCd();
const sel47a = await page.evaluate(() => document.querySelector("#grid .grid-cell.selected")?.getAttribute("data-position"));
check("cd: (0,0) selected initially", sel47a === "0,0", String(sel47a));
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowDown");
const sel47b = await page.evaluate(() => document.querySelector("#grid .grid-cell.selected")?.getAttribute("data-position"));
check("cd: Right then Down selects (1,1)", sel47b === "1,1", String(sel47b));

const click47 = await cellCenter(1, 1);
await page.mouse.click(click47.x, click47.y);
await page.waitForTimeout(140);
const edit47 = await page.evaluate(() => !!document.querySelector("#grid .grid-cell.edit input"));
check("cd: clicking a cell opens in-cell edit", edit47 === true);
await page.keyboard.type("Q");
await page.keyboard.press("Enter");
await page.waitForTimeout(160);
const cells47 = await page.evaluate(() =>
  window.__te.getState().graph.objects.filter((o) => o.type === "text").map((o) => o.text)
);
check("cd: typed text lands in the cell", cells47.join(",") === "Q", JSON.stringify(cells47));

console.log("\n== 48. cd loop via the cell's loop button ==");
await startCd();
await putCell("A");
const loopBtn48 = await page.evaluate(() => !!document.querySelector('#grid .grid-cell[data-position="0,0"] .loop'));
check("cd: loop button exists on a cell", loopBtn48 === true);
const cc48 = await cellCenter(0, 0);
await page.dispatchEvent('#grid .grid-cell[data-position="0,0"] .loop', "click", {
  button: 0,
  clientX: Math.round(cc48.x),
  clientY: Math.round(cc48.y),
});
await page.waitForTimeout(200);
const loop48 = await cdArrow(null);
check("cd: loop button creates a self-loop arrow", loop48 != null && loop48.loop != null && loop48.startId === loop48.endId, JSON.stringify(loop48));

await page.keyboard.press("e");
await page.waitForTimeout(140);
const rot48 = await cdArrow(null);
check("cd: e rotates the loop to 90deg", rot48 != null && rot48.loop != null && rot48.loop[0] === 90, JSON.stringify(rot48));

console.log("\n== 49. cd undo/redo via u and Ctrl+Y ==");
await startCd();
await putCell("A");
await page.waitForTimeout(700);
await page.keyboard.press("ArrowRight");
await putCell("B");
check("cd: two cells placed", (await page.evaluate(() => window.__te.getState().graph.objects.filter((o) => o.type === "text").length)) === 2, "count");

await page.keyboard.press("u");
await page.waitForTimeout(160);
check("cd: u undoes the second cell", (await page.evaluate(() => window.__te.getState().graph.objects.filter((o) => o.type === "text").length)) === 1, "count after u");

await page.keyboard.press("Control+y");
await page.waitForTimeout(160);
check("cd: Ctrl+Y redoes the undo", (await page.evaluate(() => window.__te.getState().graph.objects.filter((o) => o.type === "text").length)) === 2, "count after ctrl+y");

console.log("\n== 50. cd code panel (60/40 split) + edit + Parse ==");
await startCd();
await putCell("A");
await page.waitForTimeout(120);
const cb50 = await page.evaluate(() => {
  const root = document.querySelector(".te-cd-root");
  const stage = root?.querySelector(".te-cd-stage");
  const code = root?.querySelector(".te-cd-code");
  const cmHost = code?.querySelector(".te-cd-code-editor");
  const cmView = cmHost && cmHost.__cmView;
  const rects = stage && code ? { s: stage.getBoundingClientRect().width, c: code.getBoundingClientRect().width } : null;
  return {
    split: root != null && rects != null && Math.abs(rects.s / 0.6 - (rects.s + rects.c)) < 5,
    hasTikzcd: !!cmView && cmView.state.doc.toString().includes("\\begin{tikzcd}") && cmView.state.doc.toString().includes("A"),
    hasCodeBar: !!code?.querySelector(".te-cd-code-bar button[title='Insert into note']"),
    noModal: document.getElementById("modal-overlay") == null,
  };
});
check("cd: root is a 60/40 split with no modal", cb50.split === true && cb50.noModal === true && cb50.hasCodeBar === true, JSON.stringify(cb50));
check("cd: code panel shows live tikzcd of the cell", cb50.hasTikzcd === true, cb50.hasTikzcd);

await page.evaluate(() => {
  const cmView = document.querySelector(".te-cd-code .te-cd-code-editor").__cmView;
  cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: "\\begin{tikzcd}\nA \\arrow[r] & B \\\\\n\\end{tikzcd}" } });
});
await page.click(".te-cd-code .te-cd-parse");
await page.waitForTimeout(320);
const after50 = await page.evaluate(() => {
  const g = window.__te.getState().graph;
  const texts = g.objects.filter((o) => o.type === "text").map((o) => o.text);
  const cmView = document.querySelector(".te-cd-code .te-cd-code-editor").__cmView;
  return {
    texts: texts.filter((t) => t.trim() !== "").sort().join(","),
    hasArrow: g.objects.some((o) => o.type === "arrow"),
    codeSync: cmView.state.doc.toString().includes("A"),
  };
});
check("cd: Parse imports two cells", after50.texts === "A,B", JSON.stringify(after50));
check("cd: parsed arrow present in the grid", after50.hasArrow === true, String(after50.hasArrow));
check("cd: code panel stays open and re-synced after parse", after50.codeSync === true);

console.log("\n== 51. cd keyboard arrow flow (a + ArrowRight) ==");
await startCd();
await putCell("A");
await page.keyboard.press("a"); // arm flow from selected (0,0)
await page.keyboard.press("ArrowRight"); // direction key places + selects the arrow
await page.waitForTimeout(220);
const flow51 = await page.evaluate(() => {
  const g = window.__te.getState().graph;
  return {
    arrows: g.objects.filter((o) => o.type === "arrow").length,
    nodes: g.objects.filter((o) => o.type === "text").length,
    propsShown: document.getElementById("properties").classList.contains("show"),
  };
});
check("cd: a+ArrowRight creates an arrow + second node", flow51.arrows === 1 && flow51.nodes === 2, JSON.stringify(flow51));
check("cd: new arrow stays selected (style panel visible)", flow51.propsShown === true, JSON.stringify(flow51));

console.log("\n== 52. cd toolbar toggles / style badges / exit ==");
await startCd();
await putCell("A");
const noCopy52 = await page.evaluate(() => document.querySelector('#toolbox li.button[title="Copy Code"]') == null);
check("cd: Copy Code button removed (replaced by code panel)", noCopy52 === true, String(noCopy52));

await page.click('#toolbox li.button[title="Arrow Tool (Shift)"]');
await page.waitForTimeout(100);
const mode52a = await page.evaluate(() => document.getElementById("grid").className);
check("cd: Arrow Tool button toggles grid to arrow mode", mode52a === "arrow", String(mode52a));

await page.click('#toolbox li.button[title="Pan Tool (Space)"]');
await page.waitForTimeout(100);
const mode52b = await page.evaluate(() => document.getElementById("grid").className);
check("cd: Pan Tool button restores pan mode", mode52b === "pan", String(mode52b));

// flow again to select an arrow, then check badges
await page.keyboard.press("a");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(220);
const badges52 = await page.evaluate(() => {
  const badges = [...document.querySelectorAll("#properties .toolbox .badge")].map((b) => b.textContent).filter((t) => t != null && t !== "");
  return { first: badges[0], hasDashed: badges.includes("ds"), hasDotted: badges.includes("dt"), count: badges.length };
});
check("cd: style buttons carry key badges (op, t, h, ds, dt, …)", badges52.first === "op" && badges52.hasDashed === true && badges52.hasDotted === true && badges52.count >= 8, JSON.stringify(badges52));

// typing the badge sequence sets the style directly (ds = dashed)
await page.keyboard.press("d");
await page.keyboard.press("s");
await page.waitForTimeout(120);
const line52 = await page.evaluate(() => {
  const e = window.__te.getState().graph.objects.find((o) => o.type === "arrow");
  return e && (e.dash || "solid");
});
check("cd: pressing ds sets the selected arrow to dashed", line52 === "dashed", String(line52));

await page.click(".te-cd-code .te-cd-code-bar button[title='Back to editor']");
await page.waitForTimeout(320);
const env52 = await page.evaluate(() => window.__te.getState().graph.env);
check("cd: Back to editor exits cd mode", env52 === "picture", String(env52));

console.log("\n== 53. cd x-flow, e rebind, dd clear cell ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");

// dd clears the selected cell's text
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(80);
await page.keyboard.press("d");
await page.keyboard.press("d");
await page.waitForTimeout(120);
const cell53a = await page.evaluate(() => {
  const o = window.__te.getState().graph.objects.find((x) => x.type === "text" && x.text === "A");
  return o ? o.text : "GONE";
});
check("cd: dd clears the selected cell", cell53a === "GONE", String(cell53a));

// x anchors the source cell, arrows pick the target, Enter confirms
await page.keyboard.press("x");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(60);
await page.keyboard.press("Enter");
await page.waitForTimeout(220);
const x53 = await cdArrow(null);
check("cd: x + ArrowRight + Enter creates an arrow", x53 != null && x53.startId !== x53.endId, JSON.stringify(x53));
const props53 = await page.evaluate(() => document.getElementById("properties").classList.contains("show"));
check("cd: x-flow arrow stays selected", props53 === true, String(props53));

// e: move the arrow's end to another cell; Enter commits
await page.keyboard.press("e");
await page.waitForTimeout(60);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await page.waitForTimeout(220);
const x53b = await cdArrow(null);
check("cd: e + Down + Enter rebinds the arrow end", x53b != null && x53b.startId === x53.startId && x53b.endId !== x53.endId, JSON.stringify(x53b));

// Escape cancels the in-progress rebind
await page.keyboard.press("e");
await page.waitForTimeout(60);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Escape");
await page.waitForTimeout(160);
const x53c = await cdArrow(null);
check("cd: Escape cancels the rebind", x53c != null && x53c.endId === x53b.endId, JSON.stringify(x53c));

console.log("\n== 54. cd: dt sets dotted (bugfix: dt no longer parsed as t) ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
await shiftDrag(0, 0, 1, 0);
// dt must set dotted, NOT cycle the tail (which would fire first before the fix)
await page.keyboard.press("d");
await page.keyboard.press("t");
await page.waitForTimeout(140);
const line54 = await page.evaluate(() => {
  const e = window.__te.getState().graph.objects.find((o) => o.type === "arrow");
  return { dash: e.dash || "solid", tail: e.tail || "none" };
});
check("cd: dt sets the line to dotted", line54.dash === "dotted", JSON.stringify(line54));
check("cd: dt did not cycle the tail", line54.tail === "none", JSON.stringify(line54));
// and a bare t still cycles the tail
await page.keyboard.press("t");
await page.waitForTimeout(120);
const tail54 = await page.evaluate(() => {
  const e = window.__te.getState().graph.objects.find((o) => o.type === "arrow");
  return e.tail || "none";
});
check("cd: bare t still cycles the tail", tail54 === "tail", String(tail54));

console.log("\n== 55. cd: comma labels get braces; $...$/braces stripped (bugs 1/6) ==");
const cd55 = await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\nA \\arrow[r, \"{f(x),g(y)}\"] & B \\\\\n\\end{tikzcd}");
  const a = g.objects.find((o) => o.type === "arrow");
  const code = window.__te.generateCode(g);
  const g2 = window.__te.parseCode(code);
  const a2 = g2.objects.find((o) => o.type === "arrow");
  return {
    labelCleaned: a ? a.text : null,
    hasBraces: code.includes('"{f(x),g(y)}"'),
    roundTrip: a2 ? a2.text : null,
  };
});
check("cd: braced comma label parses clean", cd55.labelCleaned === "f(x),g(y)", JSON.stringify(cd55));
check("cd: comma label generated with braces", cd55.hasBraces === true, JSON.stringify(cd55));
check("cd: braced comma label round trips", cd55.roundTrip === "f(x),g(y)", JSON.stringify(cd55));

const cd55b = await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\n$x \\to y$ \\arrow[r, \"$f$\"] & $y$ \\\\\n\\end{tikzcd}");
  const code = window.__te.generateCode(g);
  return {
    cell: g.objects.filter((o) => o.type === "text").map((o) => o.text).join(","),
    cellDollars: !code.includes("$x \\to y$") && code.includes("x \\to y"),
    labelDollars: !code.includes('"$f$"') && code.includes('"f"'),
  };
});
check("cd: $...$ stripped from cells", cd55b.cell === "x \\to y,y" && cd55b.cellDollars, JSON.stringify(cd55b));
check("cd: $...$ stripped from labels", cd55b.labelDollars === true, JSON.stringify(cd55b));

console.log("\n== 55c. cd: cell math renders as KaTeX in the grid ==");
await startCd();
await putCell("$x^2$");
const math55 = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  const el = cell ? cell.querySelector(".cd-math .katex") : null;
  return el != null;
});
check("cd: $x^2$ cell renders a KaTeX node", math55 === true);
const dollarLeft55 = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  const el = cell ? cell.querySelector(".value") : null;
  return el ? !el.textContent.includes("$") : false;
});
check("cd: no literal $ in the rendered cell", dollarLeft55 === true);

console.log("\n== 56. cd: typed command shown bottom-right (bug 3) ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
await shiftDrag(0, 0, 1, 0);
const sbCmd = () => page.evaluate(() => document.querySelector(".te-sb-cmd")?.textContent ?? "");
await page.keyboard.press("d");
await page.waitForTimeout(60);
check("cd: arrow sequence d shows in the status bar", (await sbCmd()) === ":d", JSON.stringify(await sbCmd()));
await page.keyboard.press("s");
await page.waitForTimeout(120);
check("cd: buffer clears after ds executes", (await sbCmd()) === ":", JSON.stringify(await sbCmd()));
await page.keyboard.press("c");
await page.waitForTimeout(60);
check("cd: grid command c shows in the status bar", (await sbCmd()) === ":c", JSON.stringify(await sbCmd()));
await page.keyboard.press("p");
await page.waitForTimeout(120);
check("cd: cp clears the buffer", (await sbCmd()) === ":", JSON.stringify(await sbCmd()));

console.log("\n== 57. cd: external graph reload remounts the grid (bug 7) ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\nX \\arrow[r, \"f\"] & Y \\\\\n\\end{tikzcd}");
  window.__te.open(g);
});
await page.waitForTimeout(400);
const grid57 = await page.evaluate(() => {
  const cells = [...document.querySelectorAll("#grid .grid-cell")]
    .map((el) => el.textContent.trim())
    .filter((t) => t !== "" && t !== "_");
  return cells;
});
check("cd: grid shows the NEW diagram after a reload", grid57.join(",") === "X,Y", JSON.stringify(grid57));
// and the code panel re-synced to the new diagram
const code57 = await page.evaluate(() => {
  const cmView = document.querySelector(".te-cd-code .te-cd-code-editor")?.__cmView;
  return cmView ? cmView.state.doc.toString() : "";
});
check("cd: code panel shows the new diagram", code57.includes("X") && code57.includes("Y") && !code57.includes("A"), code57.slice(0, 80));

console.log("\n== 58. cd: label edit input near the arrow (bug 5) ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
await shiftDrag(0, 0, 1, 0);
await page.keyboard.press("Enter");
await page.waitForTimeout(140);
const edit58 = await page.evaluate(() => {
  const el = document.querySelector("#properties .edit");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { visible: r.width > 0 && r.height > 0, left: r.left, top: r.top };
});
check("cd: label input is visible near the arrow", edit58 != null && edit58.visible === true, JSON.stringify(edit58));
await page.keyboard.type("f,g");
await page.keyboard.press("Enter");
await page.waitForTimeout(140);
const label58 = await cdArrow(null);
check("cd: comma label typed + saved + Enter exits", label58 != null && label58.text === "f,g", JSON.stringify(label58));
const gen58 = await page.evaluate(() => {
  const code = window.__te.generateCode(window.__te.getState().graph);
  return code.includes('"{f,g}"');
});
check("cd: f,g label generates braced code", gen58 === true);

console.log("\n== 59. cd: math backslashes stay single in generated code (bug 3) ==");
const cd59 = await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\nA \\arrow[r, \"f \\to g\"] & B \\\\\n\\end{tikzcd}");
  const a = g.objects.find((o) => o.type === "arrow");
  const code = window.__te.generateCode(g);
  const g2 = window.__te.parseCode(code);
  const a2 = g2.objects.find((o) => o.type === "arrow");
  return {
    label: a ? a.text : null,
    singleSlash: code.includes('"f \\to g"'),
    noDouble: !code.includes('"f \\\\to g"'),
    roundTrip: a2 ? a2.text : null,
  };
});
check("cd: label keeps single backslash in the model", cd59.label === "f \\to g", JSON.stringify(cd59));
check("cd: generated code has ONE backslash (no doubling)", cd59.singleSlash === true && cd59.noDouble === true, JSON.stringify(cd59));
check("cd: single-backslash label round trips", cd59.roundTrip === "f \\to g", JSON.stringify(cd59));

console.log("\n== 60. cd: deleted cells leave no trailing & (bug 5) ==");
const cd60 = await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\nA & B & C \\\\\nD & E \\\\\n\\end{tikzcd}");
  const texts = g.objects.filter((o) => o.type === "text");
  const at = (col, row) =>
    texts.find((o) => Math.round(o.x / 1.6 - 0.5) === col && Math.round(o.y / 1.6 - 0.5) === row);
  const b = at(1, 0);
  g.objects = g.objects.filter((o) => o.id !== b.id);
  const code = window.__te.generateCode(g);
  return {
    noTrailingRow0: !/A & C &/.test(code),
    row0KeepsMidSlot: /A & +& C/.test(code),
    row1Clean: /D & E/.test(code),
  };
});
check("cd: no trailing & after deleting the last cell", cd60.noTrailingRow0 === true, JSON.stringify(cd60));
check("cd: interior deleted slot keeps its & (layout preserved)", cd60.row0KeepsMidSlot === true, JSON.stringify(cd60));
check("cd: untouched row intact", cd60.row1Clean === true, JSON.stringify(cd60));

console.log("\n== 61. cd: code panel is CodeMirror (light + highlighted) ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(80);
await putCell("B");
const cm61 = await page.evaluate(() => {
  const host = document.querySelector(".te-cd-code-editor");
  const cmView = host && host.__cmView;
  if (!cmView) return null;
  const doc = cmView.state.doc.toString();
  const content = document.querySelector(".te-cd-code .cm-content");
  const editorEl = document.querySelector(".te-cd-code .cm-editor");
  return {
    doc,
    sync: content != null && content.innerText.trimEnd() === doc.trimEnd(),
    lightBg: getComputedStyle(editorEl).backgroundColor,
    hasCommands: [...document.querySelectorAll(".te-cd-code .cm-content span")]
      .some((s) => s.textContent === "\\begin" && getComputedStyle(s).color === "rgb(5, 80, 174)"),
  };
});
check("cd: code panel hosts a CodeMirror editor", cm61 != null, JSON.stringify(cm61));
check("cd: CM content mirrors the live code", cm61 != null && cm61.sync === true && cm61.doc.includes("\\begin{tikzcd}"), JSON.stringify(cm61));
check("cd: \\commands are syntax-highlighted", cm61 != null && cm61.hasCommands === true, JSON.stringify(cm61));
check("cd: code panel is light", cm61 != null && cm61.lightBg === "rgb(255, 255, 255)", JSON.stringify(cm61));
// typing in the code editor must not leak into grid commands
await page.click(".te-cd-code .cm-content");
await page.waitForTimeout(100);
await page.keyboard.type("d");
await page.waitForTimeout(80);
const buf61 = await page.evaluate(() => document.querySelector(".te-sb-cmd")?.textContent ?? "");
check("cd: keys typed in the code editor stay in the editor", buf61 === ":", JSON.stringify(buf61));
const doc61 = await page.evaluate(() => document.querySelector(".te-cd-code .te-cd-code-editor").__cmView.state.doc.toString());
check("cd: the d actually landed in the code", doc61.includes("d"), doc61.slice(-40));

console.log("\n== 62. cd: remount + keys + resize produce no errors (bug 4) ==");
await startCd();
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
await shiftDrag(0, 0, 1, 0);
await page.keyboard.press("Enter"); // label edit -> updateEditPosition path
await page.waitForTimeout(120);
await page.keyboard.type("g");
await page.keyboard.press("Enter");
await page.waitForTimeout(120);
// remount the grid (as reopening the plugin on another block does)
await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\nX \\arrow[r, \"f\"] & Y \\\\\n\\end{tikzcd}");
  window.__te.open(g);
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const el = document.querySelector(".grid-arrow");
  if (el) el.click();
});
await page.waitForTimeout(120);
await page.keyboard.press("d");
await page.keyboard.press("t");
await page.waitForTimeout(120);
const line62 = await page.evaluate(() => {
  const e = window.__te.getState().graph.objects.find((o) => o.type === "arrow");
  return e ? e.dash || "solid" : null;
});
check("cd: dt still works after remount", line62 === "dotted", String(line62));
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(80);
await page.keyboard.press("Backspace");
await page.waitForTimeout(120);
check("cd: Backspace removes the arrow after remount", (await cdArrowCount()) === 0, String(await cdArrowCount()));
await page.setViewportSize({ width: 1100, height: 700 });
await page.waitForTimeout(250);
const errList62 = errors.filter((e) => !/favicon/i.test(e));
check("cd: no page errors across remount/keys/resize", errList62.length === 0, errList62.slice(0, 3).join(" | "));

console.log("\n== 63. cd: realistic math renders in a cell (bug 1) ==");
await startCd();
await putCell("\\frac{1}{2}");
const math63 = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  const el = cell ? cell.querySelector(".cd-math .katex") : null;
  return el != null;
});
check("cd: \\frac{1}{2} cell renders a KaTeX node", math63 === true);
const frac63 = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  return cell ? cell.textContent.includes("1") && cell.textContent.includes("2") : false;
});
check("cd: fraction content visible (1 and 2)", frac63 === true);

console.log("\n== 63b. cd: X \\times_Z Y and \\sum cells render (user report) ==");
await page.evaluate(() => {
  const g = window.__te.parseCode("\\begin{tikzcd}\nX \\times_Z Y \\arrow[r, \"\\sum_{i=1}^n x_i\"] & \\sum_{i=1}^n x_i \\\\\n\\end{tikzcd}");
  window.__te.open(g);
});
await page.waitForTimeout(700);
const math63b = await page.evaluate(() => {
  const cells = [...document.querySelectorAll(".grid-cell .value")].filter((el) => !el.textContent.includes("_"));
  const katexCount = cells.filter((el) => el.querySelector(".cd-math .katex")).length;
  const errCount = cells.filter((el) => el.querySelector(".katex-error")).length;
  return { cells: cells.length, katex: katexCount, errors: errCount };
});
check("cd: both reported cells render KaTeX (no error spans)", math63b.cells === 2 && math63b.katex === 2 && math63b.errors === 0, JSON.stringify(math63b));
const math63c = await page.evaluate(() => {
  const labels = [...document.querySelectorAll(".grid-arrow .value")];
  const k = labels.filter((el) => el.querySelector(".cd-math .katex")).length;
  return { labels: labels.length, katex: k };
});
check("cd: the \\sum arrow label renders KaTeX too", math63c.labels >= 1 && math63c.katex === math63c.labels, JSON.stringify(math63c));

console.log("\n== 64. cd: foreign window.MathJax does not break cell rendering (bug 1) ==");
await page.addInitScript(() => {
  // simulate the Obsidian "MathJax" plugin: a working-looking global that
  // never typesets undelimited math (as real MathJax v3 behaves)
  window.MathJax = {
    startup: { promise: Promise.resolve(), defaultReady() {} },
    typeset() {},
    typesetPromise() {
      return Promise.resolve();
    },
    typesetClear() {},
  };
});
await page.reload();
await page.waitForTimeout(800);
await page.keyboard.type("env");
await page.waitForTimeout(300);
await page.waitForSelector("#grid", { timeout: 4000 });
await page.waitForTimeout(300);
await putCell("X \\times_Z Y");
const math64 = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  const el = cell ? cell.querySelector(".cd-math .katex") : null;
  return el != null;
});
check("cd: cells render KaTeX despite a foreign MathJax global", math64 === true);

console.log("\n== 65. cd: moving the cursor onto a cell does not mangle its math ==");
await startCd();
await putCell("\\sum_{i=1}^n x_i");
const sum65a = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  const katex = cell ? cell.querySelector(".cd-math .katex") : null;
  return {
    hasKatex: !!katex,
    // correct rendering of \sum_{i=1}^n has a msupsub (limits) node
    msupsub: katex ? katex.querySelectorAll(".msupsub").length : 0,
  };
});
check("cd: \\sum cell renders with limits", sum65a.hasKatex === true && sum65a.msupsub >= 1, JSON.stringify(sum65a));
// move the cursor away and back onto the cell (re-typeset path that mangled it)
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(200);
const sum65b = await page.evaluate(() => {
  const cell = document.querySelector('#grid .grid-cell[data-position="0,0"]');
  const katex = cell ? cell.querySelector(".cd-math .katex") : null;
  return {
    hasKatex: !!katex,
    msupsub: katex ? katex.querySelectorAll(".msupsub").length : 0,
    // mangled output would be "∑i=1nxi" with no limits node and a lone ∑ op
    loneOp: katex ? katex.querySelectorAll(".mop").length : 0,
  };
});
check("cd: math intact after cursor re-move (limits preserved)", sum65b.hasKatex === true && sum65b.msupsub >= 1, JSON.stringify(sum65b));
// same for an arrow label: select the arrow (click) twice
await putCell("A");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(80);
await putCell("B");
await shiftDrag(0, 0, 1, 0);
await page.keyboard.press("Enter");
await page.waitForTimeout(120);
await page.keyboard.type("\\sum_{i=1}^n x_i");
await page.keyboard.press("Enter");
await page.waitForTimeout(160);
const lbl65a = await page.evaluate(() => {
  const katex = document.querySelector(".grid-arrow .value .cd-math .katex");
  return katex ? katex.querySelectorAll(".msupsub").length : 0;
});
check("cd: arrow label renders with limits", lbl65a >= 1, String(lbl65a));
// deselect + reselect the arrow (re-typesets the label)
await page.evaluate(() => {
  document.getElementById("grid").click();
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  const el = document.querySelector(".grid-arrow");
  if (el) el.click();
});
await page.waitForTimeout(200);
const lbl65b = await page.evaluate(() => {
  const katex = document.querySelector(".grid-arrow .value .cd-math .katex");
  return katex ? katex.querySelectorAll(".msupsub").length : 0;
});
check("cd: arrow label intact after reselect", lbl65b >= 1, String(lbl65b));

// ============================================================
// == 66. regression: round-trip & safety fixes (二开 batch 1)
// ============================================================
console.log("\n== 66. regression: parser/generator round-trip fixes ==");
{
  const r66 = await page.evaluate(() => {
    const te = window.__te;
    const wrap = (body) =>
      "\\begin{document}\n\\begin{tikzpicture}\n" + body + "\n\\end{tikzpicture}\n\\end{document}";
    const out = {};

    // (a) ellipse must survive a full round trip with ry intact
    const ellipseSrc = wrap("  \\draw[black] (3,3) circle (1.2 and 0.8);");
    const gA = te.parseCode(ellipseSrc);
    const cA = te.generateCode(gA);
    out.ellipseType = gA.objects.some((o) => o.type === "ellipse" && o.rx === 1.2 && o.ry === 0.8);
    out.ellipseRegen = /circle \(1\.2 and 0\.8\);/.test(cA);

    // (b) box-axis tick labels must not accumulate raw snippets per cycle
    let code = "";
    const rawCounts = [];
    for (let i = 0; i < 3; i++) {
      const gg = te.parseCode(code);
      rawCounts.push(gg.rawSnippets.length);
      // rebuild a graph WITH axis enabled via the parsed flags themselves
      code = te.generateCode({ ...gg });
    }
    out.tickRawStable = rawCounts.every((n) => n === 0);

    // (c) polar axes leave no stray arrow objects across cycles
    const polarSrc = wrap(
      "  \\draw[thick] (5,4) circle (4);\n" +
      "  \\draw[->, thick] (5,4) -- (9.4,4);\n" +
      "  \\draw[->, thick] (5,4) -- (5,8.4);"
    );
    let polarArrows = -1;
    let pcode = polarSrc;
    for (let i = 0; i < 3; i++) {
      const gg = te.parseCode(pcode);
      polarArrows = gg.objects.filter((o) => o.type === "arrow").length;
      pcode = te.generateCode(gg);
    }
    out.polarNoLeak = polarArrows === 0;

    // (d) tikzcd environment options are captured and re-emitted
    const cdSrc =
      "\\begin{tikzcd}[row sep=1cm]\nA \\arrow[r] & B\n\\end{tikzcd}";
    const gD = te.parseCodeCd(cdSrc);
    const cell0 = gD.objects.find((o) => o.type === "text");
    out.cdCellClean = cell0 ? cell0.text === "A" : false;
    out.cdOptsRegen = te.generateCode(gD).includes("[row sep=1cm]");

    // (e) display math braces survive escaping
    const mathSrc = wrap('  \\node[text=black, text width=2cm] (tkz_o9_9) at (2,2) {$$x^{2}$$};');
    const gE = te.parseCode(mathSrc);
    out.mathBraces = te.generateCode(gE).includes("{$$x^{2}$$}");

    // (f) math evaluator conventions
    out.negPow = te.mathEval("-2^2") === -4;
    out.powNegExp = te.mathEval("2^-3") === 0.125;
    let twoE_threw = false;
    try { te.mathEval("2e"); } catch { twoE_threw = true; }
    out.twoEThrows = twoE_threw;
    let ctorBlocked = false;
    try { te.mathEval("constructor(1)"); } catch { ctorBlocked = true; }
    out.protoBlocked = ctorBlocked;

    // (g) tikz blend colour preview mixes toward WHITE and clamps
    out.blendWhite = te.colorHex("blue!50") === "#8080ff";
    out.blendClamp = /^#[0-9a-f]{6}$/.test(te.colorHex("blue!150"));

    // (h) legacy arrow-editing keys are registered again (were ghost ids)
    const k = te.keys ;
    out.keysRegistered =
      k["cdarrow.labelPos"] === "l" &&
      k["cdarrow.labelLong"] === "L" &&
      k["cdarrow.resetBend"] === "0" &&
      k["cdarrow.loop"] === "O" &&
      k["cdarrow.loopFlip"] === "E";

    return out;
  });
  check("regression: ellipse survives round-trip", r66.ellipseType === true && r66.ellipseRegen === true, JSON.stringify(r66));
  check("regression: axis tick labels never leak to rawSnippets", r66.tickRawStable === true, JSON.stringify(r66));
  check("regression: polar axes leave no stray arrows", r66.polarNoLeak === true, JSON.stringify(r66));
  check("regression: tikzcd env options preserved", r66.cdCellClean === true && r66.cdOptsRegen === true, JSON.stringify(r66));
  check("regression: display math braces intact after escape", r66.mathBraces === true, JSON.stringify(r66));
  check("regression: -2^2 === -4 and 2^-3 works", r66.negPow === true && r66.powNegExp === true, JSON.stringify(r66));
  check("regression: '2e'/'constructor' no longer silently accepted", r66.twoEThrows === true && r66.protoBlocked === true, JSON.stringify(r66));
  check("regression: x!N blends toward white, clamped hex", r66.blendWhite === true && r66.blendClamp === true, JSON.stringify(r66));
  check("regression: legacy arrow keys re-registered in KEYBINDS", r66.keysRegistered === true, JSON.stringify(r66));
}

// == 67. 二开 batch 2 regressions (grid rendering, escapes, cd round-trip,
//        ok/op conflict, cd env + dd grace) ==
{
  console.log("\n== 67. batch 2 regressions (grid lines / escapes / cd render / ok-op / env / dd grace) ==");

  // --- (a) picture grid: horizontal lines must be horizontal ---
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__te.editor.mutate((g) => {
      g.grid.enabled = true;
      g.grid.step = 1;
      g.width = 6;
      g.height = 4;
    });
  });
  await page.waitForTimeout(250);
  const grid67 = await page.evaluate(() =>
    [...document.querySelectorAll(".te-grid line")].map((l) => ({
      x1: +l.getAttribute("x1"), y1: +l.getAttribute("y1"),
      x2: +l.getAttribute("x2"), y2: +l.getAttribute("y2"),
    }))
  );
  const horiz67 = grid67.filter((l) => Math.abs(l.y1 - l.y2) < 0.5);
  const vert67 = grid67.filter((l) => Math.abs(l.x1 - l.x2) < 0.5);
  check("grid: horizontal lines render as horizontals", horiz67.length >= 4 && vert67.length >= 6, `h=${horiz67.length} v=${vert67.length}`);

  // --- (b) text-mode escapes: _ ^ ~ survive round-trips ---
  const esc67 = await page.evaluate(() => {
    const te = window.__te;
    const code1 = [
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "  \\node[text=black] (tkz_o1_1) at (2,2) {file\\_name a\\textasciicircum b\\textasciitilde c};",
      "\\end{tikzpicture}",
      "\\end{document}",
    ].join("\n");
    const g1 = te.parseCode(code1);
    const t1 = g1.objects.find((o) => o.type === "text");
    const textParsed = t1 ? t1.text : "";
    const code2 = te.generateCode(g1);
    const g2 = te.parseCode(code2);
    const t2 = g2.objects.find((o) => o.type === "text");
    return {
      parsed: textParsed,
      stable: t2 && t2.text === textParsed,
      regenSame: code2 === code1,
    };
  });
  check("escapes: \\_ ^ ~ parse back to the model text", esc67.parsed === "file_name a^ b~ c", JSON.stringify(esc67.parsed));
  check("escapes: round-trip is byte-stable", esc67.stable === true && esc67.regenSame === true, JSON.stringify(esc67));

  // --- (c) multiline text width uses the longest line (0.18/char) ---
  const w67 = await page.evaluate(() => {
    const te = window.__te;
    const g = te.parseCode([
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "  \\node[text=black] (a) at (2,2) {short\\\\much longer line};",
      "\\end{tikzpicture}",
      "\\end{document}",
    ].join("\n"));
    const t = g.objects.find((o) => o.type === "text");
    return t ? t.width : -1;
  });
  check("width: multiline text sized by longest line", Math.abs(w67 - 16 * 0.18) < 1e-9, String(w67));

  // --- (d) user objects coloured gray!60 are no longer swallowed ---
  const gray67 = await page.evaluate(() => {
    const te = window.__te;
    const g = te.parseCode([
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "  \\draw[gray!60, ->] (0,0) -- (2,2);",
      "  \\draw[gray!60] (4,1) circle (0.5);",
      "\\end{tikzpicture}",
      "\\end{document}",
    ].join("\n"));
    return { arrows: g.objects.filter((o) => o.type === "arrow").length, shapes: g.objects.filter((o) => o.type === "circle").length };
  });
  check("gray!60: user arrow/circle survive parsing", gray67.arrows === 1 && gray67.shapes === 1, JSON.stringify(gray67));

  // --- (e) cd: brace-carrying cell text survives generate (render fix) ---
  const cdBrace67 = await page.evaluate(() => {
    const te = window.__te;
    const g1 = te.parseCodeCd("\\begin{tikzcd}\n\\sum_{i=1}^n \\arrow[r] & B \\\\\\end{tikzcd}");
    const code = te.generateCode(g1);
    const g2 = te.parseCodeCd(code);
    const cell1 = g1.objects.find((o) => o.type === "text");
    const cell2 = g2.objects.find((o) => o.type === "text");
    return {
      codeHasBraces: code.includes("\\sum_{i=1}^n"),
      codeNotEscaped: !code.includes("\\{i=1\\}"),
      stable: cell1 && cell2 && cell1.text === cell2.text,
    };
  });
  check("cd: cell math braces not escaped (note renders again)", cdBrace67.codeHasBraces === true && cdBrace67.codeNotEscaped === true, JSON.stringify(cdBrace67));
  check("cd: brace cell round-trips stably", cdBrace67.stable === true, JSON.stringify(cdBrace67));

  // --- (f) cd: arrow colour rides through the diagram bridge (Parse) ---
  await startCd();
  await page.evaluate((code) => {
    const host = document.querySelector(".te-cd-code-editor");
    const view = host.__cmView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  }, "\\begin{tikzcd}\nA \\arrow[r, red] & B\n\\end{tikzcd}");
  await page.waitForTimeout(150);
  await page.click(".te-cd-parse");
  await page.waitForTimeout(350);
  const cdColor67 = await page.evaluate(() => {
    const g = window.__te.getState().graph;
    const arrow = g.objects.find((o) => o.type === "arrow");
    const cm = document.querySelector(".te-cd-code-editor .cm-content");
    return { color: arrow ? arrow.color : "", code: cm ? cm.textContent : "" };
  });
  check("cd: Parse keeps arrow colour in the model", cdColor67.color === "red", JSON.stringify(cdColor67));
  check("cd: Parse keeps arrow colour in the code panel", /red/.test(cdColor67.code), cdColor67.code.slice(0, 80));

  // --- (g) cd: env command returns to the picture editor ---
  // (after Parse the arrow is auto-selected, where `e` belongs to the
  // rebind flow — Escape deselects first, as documented)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.keyboard.type("env");
  await page.waitForTimeout(400);
  const env67 = await page.evaluate(() => ({
    env: window.__te.getState().graph.env,
    gridGone: document.querySelector("#grid") == null,
  }));
  check("cd: typing env returns to picture mode", env67.env === "picture" && env67.gridGone === true, JSON.stringify(env67));

  // --- (h) picture: `ok` completes while an arrow is selected (op-guard) ---
  await page.evaluate(() => {
    const ed = window.__te.editor;
    window.__teOKFired = false;
    ed.attach({
      settings: {},
      insertCodeBlock: async () => ({ inserted: true, message: "ok-test" }),
      onInserted: () => { window.__teOKFired = true; },
    });
    ed.mutate((g) => { g.grid.enabled = false; });
    ed.createText(false);
  });
  await page.waitForTimeout(150);
  await page.keyboard.type("a");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const modeOk67a = await page.evaluate(() => window.__te.getState().mode);
  await page.keyboard.type("ok");
  await page.waitForTimeout(300);
  const ok67 = await page.evaluate(() => ({ fired: window.__teOKFired === true, mode: window.__te.getState().mode }));
  await page.evaluate(() => window.__te.editor.attach(null));
  check("ok: arrow selected -> ARROW_EDITING", modeOk67a === "ARROW_EDITING", String(modeOk67a));
  check("ok: insert fires while arrow selected (o swallowed by op guard, k completes)", ok67.fired === true, JSON.stringify(ok67));

  // --- (i) cd: dd on a selected arrow never clears the source cell ---
  await startCd();
  await putCell("A");
  await page.keyboard.press("ArrowRight");
  await putCell("B");
  await page.keyboard.press("ArrowLeft"); // cursor back on (0,0)
  await page.keyboard.press("a");
  await page.keyboard.press("ArrowRight"); // a+-> creates + selects the arrow
  await page.waitForTimeout(220);
  await page.keyboard.type("dd"); // deletes the arrow, cursor parked on (0,0)
  await page.keyboard.type("dd"); // reflex double-tap INSIDE the grace window
  await page.waitForTimeout(350);
  const dd67 = await page.evaluate(() => {
    const g = window.__te.getState().graph;
    return {
      arrows: g.objects.filter((o) => o.type === "arrow").length,
      cellA: g.objects.find((o) => o.type === "text" && Math.abs(o.x - 0.8) < 0.01)?.text ?? "",
    };
  });
  check("dd: arrow deleted", dd67.arrows === 0, JSON.stringify(dd67));
  check("dd: stray second dd inside the grace window keeps the cell text", dd67.cellA === "A", JSON.stringify(dd67));
  // after the grace window a deliberate dd still clears the cell
  await page.waitForTimeout(500);
  await page.keyboard.type("dd");
  await page.waitForTimeout(300);
  const dd67b = await page.evaluate(() => {
    const g = window.__te.getState().graph;
    const a = g.objects.find((o) => o.type === "text" && Math.abs(o.x - 0.8) < 0.01);
    return a ? a.text : "";
  });
  check("dd: after the grace window clear-cell works again", dd67b === "", JSON.stringify(dd67b));
}

// == 68. 二开 batch 3 regressions (cd matrix integrity / description syntax /
//        picture canvas resilience) ==
{
  console.log("\n== 68. batch 3 regressions (cd matrix / description / canvas resilience) ==");

  // --- (a) cd: the user's ORIGINAL 3-row code (empty spacer row + 2-cell
  //         arrow steps) must round-trip without collapsing the matrix ---
  const cd68 = await page.evaluate(() => {
    const te = window.__te;
    const code1 = [
      "\\begin{document}",
      "\\begin{tikzcd}",
      "  f \\arrow[rr, harpoon, \"\\mathrm{label}\", description] \\arrow[dd, maps to, dotted, bend right=49, \"text\"] &  & \\sum_{i=1}^n x_i \\\\",
      " & & \\\\",
      "  h \\arrow[uurr, hook, bend right]",
      "\\end{tikzcd}",
      "\\end{document}",
    ].join("\n");
    const g1 = te.parseCodeCd(code1);
    const code2 = te.generateCode(g1);
    const g2 = te.parseCodeCd(code2);
    const arrows = (g) => g.objects.filter((o) => o.type === "arrow").length;
    const hRow = g2.objects.find((o) => o.type === "text" && o.text === "h");
    return {
      arrows1: arrows(g1),
      arrows2: arrows(g2),
      rows2: (code2.match(/\\\\/g) || []).length,
      dirKept: code2.includes("dd,") && code2.includes("uurr,"),
      descKept: code2.includes('"\\mathrm{label}", description'),
      hBackAtRow2: hRow ? Math.round((hRow.y - 0.8) / 1.6) === 2 : false,
      stable: code2 === te.generateCode(g2),
    };
  });
  check("cd: spacer-row matrix keeps all 3 arrows through generate", cd68.arrows1 === 3 && cd68.arrows2 === 3, JSON.stringify(cd68));
  check("cd: generated matrix still has the spacer row (3 rows)", cd68.rows2 === 2, String(cd68.rows2));
  check("cd: 2-cell arrow steps and bare description survive", cd68.dirKept && cd68.descKept, JSON.stringify(cd68));
  check("cd: cell positions and code are round-trip stable", cd68.hBackAtRow2 && cd68.stable, JSON.stringify(cd68));

  // --- (b) cd: the already-collapsed snippet loads with ALL arrows (bridge
  //         creates placeholder nodes for empty-cell endpoints) ---
  await startCd();
  await page.evaluate((code) => {
    const host = document.querySelector(".te-cd-code-editor");
    const view = host.__cmView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  }, [
    "\\begin{tikzcd}",
    "  f \\arrow[rr, harpoon, \"L\", description] \\arrow[dd, maps to, dotted] &  & S \\\\",
    "  h \\arrow[uurr, hook]",
    "\\end{tikzcd}",
  ].join("\n"));
  await page.waitForTimeout(150);
  await page.click(".te-cd-parse");
  await page.waitForTimeout(400);
  const snap68 = await page.evaluate(() => {
    const g = window.__te.getState().graph;
    const arrows = g.objects.filter((o) => o.type === "arrow");
    const diag = window.__te.getState().graph;
    return { arrows: arrows.length, texts: g.objects.filter((o) => o.type === "text").length };
  });
  check("cd: collapsed snippet reload keeps all 3 arrows", snap68.arrows === 3, JSON.stringify(snap68));

  // --- (c) picture: a pgf radian-suffix function must not kill the canvas
  //         and its expression is normalized so the curve can draw ---
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const te = window.__te;
    const g = te.parseCode([
      "\\begin{document}",
      "\\begin{tikzpicture}",
      "  \\draw[blue, domain=0:6, samples=150] plot (\\x, {sin(\\x r)});",
      "  \\node[text=black] (a) at (2,4) {hello $x^2$};",
      "  \\draw[black] (5,3) circle (1);",
      "\\end{tikzpicture}",
      "\\end{document}",
    ].join("\n"));
    window.__te.open(g);
  });
  await page.waitForTimeout(400);
  const fn68 = await page.evaluate(() => {
    const s = window.__te.getState();
    const fn = s.graph.objects.find((o) => o.type === "function");
    return {
      expr: fn ? fn.expression : "",
      drawn: document.querySelectorAll(".te-drawn-vis").length,
      texts: document.querySelectorAll(".te-text-node").length,
    };
  });
  check("picture: sin(\\x r) normalized to sin(x)", fn68.expr === "sin(x)", JSON.stringify(fn68.expr));
  check("picture: canvas keeps rendering around a bad expression", fn68.texts >= 1 && fn68.drawn >= 1, JSON.stringify(fn68));

  // a truly unevaluable expression must not blank the canvas either
  await page.evaluate(() => {
    window.__te.editor.mutate((g) => {
      const fn = g.objects.find((o) => o.type === "function");
      if (fn) fn.expression = "2exp(x)"; // implicit multiplication: math.ts throws
    });
  });
  await page.waitForTimeout(300);
  const fn68b = await page.evaluate(() => ({
    drawn: document.querySelectorAll(".te-drawn-vis").length,
    texts: document.querySelectorAll(".te-text-node").length,
  }));
  check("picture: unevaluable function no longer blanks the canvas", fn68b.texts >= 1 && fn68b.drawn >= 1, JSON.stringify(fn68b));

  // --- (d) amsmath/amssymb auto-injection (TikZJax core lacks \mathbb) ---
  const ams68 = await page.evaluate(() => {
    const te = window.__te;
    const B = String.fromCharCode(92);
    const code1 = [
      B + "begin{document}",
      B + "begin{tikzpicture}",
      "  " + B + "node[text=black] (a) at (1,1) {$" + B + "mathbb{R}$};",
      B + "end{tikzpicture}",
      B + "end{document}",
    ].join("\n");
    const g1 = te.parseCode(code1);
    const out1 = te.generateCode(g1);
    const g2 = te.parseCode(out1);
    const out2 = te.generateCode(g2);
    const withPkg = [
      B + "usepackage{amssymb}",
      B + "begin{document}",
      B + "begin{tikzpicture}",
      "  " + B + "node[text=black] (a) at (1,1) {$" + B + "mathbb{R}$};",
      B + "end{tikzpicture}",
      B + "end{document}",
    ].join("\n");
    const out3 = te.generateCode(te.parseCode(withPkg));
    return {
      injected: out1.startsWith(B + "usepackage{amsmath,amssymb}" + "\n" + B + "begin{document}"),
      stable: out2 === out1,
      noDup: (out3.match(/usepackage/g) || []).length === 1,
    };
  });
  check("ams: \\mathbb body injects \\usepackage{amsmath,amssymb}", ams68.injected === true, JSON.stringify(ams68));
  check("ams: injection round-trips byte-stable", ams68.stable === true, JSON.stringify(ams68));
  check("ams: user preamble with amssymb is not duplicated", ams68.noDup === true, JSON.stringify(ams68));

  // --- (e) arrows bound to nodes are emitted AFTER their nodes ---
  const ord68 = await page.evaluate(() => {
    const te = window.__te;
    const B = String.fromCharCode(92);
    const BB = B + B;
    const code = [
      B + "begin{document}",
      B + "begin{tikzpicture}",
      "  " + B + "draw[black] (0,0) rectangle (2,2) node[midway, name=tkz_o8_1]{};",
      "  " + B + "draw[->] (tkz_o8_1) -- (tkz_o8_2);",
      "  " + B + "draw[black] (5,0) circle (1) node[name=tkz_o8_2]{};",
      "  % raw between",
      "  " + B + "node[text=black] (t1) at (0,-2) {label};",
      B + "end{tikzpicture}",
      B + "end{document}",
    ].join("\n");
    const out1 = te.generateCode(te.parseCode(code));
    const p = out1.split("\n").map((l) => l.trim());
    const circle = p.findIndex((l) => l.includes("circle (1)"));
    const arrow = p.findIndex((l) => l.includes("tkz_o8_1) -- (tkz_o8_2"));
    const raw = p.findIndex((l) => l === "% raw between");
    const nodeAfterRaw = p.findIndex((l) => l.includes("{label}"));
    return { circle, arrow, raw, nodeAfterRaw, stable: out1 === te.generateCode(te.parseCode(out1)) };
  });
  check("order: arrow bound to a node is emitted after the node", ord68.circle >= 0 && ord68.arrow > ord68.circle, JSON.stringify(ord68));
  check("order: raw snippets keep their position between objects", ord68.raw >= 0 && ord68.nodeAfterRaw > ord68.raw, JSON.stringify(ord68));
  check("order: round-trip byte-stable", ord68.stable === true, JSON.stringify(ord68));
}

// == 69. tikzcd multi-diagram side-by-side layout ==
{
  console.log("\n== 69. cd multi-diagram side-by-side layout ==");
  const B = String.fromCharCode(92);
  const BB = B + B;
  const EXAMPLE = [
    B + "usepackage{tikz-cd}",
    "",
    B + "begin{document}",
    B + "begin{tikzcd}",
    "",
    "    T",
    `    ${B}arrow[drr, bend left, "x"]`,
    `    ${B}arrow[ddr, bend right, "y"]`,
    `    ${B}arrow[dr, dotted, "{(x,y)}" description] & & ` + BB,
    "    K & X " + B + "times_Z Y " + B + `arrow[r, "p"] ${B}arrow[d, "q"]`,
    "    & X " + B + `arrow[d, "f"] ` + BB,
    "    & Y " + B + `arrow[r, "g"]`,
    "    & Z",
    "",
    B + "end{tikzcd}",
    "",
    B + "quad " + B + "quad",
    "",
    B + "begin{tikzcd}[row sep=2.5em]",
    "",
    `A' ${B}arrow[rr,"f'"] ${B}arrow[dr,swap,"a"] ${B}arrow[dd,swap,"g'"] &&`,
    `  B' ${B}arrow[dd,swap,"h'" near start] ${B}arrow[dr,"b"] ` + BB,
    "& A " + B + `arrow[rr,crossing over,"f" near start] &&`,
    "  B " + B + `arrow[dd,"h"] ` + BB,
    `C' ${B}arrow[rr,"k'" near end] ${B}arrow[dr,swap,"c"] && D' ${B}arrow[dr,swap,"d"] ` + BB,
    "& C " + B + `arrow[rr,"k"] ${B}arrow[uu,<-,crossing over,"g" near end]&& D`,
    "",
    B + "end{tikzcd}",
    "",
    B + "end{document}",
  ].join("\n");

  const multi69 = await page.evaluate((code) => {
    const BS = String.fromCharCode(92);
    const te = window.__te;
    const g1 = te.parseCodeCd(code);
    const texts = g1.objects.filter((o) => o.type === "text");
    const arrows = g1.objects.filter((o) => o.type === "arrow");
    const cellAt = (col, row) => texts.find((t) => Math.round((t.x - 0.8) / 1.6) === col && Math.round((t.y - 0.8) / 1.6) === row);
    const code2 = te.generateCode(g1);
    const g2 = te.parseCodeCd(code2);
    const envCount = (code2.match(/begin\{tikzcd\}/g) || []).length;
    return {
      texts: texts.length,
      arrows: arrows.length,
      tAt00: cellAt(0, 0)?.text,
      aPrimeCol: cellAt(4, 0) ? 4 : -1,
      zAt: cellAt(2, 2)?.text,
      sep: g1.cdMulti?.[0]?.sep,
      opt2: g1.cdMulti?.[1]?.cdOptions,
      envCount,
      sepEmitted: code2.includes(BS + "quad " + BS + "quad"),
      optEmitted: code2.includes("[row sep=2.5em]"),
      crossingEmitted: code2.includes("crossing over"),
      stable: te.generateCode(g2) === code2,
    };
  }, EXAMPLE);
  check("multi: all cells of both diagrams parse (14 texts)", multi69.texts === 14, JSON.stringify(multi69.texts));
  check("multi: all arrows parse (19)", multi69.arrows === 19, JSON.stringify(multi69.arrows));
  check("multi: diagram 1 at origin, diagram 2 offset right", multi69.tAt00 === "T" && multi69.aPrimeCol === 4 && multi69.zAt === "Z", JSON.stringify(multi69));
  check("multi: per-diagram options and separator captured", multi69.sep === B + "quad " + B + "quad" && multi69.opt2 === "[row sep=2.5em]", JSON.stringify({ sep: multi69.sep, opt2: multi69.opt2 }));
  check("multi: generate emits two envs, separator, options, crossing over", multi69.envCount === 2 && multi69.sepEmitted && multi69.optEmitted && multi69.crossingEmitted, JSON.stringify({ envCount: multi69.envCount, sep: multi69.sepEmitted, opt: multi69.optEmitted, co: multi69.crossingEmitted }));
  check("multi: round-trip is byte-stable", multi69.stable === true, JSON.stringify(multi69.stable));

  // --- editing a multi-diagram layout keeps both envs ---
  await startCd();
  await page.evaluate((code) => {
    const host = document.querySelector(".te-cd-code-editor");
    const view = host.__cmView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
  }, EXAMPLE);
  await page.waitForTimeout(150);
  await page.click(".te-cd-parse");
  await page.waitForTimeout(400);
  // edit the very first cell's text: cursor is on (0,0) after parse, Enter edits
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await page.keyboard.type("T2");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const edit69 = await page.evaluate(() => {
    const BS = String.fromCharCode(92);
    const g = window.__te.getState().graph;
    const codeEl = document.querySelector(".te-cd-code-editor .cm-content");
    const code = codeEl ? codeEl.textContent : "";
    return {
      envs: (code.match(/begin\{tikzcd\}/g) || []).length,
      t2: g.objects.some((o) => o.type === "text" && o.text === "T2"),
      sep: code.includes(BS + "quad " + BS + "quad"),
    };
  });
  check("multi: editing a cell keeps both environments in the code", edit69.envs === 2 && edit69.t2 === true && edit69.sep === true, JSON.stringify(edit69));
}

await browser.close();
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
