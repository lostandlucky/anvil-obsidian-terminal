// Phase 2 Part 2 wdio config — loads BOTH the main plugin and the Phase 2
// prototype plugin, runs only the prototype's e2e specs. Kept separate from
// wdio.conf.mts so the default test suite is unaffected.
//
// Pre-condition: `cd specs/anvil/pane-chrome-and-picker/phase-2-prototype && node build.mjs`
// must have produced main.js. This config asserts that at module load time
// so the failure is clearly-scoped, not a mid-run wdio error.

import * as path from "node:path";
import * as fs from "node:fs";
import { browser } from "@wdio/globals";

const MAIN_PLUGIN_ID = "anvil-obsidian-terminal";
const BINARY_NAME = "pty-server";
const PROTO_DIR = "./specs/anvil/pane-chrome-and-picker/phase-2-prototype";
const PROTO_MAIN_JS = path.resolve(PROTO_DIR, "main.js");

if (!fs.existsSync(PROTO_MAIN_JS)) {
  throw new Error(
    [
      "[wdio.proto.conf] Prototype is not built.",
      `Missing: ${PROTO_MAIN_JS}`,
      "",
      "Build the prototype first:",
      `  cd ${PROTO_DIR} && node build.mjs`,
      "",
      "Then re-run: npm run test:e2e:proto",
    ].join("\n"),
  );
}

export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./specs/anvil/pane-chrome-and-picker/phase-2-prototype/**/*.e2e.ts"],
  maxInstances: 1,

  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: "1.12.7",
      "wdio:obsidianOptions": {
        installerVersion: "1.12.7",
        vault: "./tests/e2e/fixtures/vault",
        // Load the main plugin (for pty-server coexistence + realistic
        // layout) and the prototype plugin (the subject of Part 2).
        plugins: [".", PROTO_DIR],
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
    // obsidian-launcher copies manifest.json / main.js / styles.css for each
    // plugin, but the main plugin's Rust pty-server binary is not one of
    // those three files. Copy it in alongside main.js so any code path that
    // resolves a pty binary — whether via the main plugin or via the
    // prototype's shared-binary resolver — finds it.
    const basePath = (await browser.execute(() => {
      type WithBasePath = { vault: { adapter: { basePath?: string } } };
      const adapter = (window as unknown as { app: WithBasePath }).app.vault.adapter;
      return adapter.basePath ?? null;
    })) as string | null;
    if (!basePath) return;
    const dest = path.join(
      basePath,
      ".obsidian",
      "plugins",
      MAIN_PLUGIN_ID,
      "bin",
      BINARY_NAME,
    );
    const src = path.resolve(`bin/${BINARY_NAME}`);
    if (!fs.existsSync(src)) {
      throw new Error(
        `pty-server binary missing at ${src} — run npm run build first`,
      );
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);
  },
};
