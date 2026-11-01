import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["tikzjax-src/TikZJax.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "tikzjax-src/tikzjax-renderer.js",
  platform: "browser",
  logLevel: "error",
  define: { global: "globalThis" },
  alias: {
    stream: "stream-browserify",
    process: "process/browser",
  },
});
console.log("tikzjax-renderer built");
