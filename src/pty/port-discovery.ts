const PORT_LINE = /^PTY_SERVER_LISTENING port=(\d+)$/;

export function parsePortLine(line: string): number | null {
  const match = PORT_LINE.exec(line.trim());
  if (!match) return null;
  const port = Number.parseInt(match[1], 10);
  return Number.isFinite(port) ? port : null;
}
