import { describe, it, expect } from "vitest";
import {
  encodeInput,
  encodeResize,
  decodeServerMessage,
} from "./protocol-client";

describe("protocol-client encode", () => {
  it("encodes input bytes as a base64 input frame", () => {
    const frame = encodeInput("echo hi\n");
    const parsed = JSON.parse(frame);
    expect(parsed.type).toBe("input");
    expect(parsed.data).toBe(Buffer.from("echo hi\n", "utf-8").toString("base64"));
  });

  it("encodes arbitrary bytes including control characters", () => {
    const frame = encodeInput("\x03"); // Ctrl-C
    const parsed = JSON.parse(frame);
    expect(parsed.type).toBe("input");
    expect(Buffer.from(parsed.data, "base64").toString("utf-8")).toBe("\x03");
  });

  it("encodes resize as integer cols/rows frame", () => {
    const frame = encodeResize(120, 40);
    const parsed = JSON.parse(frame);
    expect(parsed).toEqual({ type: "resize", cols: 120, rows: 40 });
  });
});

describe("protocol-client decode", () => {
  it("decodes an output frame to raw bytes (Uint8Array)", () => {
    const payload = Buffer.from("hello world").toString("base64");
    const msg = decodeServerMessage(JSON.stringify({ type: "output", data: payload }));
    expect(msg?.type).toBe("output");
    if (msg?.type !== "output") throw new Error("expected output");
    expect(msg.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(msg.data)).toEqual(Array.from(Buffer.from("hello world")));
  });

  it("decodes an exit frame with status and signal", () => {
    const msg = decodeServerMessage(
      JSON.stringify({ type: "exit", status: 0, signal: null }),
    );
    expect(msg).toEqual({ type: "exit", status: 0, signal: null });
  });

  it("returns null for malformed JSON", () => {
    expect(decodeServerMessage("not json")).toBeNull();
  });

  it("returns null for unknown message type", () => {
    expect(decodeServerMessage(JSON.stringify({ type: "hello" }))).toBeNull();
  });

  it("returns null for output frame with invalid base64", () => {
    expect(
      decodeServerMessage(JSON.stringify({ type: "output", data: "!!!not-base64!!!" })),
    ).toBeNull();
  });

  it("preserves multi-byte UTF-8 across output messages split mid-character", () => {
    // The PTY emits bytes in arbitrary chunk sizes; a WebSocket message
    // boundary can land inside a multi-byte UTF-8 sequence. The decoder
    // must not corrupt those bytes — when the two messages are reassembled,
    // the byte stream must equal the original.
    //
    // U+2500 (─, light horizontal box drawing) encodes as 0xE2 0x94 0x80.
    // We split it 2/1 between two output messages.
    //
    // Pre-fix: decodeServerMessage applied .toString("utf-8") to each
    // message's bytes independently. Partial sequences became U+FFFD,
    // destroying the original character. Surfaces visibly when Claude
    // Code emits long runs of box-drawing glyphs at fixed widths — the
    // last few bytes of a chunk often land mid-`─`.
    //
    // Post-fix: each message yields raw Uint8Array bytes; xterm's parser
    // reassembles UTF-8 across consecutive write() calls.
    const utf8DashBytes = [0xe2, 0x94, 0x80];

    const partAB64 = Buffer.from(Uint8Array.from([0xe2, 0x94])).toString("base64");
    const partBB64 = Buffer.from(Uint8Array.from([0x80])).toString("base64");

    const out1 = decodeServerMessage(
      JSON.stringify({ type: "output", data: partAB64 }),
    );
    const out2 = decodeServerMessage(
      JSON.stringify({ type: "output", data: partBB64 }),
    );

    if (out1?.type !== "output" || out2?.type !== "output") {
      throw new Error("expected two output messages");
    }

    // Coerce either string-returning (buggy) or Uint8Array-returning (fixed)
    // implementations to bytes for comparison.
    const toBytes = (data: string | Uint8Array): Uint8Array =>
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const combined = new Uint8Array([
      ...toBytes(out1.data),
      ...toBytes(out2.data),
    ]);

    expect(Array.from(combined)).toEqual(utf8DashBytes);
  });
});
