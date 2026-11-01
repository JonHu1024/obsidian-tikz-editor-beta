/**
 * tikz-cd text normalization helpers.
 *
 * tikz-cd typesets every cell/label in math mode, so wrapping delimiters
 * ($...$, \(...\), \[...\], {...}) are redundant: in the compiled output the
 * delimiters would show up as literal characters. The editor (KaTeX), the
 * parser and the generator all normalize them away so labels/cells render as
 * clean math and the generated code round-trips without visible delimiters.
 */

function isUnescaped(s: string, i: number): boolean {
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) backslashes++;
  return backslashes % 2 === 0;
}

/** True when t opens with "{" and that brace closes exactly at the last
 *  character (depth scan; escaped braces skipped). First/last-char heuristics
 *  alone misfire on strings like "{a},{b}". */
function outerBraceWraps(t: string): boolean {
  if (t.length < 2 || t[0] !== "{" || !isUnescaped(t, 0)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "{" && isUnescaped(t, i)) depth++;
    else if (t[i] === "}" && isUnescaped(t, i)) {
      depth--;
      if (depth === 0) return i === t.length - 1;
      if (depth < 0) return false;
    }
  }
  return false;
}

/** Strip one level of wrapping math/text delimiters ($...$, \(...\), \[...\],
 *  {...}). Escaped delimiters (\$ \{ \}) are left alone. Applied repeatedly
 *  so `{${`$x$`}}` style nesting collapses completely. */
export function cleanMathText(s: string): string {
  let t = s.trim();
  for (let iter = 0; iter < 3; iter++) {
    const before = t;
    const n = t.length;
    if (n >= 4 && t.startsWith("\\(") && t.endsWith("\\)")) t = t.slice(2, n - 2).trim();
    else if (n >= 4 && t.startsWith("\\[") && t.endsWith("\\]")) t = t.slice(2, n - 2).trim();
    else if (n >= 4 && t.startsWith("$$") && t.endsWith("$$")) t = t.slice(2, n - 2).trim();
    else if (n >= 2 && t[0] === "$" && t[n - 1] === "$" && isUnescaped(t, 0) && isUnescaped(t, n - 1)) t = t.slice(1, n - 1).trim();
    else if (outerBraceWraps(t)) t = t.slice(1, n - 1).trim();
    else break;
    if (t === before) break;
  }
  return t;
}

/** Wrap a quoted tikz-cd label in {..} when it contains characters pgfkeys
 *  treats specially (comma splits the option list, = key/value, ; list
 *  separator), unless it is already fully braced. */
export function wrapCdLabel(text: string): string {
  if (/[,;=]/.test(text) && !outerBraceWraps(text)) return `{${text}}`;
  return text;
}
