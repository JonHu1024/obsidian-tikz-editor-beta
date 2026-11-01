import esbuild from "esbuild";
import { builtinModules } from "module";

await esbuild.build({
  entryPoints: ["test/engine-probe.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "test/engine-probe.js",
  external: ["obsidian", "electron", ...builtinModules],
  loader: { ".tikzjaxjs": "text" },
  logLevel: "error",
});
console.log("engine probe built");
