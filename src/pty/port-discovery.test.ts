import { describe, it, expect } from "vitest";
import { parsePortLine } from "./port-discovery";

describe("parsePortLine", () => {
  it("parses a valid PTY_SERVER_LISTENING line", () => {
    expect(parsePortLine("PTY_SERVER_LISTENING port=12345")).toBe(12345);
  });

  it("ignores trailing whitespace/newline", () => {
    expect(parsePortLine("PTY_SERVER_LISTENING port=54321\n")).toBe(54321);
  });

  it("returns null for unrelated stderr-style log lines", () => {
    expect(parsePortLine("INFO pty-server: bound socket")).toBeNull();
  });

  it("returns null for malformed port", () => {
    expect(parsePortLine("PTY_SERVER_LISTENING port=abc")).toBeNull();
  });
});
