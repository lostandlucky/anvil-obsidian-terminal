# How to run the tests

You want to run the unit suite, the end-to-end suite, or both.

## Prerequisites

- `npm install` has been run.
- For e2e: macOS arm64 and an internet connection on first run (the Obsidian test binary downloads into `.obsidian-cache/`).

## Run everything

```bash
npm test
```

This runs `npm run test:unit` followed by `npm run test:e2e`. Full suite takes about 5 seconds after the Obsidian binary is cached. The e2e step rebuilds the plugin first — you don't need to `npm run build` separately.

## Run only the unit tests

```bash
npm run test:unit
```

Vitest runs every `*.test.ts` under `src/` and `tests/unit/`. No build step, no Obsidian binary, fast.

## Run only the e2e tests

```bash
npm run test:e2e
```

This rebuilds the plugin, then runs `wdio run ./wdio.conf.mts`, which launches a real Obsidian instance against the fixture vault at `tests/e2e/fixtures/vault/` with the plugin pre-installed. The e2e suite covers plugin load, command registration, terminal rendering, ANSI handling, the hotkey guard, and clean reopen.

## First-run notes

The first e2e run downloads the pinned Obsidian binary (currently 1.12.7 — see `wdio.conf.mts`) into `.obsidian-cache/`. This takes a minute or two on a typical connection and then never repeats unless you delete the cache.

The pinned versions of `wdio-obsidian-service` and the Obsidian binary are intentional. See `CLAUDE.md` for the maintenance cadence — pinned dependencies need to be reviewed at the start of each phase, not silently bumped.

## When a test fails

- **A unit test fails:** standard vitest output points at the file and line. Re-run with `npx vitest run <pattern>` to scope to one file.
- **An e2e test fails:** wdio prints the assertion plus an Obsidian log path. The Obsidian instance is sandboxed under a temp `user-data-dir`, so failures don't pollute your real Obsidian profile.
- **The Obsidian binary refuses to launch:** delete `.obsidian-cache/` and re-run. The download is idempotent.

## Related

- The testing philosophy lives in [`specs/anvil/testing-approach.md`](../../specs/anvil/testing-approach.md). Read that before adding new tests.
