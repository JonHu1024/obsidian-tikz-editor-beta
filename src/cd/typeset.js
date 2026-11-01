import katex from "katex";
import { cleanMathText } from "../core/texText";

/**
 * Stand-in for the MathJax API that tikzcd-editor's components use
 * (typesetPromise / typesetClear / startup.promise). Renders TeX with KaTeX
 * so the vendored Preact UI works without loading MathJax.
 *
 * The components import this stub DIRECTLY (never window.MathJax): if a
 * foreign MathJax global exists (e.g. the Obsidian MathJax plugin), real
 * MathJax v3 only typesets delimited math ($...$) — undelimited cell text
 * like `X \times_Z Y` would stay as raw LaTeX forever.
 *
 * KaTeX output lives in a `.cd-math` span inside the value div so the
 * components can measure it the same way they measured `mjx-container`.
 */
export const MathJax = {
  startup: {
    promise: Promise.resolve(),
    defaultReady() {},
  },
  typesetClear() {
    // no-op: Preact replaces the raw-text child node on value changes, so a
    // stale .cd-math wrapper never co-exists with new text; nothing to clear.
  },
  typesetPromise(elements) {
    for (const el of elements) {
      if (!el) continue;
      // Typeset the .cd-math span (rendered keyed by the value, so Preact
      // replaces it on every change) instead of the managed value div —
      // overwriting innerHTML on the div would desync Preact's VDOM and
      // freeze the label at its first rendered value.
      let target = el;
      if (!el.classList || !el.classList.contains("cd-math")) {
        const inner = el.querySelector(".cd-math");
        if (inner) target = inner;
      }
      // Re-typesets (selection moves, hover states, …) must render the RAW
      // source, not the previous KaTeX output: textContent of a rendered
      // span is glyphs ("∑i=1nxi"), and rendering that again would mangle
      // the formula (lose braces/limits). The source is stashed in
      // data-tex on the first pass; a fresh span (new value) has none and
      // falls back to its own text.
      const raw = (target.getAttribute("data-tex") ?? (target.textContent || "")).trim();
      // Cells/labels may carry redundant math/text wrappers ($...$, \(...\),
      // {...}) that tikz-cd would print literally; normalize them away so
      // the on-canvas KaTeX preview matches the compiled output.
      const tex = cleanMathText(raw);
      let html = "";
      try {
        html = katex.renderToString(tex, { throwOnError: false, displayMode: false, output: "html" });
      } catch (e) {
        html = `<span style="color:#c00">${tex}</span>`;
      }
      target.setAttribute("data-tex", raw);
      target.innerHTML = html;
    }
    return Promise.resolve();
  },
};

export function renderMath(tex) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: false, output: "html" });
  } catch (e) {
    return tex;
  }
}