import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FixtureCommit {
  message: string;
  author?: { name: string; email: string };
  date?: string; // ISO
  files: Record<string, string | null>; // null = delete
}

export const ME = { name: "Test Me", email: "me@example.com" };
export const OTHER = { name: "Other Dev", email: "other@example.com" };

/** Creates a throwaway git repo using the real git binary (tests only; never run on company repos). */
export function createFixtureRepo(commits: FixtureCommit[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa2c-fixture-"));
  const git = (args: string[], env: Record<string, string> = {}) =>
    execFileSync("git", args, { cwd: dir, env: { ...process.env, ...env }, stdio: "pipe" }).toString();
  git(["init", "-q", "-b", "main"]);
  git(["config", "commit.gpgsign", "false"]);
  let i = 0;
  for (const c of commits) {
    i++;
    for (const [rel, content] of Object.entries(c.files)) {
      const abs = path.join(dir, rel);
      if (content === null) {
        fs.rmSync(abs, { force: true });
        continue;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    git(["add", "-A"]);
    const a = c.author ?? ME;
    const date = c.date ?? new Date(Date.UTC(2026, 0, i, 10, 0, 0)).toISOString();
    git(["commit", "-q", "--allow-empty", "-m", c.message], {
      GIT_AUTHOR_NAME: a.name,
      GIT_AUTHOR_EMAIL: a.email,
      GIT_COMMITTER_NAME: a.name,
      GIT_COMMITTER_EMAIL: a.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  }
  return dir;
}

/** Hash of every file (path, size, mtime, content) under dir, including .git. Used by read-only invariant tests. */
export function snapshotTree(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      h.update(`${path.relative(dir, p)}|${st.isDirectory() ? "d" : st.size}|${st.mtimeMs}\n`);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

export function rmFixture(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
