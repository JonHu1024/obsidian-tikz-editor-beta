import {
  TikZGraph, TikZObject, defaultGraph, makeId, resetUidCounter, ArrowObject, FunctionObject,
  objectBounds, textAutoWidth,
} from "./types";
import { cleanMathText } from "./texText";

interface ParseCtx {
  graph: TikZGraph;
  line: number;
  nextId(type: string, name?: string): string;
  coords?: Record<string, { x: number; y: number }>;
  /** TikZ node name -> object id. Arrows may reference a node by the name
   *  the user gave it (`name=box1`), which is not the internal id. */
  names?: Map<string, string>;
  /** generated colour name (tkzcXXXXXX) -> hex value ("#XXXXXX") */
  colorDefs?: Map<string, string>;
}

// matches a {..} group with ONE level of nested braces (math like $\sum_{i=1}^n$)
const BRACED = String.raw`\{((?:[^{}]|\{[^{}]*\})*)\}`;

function num(s: string): number {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

function parsePoint(s: string): { x: number; y: number } | null {
  const m = s.trim().match(/^\(?\s*([-+]?[\d.]+)\s*,\s*([-+]?[\d.]+)\s*\)?$/);
  if (!m) return null;
  return { x: num(m[1]), y: num(m[2]) };
}

function stripComments(line: string): string {
  return line.replace(/(^|[^\\])%.*$/, "$1");
}

/** Reverse escapeNodeText (and the historical escapes): \& \% \# \_ \$ and the
 *  \{ \} brace escapes, plus \textasciicircum / \textasciitilde which the
 *  generator uses for literal ^ and ~ in text mode. */
function unescapeBraces(s: string): string {
  return s
    .replace(/\\textasciicircum/g, "^")
    .replace(/\\textasciitilde/g, "~")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\$/g, "$")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}");
}

function splitPreamble(code: string): { preamble: string; body: string } {
  const lines = code.split("\n");
  const preamble: string[] = [];
  let bodyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^\\(usepackage|usetikzlibrary|tikzset|pgfplotsset|def|newcommand|documentclass|definecolor)/.test(l)) {
      preamble.push(lines[i]);
    } else if (l.startsWith("\\begin{tikzpicture}")) {
      bodyStart = i;
      break;
    }
  }
  if (bodyStart === -1) return { preamble: preamble.join("\n"), body: code };
  const body = lines
    .slice(bodyStart + 1)
    .filter((l) => !/^\s*\\end\{tikzpicture\}/.test(l) && !/^\s*\\end\{document\}/.test(l))
    .join("\n");
  return { preamble: preamble.join("\n"), body };
}

