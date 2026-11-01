import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import sveltePreprocess from "svelte-preprocess";
import process from "process";
import { builtinModules } from "module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  loader: {
    ".tikzjaxjs": "text",
    ".css": "text",
    ".svg": "dataurl",
    ".js": "jsx",
  },
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      compilerOptions: { dev: !prod, css: "injected" },
    }),
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
