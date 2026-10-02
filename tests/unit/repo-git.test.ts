import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RepoGit, ForbiddenGitCommandError } from "../../src/agents/repository-agent/repo-git.ts";
import { readRepoFile, isSensitivePath, SensitiveFileError } from "../../src/agents/repository-agent/safe-files.ts";
import { createFixtureRepo, rmFixture, snapshotTree } from "../fixtures/fixture-repo.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmFixture(dirs.pop()!);
});
function repo() {
  const d = createFixtureRepo([
    { message: "init", files: { "README.md": "# hi\n", ".env": "SECRET=abc123\n", "src/a.ts": "export const a = 1;\n" } },
    { message: "second", files: { "src/a.ts": "export const a = 2;\n" } },
  ]);
  dirs.push(d);
  return d;
}

describe("RepoGit allowlist", () => {
  it("runs allowed read commands", () => {
    const g = new RepoGit(repo());
    expect(g.run(["rev-parse", "HEAD"]).trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(g.run(["log", "--format=%s"]).trim().split("\n")).toEqual(["second", "init"]);
    expect(g.run(["ls-files"])).toContain("src/a.ts");
  });

  it.each([
    ["commit", ["commit", "-m", "x"]],
    ["add", ["add", "-A"]],
    ["checkout", ["checkout", "-b", "evil"]],
    ["branch", ["branch", "evil"]],
    ["switch", ["switch", "-c", "evil"]],
    ["push", ["push"]],
    ["pull", ["pull"]],
    ["fetch", ["fetch"]],
    ["reset", ["reset", "--hard"]],
    ["rebase", ["rebase", "main"]],
    ["merge", ["merge", "main"]],
    ["tag", ["tag", "v1"]],
    ["stash", ["stash"]],
    ["clean", ["clean", "-fd"]],
    ["gc", ["gc"]],
    ["config", ["config", "user.name", "x"]],
    ["status", ["status"]],
    ["update-ref", ["update-ref", "HEAD", "HEAD"]],
    ["worktree", ["worktree", "add", "../x"]],
    ["remote", ["remote", "add", "x", "y"]],
    ["apply", ["apply", "p.patch"]],
  ])("rejects forbidden subcommand: %s", (_n, args) => {
    const g = new RepoGit(repo());
    expect(() => g.run(args)).toThrow(ForbiddenGitCommandError);
  });

  it("rejects global options placed before the subcommand", () => {
    const g = new RepoGit(repo());
    expect(() => g.run(["-c", "core.pager=evil", "log"])).toThrow(ForbiddenGitCommandError);
    expect(() => g.run(["--git-dir=/tmp/x", "log"])).toThrow(ForbiddenGitCommandError);
  });

  it("rejects options that write files or run external programs", () => {
    const g = new RepoGit(repo());
    expect(() => g.run(["diff", "HEAD~1", "--output=/tmp/qa2c-leak.txt"])).toThrow(ForbiddenGitCommandError);
    expect(() => g.run(["log", "--ext-diff"])).toThrow(ForbiddenGitCommandError);
    expect(() => g.run(["show", "--textconv", "HEAD"])).toThrow(ForbiddenGitCommandError);
    expect(fs.existsSync("/tmp/qa2c-leak.txt")).toBe(false);
  });

  it("rejects an empty command and NUL bytes", () => {
    const g = new RepoGit(repo());
    expect(() => g.run([])).toThrow(ForbiddenGitCommandError);
    expect(() => g.run(["log", "a\0b"])).toThrow(ForbiddenGitCommandError);
  });

  it("running every allowed command leaves the repository byte-for-byte unchanged", () => {
    const d = repo();
    const before = snapshotTree(d);
    const g = new RepoGit(d);
    g.run(["rev-parse", "HEAD"]);
    g.run(["rev-parse", "--abbrev-ref", "HEAD"]);
    g.run(["log", "--format=%H|%an|%ae|%s", "--name-status"]);
    g.run(["show", "--stat", "HEAD"]);
    g.run(["diff", "HEAD~1", "HEAD"]);
    g.run(["ls-files"]);
    g.run(["rev-list", "--count", "HEAD"]);
    g.run(["cat-file", "-p", "HEAD"]);
    expect(snapshotTree(d)).toBe(before);
  });

  it("refuses a path that is not a git repository", () => {
    expect(() => new RepoGit(path.join(process.cwd(), "tests"))).toThrow(/not a git repository/);
  });
});

describe("safe file reads", () => {
  it.each([".env", ".env.local", "config/.env.production", "id_rsa", "server.pem", "keys/private.key", "credentials.json", ".npmrc", "secrets.yaml", "terraform.tfstate"])(
    "flags %s as sensitive",
    (p) => expect(isSensitivePath(p)).toBe(true),
  );

  it.each(["README.md", "src/a.ts", "playwright.config.ts", ".env.example", "package.json"])("allows %s", (p) =>
    expect(isSensitivePath(p)).toBe(false),
  );

  it("never reads the contents of a sensitive file", () => {
    const d = repo();
    expect(() => readRepoFile(d, ".env")).toThrow(SensitiveFileError);
  });

  it("reads a normal file", () => {
    expect(readRepoFile(repo(), "README.md")).toBe("# hi\n");
  });

  it("blocks path traversal and symlinks that escape the repo", () => {
    const d = repo();
    expect(() => readRepoFile(d, "../etc/passwd")).toThrow(/outside/);
    fs.symlinkSync("/etc/hosts", path.join(d, "link"));
    expect(() => readRepoFile(d, "link")).toThrow(/outside/);
  });

  it("truncates very large files", () => {
    const d = repo();
    fs.writeFileSync(path.join(d, "big.txt"), "x".repeat(5000));
    expect(readRepoFile(d, "big.txt", { maxBytes: 100 }).length).toBeLessThanOrEqual(100);
  });
});