export function parseTikZ(code: string, prevGraph?: TikZGraph | null): TikZGraph {
  const graph = defaultGraph();
  // deterministic ids: the same code must parse to the same model (and
  // generate byte-identical code) no matter how often it is parsed
  resetUidCounter();

  // The generator declares hex colours with \definecolor{tkzcXXXXXX}{HTML}{…}
  // (xcolor rejects a hex value inside a draw option). Those declarations
  // are re-created on every generation, so they are consumed here and mapped
  // back to the plain hex value — the model keeps "#ff8800", the code keeps
  // a compilable colour name.
  const colorDefs = new Map<string, string>();
  code = code.replace(
    /^[ \t]*\\definecolor\{(tkzc[0-9a-fA-F]{3,8})\}\{HTML\}\{([0-9a-fA-F]{3,8})\}[ \t]*$/gm,
    (_m, name: string, hex: string) => {
      colorDefs.set(name, "#" + hex);
      return "";
    }
  );

  const { preamble, body } = splitPreamble(code);
  if (preamble.trim()) graph.preamble = preamble.trim();

  // ---- tikzcd environment ----
  if (/\\begin\{tikzcd\}/.test(code)) {
    graph.env = "cd";
    return parseTikZCd(code, graph, prevGraph);
  }

  // Stable id reuse: ids written by the generator (`name=tkz_*`) or matching
  // the previous graph's objects in order are kept, so selection/insert
  // state survives Code <-> model round-trips.
  const prevObjects = prevGraph?.objects ?? [];
  const usedIds = new Set<string>();
  let prevIndex = 0;
  const coords: Record<string, { x: number; y: number }> = {};
  /** node name (as written in the code) -> object id */
  const names = new Map<string, string>();
  /** Ids that a NAMED object in this code claims (tkz_oN_M -> oN_M).
   *  Unnamed objects (arrows, functions) get an id from makeId(), which
   *  must never hand out an id a named object is going to claim — the two
   *  would collide and the code round-trip would stop being byte-stable
   *  (the arrow grabbed "o9_1" and the text node with the name
   *  "tkz_o9_1" then lost its identity). */
  const reservedIds = new Set<string>();
  for (const l of body.split("\n")) {
    const re = /tkz_o\d+_\d+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l)) !== null) reservedIds.add(m[0].slice(4));
  }
  const ctx: ParseCtx = {
    coords,
    names,
    colorDefs,
    graph,
    line: 0,
    nextId(type: string, name?: string): string {
      if (name && /^tkz_o(\d+)_\d+$/.test(name)) {
        const id = name.slice(4);
        if (!usedIds.has(id)) {
          usedIds.add(id);
          usedIds.add(name);
          const m = name.match(/^tkz_o(\d+)_\d+$/);
          const n = m ? parseInt(m[1], 10) : 0;
          if (graph.nextId <= n) graph.nextId = n + 1;
          return id;
        }
      }
      while (prevIndex < prevObjects.length) {
        const p = prevObjects[prevIndex];
        prevIndex++;
        if (p.type === type && !usedIds.has(p.id)) {
          usedIds.add(p.id);
          return p.id;
        }
      }
      let id = makeId(graph);
      // never hand out an id that a NAMED object in the same code claims
      while (reservedIds.has(id)) id = makeId(graph);
      usedIds.add(id);
      return id;
    },
  };

  const rawLines = body.split("\n");
  const lines = rawLines.map(stripComments);
  const raw: { line: number; text: string }[] = [];
  let gridParsed = false;
  let axisEnabled = false;
  let axisType: "cartesian" | "polar" = "cartesian";
  let middleAxis = false;
  let hasBoxFrame = false;
  let lastArrowId: string | null = null;
  let lastShapeId: string | null = null;
  /** Name of the next function, taken from a "% tkz-function: X" marker. */
  let pendingFnName: string | null = null;
  /** Segment of a bare \draw[->, thick] A -- B line, for scaffold checks. */
  const arrowSegOf = (ln: string): { x1: number; y1: number; x2: number; y2: number } | null => {
    const m = ln.match(/^\\draw\[->, thick\]\s*\(([^)]+)\)\s*--\s*\(([^)]+)\);$/);
    if (!m) return null;
    const a = parsePoint(m[1]);
    const b = parsePoint(m[2]);
    return a && b ? { x1: a.x, y1: a.y, x2: b.x, y2: b.y } : null;
  };
  // Centre of the polar scaffold circle, once seen. Its two radius arrows
  // start here regardless of where the far endpoints end up, so they can be
  // consumed without knowing the grown canvas size.
  let polarCenter: { x: number; y: number } | null = null;
  // Arrows whose node references could not be resolved on first sight.
  const pendingRefRetry: { idx: number; rawLine: string; line: string }[] = [];
  // Scaffold-shaped lines that did not match the current canvas floor: the
  // generator may have placed them at the content-grown extent, which is
  // only known once all objects are parsed. Re-evaluated after the loop.
  const pendingScaffold: { idx: number; rawLine: string; line: string }[] = [];
  /** True when any coordinate on a bare scaffold-shaped line lies outside
   *  the current canvas floor — i.e. it may belong to a bigger extent. */
  const extendsBeyondCanvas = (line: string): boolean => {
    const nums = line.match(/-?\d+(?:\.\d+)?/g) ?? [];
    return nums.some((t) => {
      const v = parseFloat(t);
      return v > graph.width + 0.41 || v > graph.height + 0.41;
    });
  };

  /** Classify a line as generator scaffold geometry for a canvas of the
   *  given size. The generator anchors axes/frames at pictureExtent
   *  (= max(width/height, object bounds)), which is only fully known after
   *  every object line has been parsed — callers therefore match against
   *  the current floor here and retry deferred lines post-loop. */
  const matchScaffold = (line: string, w: number, h: number):
    { kind: "axisArrow"; middle: boolean } | { kind: "frame" } | { kind: "polar" } | null => {
    const W = w + 0.4;
    const H = h + 0.4;
    let m = line.match(/^\\draw\[->, thick\]\s*\(([^)]+)\)\s*--\s*\(([^)]+)\);?$/);
    if (m) {
      const p1 = parsePoint(m[1]);
      const p2 = parsePoint(m[2]);
      if (!p1 || !p2) return null;
      if (Math.abs(p2.x - W) < 0.01 || Math.abs(p2.y - H) < 0.01) {
        const middle =
          Math.abs(p1.y - h / 2) < 0.01 &&
          Math.abs(p1.y - p2.y) < 0.01 &&
          Math.abs(p2.x - W) < 0.01;
        return { kind: "axisArrow", middle };
      }
      return null;
    }
    m = line.match(/^\\draw\[thick\]\s*\(([^)]+)\)\s*--\s*\(([^)]+)\);?$/);
    if (m) {
      const p1 = parsePoint(m[1]);
      const p2 = parsePoint(m[2]);
      if (!p1 || !p2) return null;
      const frameX = Math.abs(p1.x - W) < 0.01 && Math.abs(p2.x - W) < 0.01;
      const frameY = Math.abs(p1.y - H) < 0.01 && Math.abs(p2.y - H) < 0.01;
      return frameX || frameY ? { kind: "frame" } : null;
    }
    m = line.match(/^\\draw\[thick\]\s*\(([\d.]+),([\d.]+)\)\s+circle\s+\(([\d.]+)\);?$/);
    if (m) {
      const cx = num(m[1]), cy = num(m[2]), r = num(m[3]);
      if (
        Math.abs(cx - w / 2) < 0.01 &&
        Math.abs(cy - h / 2) < 0.01 &&
        Math.abs(r - Math.min(w, h) / 2) < 0.01
      ) return { kind: "polar" };
      return null;
    }
    return null;
  };

  /** Loose shape test for lines that MIGHT be scaffold placed by the
   *  generator at a content-grown extent (exact size unknown until the
   *  whole body has been parsed). Only the generator's bare "[thick]" /
   *  "[->, thick]" signatures qualify — user arrows almost always carry a
   *  colour or extra options and stay on the normal object path. */
  const scaffoldShaped = (line: string): boolean =>
    /^\\draw\[->, thick\]\s*\([^)]+\)\s*--\s*\([^)]+\);$/.test(line) ||
    /^\\draw\[thick\]\s*\([^)]+\)\s*--\s*\([^)]+\);$/.test(line) ||
    /^\\draw\[thick\]\s*\([\d.]+,[\d.]+\)\s+circle\s+\([\d.]+\);$/.test(line);

  const isAxisDecoration = (line: string): boolean => {
    // axis tick MARKS only — the generator's exact `\draw[gray!60, thin]
    // (a,b) -- (c,d)` signature. A bare /gray!60/ test used to swallow USER
    // objects that merely used the same colour (arrows/circles vanished).
    // The remaining loose form ("any gray!60 thin segment") also swallowed
    // user arrows, so the tick marks are now identified by their GEOMETRY:
    // they are short segments (0.1 cm) — or, in the polar case, spokes that
    // all start at the circle's centre.
    const tickM = line.match(/^\\draw\[gray!60, thin\]\s*\(([^)]+)\)\s*--\s*\(([^)]+)\);\s*$/);
    if (tickM) {
      const p1 = parsePoint(tickM[1]);
      const p2 = parsePoint(tickM[2]);
      if (p1 && p2) {
        // polar spokes all start at the circle's centre
        if (polarCenter && Math.abs(p1.x - polarCenter.x) < 0.01 && Math.abs(p1.y - polarCenter.y) < 0.01) {
          return true;
        }
        // cartesian tick marks are 0.1 cm long
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) <= 0.2) return true;
      }
      return false;
    }
    if (/^\\draw\[gray!1\d\]\s*\(0,0\)\s+rectangle/.test(line)) return true;
    // box-axis tick NUMBER labels (under x ticks / left of y ticks): the
    // generator re-emits them every cycle, so letting them fall into
    // rawSnippets would duplicate them on every round-trip
    if (/^\\node\[below, font=\\scriptsize, gray!80\]\s+at\s+\([-\d.]+,-0\.05\)\s*\{-?[\d.]+\};$/.test(line)) return true;
    if (/^\\node\[left, font=\\scriptsize, gray!80\]\s+at\s+\(-0\.05,[-\d.]+\)\s*\{-?[\d.]+\};$/.test(line)) return true;
    if (matchScaffold(line, graph.width, graph.height) != null) return true;
    return false;
  };

  for (let idx = 0; idx < lines.length; idx++) {
    ctx.line = idx;
    const rawLine = rawLines[idx];
    const line = lines[idx].trim();

    // Marker comment emitted by the generator for a function's NAME. It is
    // consumed here (not kept as a raw snippet) so that the name survives
    // a code round-trip instead of being lost.
    const fnNameM = rawLine.trim().match(/^%\s*tkz-function:\s*(.+)$/);
    if (fnNameM) {
      pendingFnName = fnNameM[1].trim();
      continue;
    }

    if (!line || line.startsWith("%")) {
      if (rawLine.trim() !== "" || idx > 0) raw.push({ line: idx, text: rawLine.trim() });
      continue;
    }

    const coordMatch = line.match(/^\\coordinate\s+\(([^)]+)\)\s+at\s+\(([^)]+)\);?$/);
    if (coordMatch) {
      const p = parsePoint(coordMatch[2]);
      if (p && coordMatch[1].startsWith("te_")) {
        coords[coordMatch[1].slice(3)] = p;
      }
      continue;
    }

    const titleMatch = line.match(new RegExp(`^\\\\node\\[font=\\\\Large\\]\\s+at\\s+\\(([^)]+)\\)\\s*${BRACED};?$`));
    if (titleMatch) {
      graph.title = unescapeBraces(titleMatch[2]);
      continue;
    }

    const gridMatch = line.match(/^\\draw\[([^\]]*)\]\s*\(0,0\)\s+grid\s+\(([\d.]+),([\d.]+)\);?$/);
    if (gridMatch) {
      if (!gridParsed) {
        gridParsed = true;
        graph.grid.enabled = true;
        graph.grid.dashed = gridMatch[1].includes("dashed");
        const colorToken = gridMatch[1].split(",")[0].trim();
        if (!/step/i.test(colorToken)) {
          graph.grid.color = colorDefs.get(colorToken) ?? colorToken ?? "gray!30";
        }
        const stepM = gridMatch[1].match(/step=([\d.]+)/);
        if (stepM) graph.grid.step = Math.max(0.2, num(stepM[1]));
        graph.width = num(gridMatch[2]);
        graph.height = num(gridMatch[3]);
        continue;
      }
      raw.push({ line: idx, text: rawLine.trim() });
      continue;
    }

    // ---- polar unit detection ----
    const circM = line.match(/^\\draw\[thick\]\s*\(([\d.]+),([\d.]+)\)\s+circle\s+\(([\d.]+)\);$/);
    if (circM && !polarCenter) {
      const cc = { x: num(circM[1]), y: num(circM[2]) };
      const rr = num(circM[3]);
      const atFloor =
        Math.abs(cc.x - graph.width / 2) < 0.01 &&
        Math.abs(cc.y - graph.height / 2) < 0.01 &&
        Math.abs(rr - Math.min(graph.width, graph.height) / 2) < 0.01;
      polarCenter = cc;
      if (atFloor) {
        axisEnabled = true;
        axisType = "polar";
        continue;
      }
      // grown-extent circle: defer it, but remember its centre so the
      // radius arrows below are recognised as scaffold either way
      pendingScaffold.push({ idx, rawLine, line });
      continue;
    }
    if (polarCenter && line.startsWith("\\draw[->, thick]")) {
      const seg = arrowSegOf(line);
      if (
        seg &&
        Math.abs(seg.x1 - polarCenter.x) < 0.01 &&
        Math.abs(seg.y1 - polarCenter.y) < 0.01
      ) {
        axisEnabled = true;
        axisType = "polar";
        continue;
      }
    }

    const scaffoldNow = matchScaffold(line, graph.width, graph.height);
    if (scaffoldNow?.kind === "axisArrow") {
      axisEnabled = true;
      if (scaffoldNow.middle) middleAxis = true;
      continue;
    }
    if (scaffoldNow?.kind === "polar") {
      axisEnabled = true;
      axisType = "polar";
      continue;
    }
    if (scaffoldNow?.kind === "frame") {
      hasBoxFrame = true;
      continue;
    }
    // Not scaffold at the floor size: defer for a second pass ONLY when the
    // geometry exceeds the current canvas floor — that is the signature of
    // scaffold the generator anchored at a LARGER content extent. In-bounds
    // lines stay on the normal object path so their following label lines
    // still attach while parsing order is preserved.
    if (!scaffoldNow && scaffoldShaped(line) && !line.includes("node[") && extendsBeyondCanvas(line)) {
      pendingScaffold.push({ idx, rawLine, line });
      continue;
    }

    const xLabelMatch = line.match(new RegExp(`^\\\\node\\[below right, font=\\\\small\\]\\s+at\\s+\\(([^)]+)\\)\\s*${BRACED};?$`));
    if (xLabelMatch) {
      axisEnabled = true;
      graph.axis.xLabel = unescapeBraces(xLabelMatch[2]);
      continue;
    }
    const yLabelMatch = line.match(new RegExp(`^\\\\node\\[above left, font=\\\\small\\]\\s+at\\s+\\(([^)]+)\\)\\s*${BRACED};?$`));
    if (yLabelMatch) {
      axisEnabled = true;
      graph.axis.yLabel = unescapeBraces(yLabelMatch[2]);
      continue;
    }

    const arrowLabel = line.match(new RegExp(`^\\\\node\\[(above|below|left|right), font=\\\\small[^\\]]*\\]\\s+at\\s+\\(([^)]+)\\)\\s*${BRACED};?$`));
    if (arrowLabel && lastArrowId) {
      const label = unescapeBraces(arrowLabel[3]);
      const pos = arrowLabel[1];
      const arrow = graph.objects.find((x) => x.id === lastArrowId);
      let field: "text" | "textBelow";
      if (pos === "above") field = "text";
      else if (pos === "below") field = "textBelow";
      else {
        // left/right labels: depends on the arrow's direction (up: right=text)
        const up = arrow && arrow.type === "arrow" ? arrow.y2 > arrow.y1 : true;
        field = pos === "right" ? (up ? "text" : "textBelow") : up ? "textBelow" : "text";
      }
      mutateLabel(graph, lastArrowId, field, label);
      continue;
    }

    // Label node following a shape.
    //
    // Only the DIAMOND and the ELLIPSE carry their label on a separate node
    // line (the rectangle/square/circle emit it inline as `node[midway]{…}`).
    // That label sits exactly at the shape's centre. The old rule ("the
    // previous object is any shape") swallowed every standalone text node
    // that followed a shape — the generator names text nodes "tkz_…" too,
    // so a text object placed after a rectangle vanished from the model
    // and its text was silently moved onto the rectangle.
    const shapeLabel = line.match(new RegExp(`^\\\\node\\[([^\\]]*)\\]\\s*\\(tkz_[^)]*\\)\\s+at\\s+\\(([^)]+)\\)\\s*${BRACED};?$`));
    if (shapeLabel && lastShapeId && !/text width=/.test(shapeLabel[1])) {
      const so = graph.objects.find((x) => x.id === lastShapeId);
      const sepShape = so && (so.type === "diamond" || so.type === "ellipse");
      const sepPos = parsePoint(shapeLabel[2]);
      const atCentre =
        sepPos && so && Math.abs(sepPos.x - so.x) < 0.01 && Math.abs(sepPos.y - so.y) < 0.01;
      if (so && sepShape && atCentre) {
        const label = unescapeBraces(shapeLabel[3]).replace(/\\\\/g, "\n").replace(/\\phantom\{x\}/g, "").trim();
        so.text = label;
        lastShapeId = null;
        continue;
      }
    }

    // scaffold decorations (placeholder border, grid/axis lines) are
    // consumed by the generator and must never become objects or raw lines
    if (isAxisDecoration(line)) continue;

    const obj = parseObjectLine(line, ctx);
    if (obj) {
      if (obj.type === "function" && pendingFnName) obj.text = pendingFnName;
      pendingFnName = null;
      graph.objects.push(obj);
      if (obj.type === "arrow") lastArrowId = obj.id;
      else if (obj.type !== "function") lastArrowId = null;
      if (obj.type !== "text" && obj.type !== "arrow" && obj.type !== "function") lastShapeId = obj.id;
      else lastShapeId = null;
      continue;
    }

    // Forward reference: an arrow naming a node that is only defined LATER
    // in the code cannot resolve its endpoint here. Retry after the whole
    // body has been parsed (previously such arrows silently fell into
    // rawSnippets and pgf then failed on the unknown name — parsing only
    // worked by accident when the node names carried big enough numbers to
    // trigger the scaffold deferral below).
    if (line.includes("--") && /\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(line)) {
      pendingRefRetry.push({ idx, rawLine, line });
      continue;
    }

    raw.push({ line: idx, text: rawLine.trim() });
  }

  // ---- second pass: re-evaluate deferred scaffold-shaped lines ----
  // The generator anchors cartesian axes / frames at pictureExtent (max of
  // canvas floor and object bounds), which is only known now. Polar axes
  // hang off the circle centre instead, so extent matching never sees them;
  // their signature is a pair of perpendicular [->, thick] arrows leaving
  // the SAME point (away from (0,0)); the (0,0) variant is the plain
  // "axes" pair.
  {
    const parseArrowSeg = arrowSegOf;
    let exW = graph.width;
    let exH = graph.height;
    for (const o of graph.objects) {
      const b = objectBounds(o);
      if (b.right > exW) exW = b.right;
      if (b.top > exH) exH = b.top;
    }
    for (const p of pendingScaffold) {
      const m = matchScaffold(p.line, exW, exH);
      if (m?.kind === "axisArrow") {
        axisEnabled = true;
        if (m.middle) middleAxis = true;
        continue;
      }
      if (m?.kind === "polar") {
        axisEnabled = true;
        axisType = "polar";
        continue;
      }
      if (m?.kind === "frame") {
        hasBoxFrame = true;
        continue;
      }
      if (p.line.startsWith("\\draw[->, thick]")) {
        const self = parseArrowSeg(p.line);
        const partnerLine = pendingScaffold.find(
          (q) => q !== p && q.line.startsWith("\\draw[->, thick]")
        );
        const other = partnerLine ? parseArrowSeg(partnerLine.line) : null;
        if (
          self && other &&
          Math.abs(self.x1 - other.x1) < 0.01 && Math.abs(self.y1 - other.y1) < 0.01 &&
          ((Math.abs(self.y1 - self.y2) < 0.01 && Math.abs(other.x1 - other.x2) < 0.01) ||
           (Math.abs(self.x1 - self.x2) < 0.01 && Math.abs(other.y1 - other.y2) < 0.01))
        ) {
          axisEnabled = true;
          if (Math.abs(self.x1) > 0.01 || Math.abs(self.y1) > 0.01) axisType = "polar";
          continue;
        }
      }
      // genuinely not scaffold: normal object parsing, else raw
      ctx.line = p.idx;
      const obj = parseObjectLine(p.line, ctx);
      if (obj) {
        graph.objects.push(obj);
        if (obj.type === "arrow") lastArrowId = obj.id;
        else if (obj.type !== "function") lastArrowId = null;
        if (obj.type !== "text" && obj.type !== "arrow" && obj.type !== "function") lastShapeId = obj.id;
        else lastShapeId = null;
      } else {
        raw.push({ line: p.idx, text: p.rawLine.trim() });
      }
    }
  }

  // ---- third pass: retry arrows with forward node references ----
  // Every other line has now been parsed, so `(tkz_…)` endpoints resolve
  // even when the node is defined after the arrow.
  for (const p of pendingRefRetry) {
    ctx.line = p.idx;
    const obj = parseObjectLine(p.line, ctx);
    if (obj) {
      graph.objects.push(obj);
    } else {
      raw.push({ line: p.idx, text: p.rawLine.trim() });
    }
  }

  graph.axis.enabled = axisEnabled;
  graph.axis.type = axisType;
  if (axisEnabled && axisType === "cartesian") {
    if (hasBoxFrame) graph.axis.style = "box";
    else if (middleAxis) graph.axis.style = "middle";
    else graph.axis.style = "axes";
  }
  graph.rawSnippets = raw;
  return graph;
}

