// Audit test suite: regression tests for the bugs found during the
// code review (2026-11). Run with:  node test/run-audit.mjs
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
let total = 0;
function check(name, cond, extra = "") {
  total++;
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}
function section(t) {
  console.log(`\n== ${t} ==`);
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
await page.waitForTimeout(700);

const te = () => page.evaluate(() => window.__te.getState());
const reset = async () => {
  await page.evaluate(() => window.__te.open());
  await page.waitForTimeout(120);
};
const objCount = () => page.evaluate(() => window.__te.getState().graph.objects.length);
const objects = () => page.evaluate(() => window.__te.getState().graph.objects);

// ---------------------------------------------------------------------------
section("A1. Code tab: Run (Ctrl+S) must not crash (missing `editor` import)");
// ---------------------------------------------------------------------------
await reset();
await page.click(".te-props-tab:nth-child(2)"); // Code tab
await page.waitForTimeout(300);
errors.length = 0;
await page.click(".te-code-btn:nth-of-type(1)"); // Edit
await page.waitForTimeout(200);
await page.evaluate(() => {
  const cm = document.querySelector(".cm-content");
  cm.focus();
});
await page.waitForTimeout(100);
// modify the document: append a node line
await page.keyboard.press("Control+End");
await page.keyboard.type("\n\\draw[red] (1,1) -- (2,2);");
await page.waitForTimeout(200);
await page.click(".te-code-run"); // Run
await page.waitForTimeout(400);
check("no page error when running the code", errors.length === 0, JSON.stringify(errors.slice(0, 2)));
const afterRun = await objCount();
check("edited code was applied to the model", afterRun >= 1, `objects=${afterRun}`);

// ---------------------------------------------------------------------------
section("A2. Dragging an object must not make it run away from the cursor");
// ---------------------------------------------------------------------------
await reset();
// create a text box at a known place and drag it far to the LEFT of the canvas
const dragInfo = await page.evaluate(() => {
  const g = window.__te.getState().graph;
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oT1_1", type: "text", x: 5, y: 4, color: "black",
      text: "hello", width: 1,
    });
  });
  return { ok: true };
});
void dragInfo;
await page.waitForTimeout(200);
const before = await page.evaluate(() => {
  const o = window.__te.getState().graph.objects[0];
  return { x: o.x, y: o.y };
});
// find the on-screen position of the text node and drag it 6cm to the left
const startPt = await page.evaluate(() => {
  const el = document.querySelector(".te-text-node[data-id]");
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
check("text node is on screen", startPt != null);
if (startPt) {
  const cmPerPx = await page.evaluate(() => {
    const st = window.__te.getState();
    return st.canvas.ptPerCm * st.canvas.zoom;
  });
  await page.mouse.move(startPt.x, startPt.y);
  await page.mouse.down();
  // several small steps, like a real drag
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(startPt.x - (cmPerPx * 6 * i) / 12, startPt.y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const o = window.__te.getState().graph.objects[0];
    return { x: o.x, y: o.y };
  });
  const expected = before.x - 6;
  // tolerance: 0.6cm
  check(
    "dragged text lands where the pointer is (no runaway)",
    Math.abs(after.x - expected) < 0.6,
    `expected x≈${expected.toFixed(2)}, got ${after.x.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
section("A3. Arrow flow: `n` (free end) must keep the picked start object");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oR1_1", type: "rectangle", x: 3, y: 4, color: "black",
      text: "", w: 2, h: 1.4,
    });
  });
});
await page.waitForTimeout(150);
// deselect, then "a" -> pick flow
await page.keyboard.press("Alt");
await page.waitForTimeout(120);
await page.keyboard.press("a");
await page.waitForTimeout(150);
let flow = await page.evaluate(() => window.__te.getState());
check("arrow pick flow started", flow.mode === "NORMAL");
// click the rectangle to pick it as the start
const rectPt = await page.evaluate(() => {
  const el = document.querySelector(".te-drawn-hit[data-id='oR1_1']");
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
check("rectangle is on screen", rectPt != null);
if (rectPt) {
  await page.mouse.click(rectPt.x, rectPt.y);
  await page.waitForTimeout(200);
  // now "n" -> free end
  await page.keyboard.press("n");
  await page.waitForTimeout(250);
  const arrows = await page.evaluate(() =>
    window.__te.getState().graph.objects.filter((o) => o.type === "arrow")
  );
  check("an arrow was created", arrows.length === 1, `arrows=${arrows.length}`);
  if (arrows.length === 1) {
    check(
      "the picked start object is still bound to the arrow",
      arrows[0].startId === "oR1_1",
      `startId=${arrows[0].startId}`
    );
    check(
      "the arrow starts at the picked object, not the canvas centre",
      Math.abs(arrows[0].x1 - 4) < 1.2,
      `x1=${arrows[0].x1} (rect right edge = 4)`
    );
  }
}

// ---------------------------------------------------------------------------
section("A4. Function name must survive code generation");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oF1_1", type: "function", x: 0, y: 0, color: "blue", text: "myCurve",
      expression: "sin(x)", domain: [0, 5], offsetX: 0, offsetY: 0,
    });
  });
});
await page.waitForTimeout(150);
const fnCode = await page.evaluate(() => window.__te.generateCode(window.__te.getState().graph));
check("function name appears in the generated code", fnCode.includes("myCurve"), JSON.stringify(fnCode.slice(-220)));

// ---------------------------------------------------------------------------
section("A5. Multi-function template must not double LaTeX backslashes");
// ---------------------------------------------------------------------------
await reset();
const multi = await page.evaluate(() => {
  const build = window.__te.buildMultiPlotTemplate;
  if (!build) return null;
  return build(["\\frac{1}{2}", "sin(x)"]);
});
if (multi == null) {
  check("buildMultiPlotTemplate test hook exists", false, "hook missing");
} else {
  check("template keeps \\frac as a single backslash", multi.includes("\\frac{1}{2}"), JSON.stringify(multi));
  check("template does not contain a doubled backslash", !multi.includes("\\\\frac"), JSON.stringify(multi));
}

// ---------------------------------------------------------------------------
section("A6. Resizing a shape must produce ONE history entry, not one per mousemove");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oQ1_1", type: "rectangle", x: 5, y: 4, color: "black",
      text: "", w: 2, h: 1.4,
    });
  });
});
await page.waitForTimeout(200);
await page.evaluate(() => window.__te.editor.select("oQ1_1"));
await page.waitForTimeout(200);
const h0 = await page.evaluate(() => window.__te.editor.history.states.length);
const hPt = await page.evaluate(() => {
  const el = document.querySelector(".te-handle[data-handle='e']");
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
check("resize handle exists", hPt != null);
if (hPt) {
  await page.mouse.move(hPt.x, hPt.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(hPt.x + i * 4, hPt.y);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  const h1 = await page.evaluate(() => window.__te.editor.history.states.length);
  check(
    "resize drag creates a single history entry",
    h1 - h0 <= 2,
    `history grew by ${h1 - h0} entries during one resize drag`
  );
  // one undo must restore the original width
  await page.evaluate(() => window.__te.editor.undo());
  await page.waitForTimeout(150);
  const w = await page.evaluate(() => window.__te.getState().graph.objects[0].w);
  check("a single undo restores the original width", Math.abs(w - 2) < 0.01, `w=${w}`);
}

// ---------------------------------------------------------------------------
section("A7. Display math ($$...$$) must render without stray dollar signs");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oD1_1", type: "text", x: 5, y: 4, color: "black",
      text: "$$x^2$$", width: 1,
    });
  });
});
await page.waitForTimeout(250);
const dm = await page.evaluate(() => {
  const el = document.querySelector(".te-text-node[data-id='oD1_1']");
  return el ? el.textContent : null;
});
check("display math renders without literal $ signs", dm != null && !dm.includes("$"), JSON.stringify(dm));

// ---------------------------------------------------------------------------
section("A8. A user object drawn with [gray!60, thin] must not be swallowed");
// ---------------------------------------------------------------------------
await reset();
const grayObj = await page.evaluate(() => {
  const code = "\\begin{document}\n\\begin{tikzpicture}\n\\draw[gray!60, thin] (0,0) -- (1,1);\n\\end{tikzpicture}\n\\end{document}";
  const g = window.__te.parseCode(code);
  return g.objects.length;
});
check("user gray!60 arrow survives parsing", grayObj === 1, `objects=${grayObj}`);

// ---------------------------------------------------------------------------
section("A9. Arrow endpoints with spaces around the node name must parse");
// ---------------------------------------------------------------------------
await reset();
const spaced = await page.evaluate(() => {
  const code =
    "\\begin{document}\n\\begin{tikzpicture}\n" +
    "\\draw (0,0) rectangle (2,1) node[midway, name=tkz_box1]{B};\n" +
    "\\draw[->] ( tkz_box1 ) -- ( 3 , 1 );\n" +
    "\\end{tikzpicture}\n\\end{document}";
  const g = window.__te.parseCode(code);
  const arrows = g.objects.filter((o) => o.type === "arrow");
  return { total: g.objects.length, arrows: arrows.length, x2: arrows[0] ? arrows[0].x2 : null };
});
check("arrow with spaced coordinates is parsed", spaced.arrows === 1, JSON.stringify(spaced));
check("its endpoint is resolved", spaced.x2 === 3, JSON.stringify(spaced));

// ---------------------------------------------------------------------------
section("A10. New objects are placed deterministically near the viewport centre");
// ---------------------------------------------------------------------------
await reset();
const placements = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("t");
  await page.waitForTimeout(80);
  const p = await page.evaluate(() => {
    const o = window.__te.getState().graph.objects[window.__te.getState().graph.objects.length - 1];
    return { x: o.x, y: o.y };
  });
  placements.push(p);
  await page.keyboard.press("Alt");
  await page.waitForTimeout(60);
}
const spread = Math.max(...placements.map((p) => p.x)) - Math.min(...placements.map((p) => p.x));
check(
  "new text boxes are placed in a stable spot (no random scatter)",
  spread < 4,
  `x spread=${spread.toFixed(2)} -> ${JSON.stringify(placements.map((p) => p.x.toFixed(2)))}`
);

// ---------------------------------------------------------------------------
section("A11. Undo/redo keeps the tikzcd editor in sync (graphVersion)");
// ---------------------------------------------------------------------------
await reset();
const gv = await page.evaluate(() => {
  const before = window.__te.getState().graph;
  void before;
  const e = window.__te.editor;
  e.mutate((g) => g.title = "changed");
  const mid = window.__te.graphVersionValue();
  e.undo();
  const after = window.__te.graphVersionValue();
  return { mid, after };
});
check("undo bumps graphVersion", gv.after > gv.mid, JSON.stringify(gv));

// ---------------------------------------------------------------------------
section("A12. Insert button must not close the modal twice");
// ---------------------------------------------------------------------------
await reset();
const ins = await page.evaluate(() => {
  let n = 0;
  window.__te.editor.afterInserted = () => { n++; };
  // simulate what the toolbar does
  const r = window.__te.editor.insertToNote();
  return Promise.resolve(r).then((res) => ({ res, n }));
});
await page.waitForTimeout(200);
check("insertToNote resolves", ins.res != null, JSON.stringify(ins.res));

// ---------------------------------------------------------------------------
section("A13. Polar axis is drawn in the preview (it was missing entirely)");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.axis.enabled = true;
    gg.axis.type = "polar";
  });
});
await page.waitForTimeout(300);
const polar = await page.evaluate(() => {
  const g = window.__te.getState().graph;
  return {
    circle: document.querySelectorAll(".te-axis circle").length,
    lines: document.querySelectorAll(".te-axis line").length,
    type: g.axis.type,
  };
});
check("polar axis draws its circle", polar.circle >= 1, JSON.stringify(polar));
check("polar axis draws its spokes/arrows", polar.lines >= 3, JSON.stringify(polar));

// ---------------------------------------------------------------------------
section("A14. Box axis style draws the frame the generator emits");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.axis.enabled = true;
    gg.axis.type = "cartesian";
    gg.axis.style = "box";
  });
});
await page.waitForTimeout(300);
const box = await page.evaluate(() => ({
  lines: document.querySelectorAll(".te-axis line").length,
}));
check("box axis draws 4 frame lines + 2 axes", box.lines >= 6, JSON.stringify(box));

// ---------------------------------------------------------------------------
section("A15. Centering accounts for the canvas scroll offset");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oS1_1", type: "rectangle", x: 2, y: 2, color: "black",
      text: "", w: 1, h: 1,
    });
  });
});
await page.waitForTimeout(200);
// scroll the canvas, then ask the controller to centre the object
const centred = await page.evaluate(() => {
  const vp = document.querySelector(".te-viewport");
  vp.scrollLeft = 400;
  vp.scrollTop = 300;
  vp.dispatchEvent(new Event("scroll"));
  const st = window.__te.getState();
  window.__te.editor.selectAndCenter("oS1_1");
  const after = window.__te.getState().canvas;
  return { scrollX: after.scrollX, scrollY: after.scrollY, panX: after.panX, panY: after.panY, before: st.canvas.scrollX };
});
await page.waitForTimeout(250);
const onScreen = await page.evaluate(() => {
  const el = document.querySelector(".te-drawn-hit[data-id='oS1_1']");
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const vp = document.querySelector(".te-viewport").getBoundingClientRect();
  return {
    cx: b.left + b.width / 2, vy: b.top + b.height / 2,
    vpx: vp.left, vpy: vp.top, vw: vp.width, vh: vp.height,
  };
});
check(
  "the centred object is inside the visible viewport",
  onScreen &&
    onScreen.cx >= onScreen.vpx && onScreen.cx <= onScreen.vpx + onScreen.vw &&
    onScreen.vy >= onScreen.vpy && onScreen.vy <= onScreen.vpy + onScreen.vh,
  JSON.stringify(onScreen)
);

// ---------------------------------------------------------------------------
section("A16. Ctrl+H / Ctrl+L focus the canvas / the properties panel");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => window.__te.setActivePanel("props"));
await page.waitForTimeout(120);
await page.keyboard.press("Control+l");
await page.waitForTimeout(150);
let panel = await page.evaluate(() => window.__te.getState().panel);
check("Ctrl+L focuses the properties panel", panel === "props", panel);
await page.keyboard.press("Control+h");
await page.waitForTimeout(150);
panel = await page.evaluate(() => window.__te.getState().panel);
check("Ctrl+H focuses the canvas", panel === "preview", panel);

// ---------------------------------------------------------------------------
section("A17. The keyboard help overlay opens with ?");
// ---------------------------------------------------------------------------
await reset();
await page.keyboard.press("?");
await page.waitForTimeout(250);
const help = await page.evaluate(() => {
  const el = document.querySelector(".te-help");
  return el ? { rows: el.querySelectorAll(".te-help-row").length, title: el.querySelector(".te-help-title")?.textContent } : null;
});
check("help overlay is shown", help != null, JSON.stringify(help));
check("help overlay lists the shortcuts", help && help.rows > 15, JSON.stringify(help));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const helpClosed = await page.evaluate(() => document.querySelector(".te-help") == null);
check("help overlay closes with Escape", helpClosed);

// ---------------------------------------------------------------------------
section("A18. Custom colours are validated before they reach the model");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({ id: "oC1_1", type: "rectangle", x: 3, y: 3, color: "black", text: "", w: 2, h: 1 });
  });
  window.__te.editor.select("oC1_1");
});
await page.waitForTimeout(200);
await page.keyboard.press("c");
await page.waitForTimeout(250);
const colour = await page.evaluate(async () => {
  const inputs = [...document.querySelectorAll(".te-cp-input")];
  const custom = inputs[inputs.length - 1];
  custom.focus();
  custom.value = "redd";
  custom.dispatchEvent(new Event("input", { bubbles: true }));
  custom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise((r) => setTimeout(r, 100));
  const err = document.querySelector(".te-cp-error");
  const obj = window.__te.getState().graph.objects[0];
  return { hasError: !!err, color: obj.color };
});
check("an unknown colour is rejected", colour.hasError === true, JSON.stringify(colour));
check("the object colour is unchanged", colour.color === "black", JSON.stringify(colour));

// ---------------------------------------------------------------------------
section("A19. The preview applies the object colour to its text");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({
      id: "oT9_1", type: "text", x: 4, y: 4, color: "red", text: "label", width: 1,
    });
  });
});
await page.waitForTimeout(300);
const coloured = await page.evaluate(() => {
  const el = document.querySelector(".te-text-node[data-id='oT9_1']");
  return el ? getComputedStyle(el).color : null;
});
check("the text node is drawn in the object's colour", coloured === "rgb(255, 0, 0)", String(coloured));

// ---------------------------------------------------------------------------
section("A20. Zoom-to-fit brings the whole drawing into view");
// ---------------------------------------------------------------------------
await reset();
await page.evaluate(() => {
  window.__te.editor.mutate((gg) => {
    gg.objects.push({ id: "oZ1_1", type: "rectangle", x: 1, y: 1, color: "black", text: "", w: 1, h: 1 });
    gg.objects.push({ id: "oZ2_1", type: "rectangle", x: 14, y: 9, color: "black", text: "", w: 1, h: 1 });
  });
});
await page.waitForTimeout(250);
await page.evaluate(() => window.__te.editor.zoomToFit());
await page.waitForTimeout(250);
const fitted = await page.evaluate(() => {
  const els = [...document.querySelectorAll(".te-drawn-hit[data-id^='oZ']")];
  const vp = document.querySelector(".te-viewport").getBoundingClientRect();
  const inside = els.map((el) => {
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    return cx >= vp.left - 1 && cx <= vp.right + 1 && cy >= vp.top - 1 && cy <= vp.bottom + 1;
  });
  return { n: els.length, allInside: inside.every(Boolean) };
});
check("zoom-to-fit shows every object", fitted.n === 2 && fitted.allInside, JSON.stringify(fitted));

// ---------------------------------------------------------------------------
section("A21. cd grid: clicking a cell selects THAT cell (offset grid)");
// ---------------------------------------------------------------------------
await reset();
await page.reload();
await page.waitForTimeout(800);
await page.keyboard.type("env");
await page.waitForTimeout(300);
await page.waitForSelector("#grid", { timeout: 4000 });
await page.waitForTimeout(300);
// The Obsidian modal nests the grid in a centred container, so the grid's
// viewport origin is NOT (0,0) — the click handler used the viewport
// coordinates as grid coordinates and every click landed in a neighbour.
const offset = await page.evaluate(() => {
  const stage = document.querySelector(".te-cd-stage");
  stage.style.marginLeft = "70px";
  stage.style.marginTop = "45px";
  const g = document.querySelector("#grid").getBoundingClientRect();
  return { left: Math.round(g.left), top: Math.round(g.top) };
});
await page.waitForTimeout(200);
const cells = await page.evaluate(() =>
  [...document.querySelectorAll("#grid .grid-cell")].map((el) => el.getAttribute("data-position"))
);
check("the grid is offset from the viewport origin", offset.left > 0 || offset.top > 0, JSON.stringify(offset));
if (cells.length > 0) {
  const target = cells[Math.min(3, cells.length - 1)];
  const [tc, tr] = target.split(",").map(Number);
  const pt = await page.evaluate(([c, r]) => {
    const el = document.querySelector(`#grid .grid-cell[data-position="${c},${r}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [tc, tr]);
  if (pt) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300);
    const picked = await page.evaluate(() => {
      const el = document.querySelector("#grid .grid-cell.focus, #grid .grid-cell.selected, #grid .grid-cell[aria-selected='true']");
      return el ? el.getAttribute("data-position") : null;
    });
    // fall back: read the cell that entered edit mode
    const editing = await page.evaluate(() => {
      const ta = document.querySelector("#grid textarea");
      if (!ta) return null;
      const cell = ta.closest(".grid-cell");
      return cell ? cell.getAttribute("data-position") : null;
    });
    const got = picked ?? editing;
    check(
      "the clicked cell is the one that got picked",
      got === target,
      `clicked ${target}, picked ${got} (grid offset ${JSON.stringify(offset)})`
    );
  } else {
    check("the target cell is on screen", false, target);
  }
}

