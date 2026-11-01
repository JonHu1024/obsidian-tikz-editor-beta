// End-to-end: user snippets -> our parser/generator -> REAL obsidian-tikzjax pipeline.
// No literal backslashes anywhere (transport-safe): B = one backslash, BB = two.
import { chromium } from "playwright-core";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { readFile } from "node:fs/promises";

const EXE = os.platform() === "win32"
  ? path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright", "chromium-1217", "chrome-win64", "chrome.exe")
  : path.join(process.env.HOME, ".cache/ms-playwright", "chromium-1228", "chrome-linux64", "chrome");

const B = String.fromCharCode(92);
const BB = B + B;

const SRC1 = [
  `${B}usepackage{tikz-cd}`,
  `${B}begin{document}`,
  `${B}begin{tikzcd}`,
  `  f ${B}arrow[rr, "${B}mathrm{Label}", description] ${B}arrow[dd, dotted, bend right, "q"'] &  & ${B}sum_{i=1}^n x_i ${BB}`,
  `   &  &  ${BB}`,
  `  ${B}frac{f}{h} ${B}arrow[uurr, dashed, bend right, "${B}mathbb{R}"] &  & `,
  `${B}end{tikzcd}`,
  `${B}end{document}`,
].join("\n");

const SRC2 = [
  `${B}begin{document}`,
  `${B}begin{tikzpicture}`,
  `  ${B}draw[black] (4.736,-2.457) rectangle (6.736,-1.057) node[midway, name=tkz_o1_279]{Text$${B}mathbb{R}$};`,
  `  ${B}draw[->, thick] (tkz_o1_279) -- (tkz_o4_282);`,
  `  ${B}draw[black] (12.709,-7.356) circle (1.957) node[name=tkz_o4_282]{$A${B}space circle ${B}sum_{i=1}$};`,
  `  ${B}draw[->, thick] (tkz_o4_282) -- (16.093,-3.972);`,
  `  ${B}draw[black] (16.941,-3.123) circle (1.2 and 0.8);`,
  `  ${B}node[text=black] (tkz_o7_285) at (16.941,-3.123) {Insert};`,
  `${B}end{tikzpicture}`,
  `${B}end{document}`,
].join("\n");

// tikzcd multi-diagram side-by-side example (user request, TikZJax docs)
const SRC3 = [
  `${B}usepackage{tikz-cd}`,
  `${B}begin{document}`,
  `${B}begin{tikzcd}`,
  "    T",
  `    ${B}arrow[drr, bend left, "x"]`,
  `    ${B}arrow[ddr, bend right, "y"]`,
  `    ${B}arrow[dr, dotted, "{(x,y)}" description] & & ${BB}`,
  "    K & X " + B + "times_Z Y " + B + `arrow[r, "p"] ${B}arrow[d, "q"]`,
  "    & X " + B + `arrow[d, "f"] ${BB}`,
  "    & Y " + B + `arrow[r, "g"]`,
  "    & Z",
  `${B}end{tikzcd}`,
  "",
  `${B}quad ${B}quad`,
  "",
  `${B}begin{tikzcd}[row sep=2.5em]`,
  `A' ${B}arrow[rr,"f'"] ${B}arrow[dr,swap,"a"] ${B}arrow[dd,swap,"g'"] &&`,
  `  B' ${B}arrow[dd,swap,"h'" near start] ${B}arrow[dr,"b"] ${BB}`,
  "& A " + B + `arrow[rr,crossing over,"f" near start] &&`,
  "  B " + B + `arrow[dd,"h"] ${BB}`,
  `C' ${B}arrow[rr,"k'" near end] ${B}arrow[dr,swap,"c"] && D' ${B}arrow[dr,swap,"d"] ${BB}`,
  "& C " + B + `arrow[rr,"k"] ${B}arrow[uu,<-,crossing over,"g" near end]&& D`,
  `${B}end{tikzcd}`,
  `${B}end{document}`,
].join("\n");

// picture-mode case with a NAMED function (the name rides along in a
// "% tkz-function: NAME" marker comment) — verifies the marker does not
// break the compilation
const SRC4 = [
  `${B}begin{document}`,
  `${B}begin{tikzpicture}`,
  `  ${B}draw[blue, domain=0:9, samples=150] plot (${B}x, {(sin(${B}x))});`,
  `  ${B}draw[black] (0,0) rectangle (2,2) node[midway, name=tkz_o1_1]{$x^2$};`,
  `${B}end{tikzpicture}`,
  `${B}end{document}`,
].join("\n");

// picture-mode case with a HEX colour — xcolor rejects "#ff8800" inside a
// draw option, so the generator has to declare it with \definecolor first
const SRC5 = [
  `${B}begin{document}`,
  `${B}begin{tikzpicture}`,
  `  ${B}draw[#ff8800] (0,0) rectangle (2,2) node[midway, name=tkz_o1_1]{};`,
  `${B}end{tikzpicture}`,
  `${B}end{document}`,
].join("\n");