function mutateLabel(g: TikZGraph, arrowId: string, field: "text" | "textBelow", value: string): void {
  const o = g.objects.find((x) => x.id === arrowId);
  if (o && o.type === "arrow") {
    if (field === "textBelow") o.textBelow = value;
    else o.text = value;
  }
}

function parseObjectLine(line: string, ctx: ParseCtx): TikZObject | null {
  const o = parseText(line, ctx);
  if (o) return o;
  const r = parseRectangleLike(line, ctx);
  if (r) return r;
  const e = parseEllipseLine(line, ctx);
  if (e) return e;
  const c = parseCircle(line, ctx);
  if (c) return c;
  const a = parseArrowLine(line, ctx);
  if (a) return a;
  const f = parseFunction(line, ctx);
  if (f) return f;
  const d = parseDiamondLine(line, ctx);
  if (d) return d;
  return null;
}

function parseText(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  if (!line.startsWith("\\node")) return null;
  // Three TikZ forms are accepted:
  //   1. \node[opts] (name) at (x,y) {text};   — named node at a coordinate
  //   2. \node[opts] at (x,y) {text};           — anonymous node
  //   3. \node[opts] (x,y) {text};              — node AT the coordinate
  // Forms 2 and 3 were not recognised before, so hand-written nodes ended
  // up as uneditable raw snippets.
  let opts = "";
  let name = "";
  let posStr = "";
  let body = "";
  let m = line.match(/^\\node(?:\[([^\]]*)\])?\s*\(([^)]*)\)\s+at\s+\(([^)]+)\)\s*\{([\s\S]*)\};?$/);
  if (m) {
    opts = m[1] ?? "";
    const cand = m[2].trim();
    // "(1,2) at (3,4)" is form 3 written with an explicit "at" — the first
    // group is then a coordinate, not a name. A node NAME may contain
    // digits ("t1", "node2"), so only a numeric pair counts as a coordinate.
    if (cand !== "" && /^\s*[-+]?[\d.]+\s*(,\s*[-+]?[\d.]+\s*)?$/.test(cand)) {
      posStr = m[3];
      body = m[4];
    } else {
      name = cand;
      posStr = m[3];
      body = m[4];
    }
  } else {
    m = line.match(/^\\node(?:\[([^\]]*)\])?\s*(?:at\s+)?\(([^)]+)\)\s*\{([\s\S]*)\};?$/);
    if (!m) return null;
    opts = m[1] ?? "";
    posStr = m[2];
    body = m[3];
  }
  const pos = parsePoint(posStr);
  if (!pos) return null;
  const isShape = /circle|ellipse|diamond/.test(opts);
  if (isShape) return null;
  if (/font=\\Large/.test(opts)) return null;
  if (/^(above|below|left|right),/.test(opts)) return null;
  const colorMatch = opts.match(/text=([a-zA-Z0-9!]+)/);
  const textWM = opts.match(/text width=([\d.]+)cm/);
  const label = body.replace(/\\\\/g, "\n").replace(/\\phantom\{x\}/g, "").trim();
  const text = unescapeBraces(label);
  const id = ctx.nextId("text", name);
  if (name) ctx.names?.set(name, id);
  return {
    id, type: "text", _srcLine: ctx.line, x: pos.x, y: pos.y,
    color: colorMatch ? colorMatch[1] : "black",
    text,
    // width heuristic must use the unescaped text so the generator's auto-size
    // comparison (and round-trip) stays in sync
    width: textWM ? num(textWM[1]) : textAutoWidth(text),
  };
}

