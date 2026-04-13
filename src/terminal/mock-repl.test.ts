import { describe, it, expect } from "vitest";
import { runCommand, welcome, PROMPT } from "./mock-repl";

const ESC = "\x1b[";

describe("mock-repl welcome", () => {
  it("shows a greeting and a prompt", () => {
    const out = welcome();
    expect(out).toContain("Obsidian Terminal");
    expect(out).toContain(PROMPT);
  });

  it("includes ANSI color escapes", () => {
    expect(welcome()).toContain(ESC);
  });
});

describe("mock-repl runCommand", () => {
  it("help lists the available commands", () => {
    const { output } = runCommand("help");
    expect(output).toContain("help");
    expect(output).toContain("echo");
    expect(output).toContain("clear");
    expect(output).toContain(PROMPT);
  });

  it("echo prints its argument verbatim", () => {
    const { output } = runCommand("echo hello world");
    expect(output).toContain("hello world");
    expect(output).toContain(PROMPT);
  });

  it("echo with no args prints blank line", () => {
    const { output } = runCommand("echo");
    expect(output).toContain(PROMPT);
  });

  it("clear signals a screen clear", () => {
    const { output, clear } = runCommand("clear");
    expect(clear).toBe(true);
    expect(output).toContain(`${ESC}2J`);
    expect(output).toContain(PROMPT);
  });

  it("colors output includes ANSI escapes", () => {
    const { output } = runCommand("colors");
    expect(output).toContain(ESC);
    expect(output).toContain(PROMPT);
  });

  it("unknown command returns an error mentioning the command name", () => {
    const { output } = runCommand("nope");
    expect(output).toContain("nope");
    expect(output.toLowerCase()).toContain("unknown");
    expect(output).toContain(PROMPT);
  });

  it("empty input returns just a prompt", () => {
    const { output, clear } = runCommand("");
    expect(clear).toBe(false);
    expect(output).toContain(PROMPT);
  });
});
