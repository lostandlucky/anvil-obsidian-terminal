export interface AnvilSettings {
  defaultShell: string;
  userShellList: string[];
  preserveTmuxDimensions: boolean;
}

export const DEFAULT_SETTINGS: AnvilSettings = {
  defaultShell: "",
  userShellList: [],
  preserveTmuxDimensions: false,
};

export function normalizeSettings(input: unknown): AnvilSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;

  const defaultShell =
    typeof src.defaultShell === "string"
      ? src.defaultShell
      : DEFAULT_SETTINGS.defaultShell;

  const userShellList = Array.isArray(src.userShellList)
    ? (src.userShellList.filter((s) => typeof s === "string") as string[])
    : [...DEFAULT_SETTINGS.userShellList];

  const preserveTmuxDimensions =
    typeof src.preserveTmuxDimensions === "boolean"
      ? src.preserveTmuxDimensions
      : DEFAULT_SETTINGS.preserveTmuxDimensions;

  return { defaultShell, userShellList, preserveTmuxDimensions };
}