function parseRectangleLike(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  const m = line.match(new RegExp(`^\\\\draw(?:\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\])?\\s*\\(([^)]+)\\)\\s+rectangle\\s+\\(([^)]+)\\)(?:\\s*node\\[([^\\]]*)\\]\\s*${BRACED})?;?$`));
  if (m) {
    const p1 = parsePoint(m[2]);
    const p2 = parsePoint(m[3]);
    if (!p1 || !p2) return null;
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);
    const label = m[5] ? m[5].replace(/\\\\/g, "\n").trim() : "";
    const nameM = (m[4] || "").match(/name=([A-Za-z0-9_]+)/);
    const id = ctx.nextId(Math.abs(w - h) < 0.01 && Math.min(w, h) > 0 ? "square" : "rectangle", nameM ? nameM[1] : undefined);
    if (nameM) ctx.names?.set(nameM[1], id);
    const color = m[1] ? extractColor(m[1], ctx.colorDefs) : "black";
    if (Math.abs(w - h) < 0.01 && Math.min(w, h) > 0) {
      return { id, type: "square", _srcLine: ctx.line, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, color, text: unescapeBraces(label), size: w };
    }
    return {
      id, type: "rectangle", _srcLine: ctx.line, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2,
      color, text: unescapeBraces(label), w, h,
    };
  }
  return null;
}

