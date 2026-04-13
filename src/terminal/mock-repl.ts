const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD_CYAN = `${CSI}1;36m`;
const GREEN = `${CSI}32m`;
const YELLOW = `${CSI}33m`;
const RED = `${CSI}31m`;
const CLEAR = `${CSI}2J${CSI}H`;
const CRLF = "\r\n";

export const PROMPT = `${GREEN}mock>${RESET} `;

export function welcome(): string {
  return (
    `${BOLD_CYAN}Obsidian Terminal${RESET} ${YELLOW}(mock REPL)${RESET}${CRLF}` +
    `Type ${BOLD_CYAN}help${RESET} for available commands.${CRLF}${CRLF}` +
    PROMPT
  );
}

export interface ReplResult {
  output: string;
  clear: boolean;
}

export function runCommand(line: string): ReplResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { output: CRLF + PROMPT, clear: false };
  }

  const [cmd, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(" ");

  switch (cmd) {
    case "help":
      return {
        output:
          CRLF +
          `${BOLD_CYAN}help${RESET}         show this message${CRLF}` +
          `${BOLD_CYAN}echo${RESET} <text>  print <text>${CRLF}` +
          `${BOLD_CYAN}clear${RESET}        clear the screen${CRLF}` +
          `${BOLD_CYAN}colors${RESET}       ANSI color demo${CRLF}` +
          CRLF +
          PROMPT,
        clear: false,
      };
    case "echo":
      return { output: CRLF + args + CRLF + PROMPT, clear: false };
    case "clear":
      return { output: CLEAR + PROMPT, clear: true };
    case "colors":
      return {
        output:
          CRLF +
          `${RED}red${RESET} ${GREEN}green${RESET} ${YELLOW}yellow${RESET} ${BOLD_CYAN}bold-cyan${RESET}${CRLF}` +
          PROMPT,
        clear: false,
      };
    default:
      return {
        output: CRLF + `${RED}unknown command:${RESET} ${cmd}${CRLF}` + PROMPT,
        clear: false,
      };
  }
}
