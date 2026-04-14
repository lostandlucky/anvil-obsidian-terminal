export interface DiscoveredShell {
  path: string;
  name: string;
}

export interface ShellDiscoveryInput {
  envShell: string | undefined;
  userShells: string[];
  exists: (path: string) => boolean;
}

export const WELL_KNOWN_SHELLS = ["bash", "zsh", "fish", "nu", "sh"] as const;

export const WELL_KNOWN_PATHS = [
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
] as const;

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function discoverShells(input: ShellDiscoveryInput): DiscoveredShell[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const add = (p: string) => {
    if (seen.has(p)) return;
    if (!input.exists(p)) return;
    seen.add(p);
    ordered.push(p);
  };

  if (input.envShell) add(input.envShell);

  for (const dir of WELL_KNOWN_PATHS) {
    for (const name of WELL_KNOWN_SHELLS) {
      add(`${dir}/${name}`);
    }
  }

  for (const p of input.userShells) add(p);

  return ordered.map((p) => ({ path: p, name: basename(p) }));
}