function parseCircle(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  const m = line.match(new RegExp(`^\\\\draw(?:\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\])?\\s*\\(([^)]+)\\)\\s+circle\\s+\\(([^)]+)\\)(?:\\s*node\\[([^\\]]*)\\]\\s*${BRACED})?;?$`));
  if (m) {
    const p = parsePoint(m[2]);
    if (!p) return null;
    // a plain circle radius is a single number; "rx and ry" belongs to an
    // ellipse and must never be swallowed here (parseFloat would take rx)
    if (!/^\s*[\d.]+\s*$/.test(m[3])) return null;
    const r = num(m[3]);
    const label = m[5] ? m[5].replace(/\\\\/g, "\n").trim() : "";
    const nameM = (m[4] || "").match(/name=([A-Za-z0-9_]+)/);
    const color = m[1] ? extractColor(m[1], ctx.colorDefs) : "black";
    const id = ctx.nextId("circle", nameM ? nameM[1] : undefined);
    if (nameM) ctx.names?.set(nameM[1], id);
    return { id, type: "circle", _srcLine: ctx.line, x: p.x, y: p.y, color, text: unescapeBraces(label), r: Math.abs(r) };
  }
  return null;
}

function parseDiamondLine(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  const m = line.match(/^\\draw\[([^\]]*)\]\s*\(([^)]+)\)\s*--\s*\(([^)]+)\)\s*--\s*\(([^)]+)\)\s*--\s*\(([^)]+)\)\s*--\s*cycle;?$/);
  if (!m) return null;
  const p1 = parsePoint(m[2]);
  const p2 = parsePoint(m[3]);
  const p3 = parsePoint(m[4]);
  const p4 = parsePoint(m[5]);
  if (!p1 || !p2 || !p3 || !p4) return null;
  const cx = (p1.x + p3.x) / 2;
  const cy = (p1.y + p3.y) / 2;
  const size = Math.abs(p3.y - p1.y);
  if (size < 0.01) return null;
  if (Math.abs(p2.y - cy) > 0.01 || Math.abs(p4.y - cy) > 0.01) return null;
  if (Math.abs(p1.x - cx) > 0.01 || Math.abs(p3.x - cx) > 0.01) return null;
  const id = ctx.nextId("diamond");
  return {
    id, type: "diamond", _srcLine: ctx.line, x: cx, y: cy,
    color: extractColor(m[1], ctx.colorDefs), text: "", size,
  };
}

function parseEllipseLine(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  const m = line.match(new RegExp(`^\\\\draw\\[([^\\]]*)\\]\\s*\\(([^)]+)\\)\\s+circle\\s+\\(([\\d.]+) and ([\\d.]+)\\);?$`));
  if (!m) return null;
  const p = parsePoint(m[2]);
  if (!p) return null;
  const id = ctx.nextId("ellipse");
  return {
    id, type: "ellipse", _srcLine: ctx.line, x: p.x, y: p.y,
    color: extractColor(m[1], ctx.colorDefs), text: "",
    rx: Math.abs(num(m[3])), ry: Math.abs(num(m[4])),
  };
}

