export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "exit"; status: number | null; signal: number | null };

export function encodeInput(data: string): string {
  const b64 = Buffer.from(data, "utf-8").toString("base64");
  return JSON.stringify({ type: "input", data: b64 });
}

export function encodeResize(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

export function decodeServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "output" && typeof obj.data === "string") {
    if (!isValidBase64(obj.data)) return null;
    try {
      return { type: "output", data: Buffer.from(obj.data, "base64").toString("utf-8") };
    } catch {
      return null;
    }
  }
  if (obj.type === "exit") {
    const status = typeof obj.status === "number" ? obj.status : null;
    const signal = typeof obj.signal === "number" ? obj.signal : null;
    return { type: "exit", status, signal };
  }
  return null;
}

function isValidBase64(s: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}
