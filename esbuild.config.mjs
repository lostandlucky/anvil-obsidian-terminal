import esbuild from "esbuild";
import builtins from "builtin-modules";

const production = process.argv.includes("production");

const sharedExternal = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  ...builtins,
];

const jsContext = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: sharedExternal,
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

const cssContext = await esbuild.context({
  entryPoints: ["src/styles.css"],
  bundle: true,
  outfile: "styles.css",
  logLevel: "info",
  minify: production,
});

if (production) {
  await jsContext.rebuild();
  await cssContext.rebuild();
  await jsContext.dispose();
  await cssContext.dispose();
} else {
  await jsContext.watch();
  await cssContext.watch();
}
