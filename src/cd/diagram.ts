/**
 * Bridge between the reference tikzcd-editor diagram model and this plugin's
 * TikZGraph model. The Preact app keeps the reference's own state shape
 * ({nodes, edges}) so its UI code stays verbatim; every change is converted
 * to/from our TikZGraph via the plugin's own parser/generator so the Code
 * tab, Copy Code and Insert stay consistent.
 */
import { parseTikZ } from "../core/TikZParser";
import { generateTikZ } from "../core/TikZGenerator";
import { defaultGraph, makeId } from "../core/types";
import type { TikZGraph, ArrowObject } from "../core/types";

const CELL = 1.6;
let uid = 0;
export function getId(): string {
  return "n" + uid++;
}

export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

/** Flip a diagram vertically.
 *
 *  The cd grid is ROW-DOWN (row 0 at the top) while the picture canvas is
 *  Y-UP (larger y = higher on screen). Handing the cd objects to the
 *  picture canvas unchanged mirrored the whole diagram — the top row ended
 *  up at the bottom and `\arrow[d]` pointed up.
 *
 *  The flip must NOT happen inside cellCenter(): the generator derives the
 *  matrix row from y, so flipping there would invert the LaTeX as well. */
export function flipGraphY(g: TikZGraph): TikZGraph {
  const rows: number[] = [];
  for (const o of g.objects) {
    if (o.type === "text") rows.push(Math.round((o.y - CELL / 2) / CELL));
    else if (o.type === "arrow") {
      rows.push(Math.round((o.y1 - CELL / 2) / CELL));
      rows.push(Math.round((o.y2 - CELL / 2) / CELL));
    }
  }
  if (rows.length === 0) return g;
  const maxRow = Math.max(...rows);
  const flip = (y: number) => (maxRow + 1) * CELL - y;
  for (const o of g.objects) {
    if (o.type === "text") {
      o.y = flip(o.y);
    } else if (o.type === "arrow") {
      o.y1 = flip(o.y1);
      o.y2 = flip(o.y2);
      o.y = (o.y1 + o.y2) / 2;
    }
  }
  return g;
}

/** Convert a plugin graph (env=cd) into the reference diagram model. */
export function graphToDiagram(g: TikZGraph): { nodes: any[]; edges: any[] } {
  const nodes: any[] = [];
  const edges: any[] = [];
  const byId = new Map<string, any>();
  for (const o of g.objects) {
    if (o.type === "text") {
      const col = Math.round((o.x - CELL / 2) / CELL);
      const row = Math.round((o.y - CELL / 2) / CELL);
      const node = { id: o.id, position: [col, row], value: o.text };
      nodes.push(node);
      byId.set(o.id, node);
    }
  }
  for (const o of g.objects) {
    if (o.type !== "arrow") continue;
    const a = o as ArrowObject;
    // tikz-cd arrows may legitimately point at EMPTY cells (e.g. `dd`
    // crossing a spacer row). The Preact model needs a node per edge
    // endpoint, so create an invisible placeholder instead of dropping the
    // whole arrow — dropping used to lose arrows on every reload/Parse.
    const ensureNode = (x: number, y: number) => {
      const found = nodeAt(nodes, x, y);
      if (found) return found;
      const col = Math.round((x - CELL / 2) / CELL);
      const row = Math.round((y - CELL / 2) / CELL);
      const node = { id: getId(), position: [col, row], value: "" };
      nodes.push(node);
      byId.set(node.id, node);
      return node;
    };
    const fromNode = (a.startId && byId.get(a.startId)) || ensureNode(a.x1, a.y1);
    const toNode = (a.endId && byId.get(a.endId)) || ensureNode(a.x2, a.y2);
    const edge: any = { from: fromNode.id, to: toNode.id };
    if (a.text) edge.value = a.text;
    if (a.textBelow) edge.secondValue = a.textBelow;
    // the reference diagram model has no colour UI, but the colour must
    // still ride along: otherwise every bridge round-trip (Parse, or any
    // cell/arrow edit) stripped \arrow[r, red] back to black
    if (a.color && a.color !== "black") edge.color = a.color;
    edge.labelPosition = a.labelPos === "right" ? "right" : a.labelPos === "inside" ? "inside" : "left";
    if (a.labelLong && a.labelLong !== "center") edge.labelPositionLongitudinal = a.labelLong;
    if (a.tail && a.tail !== "none") edge.tail = a.tail;
    edge.line = a.dash === "double" ? "double" : a.dash === "dashed" ? "dashed" : a.dash === "dotted" ? "dotted" : a.dash === "phantom" ? "none" : "solid";
    if (a.head === "none") edge.head = "none";
    else if (a.tip === "twoheads") edge.head = "twoheads";
    else if (a.tip === "harpoon") edge.head = "harpoon";
    else if (a.tip === "harpoonalt") edge.head = "harpoonalt";
    if (a.bend) edge.bend = a.bend;
    if (a.shift) edge.shift = a.shift;
    if (a.loop) edge.loop = a.loop;
    // `crossing over` has no field in the reference model, but it IS part
    // of the arrow style — dropping it silently degraded
    // `\arrow[r, crossing over]` to `\arrow[r]` on every bridge round-trip
    if (a.crossingOver) edge.crossingOver = true;
    edges.push(edge);
  }
  return { nodes, edges };
}

