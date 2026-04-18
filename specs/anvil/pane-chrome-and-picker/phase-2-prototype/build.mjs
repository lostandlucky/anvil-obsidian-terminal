// Self-contained esbuild for the Phase 2 prototype. Deliberately separate
// from the main plugin's esbuild.config.mjs — the prototype is not shipped.
//
// Usage:
//   node build.mjs            # one-shot build
//   node build.mjs --watch    # watch mode
//
// Output: main.js + styles.css in this directory, alongside manifest.json.
// The prototype plugin folder (this directory) is meant to be symlinked into
// <vault>/.obsidian/plugins/anvil-prototype-container/.

import esbuild from "esbuild";
import builtins from "builtin-modules";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const external = [
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

const js = await esbuild.context({
  entryPoints: [path.join(__dirname, "main.ts")],
  bundle: true,
  external,
  format: "cjs",
  target: "es2022",
  platform: "node",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: true,
  outfile: path.join(__dirname, "main.js"),
});

const cssSrc = path.join(__dirname, "styles.css");
const cssDst = path.join(__dirname, "styles.css.out.css");
// The prototype's styles.css is hand-written, not bundled from a source CSS
// entrypoint. Obsidian looks for styles.css at the plugin root, which already
// exists. We only need esbuild for the JS bundle. Skip CSS bundling.
if (fs.existsSync(cssDst)) fs.unlinkSync(cssDst);

if (watch) {
  await js.watch();
  console.log("[anvil-proto] watching for changes...");
} else {
  await js.rebuild();
  await js.dispose();
  console.log("[anvil-proto] built main.js");
}