function parseArrowLine(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  const m = line.match(new RegExp(`^\\\\draw(?:\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\])?\\s*\\(([^)]+)\\)\\s*--\\s*\\(([^)]+)\\)(?:\\s*node\\[[^\\]]*\\]\\s*${BRACED})?;?$`));
  if (!m) return null;
  // NOTE: gray!60 is deliberately NOT rejected here any more — the axis tick
  // lines are consumed earlier by isAxisDecoration (exact generator
  // signature), so a USER arrow that merely uses gray!60 stays an object.
  if (/Stealth\[scale=1\.2\]/.test(m[1] || "")) return null;
  // tolerate whitespace inside the coordinate brackets: "( tkz_x )" and
  // "( 3 , 1 )" are perfectly valid TikZ but used to fail to parse
  const rawP1 = m[2].trim();
  const rawP2 = m[3].trim();
  /** Is this token a node reference rather than a coordinate? */
  const isRef = (t: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t);
  /** Resolve a node reference to a position (and to the object it names).
   *  A reference may be
   *    - a coordinate name:  (te_o1_1)  → the generator's \coordinate
   *    - a generated node:   (tkz_o1_1) → the generator's node name
   *    - a user node name:   (box1)     → `name=box1` written by hand
   *  The last form used to be unresolvable, so every arrow pointing at a
   *  hand-named node silently fell through to a raw snippet. */
  const resolveRef = (token: string): { x: number; y: number; id: string | null } | null => {
    const t = token.trim();
    const candidates = [t];
    if (t.startsWith("te_")) candidates.push(t.slice(3));
    else if (t.startsWith("tkz_")) candidates.push(t.slice(4));
    for (const c of candidates) {
      const fromCoord = ctx.coords?.[c];
      if (fromCoord) return { x: fromCoord.x, y: fromCoord.y, id: null };
      const named = ctx.names?.get(c);
      if (named) {
        const obj = graph.objects.find((o) => o.id === named);
        if (obj) return { x: obj.x, y: obj.y, id: obj.id };
      }
      const obj = graph.objects.find((o) => o.id === c);
      if (obj) return { x: obj.x, y: obj.y, id: obj.id };
    }
    return null;
  };
  const r1 = isRef(rawP1) ? resolveRef(rawP1) : null;
  const r2 = isRef(rawP2) ? resolveRef(rawP2) : null;
  const p1 = r1 ?? (isRef(rawP1) ? null : parsePoint(rawP1));
  const p2 = r2 ?? (isRef(rawP2) ? null : parsePoint(rawP2));
  if (!p1 || !p2) return null;
  const id = ctx.nextId("arrow");
  const color = m[1] ? extractColor(m[1], ctx.colorDefs) : "black";
  const label = m[4] ? m[4].replace(/\\\\/g, "\n").trim() : "";
  const opts = m[1] || "";
  let head: ArrowObject["head"] = "end";
  let tip: ArrowObject["tip"] = "arrow";
  for (const tok of opts.split(",").map((t) => t.trim())) {
    const p = parseTipToken(tok);
    if (p) { head = p.head; tip = p.tip; }
  }
  const dash: ArrowObject["dash"] = opts.includes("dotted") ? "dotted" : opts.includes("dashed") ? "dashed" : "solid";
  const arr: ArrowObject = {
    id, type: "arrow", _srcLine: ctx.line, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2,
    color, text: unescapeBraces(label), textBelow: "",
    x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
    startId: r1?.id ?? null, endId: r2?.id ?? null,
    head, tip, dash,
  };
  return arr;
}

/** Parse a single draw-option token into an arrowhead spec, e.g. "<->", "-latex", "latex-", "*-*". */
function parseTipToken(tok: string): { head: ArrowObject["head"]; tip: ArrowObject["tip"] } | null {
  const t = tok.trim();
  if (t === "->") return { head: "end", tip: "arrow" };
  if (t === "<-") return { head: "start", tip: "arrow" };
  if (t === "<->") return { head: "both", tip: "arrow" };
  if (!t || t === "thick" || t === "thin" || t === "dashed" || t === "dotted") return null;
  if (!t.includes("-")) return null;
  const parts = t.split("-");
  const left = parts[0].trim();
  const right = parts[parts.length - 1].trim();
  const tipOf = (name: string): ArrowObject["tip"] | null => {
    switch (name) {
      case "latex": return "latex";
      case "stealth": return "stealth";
      case "to": return "to";
      case "triangle 45": return "triangle";
      case "angle 60": return "angle";
      case "o": return "o";
      case "*": return "star";
      case "|": return "bar";
      case "diamond": return "diamond";
      default: return null;
    }
  };
  const lt = left ? tipOf(left) : null;
  const rt = right ? tipOf(right) : null;
  if (lt && rt) return { head: "both", tip: rt };
  if (lt) return { head: "start", tip: lt };
  if (rt) return { head: "end", tip: rt };
  return null;
}

function extractColor(opts: string, colorDefs?: Map<string, string>): string {
  const tokens = opts.split(",").map((t) => t.trim());
  for (const t of tokens) {
    if (t.startsWith("-")) continue;
    if (t === "thick" || t === "thin" || t === "very thick" || t === "very thin" || t === "semithick" || t === "ultra thick" || t === "ultra thin") continue;
    if (/^step=/.test(t)) continue;
    if (t === "") continue;
    // a generated colour name maps back to the plain hex value
    return colorDefs?.get(t) ?? t;
  }
  return "black";
}

function parseFunction(line: string, ctx: ParseCtx): TikZObject | null {
  const graph = ctx.graph;
  const m = line.match(/^\\draw(?:\[((?:[^\[\]]|\[[^\]]*\])*)\])?\s+plot\s+\(\\x,\s*\{(.*)\}\);?$/);
  if (!m) return null;
  const opts = m[1] || "";
  const domainM = opts.match(/domain=([-.\d]+):([-.\d]+)/);
  const color = extractColor(opts.replace(/domain=[^,]*/, "").replace(/samples=[^,]*/, "").replace(/xshift=[^,]*cm/, "").replace(/yshift=[^,]*cm/, ""), ctx.colorDefs) || "black";
  const shiftX = num((opts.match(/xshift=([-.\d]+)cm/) || [])[1]);
  const shiftY = num((opts.match(/yshift=([-.\d]+)cm/) || [])[1]);
  let expr = m[2].replace(/\\x/g, "x").trim();
  // pgf's radian suffix — `sin(\x r)` means sin(x) in radians; math.ts has
  // no "r" operator and `x r` would tokenize into an unknown identifier
  expr = expr.replace(/\bx\s+r\b/g, "x");
  if (expr.startsWith("(") && expr.endsWith(")")) {
    let depth = 0;
    let wrap = true;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === "(") depth++;
      else if (expr[i] === ")") {
        depth--;
        if (depth === 0 && i !== expr.length - 1) {
          wrap = false;
          break;
        }
      }
    }
    if (wrap) expr = expr.slice(1, -1);
  }
  const id = ctx.nextId("function");
  const fn: FunctionObject = {
    id, type: "function", _srcLine: ctx.line, x: 0, y: 0,
    color, text: "",
    expression: expr,
    domain: domainM ? [num(domainM[1]), num(domainM[2])] : [0, 10],
    offsetX: shiftX, offsetY: shiftY,
  };
  return fn;
}

