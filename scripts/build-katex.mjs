import fs from "fs";
import path from "path";

const dist = "node_modules/katex/dist";
const css = fs.readFileSync(path.join(dist, "katex.min.css"), "utf8");
const fontDir = path.join(dist, "fonts");

const replaced = css.replace(/url\(fonts\/([^)]+)\)/g, (m, name) => {
  const file = path.join(fontDir, name);
  if (!fs.existsSync(file)) {
    console.warn("missing font:", name);
    return m;
  }
  const b64 = fs.readFileSync(file).toString("base64");
  const ext = path.extname(name).slice(1);
  const mime = ext === "woff2" ? "font/woff2" : ext === "woff" ? "font/woff" : "font/ttf";
  return `url(data:${mime};base64,${b64})`;
});

fs.mkdirSync("src/core", { recursive: true });
fs.writeFileSync("src/core/katex-inline.css", replaced);
console.log("katex-inline.css written:", (replaced.length / 1024 / 1024).toFixed(2), "MB");
