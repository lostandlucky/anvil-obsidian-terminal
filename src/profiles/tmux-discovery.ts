export interface TmuxSession {
  name: string;
}

export interface TmuxDiscoveryResult {
  installed: boolean;
  tmuxPath: string | null;
  sessions: TmuxSession[];
}

export interface TmuxRunner {
  which(): Promise<string | null>;
  listSessions(): Promise<{ stdout: string; exitCode: number }>;
}

export function parseSessionNames(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

export async function discoverTmux(
  runner: TmuxRunner,
): Promise<TmuxDiscoveryResult> {
  const tmuxPath = await runner.which();
  if (!tmuxPath) {
    return { installed: false, tmuxPath: null, sessions: [] };
  }

  const listResult = await runner.listSessions();
  if (listResult.exitCode !== 0 || listResult.stdout.trim().length === 0) {
    return { installed: true, tmuxPath, sessions: [] };
  }

  const names = parseSessionNames(listResult.stdout);
  return {
    installed: true,
    tmuxPath,
    sessions: names.map((name) => ({ name })),
  };
}

export function createSystemTmuxRunner(): TmuxRunner {
  return {
    which: async () => {
      const { spawn } = await import("child_process");
      return new Promise<string | null>((resolve) => {
        const child = spawn("which", ["tmux"], { stdio: ["ignore", "pipe", "ignore"] });
        let out = "";
        child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf-8")));
        child.on("error", () => resolve(null));
        child.on("exit", (code) => {
          if (code !== 0) return resolve(null);
          const path = out.trim();
          resolve(path.length > 0 ? path : null);
        });
      });
    },
    listSessions: async () => {
      const { spawn } = await import("child_process");
      return new Promise((resolve) => {
        const child = spawn(
          "tmux",
          ["list-sessions", "-F", "#{session_name}"],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
        child.on("error", () => resolve({ stdout: "", exitCode: 1 }));
        child.on("exit", (code) => resolve({ stdout, exitCode: code ?? 1 }));
      });
    },
  };
}
