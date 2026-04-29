import * as path from "node:path";
import * as fs from "node:fs";
import { browser } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const BINARY_NAME = "pty-server";
const FONT_FILE = "SymbolsNerdFontMono.woff2";

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./tests/e2e/**/*.e2e.ts"],
  maxInstances: 1,

  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "1.12.7",
      "wdio:obsidianOptions": {
        installerVersion: "1.12.7",
        vault: "./tests/e2e/fixtures/vault",
        plugins: ["."],
      },
    },
  ],

  services: ["obsidian"],
  reporters: ["obsidian"],

  cacheDir: path.resolve(".obsidian-cache"),

  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },

  logLevel: "warn",

  before: async function () {
    // obsidian-launcher only copies manifest.json/main.js/styles.css into the
    // temp plugin dir; our Rust binary lives at bin/pty-server in the project
    // root and the bundled font lives at fonts/SymbolsNerdFontMono.woff2 —
    // both would otherwise be missing inside the test vault. Copy them in
    // alongside main.js so the e2e harness sees the same layout the release
    // zip will ship.
    const basePath = (await browser.execute(() => {
      type WithBasePath = { vault: { adapter: { basePath?: string } } };
      const adapter = (window as unknown as { app: WithBasePath }).app.vault.adapter;
      return adapter.basePath ?? null;
    })) as string | null;
    if (!basePath) return;
    const pluginRoot = path.join(basePath, ".obsidian", "plugins", PLUGIN_ID);

    const binDest = path.join(pluginRoot, "bin", BINARY_NAME);
    const binSrc = path.resolve(`bin/${BINARY_NAME}`);
    if (!fs.existsSync(binSrc)) {
      throw new Error(`pty-server binary missing at ${binSrc} — run npm run build first`);
    }
    fs.mkdirSync(path.dirname(binDest), { recursive: true });
    fs.copyFileSync(binSrc, binDest);
    fs.chmodSync(binDest, 0o755);

    const fontDest = path.join(pluginRoot, "fonts", FONT_FILE);
    const fontSrc = path.resolve(`fonts/${FONT_FILE}`);
    if (!fs.existsSync(fontSrc)) {
      throw new Error(`bundled font missing at ${fontSrc} — run npm run build first`);
    }
    fs.mkdirSync(path.dirname(fontDest), { recursive: true });
    fs.copyFileSync(fontSrc, fontDest);
  },
};
