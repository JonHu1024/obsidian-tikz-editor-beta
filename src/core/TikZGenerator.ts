import {
  TikZGraph, TikZObject, FunctionObject, ArrowObject,
} from "./types";
import { objectBounds, textAutoWidth } from "./types";
import { normalizeHex } from "../utils/colors";
import { cleanMathText, wrapCdLabel } from "./texText";

export function objName(id: string): string {
  return `tkz_${id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/** Escape TeX-special characters for use inside a `{...}` node body.
 *  $$...$$ / $...$ / \(...\) / \[...\] math segments are preserved verbatim
 *  (the $$..$$ alternation MUST precede the single-$ one or display math
 *  like "$$x^{2}$$" is corrupted by brace escaping)
 *  so braces used as math grouping (x^{2}), \frac etc. survive untouched
 *  while %&#{}_^~ and lone $ in plain text are escaped (an unescaped _ or ^
 *  is an illegal subscript/superscript in text mode — file_name used to
 *  produce uncompilable code; \$? guards against double-escaping a
 *  user-typed \%). */
const PLAIN_TEXT_ESCAPES: Record<string, string> = {
  "%": "\\%",
  "&": "\\&",
  "#": "\\#",
  "{": "\\{",
  "}": "\\}",
  "_": "\\_",
  "^": "\\textasciicircum",
  "~": "\\textasciitilde",
  "$": "\\$",
};

function escapeNodeText(s: string): string {
  return s
    .split(/(\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(?<!\\)[%&#{}^_~$]/g, (m) => PLAIN_TEXT_ESCAPES[m])))
    .join("");
}

/** amsmath/amssymb commands that TikZJax's LaTeX core does NOT preload.
 *  The editor's KaTeX preview renders them fine, so without injecting the
 *  packages, notes compiled by obsidian-tikzjax failed with
 *  "! Undefined control sequence" (e.g. \mathbb{R} in a label). */
const AMS_TRIGGER_RE = /\\(?:mathbb|Bbb|mathfrak|boldsymbol|varnothing|lesssim|gtrsim|nmid|subsetneq|supsetneq|complement|ncong|text|tfrac|dfrac|binom|substack|xrightarrow|xleftarrow|xleftrightarrow)\b/;

function ensureAmsPackages(preamble: string, body: string, extra: string[] = []): string {
  const pre = preamble.trim();
  const head = extra.length ? pre + "\n" + extra.join("\n") : pre;
  if (!AMS_TRIGGER_RE.test(body)) return head;
  // already covered by the user's own preamble?
  if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*amssymb[^}]*\}/.test(pre)) return head;
  return (head ? head + "\n" : "") + "\\usepackage{amsmath,amssymb}";
}

/** xcolor does NOT accept a hex value in a draw option — "\draw[#ff8800]"
 *  fails with "Illegal parameter number". Such colours therefore have to be
 *  declared with \definecolor before they are used.
 *
 *  This maps every hex colour used in the graph to a generated colour name
 *  and returns the \definecolor lines for the preamble. The names are
 *  deterministic ("tkzc" + the hex digits), so the declaration is recreated
 *  on every generation instead of accumulating. */
function applyColorDefs(g: TikZGraph): { graph: TikZGraph; defines: string[] } {
  const hexes = new Set<string>();
  const isHex = (c: string) => normalizeHex(c) !== null;
  for (const o of g.objects) if (isHex(o.color)) hexes.add(o.color.trim().toLowerCase());
  if (isHex(g.grid.color)) hexes.add(g.grid.color.trim().toLowerCase());
  if (hexes.size === 0) return { graph: g, defines: [] };

  const nameOf = new Map<string, string>();
  const defines: string[] = [];
  for (const h of hexes) {
    const six = normalizeHex(h) as string;
    const name = "tkzc" + six.slice(1);
    nameOf.set(h, name);
    defines.push(`\\definecolor{${name}}{HTML}{${six.slice(1)}}`);
  }
  const token = (c: string): string => nameOf.get((c ?? "").trim().toLowerCase()) ?? c;
  const graph: TikZGraph = {
    ...g,
    grid: { ...g.grid, color: token(g.grid.color) },
    objects: g.objects.map((o) => {
      const t = token(o.color);
      return t === o.color ? o : { ...o, color: t };
    }),
  };
  return { graph, defines };
}

export function generateTikZ(src: TikZGraph): string {
  // hex colours have to be declared in the preamble — map them first
  const { graph: g, defines } = applyColorDefs(src);
  // arrows bound to nodes reference them by their node name (tkz_<id>), so
  // moving the node in the code moves the arrow with it. Only existing
  // objects may be referenced; missing ids fall back to absolute coords.
  const existingIds = new Set(g.objects.map((o) => o.id));
  const referenced = new Set<string>();
  for (const o of g.objects) {
    if (o.type === "arrow") {
      if (o.startId && existingIds.has(o.startId)) referenced.add(o.startId);
      if (o.endId && existingIds.has(o.endId)) referenced.add(o.endId);
    }
  }

  // Stable emission order. Arrows name their bound nodes in the code
  // (tkz_<id>), and TikZ only knows a node name AFTER the node is drawn —
  // an arrow created before the shape it was later bound to used to be
  // emitted first and pgf failed with "No shape named tkz_… is known".
  // Each arrow is therefore pushed to strictly after the latest object it
  // references; everything else keeps its source order, so well-formed
  // code round-trips byte-for-byte unchanged.
  const srcLineOf = (o: TikZObject): number => (o._srcLine !== undefined ? o._srcLine : Number.MAX_SAFE_INTEGER);
  const ordered = g.objects
    .map((o, idx) => ({ o, idx }))
    .sort((a, b) => srcLineOf(a.o) - srcLineOf(b.o) || a.idx - b.idx);
  const posOf = new Map(ordered.map((e, i) => [e.o.id, i]));
  const eff = ordered.map((e, i) => {
    if (e.o.type !== "arrow") return i;
    let m = i;
    for (const r of [e.o.startId, e.o.endId]) {
      const p = r !== null ? posOf.get(r) : undefined;
      if (p !== undefined && p > m) m = p;
    }
    // +0.5 lands the arrow strictly AFTER its last referenced object when
    // it had to be deferred (a bare tie would keep it before the target)
    return m > i ? m + 0.5 : i;
  });
  const finalObjects = ordered
    .map((e, i) => ({ e, i, eff: eff[i] }))
    .sort((a, b) => a.eff - b.eff || a.i - b.i)
    .map((x) => x.e.o);

  // Emit as a single ordered sequence. Raw snippets keep their position
  // relative to the objects they were written between (anchored after the
  // object that originally preceded them), and there is NO secondary sort —
  // sorting by _srcLine here used to silently undo the arrow reordering.
  const newPos = new Map(finalObjects.map((o, i) => [o, i]));
  type Ev = { key: number; ord: number; obj?: TikZObject; text?: string };
  const events: Ev[] = finalObjects.map((o, seq) => ({ key: seq, ord: seq, obj: o }));
  g.rawSnippets.forEach((r, ri) => {
    let anchor = -1;
    for (let k = 0; k < ordered.length; k++) {
      if (srcLineOf(ordered[k].o) <= r.line) anchor = k;
      else break;
    }
    const anchorSeq = anchor >= 0 ? (newPos.get(ordered[anchor].o) ?? -1) : -1;
    events.push({ key: anchorSeq + 0.5 + ri * 1e-6, ord: finalObjects.length + ri, text: r.text });
  });
  events.sort((a, b) => a.key - b.key || a.ord - b.ord);

  const lines: string[] = generateScaffold(g);
  for (const ev of events) {
    if (ev.text !== undefined) {
      // raw lines are emitted verbatim (no re-indentation) so the code editor
      // content round-trips byte-for-byte
      lines.push(ev.text);
    } else {
      lines.push(...generateObject(ev.obj!, referenced, g.objects));
    }
  }

  const preamble = ensureAmsPackages(g.preamble.trim(), lines.join("\n"), defines);
  const picture = `${lines.map((l) => "  " + l).join("\n")}`;
  // full LaTeX document structure is required by Obsidian's TikZJax plugin
  if (g.env === "cd") return generateTikZCd(g, preamble);
  return `${preamble ? preamble + "\n" : ""}\\begin{document}\n\\begin{tikzpicture}\n${picture}\n\\end{tikzpicture}\n\\end{document}`;
}

/** tikzcd matrix: text boxes become cells, arrows are emitted INLINE in their
 *  source cell (tikzcd requires \\arrow inside the matrix). Multiple
 *  side-by-side environments (g.cdMulti) are emitted as separate matrices
 *  joined with their recorded separators (default "\quad \quad"). */
function generateTikZCd(g: TikZGraph, preamble: string): string {
  // Obsidian's TikZJax needs tikz-cd loaded explicitly for \begin{tikzcd};
  // amsmath/amssymb were already ensured by generateTikZ (body scan)
  let pre = preamble.trim();
  if (!/\\usepackage(?:\[[^\]]*\])?\{tikz-cd\}/.test(pre)) {
    pre = (pre ? pre + "\n" : "") + "\\usepackage{tikz-cd}";
  }
  const cellSize = 1.6;
  const texts = g.objects.filter((o) => o.type === "text");
  // (col, row) -> cell  (row 0 at the top = largest y)
  const cells = new Map<string, { text: string; arrows: string[] }>();
  for (const o of texts) {
    const col = Math.round((o.x - cellSize / 2) / cellSize);
    const row = Math.round((o.y - cellSize / 2) / cellSize);
    const key = `${col},${row}`;
    if (!cells.has(key)) cells.set(key, { text: o.text, arrows: [] });
  }
  // attach each arrow to its source cell
  for (const o of g.objects) {
    if (o.type !== "arrow") continue;
    const s = cdCellOf(o.x1, o.y1, cellSize);
    const key = `${s.col},${s.row}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { text: "", arrows: [] };
      cells.set(key, cell);
    }
    cell.arrows.push(generateCdArrow(o, cellSize));
    // The arrow's TARGET cell must exist in the emitted matrix even when it
    // is empty — otherwise explicit steps like `dd`/`uurr` point at cells
    // tikz-cd never defined and the document fails to compile. This is what
    // collapsed an empty spacer row out of the matrix while the arrows
    // crossing it kept their 2-cell steps.
    const t = cdCellOf(o.x2, o.y2, cellSize);
    const tkey = `${t.col},${t.row}`;
    if (!cells.has(tkey)) cells.set(tkey, { text: "", arrows: [] });
  }

  // Column ranges per diagram. Without cdMulti everything is one matrix.
  // With cdMulti, diagram i owns [colStart_i .. colStart_{i+1} - 1]: cells
  // drawn in the spacer column extend the LEFT diagram, cells beyond the
  // last range extend the last one. Empty diagrams are skipped, so joining
  // pairs the remaining envs with the separator recorded before each.
  const multi = g.cdMulti && g.cdMulti.length > 0 ? g.cdMulti : null;
  const ranges = multi
    ? multi.map((d, i) => ({
        cdOptions: d.cdOptions,
        sep: d.sep || "\\quad \\quad",
        colStart: i === 0 ? Number.NEGATIVE_INFINITY : d.colStart,
      }))
    : [{ cdOptions: g.cdOptions, sep: "\\quad \\quad", colStart: Number.NEGATIVE_INFINITY }];

  const diagramOf = (col: number): number => {
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (col >= ranges[i].colStart) return i;
    }
    return 0;
  };

  const perDiagram: Map<string, { text: string; arrows: string[] }>[] = ranges.map(() => new Map());
  for (const [key, cell] of cells) {
    const col = parseInt(key.split(",")[0], 10);
    perDiagram[diagramOf(col)].set(key, cell);
  }

  interface EnvTex { di: number; tex: string }
  const envs: EnvTex[] = [];
  perDiagram.forEach((cellsD, di) => {
    if (cellsD.size === 0) return;
    const rowNums = [...cellsD.keys()].map((k) => parseInt(k.split(",")[1], 10));
    const colNums = [...cellsD.keys()].map((k) => parseInt(k.split(",")[0], 10));
    const minRow = Math.min(...rowNums);
    const maxRow = Math.max(...rowNums);
    const minCol = Math.min(...colNums);
    const maxCol = Math.max(...colNums);
    // Emit the FULL rectangular matrix from minRow..maxRow / minCol..maxCol.
    // Skipping rows or columns that happen to have no content detaches them
    // from the arrow direction arithmetic (see above); skipping NEGATIVE
    // columns (cells left of the origin) silently dropped content.
    const rowLines: string[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      const parts: string[] = [];
      for (let c = minCol; c <= maxCol; c++) {
        const cell = cellsD.get(`${c},${row}`);
        if (!cell) {
          parts.push("");
        } else {
          // cell text is MATH mode in tikz-cd: only strip redundant $...$/{...}
          // wrappers — it must NOT go through escapeNodeText (text-mode
          // escaping), which used to rewrite \sum_{i=1}^n into
          // \sum_\{i=1\}^n and made every brace-carrying cell uncompilable
          parts.push(cleanMathText(cell.text) + cell.arrows.map((a) => " " + a).join(""));
        }
      }
      const isLast = row === maxRow;
      rowLines.push(parts.join(" & ") + (isLast ? "" : " \\\\"));
    }
    const body = rowLines.map((l) => "  " + l).join("\n");
    envs.push({ di, tex: `\\begin{tikzcd}${ranges[di].cdOptions ?? ""}\n${body}\n\\end{tikzcd}` });
  });
  if (envs.length === 0) {
    envs.push({ di: 0, tex: `\\begin{tikzcd}${(multi ? ranges[0].cdOptions : g.cdOptions) ?? ""}\n\n\\end{tikzcd}` });
  }

  const raws = g.rawSnippets.map((r) => r.text).join("\n");
  const after = raws ? "\n" + raws.split("\n").map((l) => "  " + l).join("\n") : "";
  let body2 = "";
  envs.forEach((e, i) => {
    if (i > 0) body2 += "\n\n" + (ranges[e.di]?.sep ?? "\\quad \\quad") + "\n\n";
    body2 += e.tex;
  });
  return `${pre ? pre + "\n" : ""}\\begin{document}\n${body2}${after}\n\\end{document}`;
}

