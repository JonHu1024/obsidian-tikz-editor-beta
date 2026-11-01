const fs = require("fs");
const path = require("path");
const dir = "src/cd";

// Properties.js: icon=".../img/properties/x.svg" -> icon={icon("properties/x.svg")}
let p = fs.readFileSync(path.join(dir, "Properties.js"), "utf8");
const before = p;
p = p.replace(
  /icon="\.\/img\/properties\/([a-z]+\.svg)"/g,
  (m, f) => `icon={icon("properties/${f}")}`
);
p = p.replace(
  /icon={`\.\/img\/properties\/\$\{([^}]+)\}\.svg`}/g,
  (m, inner) => `icon={icon("properties/" + ${inner} + ".svg")}`
);
fs.writeFileSync(path.join(dir, "Properties.js"), p);
console.log("Properties.js patched:", before !== p ? "changed" : "UNCHANGED");
