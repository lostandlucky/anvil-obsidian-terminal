import esbuild from "esbuild";
import builtins from "builtin-modules";
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";

const production = process.argv.includes("production");

function copyBundledFont() {
  // Phase 1 (glyph-rendering) / D6: ship src/fonts/SymbolsNerdFontMono.woff2
  // at the bundle-root path `fonts/SymbolsNerdFontMono.woff2`. Mirrors the
  // bin/pty-server source-to-shipped pattern. The CSS @font-face references
  // `url("./fonts/SymbolsNerdFontMono.woff2")` so the file must land
  // adjacent to the bundled styles.css.
  const src = path.resolve("src/fonts/SymbolsNerdFontMono.woff2");
  const destDir = path.resolve("fonts");
  const dest = path.join(destDir, "SymbolsNerdFontMono.woff2");
  if (!existsSync(src)) {
    throw new Error(`bundled font missing at ${src}`);
  }
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
}

function buildPtyServer() {
  const env = { ...process.env };
  // Cargo lives at ~/.cargo/bin on this machine and may not be on PATH.
  if (!env.PATH || !env.PATH.includes(".cargo/bin")) {
    env.PATH = `${process.env.HOME}/.cargo/bin:${env.PATH ?? ""}`;
  }
  const result = spawnSync("cargo", ["build", "--release"], {
    cwd: path.resolve("pty-server"),
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`cargo build --release failed (exit ${result.status})`);
  }
  const src = path.resolve("pty-server/target/release/pty-server");
  const destDir = path.resolve("bin");
  const dest = path.join(destDir, "pty-server");
  if (!existsSync(src)) {
    throw new Error(`pty-server binary missing at ${src}`);
  }
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  // Strip the macOS quarantine bit so freshly-compiled binaries don't get
  // blocked by Gatekeeper. Codesigning is Phase 4.
  spawnSync("xattr", ["-d", "com.apple.quarantine", dest], { stdio: "ignore" });
}

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
  buildPtyServer();
  copyBundledFont();
  await jsContext.rebuild();
  await cssContext.rebuild();
  await jsContext.dispose();
  await cssContext.dispose();
} else {
  buildPtyServer();
  copyBundledFont();
  await jsContext.watch();
  await cssContext.watch();
}
