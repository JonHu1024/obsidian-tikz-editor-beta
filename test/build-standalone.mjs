import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { builtinModules } from "module";

await esbuild.build({
  entryPoints: ["test/standalone.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "test/standalone.js",
  external: ["obsidian", "electron", ...builtinModules],
  loader: { ".tikzjaxjs": "text", ".css": "text" },
  logLevel: "error",
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      compilerOptions: { dev: false, css: "injected" },
    }),
  ],
});
console.log("standalone built");
