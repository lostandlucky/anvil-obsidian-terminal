# Phase 0 Audit: wdio-obsidian-service

**Package:** `wdio-obsidian-service`
**Version audited:** `3.0.2` (latest on npm as of 2026-04-13)
**Source commit:** `555750b6317429af4e49bf10eb60bf2e539fc2cb`
**Repo:** https://github.com/jesse-r-s-hines/wdio-obsidian-service
**License:** MIT
**Maintainer:** `jesse-r-s-hines` (sole maintainer, one additional contributor; actively maintained — latest commit 2026-04-05)

## 1. What it downloads, and from where

- **Obsidian app (`obsidian-*.asar.gz`):** from `github.com/obsidianmd/obsidian-releases/releases/download/...` (official).
- **Obsidian installer (DMG / AppImage / EXE):** same GitHub release URL.
- **ChromeDriver for Electron:** via `@electron/get`, from official Electron releases.
- **Version metadata:** `raw.githubusercontent.com/jesse-r-s-hines/wdio-obsidian-service/HEAD/obsidian-versions.json` (the author's repo).
- **Community plugins/themes list** (only if used): `raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json` and the themes equivalent.
- **Obsidian Insider builds:** from `releases.obsidian.md` — **requires authentication**. Not applicable to us (we will not use Insider).

All downloads are HTTPS. No telemetry, no requests to third-party domains, no auto-update.

## 2. Binary verification

- **HTTPS only.** No signature verification.
- `obsidian-versions.json` **contains SHA256 digests** (e.g. `"digest": "sha256:..."`) for installers, but the current code **does not validate them at download time**. This is the sharpest edge in the package.
- On macOS, `xattr` is used to strip the quarantine bit from the extracted binary (necessary for launching a downloaded DMG non-interactively, but it bypasses Gatekeeper's first-run check).

## 3. Writes outside the project directory

- **`~/.obsidian-cache/`** — cached Obsidian binaries, plugins, themes, ChromeDriver. Persists across runs (intentional, for performance). Location is overridable via `OBSIDIAN_CACHE` env var.
- **System tmpdir** — per-session Obsidian config dirs (`obsidian-launcher-config-*`) and vault copies. **Cleaned up in `afterSession()`.**
- **`~/.obsidian-cache/obsidian-credentials.env`** — *only* if the user opts into Insider + interactive mode. Plaintext dotenv. **Not applicable to us.**

No writes to `/etc`, no sudo, no launchd, no LaunchAgents.

## 4. Lifecycle hooks

- **No `postinstall` / `preinstall` / `postuninstall` scripts** in any package.json. Installing the npm package does not execute code.
- Execution happens only when wdio runs:
  - `onPrepare()` — downloads binaries if not cached.
  - `onWorkerStart()` — spawns Obsidian (`child_process.spawn`) with `--user-data-dir`.
  - `afterSession()` — cleans up tmp dirs.
- Child process spawns beyond Obsidian itself: `hdiutil` (DMG mount on macOS), `xattr` (quarantine strip), `7z-wasm` (archive extraction). All limited to setup of downloaded Obsidian installer.
- **No `eval`, no `new Function`, no dynamic code execution.**

## 5. Other observations

- Dependencies are small and reputable: `lodash`, `semver`, `tar`, `7z-wasm`, `@electron/get`.
- Active maintenance, zero open issues at audit time, 41 stars, MIT.
- Sole-maintainer bus factor remains — that's a project-level concern, already acknowledged in `../testing-approach.md` and `CLAUDE.md`.

## Risk summary

| Concern | Severity | Mitigation in our use |
|---|---|---|
| Checksums present but not validated in code | Medium | Accept: downloads are HTTPS from GitHub and Obsidian's own domain; we pin exact versions so the attack surface is "did someone compromise the GitHub release or MITM GitHub's TLS." |
| `xattr` strips macOS quarantine on the Obsidian binary | Low | Necessary for headless launch; same binary the user already runs every day. |
| `~/.obsidian-cache` persists binaries outside the project | Low | Documented. Override with `OBSIDIAN_CACHE=./.obsidian-cache` in env if we want it project-local. |
| Insider/interactive mode stores plaintext creds | N/A | We will not use Insider. |
| Sole-maintainer bus factor | Already accepted | Documented in `../testing-approach.md`. |

## Verdict — APPROVED by Steve (2026-04-13)

**CONDITIONAL SAFE to adopt**, with these conditions applied at setup time:

1. Pin `wdio-obsidian-service` and the Obsidian test binary to exact versions (already a spec requirement).
2. Do not enable Obsidian Insider / interactive mode. Never pass credentials.
3. Set `OBSIDIAN_CACHE` to a project-local path (e.g. `./.obsidian-cache`, git-ignored) so cached binaries don't accumulate in `$HOME`. This also makes the harness fully self-contained and easier to nuke if it gets into a bad state.
4. Accept the "checksums present but unvalidated" gap. The trust boundary is GitHub's HTTPS to the official Obsidian release repo, which is the same boundary we'd accept if we downloaded Obsidian by hand. Revisit if upstream adds hash validation.
5. Re-audit on every version bump (Dependabot PR). The diff between pinned versions is the review surface.

**Reasoning:** This is a legitimately useful package with clean install semantics (no postinstall!), no telemetry, no unexpected network, and it confines disk state to a known, overridable cache dir. The unvalidated-checksum gap is a real finding but it's proportionate to "we're running a community test harness that launches Obsidian," not "we're running it against production data." The conditions above bring the residual risk below the threshold where the harness is worth having at all.

---

**Status:** Audit complete and approved. Phase 0 proceeds to installing the package with the four conditions above.

## Post-install notes (2026-04-13)

After `npm install`, `npm audit` reports **6 high-severity transitive vulnerabilities**, all resolving to two root causes:

- **lodash** (via `obsidian-launcher` → `wdio-obsidian-service`). CVEs are `_.template` code injection and `_.unset/_.omit` prototype pollution. Both require an attacker to feed malicious input into those specific lodash functions. In our use path — parsing trusted Obsidian release metadata in a local test run — neither is reachable.
- **serialize-javascript** (via `mocha`). RCE via `RegExp.flags` and a DoS via crafted array-likes. Only matters if you're serializing untrusted data to JS strings, which mocha's test runner does not do against anything we control.

**Assessment: accepted.** These are the sort of "high severity on paper, not reachable in our threat model" findings that `npm audit` surfaces routinely for dev tooling. Re-check on each Dependabot bump — if upstream ever updates `lodash` or the `serialize-javascript` chain, take the fix.

Additionally, a handful of `npm warn EBADENGINE` warnings appeared from `@jest/*` packages (transitive) declaring support for Node `18/20/22/24+` but not `23.x`. Node 23 is a non-LTS odd version; the warnings are cosmetic — nothing actually breaks. Worth revisiting when we consider moving the project to Node 22 LTS or 24 LTS.