function nodeAt(nodes: any[], x: number, y: number): any | null {
  const col = Math.round((x - CELL / 2) / CELL);
  const row = Math.round((y - CELL / 2) / CELL);
  return nodes.find((n) => n.position[0] === col && n.position[1] === row) || null;
}

/** Convert the reference diagram model into a plugin graph (env=cd).
 *  `base` (the plugin's current graph) carries the cd metadata through the
 *  bridge — cdMulti (multi-diagram ranges), cdOptions, preamble, raw
 *  snippets — so cell edits do not degrade a multi-diagram layout back into
 *  a single matrix. */
export function diagramToGraph(diagram: { nodes: any[]; edges: any[] }, base?: TikZGraph | null): TikZGraph {
  const g = defaultGraph(10, 8, "cd");
  if (base) {
    g.cdMulti = base.cdMulti;
    g.cdOptions = base.cdOptions;
    g.preamble = base.preamble;
    g.rawSnippets = base.rawSnippets;
    g.title = base.title;
  }
  g.objects = [];
  const idByPos = new Map<string, string>();
  for (const n of diagram.nodes) {
    const id = n.id || makeId(g);
    const c = cellCenter(n.position[0], n.position[1]);
    g.objects.push({
      id,
      type: "text",
      x: c.x,
      y: c.y,
      color: "black",
      text: n.value || "",
      width: 1.4,
    });
    idByPos.set(n.position.join(","), id);
  }
  for (const e of diagram.edges) {
    const fromNode = diagram.nodes.find((n) => n.id === e.from);
    const toNode = diagram.nodes.find((n) => n.id === e.to);
    if (!fromNode || !toNode) continue;
    const startId = e.from;
    const endId = e.to;
    const s = cellCenter(fromNode.position[0], fromNode.position[1]);
    const t = cellCenter(toNode.position[0], toNode.position[1]);
    const a: ArrowObject = {
      id: makeId(g),
      type: "arrow",
      x: (s.x + t.x) / 2,
      y: (s.y + t.y) / 2,
      color: e.color || "black",
      text: e.value || "",
      textBelow: (e.secondValue as string) || "",
      x1: s.x,
      y1: s.y,
      x2: t.x,
      y2: t.y,
      startId,
      endId,
      head: e.head === "none" ? "none" : "end",
      tip: e.head === "twoheads" ? "twoheads" : e.head === "harpoon" ? "harpoon" : e.head === "harpoonalt" ? "harpoonalt" : "arrow",
      dash: e.line === "double" ? "double" : e.line === "dashed" ? "dashed" : e.line === "dotted" ? "dotted" : e.line === "none" ? "phantom" : "solid",
      labelPos: e.labelPosition === "right" ? "right" : e.labelPosition === "inside" ? "inside" : "left",
    };
    if (e.tail) a.tail = e.tail;
    if (e.bend) a.bend = e.bend;
    if (e.shift) a.shift = e.shift;
    if (e.loop) a.loop = e.loop;
    if (e.crossingOver) a.crossingOver = true;
    if (e.labelPositionLongitudinal) a.labelLong = e.labelPositionLongitudinal;
    g.objects.push(a);
  }
  g.nextId = 1;
  return g;
}

/** Generate tikz-cd code for a diagram via the plugin generator. `base`
 *  carries the cd metadata (see diagramToGraph). */
export function toTeX(diagram: { nodes: any[]; edges: any[] }, base?: TikZGraph | null): string {
  return generateTikZ(diagramToGraph(diagram, base));
}

/** Parse tikz-cd code into the diagram model via the plugin parser.
 *  Throws on input without a tikzcd environment — silently returning an
 *  empty diagram used to WIPE the canvas and overwrite the code panel.
 *  `meta` carries the parsed cd metadata (multi-diagram ranges etc.) so the
 *  caller can write it onto the plugin graph. */
export function fromTeX(code: string): { nodes: any[]; edges: any[]; meta: { cdMulti: TikZGraph["cdMulti"]; cdOptions: TikZGraph["cdOptions"] } } {
  if (!/\\begin\{tikzcd\}/.test(code)) {
    throw new Error("no \\begin{tikzcd} environment found in the code panel");
  }
  const g = parseTikZ(code, defaultGraph(10, 8, "cd"));
  return { ...graphToDiagram(g), meta: { cdMulti: g.cdMulti, cdOptions: g.cdOptions } };
}

export { parseTikZ };
