export type ObjectType =
  | "text"
  | "rectangle"
  | "square"
  | "circle"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "function";

export interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  color: string;
  text: string;
  /** source line in the parsed code body, used for canonical round-trips */
  _srcLine?: number;
}

export interface TextObject extends BaseObject {
  type: "text";
  width: number;
}

export interface RectObject extends BaseObject {
  type: "rectangle";
  w: number;
  h: number;
}

export interface SquareObject extends BaseObject {
  type: "square";
  size: number;
}

export interface CircleObject extends BaseObject {
  type: "circle";
  r: number;
}

export interface DiamondObject extends BaseObject {
  type: "diamond";
  size: number;
}

export interface EllipseObject extends BaseObject {
  type: "ellipse";
  rx: number;
  ry: number;
}

export interface ArrowObject extends BaseObject {
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  startId: string | null;
  endId: string | null;
  textBelow: string;
  /** which end(s) get an arrowhead */
  head: "end" | "start" | "both" | "none";
  /** arrow tip style */
  tip: "arrow" | "latex" | "stealth" | "to" | "triangle" | "angle" | "o" | "star" | "bar" | "diamond" | "twoheads" | "harpoon" | "harpoonalt";
  /** line style */
  dash: "solid" | "dashed" | "dotted" | "double" | "phantom";
  // ---- tikz-cd specific styling (only used when graph.env === "cd") ----
  /** arrow tail style (perpendicular start) */
  tail?: "none" | "hook" | "hookalt" | "mapsto" | "tail";
  /** bend in degrees, signed: >0 = bend left, <0 = bend right (range ±80) */
  bend?: number;
  /** parallel shift in em, signed: >0 = shift right, <0 = shift left */
  shift?: number;
  /** self loop: [angle, clockwise] */
  loop?: [number, boolean] | null;
  /** main label position */
  labelPos?: "left" | "inside" | "right";
  /** longitudinal label position */
  labelLong?: "center" | "nearstart" | "verynearstart" | "nearend" | "verynearend";
  /** tikz-cd `crossing over`: the arrow crosses others and gets a small gap */
  crossingOver?: boolean;
}

export interface FunctionObject extends BaseObject {
  type: "function";
  expression: string;
  domain: [number, number];
  offsetX: number;
  offsetY: number;
}

export type TikZObject =
  | TextObject
  | RectObject
  | SquareObject
  | CircleObject
  | DiamondObject
  | EllipseObject
  | ArrowObject
  | FunctionObject;

export interface AxisConfig {
  enabled: boolean;
  type: "cartesian" | "polar";
  style: "box" | "middle" | "axes";
  xLabel: string;
  yLabel: string;
  step: number;
}

export interface GridConfig {
  enabled: boolean;
  step: number;
  color: string;
  dashed: boolean;
}

export interface RawSnippet {
  line: number;
  text: string;
}

