/**
 * Multi-function plot template.
 *
 * Extracted from the Functions panel so it can be unit-tested outside the
 * UI. The previous inline version escaped every backslash
 * (`expr.replace(/\\/g, "\\\\")`) which turned a LaTeX command such as
 * `\frac{1}{2}` into `\\frac{1}{2}` — a line break in TeX, i.e. broken
 * code. The expressions are inserted verbatim; the caller is responsible
 * for validating them.
 */

export const MULTI_PLOT_COLORS: string[] = [
  "red", "blue", "green", "orange", "purple", "teal", "magenta", "brown",
];

export interface MultiPlotOptions {
  /** x range of the plot */
  domain?: [number, number];
  /** number of samples per curve */
  samples?: number;
  /** extra lines inserted between the axes and the curves */
  preamble?: string[];
}

export function buildMultiPlotTemplate(exprs: string[], opts: MultiPlotOptions = {}): string {
  const domain = opts.domain ?? [0, 4];
  const samples = opts.samples ?? 100;
  const lines: string[] = [];
  lines.push("\\begin{document}");
  lines.push(`\\begin{tikzpicture}[domain=${domain[0]}:${domain[1]}]`);
  for (const l of opts.preamble ?? []) lines.push(l);
  lines.push(`\\draw[->] (0,0) -- (${domain[1] + 0.4},0) node[right] {$x$};`);
  lines.push(`\\draw[->] (0,0) -- (0,3.2) node[above] {$y$};`);
  exprs.forEach((e, i) => {
    const color = MULTI_PLOT_COLORS[i % MULTI_PLOT_COLORS.length];
    lines.push(`\\draw[${color}, samples=${samples}] plot (\\x,{${e}});`);
  });
  lines.push("\\end{tikzpicture}");
  lines.push("\\end{document}");
  return lines.join("\n");
}
