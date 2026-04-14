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
  it("decodes an output frame to raw string bytes", () => {
    const payload = Buffer.from("hello world").toString("base64");
    const msg = decodeServerMessage(JSON.stringify({ type: "output", data: payload }));
    expect(msg).toEqual({ type: "output", data: "hello world" });
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
});