export interface TikZGraph {
  width: number;
  height: number;
  title: string;
  /** editing/generation environment: tikzpicture or tikzcd */
  env: "picture" | "cd";
  axis: AxisConfig;
  grid: GridConfig;
  objects: TikZObject[];
  nextId: number;
  preamble: string;
  rawSnippets: RawSnippet[];
/** Options captured from \begin{tikzcd}[...] and re-emitted verbatim
 *  (row sep / column sep etc.). Empty/undefined when none. */
  cdOptions?: string;
  /** Multiple side-by-side tikzcd environments (multi-diagram layout).
   *  Diagram i's cells occupy columns [colStart, colEnd] of the shared grid
   *  (later diagrams are offset right with one blank spacer column), and
   *  `sep` is the LaTeX separator emitted BEFORE this diagram (i > 0,
   *  e.g. "\quad \quad"). Absent for single-diagram graphs. */
  cdMulti?: { cdOptions?: string; colStart: number; colEnd: number; sep: string }[];
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

let uidCounter = 0;

export function makeId(graph: TikZGraph): string {
  return `o${graph.nextId++}_${++uidCounter}`;
}

/** Reset the id suffix counter. parseTikZ calls this so parsing the SAME
 *  code twice produces identical generated ids — without the reset the
 *  global counter leaked between parses and round-trips were not
 *  byte-stable (ellipse label names drifted: tkz_o5_1 vs tkz_o5_4). */
export function resetUidCounter(): void {
  uidCounter = 0;
}

/** Auto width of a text object in cm: widest LINE × 0.18, floored at 1.
 *  Single source of truth shared by the parser fallback, the generator's
 *  "was the box resized?" comparison and the INSERT finish handler (which
 *  used to use a different 0.19/char factor, forcing an explicit
 *  text width=… onto the code after every edit). */
export function textAutoWidth(text: string): number {
  const lines = text.split("\n");
  const maxLen = Math.max(...lines.map((l) => l.length), 1);
  return Math.max(1, maxLen * 0.18);
}

export function defaultGraph(width = 10, height = 8, env: "picture" | "cd" = "picture"): TikZGraph {
  return {
    width,
    height,
    title: "",
    env,
    axis: {
      enabled: false,
      type: "cartesian",
      style: "middle",
      xLabel: "x",
      yLabel: "y",
      step: 1,
    },
    grid: {
      enabled: false,
      step: 1,
      color: "gray!30",
      dashed: false,
    },
    objects: [],
    nextId: 1,
    preamble: "",
    rawSnippets: [],
  };
}

export function isShape(o: TikZObject): boolean {
  return o.type !== "arrow" && o.type !== "function" && o.type !== "text";
}

/** Exact drawn geometry of an object (no hit-area padding) — used for the
 *  outlines and the edit input box so they coincide with the render. */
export function exactObjectBounds(o: TikZObject): Bounds {
  switch (o.type) {
    case "text": {
      const w = o.width || textAutoWidth(o.text);
      return { left: o.x - w / 2, right: o.x + w / 2, top: o.y + 0.4, bottom: o.y - 0.4 };
    }
    case "rectangle":
      return { left: o.x - o.w / 2, right: o.x + o.w / 2, top: o.y + o.h / 2, bottom: o.y - o.h / 2 };
    case "square": {
      const h = o.size / 2;
      return { left: o.x - h, right: o.x + h, top: o.y + h, bottom: o.y - h };
    }
    case "circle":
      return { left: o.x - o.r, right: o.x + o.r, top: o.y + o.r, bottom: o.y - o.r };
    case "diamond": {
      const h = o.size / 2;
      return { left: o.x - h, right: o.x + h, top: o.y + h, bottom: o.y - h };
    }
    case "ellipse":
      return { left: o.x - o.rx, right: o.x + o.rx, top: o.y + o.ry, bottom: o.y - o.ry };
    case "arrow":
      return {
        left: Math.min(o.x1, o.x2),
        right: Math.max(o.x1, o.x2),
        top: Math.max(o.y1, o.y2),
        bottom: Math.min(o.y1, o.y2),
      };
    case "function":
      return {
        left: o.domain[0] + o.offsetX,
        right: o.domain[1] + o.offsetX,
        top: o.y + o.offsetY + 1.2,
        bottom: o.y + o.offsetY - 1.2,
      };
  }
}

export function objectBounds(o: TikZObject): Bounds {
  switch (o.type) {
    case "text": {
      const w = o.width || textAutoWidth(o.text);
      return { left: o.x - w / 2, right: o.x + w / 2, top: o.y + 0.4, bottom: o.y - 0.4 };
    }
    case "rectangle":
      return { left: o.x - o.w / 2, right: o.x + o.w / 2, top: o.y + o.h / 2, bottom: o.y - o.h / 2 };
    case "square": {
      const h = o.size / 2;
      return { left: o.x - h, right: o.x + h, top: o.y + h, bottom: o.y - h };
    }
    case "circle": {
      const r = o.r * 1.15;
      return { left: o.x - r, right: o.x + r, top: o.y + r, bottom: o.y - r };
    }
    case "diamond": {
      const h = o.size / 2;
      return { left: o.x - h, right: o.x + h, top: o.y + h, bottom: o.y - h };
    }
    case "ellipse": {
      return { left: o.x - o.rx, right: o.x + o.rx, top: o.y + o.ry, bottom: o.y - o.ry };
    }
    case "arrow": {
      return {
        left: Math.min(o.x1, o.x2),
        right: Math.max(o.x1, o.x2),
        top: Math.max(o.y1, o.y2),
        bottom: Math.min(o.y1, o.y2),
      };
    }
    case "function": {
      return {
        left: o.domain[0] + o.offsetX,
        right: o.domain[1] + o.offsetX,
        top: o.y + o.offsetY + 1.2,
        bottom: o.y + o.offsetY - 1.2,
      };
    }
  }
}

export function cloneGraph(g: TikZGraph): TikZGraph {
  return JSON.parse(JSON.stringify(g)) as TikZGraph;
}