/** Escape a label for inclusion inside "..." in a tikz-cd arrow spec.
 *  tikz-cd passes the quoted label to math mode verbatim, so math backslashes
 *  (\to, \frac, ...) must stay SINGLE — escaping them to \\ would render a
 *  line break. Only the quote character (which terminates the label) and a
 *  trailing lone backslash (which would swallow the closing quote) need
 *  escaping. */
function cdLabel(text: string): string {
  return text.replace(/\\$/, "\\\\").replace(/"/g, '\\"');
}

function generateCdArrow(o: ArrowObject, cellSize: number): string {
  const start = cdCellOf(o.x1, o.y1, cellSize);
  const end = cdCellOf(o.x2, o.y2, cellSize);
  const opts: string[] = [];

  // head: default arrows need no explicit token
  if (o.head === "none") opts.push("no head");
  else if (o.tip === "twoheads") opts.push("two heads");
  else if (o.tip === "harpoon") opts.push("harpoon");
  else if (o.tip === "harpoonalt") opts.push("harpoon'");

  // tail
  const tail = o.tail ?? "none";
  if (tail === "hook") opts.push("hook");
  else if (tail === "hookalt") opts.push("hook'");
  else if (tail === "mapsto") opts.push("maps to");
  else if (tail === "tail") opts.push("tail");

  // line style
  if (o.dash === "dashed") opts.push("dashed");
  else if (o.dash === "dotted") opts.push("dotted");
  else if (o.dash === "double") opts.push("Rightarrow");
  else if (o.dash === "phantom") opts.push("phantom");

  // bend / shift (skipped for loops, as in tikzcd-editor)
  const bend = o.bend ?? 0;
  const shift = o.shift ?? 0;
  if (!o.loop) {
    if (bend > 0) opts.push(bend === 30 ? "bend left" : `bend left=${bend}`);
    else if (bend < 0) opts.push(bend === -30 ? "bend right" : `bend right=${-bend}`);
    if (shift > 0) opts.push(shift === 1 ? "shift right" : `shift right=${shift}`);
    else if (shift < 0) opts.push(shift === -1 ? "shift left" : `shift left=${-shift}`);
  }

  // self loop: in=/out= computed from [angle, clockwise] (tikzcd-editor formula)
  if (o.loop) {
    const [angle, clockwise] = o.loop;
    let [inAngle, outAngle] = [235, 305].map((x) => (x + angle + 360) % 360);
    if (!clockwise) { const t = inAngle; inAngle = outAngle; outAngle = t; }
    opts.push("loop", "distance=2em", `in=${inAngle}`, `out=${outAngle}`);
  }

  if (o.crossingOver) opts.push("crossing over");
  if (o.color && o.color !== "black") opts.push(o.color);

  // label position: inside -> bare description key AFTER the quoted label
  // (the documented tikz-cd syntax — `description="..."` is a pgfkeys style
  // given a value, which real tikz-cd rejects)
  const labelPos = o.labelPos ?? "left";
  const raw = o.text.trim();
  const text = raw === "" ? "" : wrapCdLabel(cleanMathText(raw));
  if (text !== "") {
    if (labelPos === "inside") {
      opts.push(`"${cdLabel(text)}"`, "description");
    } else {
      opts.push(`"${cdLabel(text)}"${labelPos === "right" ? "'" : ""}`);
    }
  }
  const longMap: Record<string, string> = {
    nearstart: "near start", verynearstart: "very near start",
    nearend: "near end", verynearend: "very near end",
  };
  const l = longMap[o.labelLong ?? "center"];
  if (l && labelPos !== "inside" && text !== "") opts.push(l);
  if (o.textBelow.trim() !== "") opts.push("swap", `"${cdLabel(wrapCdLabel(cleanMathText(o.textBelow.trim())))}"`);

  const dr = end.row - start.row;
  const dc = end.col - start.col;
  let dir = "";
  if (dr > 0) dir += "d".repeat(dr);
  else if (dr < 0) dir += "u".repeat(-dr);
  if (dc > 0) dir += "r".repeat(dc);
  else if (dc < 0) dir += "l".repeat(-dc);
  // loops carry no direction
  if (!dir && !o.loop) dir = "r";
  const args = dir ? [dir, ...opts] : opts;
  return `\\arrow[${args.join(", ")}]`;
}

function cdCellOf(x: number, y: number, cellSize: number): { col: number; row: number } {
  return { col: Math.round((x - cellSize / 2) / cellSize), row: Math.round((y - cellSize / 2) / cellSize) };
}

/** Picture extent: the canvas grows with the content (width/height are only
 *  the default floor). Used for the grid, axis and title placement. */
function pictureExtent(g: TikZGraph): { w: number; h: number } {
  let maxX = g.width;
  let maxY = g.height;
  for (const o of g.objects) {
    const b = objectBounds(o);
    if (b.right > maxX) maxX = b.right;
    if (b.top > maxY) maxY = b.top;
  }
  return { w: Math.max(1, maxX), h: Math.max(1, maxY) };
}

function generateScaffold(g: TikZGraph): string[] {
  const lines: string[] = [];
  const { w, h } = pictureExtent(g);

  if (g.title) {
    lines.push(`\\node[font=\\Large] at (${w / 2}, ${h + 0.6}) {${escapeNodeText(g.title)}};`);
  }

  if (g.grid.enabled) {
    const gridStyle = g.grid.dashed ? `, dashed` : "";
    lines.push(`\\draw[${g.grid.color}${gridStyle}, step=${g.grid.step}cm] (0,0) grid (${w},${h});`);
  }

  if (g.axis.enabled && g.axis.type === "cartesian") {
    lines.push(...generateCartesianAxis(g));
  } else if (g.axis.enabled && g.axis.type === "polar") {
    lines.push(...generatePolarAxis(g));
  }

  return lines;
}

function generateCartesianAxis(g: TikZGraph): string[] {
  const { w, h } = pictureExtent(g);
  const s = g.axis.step || 1;
  const lines: string[] = [];
  const midX = w / 2;
  const midY = h / 2;

  const fmt = (n: number) => {
    if (Number.isInteger(n)) return n.toString();
    return (Math.round(n * 100) / 100).toString();
  };

  switch (g.axis.style) {
    case "box":
      lines.push(`\\draw[->, thick] (0,0) -- (${w + 0.4},0);`);
      lines.push(`\\draw[->, thick] (0,0) -- (0,${h + 0.4});`);
      lines.push(`\\draw[thick] (${w + 0.4},0) -- (${w + 0.4},${h + 0.4});`);
      lines.push(`\\draw[thick] (0,${h + 0.4}) -- (${w + 0.4},${h + 0.4});`);
      lines.push(`\\node[below right, font=\\small] at (${w + 0.4},0) {${escapeNodeText(g.axis.xLabel || "x")}};`);
      lines.push(`\\node[above left, font=\\small] at (0,${h + 0.4}) {${escapeNodeText(g.axis.yLabel || "y")}};`);
      for (let i = s; i < w; i += s) {
        lines.push(`\\draw[gray!60, thin] (${fmt(i)},0) -- (${fmt(i)},-0.1);`);
        lines.push(`\\node[below, font=\\scriptsize, gray!80] at (${fmt(i)},-0.05) {${fmt(i)}};`);
      }
      for (let i = s; i < h; i += s) {
        lines.push(`\\draw[gray!60, thin] (0,${fmt(i)}) -- (-0.1,${fmt(i)});`);
        lines.push(`\\node[left, font=\\scriptsize, gray!80] at (-0.05,${fmt(i)}) {${fmt(i)}};`);
      }
      break;
    case "middle":
      lines.push(`\\draw[->, thick] (0,${midY}) -- (${w + 0.4},${midY});`);
      lines.push(`\\draw[->, thick] (${midX},0) -- (${midX},${h + 0.4});`);
      lines.push(`\\node[below right, font=\\small] at (${w + 0.4},${midY}) {${escapeNodeText(g.axis.xLabel || "x")}};`);
      lines.push(`\\node[above left, font=\\small] at (${midX},${h + 0.4}) {${escapeNodeText(g.axis.yLabel || "y")}};`);
      for (let i = s; midX + i <= w; i += s) {
        lines.push(`\\draw[gray!60, thin] (${fmt(midX + i)},${midY}) -- (${fmt(midX + i)},${fmt(midY + 0.1)});`);
      }
      for (let i = s; midY + i <= h; i += s) {
        lines.push(`\\draw[gray!60, thin] (${midX},${fmt(midY + i)}) -- (${fmt(midX + 0.1)},${fmt(midY + i)});`);
      }
      break;
    case "axes":
      lines.push(`\\draw[->, thick] (0,0) -- (${w + 0.4},0);`);
      lines.push(`\\draw[->, thick] (0,0) -- (0,${h + 0.4});`);
      lines.push(`\\node[below right, font=\\small] at (${w + 0.4},0) {${escapeNodeText(g.axis.xLabel || "x")}};`);
      lines.push(`\\node[above left, font=\\small] at (0,${h + 0.4}) {${escapeNodeText(g.axis.yLabel || "y")}};`);
      break;
  }
  return lines;
}

function generatePolarAxis(g: TikZGraph): string[] {
  const lines: string[] = [];
  const { w, h } = pictureExtent(g);
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  lines.push(`\\draw[thick] (${cx},${cy}) circle (${r});`);
  lines.push(`\\draw[->, thick] (${cx},${cy}) -- (${cx + r + 0.4},${cy});`);
  lines.push(`\\draw[->, thick] (${cx},${cy}) -- (${cx},${cy + r + 0.4});`);
  lines.push(`\\draw[gray!60, thin] (${cx},${cy}) -- (${cx + r * Math.cos(Math.PI / 4)},${cy + r * Math.sin(Math.PI / 4)});`);
  lines.push(`\\draw[gray!60, thin] (${cx},${cy}) -- (${cx - r * Math.cos(Math.PI / 4)},${cy + r * Math.sin(Math.PI / 4)});`);
  lines.push(`\\draw[gray!60, thin] (${cx},${cy}) -- (${cx + r * Math.cos(Math.PI / 4)},${cy - r * Math.sin(Math.PI / 4)});`);
  lines.push(`\\draw[gray!60, thin] (${cx},${cy}) -- (${cx - r * Math.cos(Math.PI / 4)},${cy - r * Math.sin(Math.PI / 4)});`);
  lines.push(`\\node[above left, font=\\small] at (${cx},${cy + r + 0.4}) {${escapeNodeText(g.axis.yLabel || "θ")}};`);
  lines.push(`\\node[below right, font=\\small] at (${cx + r + 0.4},${cy}) {${escapeNodeText(g.axis.xLabel || "r")}};`);
  return lines;
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function generateObject(o: TikZObject, referenced: Set<string>, graphObjects: TikZObject[]): string[] {
  const lines = generateObjectLines(o, referenced, graphObjects);
  // functions have no named node; bound arrows reference them via a coordinate
  if (o.type === "function" && referenced.has(o.id)) {
    lines.push(`\\coordinate (${coordName(o.id)}) at (${fmt(o.x)},${fmt(o.y)});`);
  }
  return lines;
}

function generateObjectLines(o: TikZObject, referenced: Set<string>, graphObjects: TikZObject[]): string[] {
  const name = objName(o.id);
  switch (o.type) {
    case "text": {
      const lines: string[] = [];
      const label = o.text.split("\n").join("\\\\");
      const content = o.text.trim() === "" ? "\\phantom{x}" : escapeNodeText(label);
      // emit text width only when it differs from the auto-size heuristic
      // (i.e. the box was resized or the source carried an explicit width),
      // keeping untouched diagrams byte-stable while matching the canvas box.
      const auto = textAutoWidth(o.text);
      const widthOpt =
        o.text.trim() !== "" && Math.abs(o.width - auto) > 0.001
          ? `, text width=${fmt(o.width)}cm`
          : "";
      lines.push(
        `\\node[text=${o.color}${widthOpt}] (${name}) at (${fmt(o.x)},${fmt(o.y)}) {${content}};`
      );
      return lines;
    }
    case "rectangle": {
      const lines: string[] = [];
      const x1 = o.x - o.w / 2, y1 = o.y - o.h / 2, x2 = o.x + o.w / 2, y2 = o.y + o.h / 2;
      const label = escapeNodeText(o.text.split("\n").join("\\\\"));
      lines.push(`\\draw[${o.color}] (${fmt(x1)},${fmt(y1)}) rectangle (${fmt(x2)},${fmt(y2)}) node[midway, name=${name}]{${label}};`);
      return lines;
    }
    case "square": {
      const lines: string[] = [];
      const half = o.size / 2;
      const x1 = o.x - half, y1 = o.y - half, x2 = o.x + half, y2 = o.y + half;
      const label = escapeNodeText(o.text.split("\n").join("\\\\"));
      lines.push(`\\draw[${o.color}] (${fmt(x1)},${fmt(y1)}) rectangle (${fmt(x2)},${fmt(y2)}) node[midway, name=${name}]{${label}};`);
      return lines;
    }
    case "circle": {
      const lines: string[] = [];
      const label = escapeNodeText(o.text.split("\n").join("\\\\"));
      lines.push(`\\draw[${o.color}] (${fmt(o.x)},${fmt(o.y)}) circle (${fmt(o.r)}) node[name=${name}]{${label}};`);
      return lines;
    }
    case "diamond": {
      const lines: string[] = [];
      const half = o.size / 2;
      const x = fmt(o.x), y = fmt(o.y), s = fmt(half);
      lines.push(`\\draw[${o.color}] (${x},${fmt(o.y - half)}) -- (${fmt(o.x + half)},${y}) -- (${x},${fmt(o.y + half)}) -- (${fmt(o.x - half)},${y}) -- cycle;`);
      if (o.text.trim() !== "") {
        lines.push(`\\node[text=${o.color}] (${name}) at (${x},${y}) {${escapeNodeText(o.text.split("\n").join("\\\\"))}};`);
      }
      return lines;
    }
    case "ellipse": {
      const lines: string[] = [];
      lines.push(`\\draw[${o.color}] (${fmt(o.x)},${fmt(o.y)}) circle (${fmt(o.rx)} and ${fmt(o.ry)});`);
      if (o.text.trim() !== "") {
        lines.push(`\\node[text=${o.color}] (${name}) at (${fmt(o.x)},${fmt(o.y)}) {${escapeNodeText(o.text.split("\n").join("\\\\"))}};`);
      }
      return lines;
    }
    case "arrow":
      return generateArrow(o, referenced, graphObjects);
    case "function":
      return generateFunction(o);
  }

  return [];
}

/** Named coordinate referenced by bound arrows (\coordinate te_<id>). */
function coordName(id: string): string {
  return `te_${id.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function arrowHeadToken(o: ArrowObject): string {
  const tipName: Record<ArrowObject["tip"], string> = {
    arrow: "arrow", latex: "latex", stealth: "stealth", to: "to",
    triangle: "triangle 45", angle: "angle 60", o: "o", star: "*",
    bar: "|", diamond: "diamond", twoheads: "two heads", harpoon: "harpoon", harpoonalt: "harpoon'",
  };
  const t = tipName[o.tip];
  if (o.tip === "arrow") {
    switch (o.head) {
      case "start": return "<-";
      case "both": return "<->";
      case "none": return "";
      default: return "->";
    }
  }
  switch (o.head) {
    case "start": return `${t}-`;
    case "both": return `${t}-${t}`;
    case "none": return "";
    default: return `-${t}`;
  }
}

function arrowDashToken(o: ArrowObject): string {
  switch (o.dash) {
    case "dashed": return "dashed";
    case "dotted": return "dotted";
    default: return "";
  }
}

function generateArrow(o: ArrowObject, referenced: Set<string>, graphObjects: TikZObject[]): string[] {
  const lines: string[] = [];
  const opts = o.color && o.color !== "black" ? `${o.color}, thick` : "thick";
  const drawOpts = [arrowHeadToken(o), arrowDashToken(o), opts].filter(Boolean).join(", ");
  const refFor = (id: string | null): string | null => {
    if (!id || !referenced.has(id)) return null;
    const target = graphObjects.find((x) => x.id === id);
    if (target && target.type === "function") return coordName(id);
    return objName(id);
  };
  const r1 = refFor(o.startId);
  const r2 = refFor(o.endId);
  const p1 = r1 ? `(${r1})` : `(${fmt(o.x1)},${fmt(o.y1)})`;
  const p2 = r2 ? `(${r2})` : `(${fmt(o.x2)},${fmt(o.y2)})`;
  lines.push(
    `\\draw[${drawOpts}] ${p1} -- ${p2};`
  );
  const midX = (o.x1 + o.x2) / 2;
  const midY = (o.y1 + o.y2) / 2;
  // vertical arrows place their labels on the left/right instead of above/below
  const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const vertical = Math.abs(Math.abs(ang) - Math.PI / 2) < Math.PI / 4;
  const posAbove = vertical ? (ang > 0 ? "right" : "left") : "above";
  const posBelow = vertical ? (ang > 0 ? "left" : "right") : "below";
  if (o.text.trim() !== "") {
    lines.push(
      `\\node[${posAbove}, font=\\small, text=${o.color}] at (${fmt(midX)},${fmt(midY)}) {${escapeNodeText(o.text)}};`
    );
  }
  if (o.textBelow.trim() !== "") {
    lines.push(
      `\\node[${posBelow}, font=\\small, text=${o.color}] at (${fmt(midX)},${fmt(midY)}) {${escapeNodeText(o.textBelow)}};`
    );
  }
  return lines;
}

function generateFunction(o: FunctionObject): string[] {
  const expr = o.expression.replace(/\bx\b/g, "\\x");
  const opts: string[] = [];
  if (o.color) opts.push(o.color);
  const shift: string[] = [];
  if (o.offsetX !== 0) shift.push(`xshift=${fmt(o.offsetX)}cm`);
  if (o.offsetY !== 0) shift.push(`yshift=${fmt(o.offsetY)}cm`);
  const domain = `domain=${fmt(o.domain[0])}:${fmt(o.domain[1])}`;
  opts.push(domain, "samples=150");
  const line = `\\draw[${opts.join(", ")}${shift.length ? ", " + shift.join(", ") : ""}] plot (\\x, {(${expr})});`;
  const lines: string[] = [];
  // The function's NAME has no TikZ representation of its own — a plot
  // cannot be named — so it used to be dropped on export (the UI accepted
  // a name, the generated code silently forgot it). It is now carried by a
  // marker comment that the parser reads back.
  const name = (o.text ?? "").replace(/[\r\n%]/g, " ").trim();
  if (name) lines.push(`% tkz-function: ${name}`);
  lines.push(line);
  return lines;
}

export function generateTikZDoc(g: TikZGraph): string {
  return generateTikZ(g);
}
