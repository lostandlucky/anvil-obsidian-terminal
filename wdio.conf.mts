import * as path from "node:path";
import * as fs from "node:fs";
import { browser } from "@wdio/globals";

const PLUGIN_ID = "anvil-obsidian-terminal";
const BINARY_NAME = "pty-server";

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
    // root and would otherwise be missing inside the test vault. Copy it in
    // alongside main.js so TerminalView.resolveBinaryPath() finds it.
    const basePath = (await browser.execute(() => {
      type WithBasePath = { vault: { adapter: { basePath?: string } } };
      const adapter = (window as unknown as { app: WithBasePath }).app.vault.adapter;
      return adapter.basePath ?? null;
    })) as string | null;
    if (!basePath) return;
    const dest = path.join(basePath, ".obsidian", "plugins", PLUGIN_ID, "bin", BINARY_NAME);
    const src = path.resolve(`bin/${BINARY_NAME}`);
    if (!fs.existsSync(src)) {
      throw new Error(`pty-server binary missing at ${src} — run npm run build first`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
  },
};
