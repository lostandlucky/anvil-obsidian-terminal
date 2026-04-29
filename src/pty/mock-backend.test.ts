import { describe, it, expect } from "vitest";
import { MockBackend } from "./mock-backend";

describe("MockBackend", () => {
  it("start resolves", async () => {
    const backend = new MockBackend();
    await expect(backend.start()).resolves.toBeUndefined();
  });

  it("records writes", () => {
    const backend = new MockBackend();
    backend.write("hello");
    backend.write("world");
    expect(backend.getWrites()).toEqual(["hello", "world"]);
  });

  it("records resizes", () => {
    const backend = new MockBackend();
    backend.resize(80, 24);
    backend.resize(100, 40);
    expect(backend.getResizes()).toEqual([
      { cols: 80, rows: 24 },
      { cols: 100, rows: 40 },
    ]);
  });

  it("emitData fires onData handlers with the emitted data", () => {
    const backend = new MockBackend();
    const received: string[] = [];
    backend.onData((d) => {
      if (typeof d === "string") received.push(d);
    });
    backend.emitData("one");
    backend.emitData("two");
    expect(received).toEqual(["one", "two"]);
  });

  it("emitExit fires onExit handlers with status/signal info", () => {
    const backend = new MockBackend();
    const events: Array<{ status: number | null; signal: number | null }> = [];
    backend.onExit((info) => events.push(info));
    backend.emitExit({ status: 0, signal: null });
    expect(events).toEqual([{ status: 0, signal: null }]);
  });

  it("close is idempotent and safe to call twice", async () => {
    const backend = new MockBackend();
    await backend.close();
    await expect(backend.close()).resolves.toBeUndefined();
  });

  it("writes after close are ignored", async () => {
    const backend = new MockBackend();
    await backend.close();
    backend.write("ignored");
    expect(backend.getWrites()).toEqual([]);
  });
});

describe("MockBackend — multi-instance isolation", () => {
  it("two instances have independent write buffers", () => {
    const a = new MockBackend();
    const b = new MockBackend();
    a.write("alpha");
    b.write("bravo");
    expect(a.getWrites()).toEqual(["alpha"]);
    expect(b.getWrites()).toEqual(["bravo"]);
  });

  it("data emitted on instance A does not fire handlers on instance B", () => {
    const a = new MockBackend();
    const b = new MockBackend();
    const aReceived: string[] = [];
    const bReceived: string[] = [];
    a.onData((d) => {
      if (typeof d === "string") aReceived.push(d);
    });
    b.onData((d) => {
      if (typeof d === "string") bReceived.push(d);
    });

    a.emitData("from-a");

    expect(aReceived).toEqual(["from-a"]);
    expect(bReceived).toEqual([]);
  });

  it("closing one instance does not affect the other", async () => {
    const a = new MockBackend();
    const b = new MockBackend();
    await a.close();
    b.write("still alive");
    expect(b.getWrites()).toEqual(["still alive"]);
  });

  it("exit events are scoped to the instance that emitted them", () => {
    const a = new MockBackend();
    const b = new MockBackend();
    const aExits: unknown[] = [];
    const bExits: unknown[] = [];
    a.onExit((info) => aExits.push(info));
    b.onExit((info) => bExits.push(info));

    a.emitExit({ status: 1, signal: null });

    expect(aExits).toHaveLength(1);
    expect(bExits).toHaveLength(0);
  });
});
