import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import { builtinModules } from "module";

await esbuild.build({
  entryPoints: ["test/harness.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "test/harness.js",
  external: ["obsidian", "electron", ...builtinModules],
  loader: { ".tikzjaxjs": "text", ".css": "text", ".svg": "dataurl", ".js": "jsx" },
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
  logLevel: "warning",
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      compilerOptions: { dev: false, css: "injected" },
    }),
  ],
});
console.log("harness built");
