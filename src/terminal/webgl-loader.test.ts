// Phase 1 (glyph-rendering) — unit tests for the WebGL renderer load path.
// Covers AC3 (graceful-degrade on init failure) and AC4 (onContextLoss
// wired to addon.dispose). The helper takes injectable factory + warn
// dependencies so we can simulate success / throw / context-loss without
// needing a real DOM or WebGL context.

import { describe, it, expect, vi } from "vitest";
import { tryLoadWebgl, type WebglLoaderAddon, type WebglLoaderTerminal } from "./webgl-loader";

interface FakeAddon {
  onContextLoss: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  activate: ReturnType<typeof vi.fn>;
}

function makeFakeAddon(): FakeAddon {
  return {
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
    activate: vi.fn(),
  };
}

function asAddon(fake: FakeAddon): WebglLoaderAddon {
  return fake as unknown as WebglLoaderAddon;
}

function makeFakeTerminal(loadAddonImpl?: (addon: WebglLoaderAddon) => void): {
  terminal: WebglLoaderTerminal;
  loadAddon: ReturnType<typeof vi.fn>;
} {
  const loadAddon = vi.fn(loadAddonImpl ?? (() => undefined));
  return {
    terminal: { loadAddon } as unknown as WebglLoaderTerminal,
    loadAddon,
  };
}

describe("tryLoadWebgl (Phase 1 — AC3, AC4)", () => {
  it("loads the addon onto the terminal when the factory succeeds", () => {
    const addon = makeFakeAddon();
    const { terminal, loadAddon } = makeFakeTerminal();
    const factory = vi.fn(() => asAddon(addon));

    const result = tryLoadWebgl({ terminal, factory });

    expect(result).not.toBeNull();
    expect(result?.addon).toBe(addon);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(loadAddon).toHaveBeenCalledWith(addon);
    expect(addon.onContextLoss).toHaveBeenCalledTimes(1);
  });

  it("warns once and returns null when the factory throws", () => {
    const { terminal, loadAddon } = makeFakeTerminal();
    const factory = vi.fn(() => {
      throw new Error("WebGL unavailable");
    });
    const warn = vi.fn();

    const result = tryLoadWebgl({ terminal, factory, warn });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("@xterm/addon-webgl");
    expect(loadAddon).not.toHaveBeenCalled();
  });

  it("warns once and returns null when terminal.loadAddon throws", () => {
    const addon = makeFakeAddon();
    const { terminal } = makeFakeTerminal(() => {
      throw new Error("activate failed");
    });
    const factory = vi.fn(() => asAddon(addon));
    const warn = vi.fn();

    const result = tryLoadWebgl({ terminal, factory, warn });

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("@xterm/addon-webgl");
  });

  it("wires onContextLoss so context-loss disposes the addon", () => {
    const handlers: Array<() => void> = [];
    const addon = makeFakeAddon();
    addon.onContextLoss.mockImplementation((handler: () => void) => {
      handlers.push(handler);
    });
    const { terminal } = makeFakeTerminal();
    const factory = vi.fn(() => asAddon(addon));

    tryLoadWebgl({ terminal, factory });

    expect(handlers.length).toBe(1);
    expect(addon.dispose).not.toHaveBeenCalled();

    handlers[0]?.();

    expect(addon.dispose).toHaveBeenCalledTimes(1);
  });
});