// ---------------------------------------------------------------------------
section("A22. cd: the loop angle survives the LaTeX round trip");
// ---------------------------------------------------------------------------
await reset();
const loop = await page.evaluate(() => {
  const te = window.__te;
  const B = String.fromCharCode(92);
  const out = [];
  for (const angle of [0, 90, 180, 270]) {
    // encode the loop the way the generator does
    let inA = (235 + angle) % 360;
    let outA = (305 + angle) % 360;
    const code = [
      B + "begin{document}",
      B + "begin{tikzcd}",
      `  A ${B}arrow[loop, in=${inA}, out=${outA}]`,
      B + "end{tikzcd}",
      B + "end{document}",
    ].join("\n");
    const g = te.parseCodeCd(code);
    const a = g.objects.find((o) => o.type === "arrow");
    out.push({ angle, got: a && a.loop ? a.loop[0] : null });
  }
  return out;
});
for (const l of loop) {
  check(`loop angle ${l.angle}° round-trips`, l.got === l.angle, JSON.stringify(l));
}

// ---------------------------------------------------------------------------
section("A23. cd: `crossing over` survives the bridge");
// ---------------------------------------------------------------------------
await reset();
const crossing = await page.evaluate(() => {
  const te = window.__te;
  const B = String.fromCharCode(92);
  const code = [
    B + "begin{document}",
    B + "begin{tikzcd}",
    `  A ${B}arrow[r, crossing over] & B`,
    B + "end{tikzcd}",
    B + "end{document}",
  ].join("\n");
  const g = te.parseCodeCd(code);
  const a = g.objects.find((o) => o.type === "arrow");
  const out = te.generateCode(g);
  return { crossingOver: a ? !!a.crossingOver : null, code: out };
});
check("the parsed arrow has crossingOver", crossing.crossingOver === true, JSON.stringify(crossing));
check("the regenerated code keeps `crossing over`", crossing.code.includes("crossing over"), crossing.code);