/** Fully-parsed styling of a tikz-cd arrow (yishn/tikzcd-editor compatible). */
interface CdArrowSpec {
  dc: number;
  dr: number;
  line: ArrowObject["dash"];
  tail: NonNullable<ArrowObject["tail"]>;
  tip: ArrowObject["tip"];
  head: ArrowObject["head"];
  bend: number;
  shift: number;
  loop: [number, boolean] | null;
  labelPos: "left" | "inside" | "right";
  labelLong: "center" | "nearstart" | "verynearstart" | "nearend" | "verynearend";
  text: string;
  textBelow: string;
  color: string;
  crossingOver?: boolean;
}

/** Unescape a "..." label body (quote escapes only — backslashes are passed
 *  to math mode verbatim, so \\\\ is a genuine math line break, not an
 *  escaped backslash) and normalize redundant math/text wrappers (see
 *  cleanMathText). */
function parseCdLabelBody(inner: string): string {
  return cleanMathText(inner.replace(/\\"/g, '"'));
}

/** Unquote a "..." label token and unescape its inner quotes/backslashes. */
function parseCdLabelToken(tok: string): string {
  return parseCdLabelBody(tok.slice(1, tok.length - 1));
}

/** Tokenize a \\arrow[...] spec into individual comma-separated tokens,
 *  respecting quotes (labels may contain commas) and backslash escapes. */
function splitCdSpec(spec: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (c === "\\") {
      cur += c;
      if (i + 1 < spec.length) { cur += spec[i + 1]; i++; }
      continue;
    }
    if (c === '"') inQuote = !inQuote;
    if (c === "," && !inQuote) { tokens.push(cur); cur = ""; continue; }
    cur += c;
  }
  tokens.push(cur);
  return tokens;
}

/** Parse the full styling of a tikz-cd \\arrow[...] spec. */
function parseCdArrowSpec(spec: string): CdArrowSpec {
  const out: CdArrowSpec = {
    dc: 0, dr: 0, line: "solid", tail: "none", tip: "arrow", head: "end",
    bend: 0, shift: 0, loop: null, labelPos: "left", labelLong: "center",
    crossingOver: false,
    text: "", textBelow: "", color: "black",
  };
  let inAngle: number | null = null;
  let outAngle: number | null = null;
  let swap = false;
  const labels: string[] = [];

  for (const raw of splitCdSpec(spec)) {
    const tok = raw.trim();
    if (!tok) continue;

    if (/^[lrud]+$/.test(tok)) {
      for (const ch of tok) {
        if (ch === "r") out.dc++;
        else if (ch === "l") out.dc--;
        else if (ch === "d") out.dr++;
        else if (ch === "u") out.dr--;
      }
      continue;
    }
    if (tok === "'") { out.labelPos = "right"; continue; }
    const labelRe = /^"((?:[^"\\]|\\.)*)"/;
    const labelM = tok.match(labelRe);
    if (labelM) {
      // A label may carry trailing options written after the closing quote,
      // e.g. `"{(x,y)}" description`, `"f"'`, `"x" swap`, `"y" near end`.
      const inner = labelM[1];
      const trail = tok.slice(labelM[0].length).trim();
      labels.push(parseCdLabelBody(inner));
      if (trail === "'") out.labelPos = "right";
      else if (trail === "description") out.labelPos = "inside";
      else if (trail === "swap") swap = true;
      else if (trail === "near start") out.labelLong = "nearstart";
      else if (trail === "very near start") out.labelLong = "verynearstart";
      else if (trail === "near end") out.labelLong = "nearend";
      else if (trail === "very near end") out.labelLong = "verynearend";
      continue;
    }
    if (tok.startsWith('"')) {
      let t = tok;
      if (t.endsWith("'") && !t.endsWith('\\"')) { out.labelPos = "right"; t = t.slice(0, -1); }
      labels.push(parseCdLabelToken(t));
      continue;
    }
    const descM = tok.match(/^description\s*=\s*"((?:[^"\\]|\\.)*)"/);
    if (descM) { out.labelPos = "inside"; labels.push(parseCdLabelToken('"' + descM[1] + '"')); continue; }
    // bare `description` key (the syntax the generator now emits after the
    // quoted label); must be matched before the unknown-word colour fallback
    if (tok === "description") { out.labelPos = "inside"; continue; }
    if (tok === "swap") { swap = true; continue; }
    if (tok === "crossing over") { out.crossingOver = true; continue; }
    if (tok === "dashed") { out.line = "dashed"; continue; }
    if (tok === "dotted") { out.line = "dotted"; continue; }
    if (tok === "Rightarrow") { out.line = "double"; continue; }
    if (tok === "phantom") { out.line = "phantom"; out.head = "none"; out.tail = "none"; if (out.labelPos === "left") out.labelPos = "inside"; continue; }
    if (tok === "hook") { out.tail = "hook"; continue; }
    if (tok === "hook'") { out.tail = "hookalt"; continue; }
    if (tok === "maps to") { out.tail = "mapsto"; continue; }
    if (tok === "tail") { out.tail = "tail"; continue; }
    if (tok === "harpoon") { out.tip = "harpoon"; continue; }
    if (tok === "harpoon'") { out.tip = "harpoonalt"; continue; }
    if (tok === "two heads") { out.tip = "twoheads"; continue; }
    if (tok === "no head") { out.head = "none"; continue; }
    if (tok === "near start") { out.labelLong = "nearstart"; continue; }
    if (tok === "very near start") { out.labelLong = "verynearstart"; continue; }
    if (tok === "near end") { out.labelLong = "nearend"; continue; }
    if (tok === "very near end") { out.labelLong = "verynearend"; continue; }
    const bendM = tok.match(/^bend (left|right)(?:=(-?\d+(?:\.\d+)?))?/);
    if (bendM) { const v = bendM[2] ? parseFloat(bendM[2]) : 30; out.bend = bendM[1] === "left" ? v : -v; continue; }
    const shiftM = tok.match(/^shift (left|right)(?:=(-?\d+(?:\.\d+)?))?/);
    if (shiftM) { const v = shiftM[2] ? parseFloat(shiftM[2]) : 1; out.shift = shiftM[1] === "right" ? v : -v; continue; }
    if (tok === "loop" || /^loop=/.test(tok)) { if (!out.loop) out.loop = [0, false]; continue; }
    const inM = tok.match(/^in=(-?\d+)/);
    if (inM) { inAngle = parseInt(inM[1], 10); continue; }
    const outM = tok.match(/^out=(-?\d+)/);
    if (outM) { outAngle = parseInt(outM[1], 10); continue; }
    // tikz-cd arrow colors: a plain word that is not a known option
    if (/^[a-zA-Z][a-zA-Z0-9!.,-]*$/.test(tok) && out.color === "black") { out.color = tok; continue; }
  }

  if (labels.length > 0) out.text = labels[0];
  if (labels.length > 1) out.textBelow = labels[labels.length - 1];
  else if (swap && labels.length === 1) out.textBelow = out.text;

  // loop angle + direction recovered from in=/out= (yishn formula)
  if (out.loop && inAngle != null && outAngle != null) {
    // The angle is the MIDPOINT of the two arc ends — but a plain
    // arithmetic mean is wrong when the ends straddle 0° (a 90° loop is
    // encoded as in=35, out=325 and the mean gave 270°, i.e. the loop
    // jumped to the opposite side of the cell). Use the shortest arc.
    const diff = (((outAngle - inAngle) % 360) + 540) % 360 - 180; // signed shortest arc
    const angle = (((inAngle + diff / 2 + 90) % 360) + 360) % 360;
    out.loop = [angle, (outAngle - inAngle + 360) % 360 < 180];
  }
  return out;
}

