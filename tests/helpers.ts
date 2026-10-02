import type { RawCommit } from "../src/agents/repository-agent/scanner.ts";

let n = 0;

export interface MkCommit {
  sha?: string;
  subject?: string;
  body?: string;
  date?: string;
  mine?: boolean;
  email?: string;
  files?: Array<string | { path: string; additions?: number; deletions?: number }>;
  /** Convenience: lines to put in the diff for the first file. Prefix "+" added, "-" removed. */
  lines?: string[];
  diff?: string;
  isMerge?: boolean;
}

export function mkCommit(o: MkCommit = {}): RawCommit {
  n++;
  const sha = o.sha ?? n.toString(16).padStart(40, "0");
  const files = (o.files ?? ["tests/example.spec.ts"]).map((f) =>
    typeof f === "string" ? { path: f, additions: 5, deletions: 2 } : { path: f.path, additions: f.additions ?? 5, deletions: f.deletions ?? 2 },
  );
  const first = files[0]?.path ?? "tests/example.spec.ts";
  const diff =
    o.diff ??
    (o.lines
      ? `diff --git a/${first} b/${first}\n--- a/${first}\n+++ b/${first}\n@@ -1,3 +1,3 @@\n${o.lines.join("\n")}\n`
      : "");
  const subject = o.subject ?? "fix: something";
  return {
    sha,
    parents: o.isMerge ? ["a", "b"] : ["p"],
    isMerge: o.isMerge ?? false,
    authorName: "Test Me",
    authorEmail: o.email ?? "me@example.com",
    date: o.date ?? "2026-01-05T10:00:00+00:00",
    subject,
    body: o.body ?? "",
    files,
    diff,
    authoredByMe: o.mine ?? true,
    prNumbers: [...new Set([...subject.matchAll(/#(\d+)/g)].map((m) => m[1]!))],
    tickets: [...new Set([...`${subject}\n${o.body ?? ""}`.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g)].map((m) => m[1]!))],
  };
}