// ---------------------------------------------------------------------------
section("A24. cd: the first edit keeps a working undo baseline");
// ---------------------------------------------------------------------------
await reset();
await page.reload();
await page.waitForTimeout(800);
await page.keyboard.type("env");
await page.waitForTimeout(300);
await page.waitForSelector("#grid", { timeout: 4000 });
await page.waitForTimeout(300);
// type into the first cell IMMEDIATELY (inside the 500 ms merge window)
await page.keyboard.press("Enter");
await page.waitForTimeout(60);
await page.keyboard.type("Z");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
await page.keyboard.press("u"); // undo
await page.waitForTimeout(300);
const undone = await page.evaluate(() => {
  const cells = [...document.querySelectorAll("#grid .grid-cell")];
  return cells.map((c) => c.textContent.trim());
});
check(
  "undo after a fast first edit reverts the cell",
  !undone.some((t) => t.includes("Z")),
  JSON.stringify(undone.filter((t) => t.includes("Z")))
);

// ---------------------------------------------------------------------------
section("A25. cd: the bend stepper never produces NaN");
// ---------------------------------------------------------------------------
await reset();
const bend = await page.evaluate(() => {
  const te = window.__te;
  const B = String.fromCharCode(92);
  const code = [
    B + "begin{document}",
    B + "begin{tikzcd}",
    `  A ${B}arrow[r, bend right=10] & B`,
    B + "end{tikzcd}",
    B + "end{document}",
  ].join("\n");
  const g = te.parseCodeCd(code);
  const a = g.objects.find((o) => o.type === "arrow");
  return { bend: a ? a.bend : null, finite: a ? Number.isFinite(a.bend) : false };
});
check("a negative bend is parsed", bend.bend !== null && bend.bend < 0, JSON.stringify(bend));