/** \\arrow[...] — the spec may contain ] inside "quoted" labels, so the
 *  bracket group must not stop at the first ]. A token is either a
 *  non-quote/non-bracket char or a whole "quoted string". */
const ARROW_RE = /\\arrow(\[(?:[^"\]\[]|"[^"]*")*\])/g;

/** Parse a tikzcd body: matrix cells become text objects, \\arrow lines become arrows.
 *  MULTIPLE \begin{tikzcd} environments are supported (side-by-side layout):
 *  diagram i+1's cells are offset right of diagram i's with one blank spacer
 *  column; per-environment options and the separators between environments are
 *  recorded in graph.cdMulti so the generator can reproduce the layout. */
function parseTikZCd(code: string, graph: TikZGraph, prevGraph?: TikZGraph | null): TikZGraph {
  const cellSize = 1.6;
  const prevObjects = prevGraph?.objects ?? [];
  const usedIds = new Set<string>();
  let prevIndex = 0;
  const nextId = (type: string): string => {
    while (prevIndex < prevObjects.length) {
      const p = prevObjects[prevIndex];
      prevIndex++;
      if (p.type === type && !usedIds.has(p.id)) {
        usedIds.add(p.id);
        return p.id;
      }
    }
    const id = makeId(graph);
    usedIds.add(id);
    return id;
  };

  const envRe = /\\begin\{tikzcd\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{tikzcd\}/g;
  const envs = [...code.matchAll(envRe)];

  const cellPos = new Map<string, string>(); // key "col,row" -> id (offset cols)
  const pendingArrows: { row: number; col: number; spec: string }[] = [];
  const multi: NonNullable<TikZGraph["cdMulti"]> = [];
  let colCursor = 0;

  envs.forEach((m, mi) => {
    const optM = m[0].match(/^\\begin\{tikzcd\}(\[[^\]]*\])/);
    const cdOptions = optM ? optM[1] : undefined;
    if (mi === 0 && cdOptions) graph.cdOptions = cdOptions;
    const colStart = colCursor;
    let maxColRel = 0;

    const rows = m[1].split("\\\\");
    rows.forEach((rowText, row) => {
      // cells: split the whole (multi-line) row on &
      rowText.split("&").forEach((piece, col) => {
        const text = cleanMathText(piece.replace(ARROW_RE, "").trim());
        if (text !== "") {
          const key = `${col + colStart},${row}`;
          const id = nextId("text");
          cellPos.set(key, id);
          maxColRel = Math.max(maxColRel, col);
          graph.objects.push({
            id, type: "text", _srcLine: 100000 + mi * 10000 + row * 100 + col,
            x: (col + colStart) * cellSize + cellSize / 2, y: row * cellSize + cellSize / 2,
            color: "black", text, width: 1.4,
          });
        }
      });
      // arrows: their source cell = the number of & before the arrow in this row
      const arrowRe = ARROW_RE;
      let am: RegExpExecArray | null;
      while ((am = arrowRe.exec(rowText)) !== null) {
        const before = rowText.slice(0, am.index);
        const col = (before.match(/&/g) ?? []).length;
        pendingArrows.push({ row, col: col + colStart, spec: am[1].slice(1, -1) });
        maxColRel = Math.max(maxColRel, col);
      }
    });

    // record the env before arrows are resolved: arrow targets may extend the
    // diagram's column range, folded in below
    multi.push({ cdOptions, colStart, colEnd: colStart + maxColRel, sep: "" });
    if (mi + 1 < envs.length) {
      const between = code.slice((m.index ?? 0) + m[0].length, envs[mi + 1].index ?? undefined).trim();
      multi[mi].sep = between !== "" ? between : "\\quad \\quad";
    }
    colCursor = colStart + maxColRel + 2;
  });

  // anything after the LAST tikzcd block (e.g. \quad or trailing macros) is
  // preserved as raw snippets so the round trip keeps the whole document
  const last = envs[envs.length - 1];
  const afterIdx = last && last.index !== undefined ? last.index + last[0].length : -1;
  if (afterIdx !== -1) {
    const tail = code.slice(afterIdx);
    tail.split("\n").forEach((t, i) => {
      const l = t.trim();
      if (l === "" || /^\\end\{document\}/.test(l)) return;
      graph.rawSnippets.push({ line: 1000000 + i, text: t });
    });
  }

  const cellOf = (row: number, col: number): { id: string | null; x: number; y: number } => {
    const id = cellPos.get(`${col},${row}`) ?? null;
    return { id, x: col * cellSize + cellSize / 2, y: row * cellSize + cellSize / 2 };
  };

  for (const pa of pendingArrows) {
    const s = parseCdArrowSpec(pa.spec);
    const start = cellOf(pa.row, pa.col);
    let end;
    if (s.loop) {
      end = { id: start.id, x: start.x, y: start.y };
    } else {
      let dc = s.dc;
      let dr = s.dr;
      if (dc === 0 && dr === 0) dc = 1;
      end = cellOf(pa.row + dr, pa.col + dc);
      // an arrow reaching one column past its diagram extends that diagram's
      // range (cells of LATER diagrams keep their placed offsets — arrows
      // crossing into another diagram are an accepted edge case)
      const mi = multi.findIndex((d) => pa.col >= d.colStart && pa.col <= d.colEnd);
      if (mi >= 0) {
        const limit = mi + 1 < multi.length ? multi[mi + 1].colStart - 1 : pa.col + dc;
        multi[mi].colEnd = Math.max(multi[mi].colEnd, Math.min(pa.col + dc, limit));
      }
    }
    const id = nextId("arrow");
    graph.objects.push({
      id, type: "arrow", _srcLine: 200000 + graph.objects.length,
      x: (start.x + end.x) / 2, y: (start.y + end.y) / 2,
      color: s.color, text: s.text, textBelow: s.textBelow,
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      startId: start.id, endId: end.id,
      head: s.head, tip: s.tip, dash: s.line,
      tail: s.tail, bend: s.bend, shift: s.shift, loop: s.loop,
      labelPos: s.labelPos, labelLong: s.labelLong,
      crossingOver: s.crossingOver || undefined,
    });
  }

  if (multi.length > 0) graph.cdMulti = multi;
  return graph;
}

