// Unit tests for the bundled-font loader. These hit the path that
// previous tests didn't: actually constructing a FontFace from bytes,
// awaiting load(), and ensuring the face reaches "loaded" status before
// we call it ok. Prior font tests checked CSS rule presence, file
// existence on disk, and font-family string contents — none of those
// touched the load path.

import { describe, it, expect, vi } from "vitest";
import {
  bundledFontAbsPath,
  loadBundledFont,
  type BundledFontDeps,
  type BundledFontFaceLike,
} from "./bundled-font";

class FakeFontFace implements BundledFontFaceLike {
  public status = "unloaded";
  public family: string;
  public source: ArrayBuffer | ArrayBufferView;
  public descriptors: { display?: string; unicodeRange?: string } | undefined;
  constructor(
    family: string,
    source: ArrayBuffer | ArrayBufferView,
    descriptors?: { display?: string; unicodeRange?: string },
  ) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }
  async load(): Promise<unknown> {
    this.status = "loaded";
    return this;
  }
}

class FailingLoadFontFace extends FakeFontFace {
  override async load(): Promise<unknown> {
    this.status = "error";
    throw new Error("network error");
  }
}

class StaysUnloadedFontFace extends FakeFontFace {
  override async load(): Promise<unknown> {
    // Simulate a browser that resolves load() but leaves status flat —
    // the symptom we observed in production with the broken @font-face.
    return this;
  }
}

function makeDeps(overrides: Partial<BundledFontDeps> = {}): {
  deps: BundledFontDeps;
  added: BundledFontFaceLike[];
  warns: string[];
} {
  const added: BundledFontFaceLike[] = [];
  const warns: string[] = [];
  const okBytes = new ArrayBuffer(16);
  const deps: BundledFontDeps = {
    readBytes: () => okBytes,
    fontFaceCtor: FakeFontFace,
    documentFonts: {
      add: (f) => {
        added.push(f);
      },
    },
    warn: (m) => {
      warns.push(m);
    },
    ...overrides,
  };
  return { deps, added, warns };
}

describe("bundledFontAbsPath", () => {
  it("joins pluginDir with the relative font path", () => {
    expect(bundledFontAbsPath("/path/to/plugin")).toBe(
      "/path/to/plugin/fonts/SymbolsNerdFontMono.woff2",
    );
  });

  it("handles a trailing slash on pluginDir", () => {
    expect(bundledFontAbsPath("/path/to/plugin/")).toBe(
      "/path/to/plugin/fonts/SymbolsNerdFontMono.woff2",
    );
  });
});

describe("loadBundledFont", () => {
  it("returns ok=true and adds the face to document.fonts on success", async () => {
    const { deps, added, warns } = makeDeps();
    const result = await loadBundledFont("/plugin", deps);
    expect(result.ok).toBe(true);
    expect(result.face).toBeDefined();
    expect(added.length).toBe(1);
    expect(added[0]).toBe(result.face);
    expect(warns).toEqual([]);
  });

  it("passes the correct FontFace descriptors (display + unicode-range)", async () => {
    const captured: Array<{
      family: string;
      source: ArrayBuffer | ArrayBufferView;
      descriptors?: { display?: string; unicodeRange?: string };
    }> = [];
    const ctor = function (
      family: string,
      source: ArrayBuffer | ArrayBufferView,
      descriptors?: { display?: string; unicodeRange?: string },
    ) {
      captured.push({ family, source, descriptors });
      return new FakeFontFace(family, source, descriptors);
    } as unknown as BundledFontDeps["fontFaceCtor"];

    const { deps } = makeDeps({ fontFaceCtor: ctor });
    await loadBundledFont("/plugin", deps);

    expect(captured.length).toBe(1);
    expect(captured[0].family).toBe("Symbols Nerd Font Mono");
    expect(captured[0].descriptors?.display).toBe("block");
    expect(captured[0].descriptors?.unicodeRange).toContain("U+2500-259F");
    expect(captured[0].descriptors?.unicodeRange).toContain("U+F0001-F1AF0");
  });

  it("warns and returns ok=false when readBytes throws", async () => {
    const { deps, added, warns } = makeDeps({
      readBytes: () => {
        throw new Error("ENOENT");
      },
    });
    const result = await loadBundledFont("/plugin", deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ENOENT");
    expect(added).toEqual([]);
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("bundled font:");
    expect(warns[0]).toContain("ENOENT");
  });

  it("awaits a Promise<ArrayBuffer> from readBytes", async () => {
    const { deps, added } = makeDeps({
      readBytes: () => Promise.resolve(new ArrayBuffer(8)),
    });
    const result = await loadBundledFont("/plugin", deps);
    expect(result.ok).toBe(true);
    expect(added.length).toBe(1);
  });

  it("warns and returns ok=false when face.load() rejects", async () => {
    const { deps, added, warns } = makeDeps({
      fontFaceCtor: FailingLoadFontFace,
    });
    const result = await loadBundledFont("/plugin", deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("network error");
    expect(added).toEqual([]);
    expect(warns.length).toBe(1);
  });

  it("warns and returns ok=false when load() resolves but status stays unloaded", async () => {
    // This is the failure mode that previous tests missed: the URL was
    // unreachable, FontFace stayed in "unloaded" state, but the face was
    // still considered "registered" by document.fonts. Asserting on
    // status === "loaded" forces a real reachability check.
    const { deps, added, warns } = makeDeps({
      fontFaceCtor: StaysUnloadedFontFace,
    });
    const result = await loadBundledFont("/plugin", deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("face.status=unloaded");
    expect(added).toEqual([]);
    expect(warns.length).toBe(1);
  });

  it("does NOT add the face when status is not 'loaded'", async () => {
    const { deps, added } = makeDeps({
      fontFaceCtor: StaysUnloadedFontFace,
    });
    await loadBundledFont("/plugin", deps);
    expect(added).toEqual([]);
  });

  it("warns and returns ok=false when document.fonts.add throws", async () => {
    const { deps, added, warns } = makeDeps({
      documentFonts: {
        add: () => {
          throw new Error("set is sealed");
        },
      },
    });
    const result = await loadBundledFont("/plugin", deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("set is sealed");
    expect(added).toEqual([]);
    expect(warns.length).toBe(1);
  });

  it("uses default console.warn when no warn fn injected", async () => {
    const consoleWarn = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { deps } = makeDeps({
      readBytes: () => {
        throw new Error("BOOM");
      },
      warn: undefined,
    });
    delete (deps as { warn?: unknown }).warn;
    await loadBundledFont("/plugin", deps);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    consoleWarn.mockRestore();
  });
});