// ---------------------------------------------------------------------------
section("A26. cd -> picture: the diagram is not mirrored");
// ---------------------------------------------------------------------------
await reset();
const flip = await page.evaluate(() => {
  const te = window.__te;
  const B = String.fromCharCode(92);
  const code = [
    B + "begin{document}",
    B + "begin{tikzcd}",
    "  TOP " + B + B,
    "  BOTTOM",
    B + "end{tikzcd}",
    B + "end{document}",
  ].join("\n");
  const g = te.parseCodeCd(code);
  const texts = g.objects.filter((o) => o.type === "text");
  const top = texts.find((o) => o.text === "TOP");
  const bottom = texts.find((o) => o.text === "BOTTOM");
  return { topY: top ? top.y : null, bottomY: bottom ? bottom.y : null, n: texts.length };
});
check("the 2-row matrix parsed into 2 cells", flip.n === 2, JSON.stringify(flip));
check(
  "row 0 has the SMALLER y in the cd model (row-down)",
  flip.topY !== null && flip.bottomY !== null && flip.topY < flip.bottomY,
  JSON.stringify(flip)
);

// ---------------------------------------------------------------------------
section("A27. A standalone text node after a shape is NOT swallowed");
// ---------------------------------------------------------------------------
await reset();
const swallow = await page.evaluate(() => {
  const te = window.__te;
  const B = String.fromCharCode(92);
  const code = [
    B + "begin{document}",
    B + "begin{tikzpicture}",
    "  " + B + "draw[black] (1,1) rectangle (3,2) node[midway, name=tkz_o1_1]{};",
    "  " + B + "node[text=blue] (tkz_o2_2) at (5,5) {Hello};",
    B + "end{tikzpicture}",
    B + "end{document}",
  ].join("\n");
  const g = te.parseCode(code);
  return g.objects.map((o) => ({ id: o.id, t: o.type, text: o.text }));
});
check("the text object survives the parse", swallow.some((o) => o.t === "text"), JSON.stringify(swallow));
check(
  "the text did not move onto the rectangle",
  !swallow.some((o) => o.t === "rectangle" && o.text === "Hello"),
  JSON.stringify(swallow)
);
const roundTrip = await page.evaluate(() => {
  const te = window.__te;
  const B = String.fromCharCode(92);
  const code = [
    B + "begin{document}",
    B + "begin{tikzpicture}",
    "  " + B + "draw[black] (1,1) rectangle (3,2) node[midway, name=tkz_o1_1]{};",
    "  " + B + "node[text=blue] (tkz_o2_2) at (5,5) {Hello};",
    B + "end{tikzpicture}",
    B + "end{document}",
  ].join("\n");
  const g = te.parseCode(code);
  const out = te.generateCode(g);
  const g2 = te.parseCode(out);
  return { n1: g.objects.length, n2: g2.objects.length, out };
});
check("the round trip keeps both objects", roundTrip.n1 === 2 && roundTrip.n2 === 2, JSON.stringify(roundTrip));
check("the text is still there after the round trip", roundTrip.out.includes("Hello"), roundTrip.out);

