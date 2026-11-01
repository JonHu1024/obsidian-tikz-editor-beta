const fs = require("fs");
const path = require("path");
const root = "src/cd";
const dirs = ["img", "img/tools", "img/properties", "img/arrow"];
const lines = [
  "// Auto-generated icon map: svg -> data URL (esbuild inlines them)",
];
const files = [];
dirs.forEach((d) => {
  fs.readdirSync(path.join(root, d))
    .filter((f) => f.endsWith(".svg"))
    .forEach((f) => {
      const key = d + "/" + f;
      const bind = "i_" + d.replace(/[^a-zA-Z0-9]/g, "_") + "_" + f.replace(/[^a-zA-Z0-9]/g, "_");
      files.push({ bind, key });
    });
});
files.forEach(({ bind, key }) => {
  lines.push('import ' + bind + ' from "./' + key + '";');
});
lines.push("");
lines.push("export const ICONS: Record<string, string> = {");
files.forEach(({ bind, key }) => {
  lines.push('  "' + key + '": ' + bind + ",");
});
lines.push("};");
lines.push("");
lines.push("export function icon(p: string): string { return ICONS[p] ?? \"\"; }");
fs.writeFileSync(path.join(root, "icons.ts"), lines.join("\n"));
console.log(files.length + " icons");