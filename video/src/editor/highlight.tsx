import type { ReactNode } from "react";

export const colors = {
  bg: "#1e1e1e",
  sidebar: "#181818",
  tabBar: "#252526",
  activeTab: "#1e1e1e",
  border: "#2b2b2b",
  text: "#d4d4d4",
  lineNumber: "#6e7681",
  keyword: "#569cd6",
  control: "#c586c0",
  string: "#ce9178",
  fn: "#dcdcaa",
  type: "#4ec9b0",
  number: "#b5cea8",
  comment: "#6a9955",
  statusBar: "#007acc",
  red: "#f14c4c",
  green: "#89d185",
  yellow: "#cca700",
};

const KEYWORDS = new Set([
  "async",
  "await",
  "function",
  "const",
  "let",
  "public",
  "class",
  "static",
  "int",
  "new",
  "true",
  "false",
]);
const CONTROL = new Set(["if", "for", "return", "throw"]);

const TOKEN =
  /(\/\/.*$)|(`[^`]*`|"[^"]*"|'[^']*')|(\b\d[\d_]*\b)|(\b[A-Za-z_$][\w$]*\b)|(\s+)|(.)/g;

export const highlightLine = (line: string): ReactNode[] => {
  const out: ReactNode[] = [];
  let match: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(line)) !== null) {
    const [text, comment, str, num, word] = match;
    let color = colors.text;
    if (comment) color = colors.comment;
    else if (str) color = colors.string;
    else if (num) color = colors.number;
    else if (word) {
      const rest = line.slice(match.index + text.length);
      if (CONTROL.has(word)) color = colors.control;
      else if (KEYWORDS.has(word)) color = colors.keyword;
      else if (/^[A-Z]/.test(word)) color = colors.type;
      else if (rest.startsWith("(")) color = colors.fn;
      else color = "#9cdcfe";
    }
    out.push(
      <span key={i++} style={{ color }}>
        {text}
      </span>,
    );
  }
  return out;
};
