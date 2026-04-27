// Pure tmux argv-construction helpers. Decisions live here so picker
// dispatch in main.ts stays a thin glue layer (AC6/AC7, R5/R7).

import type { TmuxSessionNameFormat } from "../settings/settings";

export interface BuildAttachInput {
  sessionName: string;
  /** Cols read from `xtermHost.terminal.cols` at click-time. */
  cols: number;
  /** Rows read from `xtermHost.terminal.rows` at click-time. */
  rows: number;
  /** R7 — when true, append -x/-y to keep the session at the pane size. */
  preserveTmuxDimensions: boolean;
}

export function buildTmuxAttachArgs(input: BuildAttachInput): string[] {
  const args = ["attach-session", "-t", input.sessionName];
  if (input.preserveTmuxDimensions && input.cols > 0 && input.rows > 0) {
    args.push("-x", String(input.cols), "-y", String(input.rows));
  }
  return args;
}

export interface BuildNewSessionInput {
  tmuxSessionNameFormat: TmuxSessionNameFormat;
  /** All currently-known tmux session names — used for obsidian-prefix
   *  auto-incrementing. */
  existingNames: readonly string[];
}

export function buildTmuxNewSessionArgs(input: BuildNewSessionInput): string[] {
  if (input.tmuxSessionNameFormat === "obsidian-prefix") {
    return ["new-session", "-s", nextObsidianSessionName(input.existingNames)];
  }
  // 'integer' — let tmux assign its default integer name. (Current behavior.)
  return ["new-session"];
}

/** "obsidian-N" with N = (max existing obsidian-K) + 1, or 0 when none. */
export function nextObsidianSessionName(
  existingNames: readonly string[],
): string {
  let max = -1;
  for (const name of existingNames) {
    const m = /^obsidian-(\d+)$/.exec(name);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `obsidian-${max + 1}`;
}
