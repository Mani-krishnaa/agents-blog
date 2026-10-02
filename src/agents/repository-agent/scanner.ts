import { RepoGit } from "./repo-git.ts";
import { isSensitivePath, readRepoFile } from "./safe-files.ts";

export interface Identity {
  names: string[];
  emails: string[];
}

export interface RawFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface RawCommit {
  sha: string;
  parents: string[];
  isMerge: boolean;
  authorName: string;
  authorEmail: string;
  date: string; // ISO 8601
  subject: string;
  body: string;
  files: RawFileChange[];
  /** Bounded patch text: lockfiles, generated files and sensitive files removed. */
  diff: string;
  authoredByMe: boolean;
  prNumbers: string[];
  tickets: string[];
}

export interface ScanOptions {
  identity: Identity;
  previousTips?: string[];
  maxCommits?: number;
  maxDiffBytes?: number;
}

export interface ScanResult {
  repo: string;
  branch: string | null;
  commits: RawCommit[];
  /** Hashes of all branch/remote tips at scan time. Pass back as previousTips for incremental scans. */
  tips: string[];
  warnings: string[];
}

const SKIP_DIFF_RE = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|Cargo\.lock)$/,
  /\.lock$/,
  /(^|\/)(node_modules|dist|build|coverage|\.next|playwright-report|test-results)\//,
  /\.(min\.js|min\.css|map|snap|png|jpg|jpeg|gif|webp|pdf|zip|gz|ico|woff2?|ttf|mp4|mov)$/i,
];

function skipDiffPath(p: string): boolean {
  return isSensitivePath(p) || SKIP_DIFF_RE.some((re) => re.test(p));
}

const RS = "\x1e";
const US = "\x1f";

