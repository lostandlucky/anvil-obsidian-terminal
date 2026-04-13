import * as path from "node:path";

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
};
