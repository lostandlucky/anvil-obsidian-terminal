// Phase 1 (glyph-rendering) / R3 — runtime registration of the bundled
// Symbols Nerd Font Mono via the FontFace API.
//
// Why not @font-face in CSS: Obsidian inlines plugin styles via a <style>
// tag. Relative `url()` paths in such a sheet resolve against the document
// URL (app://obsidian.md/...), not the plugin file's path. The browser
// silently can't fetch the woff2 — the FontFace stays in the "unloaded"
// state and Canvas-2D measurements (which xterm uses to size glyph cells
// and bake the WebGL atlas) fall back to the next font in the stack. On
// machines with an installed Nerd Font (MesloLGS NF, etc.) this hides the
// failure: glyphs render via the system font and the bundle is dead
// weight. On machines without one — the audience FI-022 was written for —
// glyphs paint as tofu.
//
// The fix here loads the woff2 bytes off disk and registers the FontFace
// with an ArrayBuffer source. No URL resolution is involved, so the path
// can't be misinterpreted by the host document.

const FAMILY = "Symbols Nerd Font Mono";
const FONT_REL_PATH = "fonts/SymbolsNerdFontMono.woff2";

// Canonical Symbols Nerd Font Mono v3.x coverage. Same set as the spec's
// @font-face block; do NOT shorten or rebase from FI-022's earlier draft
// (it was wrong/incomplete in 6 places — see the spec).
const UNICODE_RANGE = [
  "U+2500-259F",
  "U+23FB-23FE",
  "U+2B58",
  "U+2665",
  "U+26A1",
  "U+2630",
  "U+276C-2771",
  "U+E000-E00A",
  "U+E0A0-E0D7",
  "U+E200-E2A9",
  "U+E300-E3E3",
  "U+E5FA-E6B7",
  "U+E700-E8EF",
  "U+EA60-EC1E",
  "U+ED00-EF2F",
  "U+F000-F2FF",
  "U+F300-F381",
  "U+F400-FD46",
  "U+F0001-F1AF0",
].join(", ");

export interface BundledFontFaceLike {
  status: string;
  load(): Promise<unknown>;
}

export interface BundledFontDocumentFontsLike {
  add(face: BundledFontFaceLike): void;
  has?(face: BundledFontFaceLike): boolean;
  delete?(face: BundledFontFaceLike): void;
}

export interface BundledFontDeps {
  /** Read the woff2 bytes off disk. May throw or return a Promise. */
  readBytes: (absPath: string) => ArrayBuffer | Promise<ArrayBuffer>;
  /** FontFace constructor. In production: the global `FontFace`. */
  fontFaceCtor: new (
    family: string,
    source: ArrayBuffer | ArrayBufferView,
    descriptors?: { display?: string; unicodeRange?: string },
  ) => BundledFontFaceLike;
  /** Live `document.fonts` set in production; injectable for tests. */
  documentFonts: BundledFontDocumentFontsLike;
  /** Defaults to console.warn. */
  warn?: (message: string) => void;
}

export interface BundledFontResult {
  ok: boolean;
  /** Returned only when ok=true; the registered face for cleanup. */
  face?: BundledFontFaceLike;
  /** Failure reason. */
  reason?: string;
}

/** Compute the absolute on-disk path to the bundled woff2 given the
 *  plugin's installation directory. Pure helper for unit tests. */
export function bundledFontAbsPath(pluginDir: string): string {
  const sep = pluginDir.endsWith("/") ? "" : "/";
  return `${pluginDir}${sep}${FONT_REL_PATH}`;
}

/** Read the woff2, register the FontFace, await the load, add to
 *  document.fonts. On any failure, log a single warning and return
 *  { ok: false } — the plugin proceeds with whatever the user has
 *  installed (glyphs may tofu, but the rest of the terminal still works).
 */
export async function loadBundledFont(
  pluginDir: string,
  deps: BundledFontDeps,
): Promise<BundledFontResult> {
  const absPath = bundledFontAbsPath(pluginDir);
  let bytes: ArrayBuffer;
  try {
    const result = deps.readBytes(absPath);
    bytes = result instanceof Promise ? await result : result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(deps, `read failed at ${absPath}: ${reason}`);
    return { ok: false, reason };
  }
  let face: BundledFontFaceLike;
  try {
    face = new deps.fontFaceCtor(FAMILY, bytes, {
      display: "block",
      unicodeRange: UNICODE_RANGE,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(deps, `FontFace construction failed: ${reason}`);
    return { ok: false, reason };
  }
  try {
    await face.load();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(deps, `font.load() rejected: ${reason}`);
    return { ok: false, reason };
  }
  if (face.status !== "loaded") {
    const reason = `face.status=${face.status} after load()`;
    warn(deps, reason);
    return { ok: false, reason };
  }
  try {
    deps.documentFonts.add(face);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(deps, `document.fonts.add failed: ${reason}`);
    return { ok: false, reason };
  }
  return { ok: true, face };
}

function warn(deps: BundledFontDeps, message: string): void {
  const prefix = "[anvil] bundled font: ";
  (deps.warn ?? ((m: string) => console.warn(m)))(prefix + message);
}