// phase 1: generate with our plugin (harness)
const testDir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const harnessHtml = await readFile(new URL("./index.html", import.meta.url), "utf-8");
const h2 = http.createServer(async (req, res) => {
  try {
    const url = (req.url || "/").split("?")[0];
    const file = await readFile(path.join(testDir, url === "/" ? "index.html" : url));
    res.setHeader("Content-Type", url.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
    res.end(file);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((r) => h2.listen(0, "127.0.0.1", r));
const b1 = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const p1 = await b1.newPage();
await p1.goto(`http://127.0.0.1:${h2.address().port}/`);
await p1.waitForFunction("window.__te != null", null, { timeout: 30000 });
await p1.waitForTimeout(400);
const gen = await p1.evaluate(([s1, s2, s3, s4, s5]) => {
  const te = window.__te;
  const g4 = te.parseCode(s4);
  // give the function a name so the "% tkz-function:" marker is exercised
  if (g4.objects[0] && g4.objects[0].type === "function") g4.objects[0].text = "myCurve";
  return {
    code1: te.generateCode(te.parseCodeCd(s1)),
    code2: te.generateCode(te.parseCode(s2)),
    code3: te.generateCode(te.parseCodeCd(s3)),
    code4: te.generateCode(g4),
    code5: te.generateCode(te.parseCode(s5)),
  };
}, [SRC1, SRC2, SRC3, SRC4, SRC5]);
await b1.close();
h2.close();
console.log("--- generated code1 (head) ---");
console.log(gen.code1.split("\n").slice(0, 6).join("\n"));
console.log("--- generated code2 (full) ---");
console.log(gen.code2);
console.log("--- end code2 ---");

// phase 2: compile through the REAL tikzjax runtime
const frag = await readFile(new URL("./tikzjax-runtime.html.frag", import.meta.url), "utf-8");
const tidy = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
const esc = (s) => s.split("</" + "script>").join("<" + "/script>");
let page2 = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>\n" + frag;
page2 += "\n<script>window.__cases = [];\nwindow.addEventListener('load', () => {\n  const s = document.createElement('script');\n  s.id = 'tikzjax'; s.type = 'text/javascript'; s.innerText = tikzjax_default;\n  document.body.appendChild(s);\n});\n</script>\n";
page2 += '<div id="g1"><script type="text/tikz" data-show-console="true">' + esc(tidy(gen.code1)) + "</script></div>\n";
  page2 += '<div id="g2"><script type="text/tikz" data-show-console="true">' + esc(tidy(gen.code2)) + "</script></div>\n";
  page2 += '<div id="g3"><script type="text/tikz" data-show-console="true">' + esc(tidy(gen.code3)) + "</script></div>\n";
page2 += '<div id="g4"><script type="text/tikz" data-show-console="true">' + esc(tidy(gen.code4)) + "</script></div>\n";
page2 += '<div id="g5"><script type="text/tikz" data-show-console="true">' + esc(tidy(gen.code5)) + "</script></div>\n";
page2 += "\n<script>\ndocument.addEventListener('tikzjax-load-finished', (e) => { window.__cases.push(e.target.tagName); });\n</script>\n</body></html>";

// The runtime fragment pulls in the renderer bundle and the fonts as
// separate assets — the server has to hand those out with the right MIME
// type, everything else is the generated page.
const s2 = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  const asset = path.join(testDir, url.replace(/^\//, ""));
  if (url !== "/" && /\.(js|css)$/.test(url)) {
    try {
      const f = await readFile(asset);
      res.setHeader("Content-Type", url.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
      res.end(f);
      return;
    } catch {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(page2);
});
await new Promise((r) => s2.listen(0, "127.0.0.1", r));
const b2 = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const p2 = await b2.newPage();
const lines = [];
p2.on("console", (m) => lines.push(m.text()));
await p2.goto(`http://127.0.0.1:${s2.address().port}/`);
await p2.waitForFunction("window.__rt_ready === true", null, { timeout: 30000 });
await p2.waitForFunction("window.__cases && window.__cases.length >= 3", null, { timeout: 120000 }).catch(() => {});
await p2.waitForTimeout(1500);
console.log("RESULTS:", JSON.stringify(await p2.evaluate(() => window.__cases)));
const joined = lines.join("\n");
if (!/Output written on input\.dvi/.test(joined)) {
  console.log("--- console ---");
  console.log(joined.split("\n").slice(-25).join("\n"));
}
const parts = joined.split("TikZJax: Rendering input:");
for (let i = 1; i < parts.length; i++) {
  const ok = parts[i].includes("Output written on input.dvi");
  const err = (parts[i].match(/! [^\n.]*/g) || []).slice(0, 2).join(" | ");
  console.log(`generated case ${i}: ${ok ? "COMPILES" : "FAILS"} ${err ? "err=" + err : ""}`);
}
await b2.close();
s2.close();
process.exit(0);