function parseNumstat(text: string): RawFileChange[] {
  const out: RawFileChange[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    out.push({ path: m[3]!, additions: m[1] === "-" ? 0 : Number(m[1]), deletions: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return out;
}

function filterPatch(patch: string, maxBytes: number): string {
  if (!patch) return "";
  const sections = patch.split(/^(?=diff --git )/m);
  const kept: string[] = [];
  for (const s of sections) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(s);
    if (!m) continue;
    if (skipDiffPath(m[2]!) || skipDiffPath(m[1]!)) continue;
    kept.push(s);
  }
  const joined = kept.join("");
  return joined.length > maxBytes ? `${joined.slice(0, maxBytes)}\n[truncated]` : joined;
}

function extractPrs(text: string): string[] {
  return [...new Set([...text.matchAll(/#(\d{1,6})\b/g)].map((m) => m[1]!))];
}

function extractTickets(text: string): string[] {
  return [...new Set([...text.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)].map((m) => m[1]!))];
}

function isMine(identity: Identity, name: string, email: string): boolean {
  const e = email.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  return identity.emails.some((x) => x.toLowerCase() === e) || identity.names.some((x) => x.toLowerCase() === n);
}

const PATCH_BATCH = 20;

function isOversized(err: unknown): boolean {
  const msg = String((err as Error).message ?? err);
  return msg.includes("ENOBUFS") || msg.includes("maxBuffer") || msg.includes("ENOMEM") || msg.includes("Invalid string length");
}

/**
 * Reads commit metadata and patches one batch at a time. A single `git log -p` of a large
 * history can exceed Node's string limit, which would otherwise look like a failed scan.
 */
function forEachPatchBatch(git: RepoGit, format: string, shas: string[], warnings: string[], onBatch: (raw: string) => void): void {
  const read = (batch: string[], withPatch: boolean): void => {
    if (batch.length === 0) return;
    const args = ["log", "--no-walk=unsorted", format, "--numstat", "--no-renames", ...(withPatch ? ["-p"] : []), ...batch];
    try {
      onBatch(git.run(args));
    } catch (err) {
      if (!isOversized(err)) throw err;
      if (batch.length === 1) {
        if (withPatch) {
          warnings.push(`Diff for ${batch[0]!.slice(0, 8)} was too large and was skipped.`);
          read(batch, false);
          return;
        }
        warnings.push(`Commit ${batch[0]!.slice(0, 8)} could not be read.`);
        return;
      }
      const mid = Math.ceil(batch.length / 2);
      read(batch.slice(0, mid), withPatch);
      read(batch.slice(mid), withPatch);
    }
  };
  for (let i = 0; i < shas.length; i += PATCH_BATCH) read(shas.slice(i, i + PATCH_BATCH), true);
}

export function scanRepo(repo: { name: string; path: string }, opts: ScanOptions): ScanResult {
  const git = new RepoGit(repo.path);
  const maxCommits = opts.maxCommits ?? 500;
  const maxDiffBytes = opts.maxDiffBytes ?? 200_000;
  const warnings: string[] = [];
  if (opts.identity.emails.length === 0 && opts.identity.names.length === 0) {
    warnings.push("No identity configured in config/app.yaml: no commit can be attributed to you, so all work is LOW_CONFIDENCE.");
  }

  const branch = git.tryRun(["rev-parse", "--abbrev-ref", "HEAD"])?.trim() ?? null;
  const tipsOut = git.tryRun(["rev-parse", "--branches", "--remotes"]) ?? "";
  const tips = [...new Set(tipsOut.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
  if (tips.length === 0) {
    warnings.push("Repository has no commits yet.");
    return { repo: repo.name, branch, commits: [], tips, warnings };
  }

  const prev = (opts.previousTips ?? []).filter(Boolean);
  const prevValid = prev.filter((t) => git.tryRun(["rev-parse", "--verify", "--quiet", `${t}^{commit}`]) !== null);
  const usePrev = prev.length > 0 && prevValid.length === prev.length;
  if (prev.length > 0 && !usePrev) warnings.push("A previous scan tip no longer exists (history rewritten?): doing a full scan.");

  const format = `--format=${RS}%H${US}%P${US}%an${US}%ae${US}%aI${US}%s${US}%b${US}`;
  const shaArgs = ["log", "--branches", "--remotes", "--format=%H", "-n", String(maxCommits), "--reverse"];
  if (usePrev) shaArgs.push("--not", ...prevValid);
  const shaText = git.tryRun(shaArgs);
  if (shaText === null) {
    warnings.push("git log failed. No commits were read, and the scan checkpoint was not moved.");
    return { repo: repo.name, branch, commits: [], tips: prev, warnings };
  }
  const shas = shaText.split("\n").map((s) => s.trim()).filter((s) => /^[0-9a-f]{40}$/.test(s));

  const commits: RawCommit[] = [];
  forEachPatchBatch(git, format, shas, warnings, (raw) => {
    for (const rec of raw.split(RS)) {
    if (!rec.trim()) continue;
    const parts = rec.split(US);
    if (parts.length < 8) continue;
    const [sha, parentsStr, an, ae, date, subject, body] = parts as [string, string, string, string, string, string, string];
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    const rest = parts.slice(7).join(US);
    const idx = rest.search(/^diff --git /m);
    const numstatText = idx === -1 ? rest : rest.slice(0, idx);
    const patch = idx === -1 ? "" : rest.slice(idx);
    const parents = parentsStr.split(" ").filter(Boolean);
    commits.push({
      sha,
      parents,
      isMerge: parents.length > 1,
      authorName: an,
      authorEmail: ae,
      date,
      subject,
      body: body.trim(),
      files: parseNumstat(numstatText),
      diff: filterPatch(patch, maxDiffBytes),
      authoredByMe: isMine(opts.identity, an, ae),
      prNumbers: extractPrs(subject),
      tickets: extractTickets(`${subject}\n${body}`),
    });
    }
  });

  return { repo: repo.name, branch, commits, tips, warnings };
}

export interface RepoStack {
  technologies: string[];
  hasPlaywrightConfig: boolean;
}

/** Cheap, read-only fingerprint of what a repository is built with. Never reads sensitive files. */
export function detectRepoStack(root: string): RepoStack {
  const git = new RepoGit(root);
  const files = (git.tryRun(["ls-files"]) ?? "").split("\n").filter(Boolean);
  const tech = new Set<string>();
  const has = (re: RegExp) => files.some((f) => re.test(f));

  const read = (rel: string): string => {
    try {
      return readRepoFile(root, rel, { maxBytes: 100_000 });
    } catch {
      return "";
    }
  };

  const pkgPaths = files.filter((f) => /(^|\/)package\.json$/.test(f) && !f.includes("node_modules")).slice(0, 5);
  for (const p of pkgPaths) {
    tech.add("JavaScript");
    const txt = read(p);
    if (/@playwright\/test|"playwright"/.test(txt)) tech.add("Playwright");
    if (/selenium-webdriver|webdriverio|"selenium/.test(txt)) tech.add("Selenium");
    if (/"typescript"/.test(txt)) tech.add("TypeScript");
  }
  if (has(/\.tsx?$/)) tech.add("TypeScript");

  const pyFiles = files.filter((f) => /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py)$/.test(f)).slice(0, 5);
  for (const p of pyFiles) {
    tech.add("Python");
    const txt = read(p).toLowerCase();
    if (/\bpytest\b/.test(txt)) tech.add("Pytest");
    if (/\bselenium\b/.test(txt)) tech.add("Selenium");
    if (/\bplaywright\b/.test(txt)) tech.add("Playwright");
  }
  if (has(/\.py$/)) tech.add("Python");

  const hasPlaywrightConfig = has(/(^|\/)playwright\.config\.[cm]?[jt]s$/);
  if (hasPlaywrightConfig) tech.add("Playwright");
  if (has(/^\.circleci\//)) tech.add("CircleCI");
  if (has(/^\.github\/workflows\//)) tech.add("GitHub");
  if (has(/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml)$/)) tech.add("Docker");
  if (has(/(^|\/)(serverless\.ya?ml|template\.ya?ml|cdk\.json|[^/]+\.tf)$/)) tech.add("AWS");
  if (has(/lambda/i)) tech.add("Lambda");

  return { technologies: [...tech].sort(), hasPlaywrightConfig };
}
