import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export class ForbiddenGitCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenGitCommandError";
  }
}

/**
 * ALLOWLIST of git subcommands. Everything else is rejected before a process is spawned.
 * Deliberately excluded: status (can refresh/write the index), config, branch, checkout,
 * switch, fetch, pull, push, commit, add, reset, merge, rebase, tag, stash, clean, gc, worktree, remote.
 */
const ALLOWED_SUBCOMMANDS = new Set(["log", "show", "diff", "diff-tree", "rev-parse", "ls-files", "cat-file", "rev-list"]);

/** Subcommands that accept diff-rendering flags; we force the safe variants on them. */
const DIFF_LIKE = new Set(["log", "show", "diff", "diff-tree"]);

/** Options that write files, read outside the repo, or execute external programs. */
const FORBIDDEN_OPTION_RE = [
  /^--output(=|$)/,
  /^--ext-diff$/,
  /^--textconv$/,
  /^--filters$/,
  /^--no-index$/,
  /^--exec-path/,
  /^--open-files-in-pager/,
  /^--git-dir/,
  /^--work-tree/,
];

export class RepoGit {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    if (!fs.existsSync(path.join(this.root, ".git"))) {
      throw new Error(`${this.root} is not a git repository (no .git at its root)`);
    }
  }

  /** Runs one allowlisted, read-only git command and returns stdout. */
  run(args: string[]): string {
    const sub = args[0];
    if (!sub) throw new ForbiddenGitCommandError("empty git command");
    if (!ALLOWED_SUBCOMMANDS.has(sub)) {
      throw new ForbiddenGitCommandError(
        `git "${sub}" is not allowed: repositories are read-only (allowed: ${[...ALLOWED_SUBCOMMANDS].join(", ")})`,
      );
    }
    for (const a of args) {
      if (a.includes("\0")) throw new ForbiddenGitCommandError("NUL byte in git argument");
      if (FORBIDDEN_OPTION_RE.some((re) => re.test(a))) {
        throw new ForbiddenGitCommandError(`git option "${a}" is not allowed in read-only mode`);
      }
    }
    const safeArgs = DIFF_LIKE.has(sub) ? [sub, "--no-ext-diff", "--no-textconv", ...args.slice(1)] : args;
    const full = [
      "--no-pager",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.quotepath=false",
      ...safeArgs,
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_PAGER: "cat",
    };
    delete env.GIT_EXTERNAL_DIFF;
    return execFileSync("git", full, {
      cwd: this.root,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  /** Like run(), but returns null on a non-zero exit (e.g. unknown revision). Forbidden commands still throw. */
  tryRun(args: string[]): string | null {
    try {
      return this.run(args);
    } catch (e) {
      if (e instanceof ForbiddenGitCommandError) throw e;
      return null;
    }
  }
}
