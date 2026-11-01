import katex from "katex";

/**
 * Render text with math segments via KaTeX (left editor pseudo-render).
 *
 * Supported math delimiters:
 *   $$…$$   display math
 *   $…$     inline math
 *   \(…\)   inline math
 *   \[…\]   display math
 *
 * The previous implementation only understood `$…$`, so `$$x^2$$` was split
 * into a stray leading "$" + inline math + a stray trailing "$" — the
 * dollar signs were rendered as visible text next to the formula.
 */
export function renderMathText(text: string): string {
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) {
    return escapeHtml(text);
  }
  let html = "";
  for (const seg of splitMath(text)) {
    html += seg.math ? seg.html : escapeHtml(seg.text);
  }
  return html;
}

interface Segment {
  math: boolean;
  /** literal source (math === false) */
  text: string;
  /** rendered HTML (math === true) */
  html: string;
}

/** Split text into literal and math segments. */
function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ math: false, text: buf, html: "" });
      buf = "";
    }
  };
  const pushMath = (src: string, display: boolean) => {
    const body = src.trim();
    if (body === "") return;
    out.push({ math: true, text: body, html: renderMath(body, display) });
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && (text[i + 1] === "(" || text[i + 1] === "[")) {
      const close = text[i + 1] === "(" ? "\\)" : "\\]";
      const end = text.indexOf(close, i + 2);
      if (end > 0) {
        flush();
        pushMath(text.slice(i + 2, end), text[i + 1] === "[");
        i = end + 2;
        continue;
      }
    }
    if (ch === "$") {
      // display math first — $$…$$ must win over a single $
      if (text[i + 1] === "$") {
        const end = text.indexOf("$$", i + 2);
        if (end > 0) {
          flush();
          pushMath(text.slice(i + 2, end), true);
          i = end + 2;
          continue;
        }
      }
      const end = text.indexOf("$", i + 1);
      if (end > 0) {
        flush();
        pushMath(text.slice(i + 1, end), false);
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Render one math expression; falls back to the escaped source on error. */
function renderMath(src: string, display: boolean): string {
  const body = src.trim();
  if (body === "") return "";
  try {
    return katex.renderToString(body, {
      throwOnError: false,
      displayMode: display,
      output: "html",
    });
  } catch (e) {
    return escapeHtml(body);
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
