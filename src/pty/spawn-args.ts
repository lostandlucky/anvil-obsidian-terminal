export interface SpawnArgsInput {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  shellArgs?: string[];
}

export function isLoginShellCapable(shellPath: string): boolean {
  const base = shellPath.split("/").pop() ?? "";
  return base === "zsh" || base === "bash" || base === "sh";
}

export function buildSpawnArgs(input: SpawnArgsInput): string[] {
  const args: string[] = [
    "--shell",
    input.shell,
    "--cwd",
    input.cwd,
    "--cols",
    String(input.cols),
    "--rows",
    String(input.rows),
  ];
  // Caller-supplied shellArgs suppress the implicit login flag (Option A,
  // slice 7). Revisit: should login-shell behavior be an explicit opt-in
  // flag instead of coupled to "did the caller pass shellArgs"?
  if (input.shellArgs && input.shellArgs.length > 0) {
    for (const a of input.shellArgs) {
      args.push(`--shell-arg=${a}`);
    }
  } else if (isLoginShellCapable(input.shell)) {
    args.push("--shell-arg=-l");
  }
  return args;
}
