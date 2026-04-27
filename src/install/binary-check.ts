/**
 * Pure helpers for the startup-time pty-server binary check (R7 / AC9).
 *
 * The plugin's onload checks that `bin/pty-server` exists relative to its
 * own install directory. If not, it fires an Obsidian Notice + console.error
 * pointing the user at the install docs rather than crashing on first PTY
 * spawn. The plumbing lives in main.ts; the pure decision logic lives here
 * so it can be unit-tested without booting Obsidian.
 */

import * as path from "node:path";

/** Where the binary should land relative to a plugin install directory. */
export function resolveBundledBinaryPath(pluginDir: string): string {
  return path.join(pluginDir, "bin", "pty-server");
}

/** The notice message a user sees when the binary is missing on disk. */
export const MISSING_BINARY_NOTICE_MESSAGE =
  "Anvil Terminal: pty-server binary not found. " +
  "See docs/install.md for setup instructions.";

/** Decide whether to surface the missing-binary notice. Pure function so the
 *  call site in main.ts is testable end-to-end without booting Obsidian. */
export function shouldShowMissingBinaryNotice(input: {
  pluginDir: string;
  exists: (p: string) => boolean;
}): { show: boolean; checkedPath: string } {
  const checkedPath = resolveBundledBinaryPath(input.pluginDir);
  const show = !input.exists(checkedPath);
  return { show, checkedPath };
}
