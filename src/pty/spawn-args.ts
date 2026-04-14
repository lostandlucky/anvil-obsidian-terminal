export interface SpawnArgsInput {
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
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
  if (isLoginShellCapable(input.shell)) {
    args.push("--shell-arg=-l");
  }
  return args;
}