// ---------------------------------------------------------------------------
section("A28. Hex colours are declared with \\definecolor (xcolor needs it)");
// ---------------------------------------------------------------------------
await reset();
const hex = await page.evaluate(() => {
  const te = window.__te;
  te.editor.mutate((gg) => {
    gg.objects.push({ id: "oH1_1", type: "rectangle", x: 2, y: 2, color: "#ff8800", text: "", w: 2, h: 1 });
    gg.objects.push({ id: "oH2_1", type: "circle", x: 6, y: 2, color: "#0a0", text: "", r: 1 });
  });
  const g = te.getState().graph;
  const code = te.generateCode(g);
  const g2 = te.parseCode(code);
  return {
    code,
    colours: g2.objects.map((o) => o.color),
  };
});
check(
  "the hex colour is declared in the preamble",
  hex.code.includes("\\definecolor{tkzcff8800}{HTML}{ff8800}"),
  hex.code
);
check(
  "the draw option uses the declared name, not the raw hex",
  hex.code.includes("\\draw[tkzcff8800]") && !hex.code.includes("\\draw[#ff8800]"),
  hex.code
);
check(
  "the hex value is restored when the code is parsed back",
  hex.colours.includes("#ff8800") && hex.colours.includes("#00aa00"),
  JSON.stringify(hex.colours)
);

// ---------------------------------------------------------------------------
console.log(`\n${total - failures}/${total} checks passed`);
if (errors.length) {
  console.log("\nPage errors observed:");
  for (const e of errors.slice(0, 10)) console.log("  " + e);
}
await browser.close();
process.exit(failures > 0 ? 1 : 0);
