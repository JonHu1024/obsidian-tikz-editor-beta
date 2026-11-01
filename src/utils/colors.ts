export const NAMED_COLORS: string[] = [
  "red", "blue", "green", "yellow", "black", "gray", "white",
  "orange", "purple", "cyan", "magenta", "brown", "lime", "olive",
  "teal", "violet", "pink", "darkgray", "lightgray", "blue!50", "red!50", "green!50",
];

/** The xcolor base names the editor knows how to preview. */
export const COLOR_RGB: Record<string, [number, number, number]> = {
  red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], yellow: [255, 255, 0],
  black: [0, 0, 0], gray: [128, 128, 128], white: [255, 255, 255], orange: [255, 165, 0],
  purple: [128, 0, 128], cyan: [0, 255, 255], magenta: [255, 0, 255], brown: [165, 42, 42],
  lime: [0, 255, 0], olive: [128, 128, 0], teal: [0, 128, 128], violet: [238, 130, 238],
  pink: [255, 192, 203], darkgray: [64, 64, 64], lightgray: [211, 211, 211],
};

/** Is `name` a colour the generated LaTeX can actually compile?
 *
 *  xcolor accepts a base name from its palette, an optional "name!NN" blend
 *  and (with the `dvipsnames`/`x11` options) more exotic names. An unknown
 *  base name makes pgf fail with "Undefined color", which breaks the whole
 *  tikz block in the note — so the custom colour input validates before it
 *  is written into the model. */
export function isValidColor(name: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(n)) return true;
  const m = n.match(/^([a-zA-Z]+)(!(\d{1,2}))?$/);
  if (!m) return false;
  const base = m[1].toLowerCase();
  if (!(base in COLOR_RGB)) return false;
  if (m[3] !== undefined) {
    const p = parseInt(m[3], 10);
    if (p < 0 || p > 100) return false;
  }
  return true;
}

export function colorHex(name: string): string {
  // a hex value is used as-is
  const hex = normalizeHex(name);
  if (hex) return hex;
  const m = (name ?? "").trim().match(/^([a-zA-Z]+)!(\d+)$/);
  const base = m ? m[1].toLowerCase() : (name ?? "").trim().toLowerCase();
  const pctRaw = m ? parseInt(m[2], 10) / 100 : 1;
  const pct = Math.min(1, Math.max(0, pctRaw));
  const c = COLOR_RGB[base] ?? [0, 0, 0];
  // tikz "x!N" = N parts of x mixed into (100-N) parts of WHITE — mixing
  // toward black made every blended preview systematically too dark
  return `#${c.map((v) => Math.round(v * pct + 255 * (1 - pct)).toString(16).padStart(2, "0")).join("")}`;
}

/** Expand #rgb → #rrggbb (xcolor's HTML model wants six digits). */
export function normalizeHex(name: string): string | null {
  const n = (name ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(n)) return n;
  if (/^#[0-9a-f]{3}$/.test(n)) {
    return "#" + n[1] + n[1] + n[2] + n[2] + n[3] + n[3];
  }
  return null;
}

export const SHAPES: { name: string; label: string }[] = [
  { name: "rectangle", label: "Rectangle" },
  { name: "square", label: "Square" },
  { name: "circle", label: "Circle" },
  { name: "diamond", label: "Diamond" },
  { name: "ellipse", label: "Ellipse" },
];
