import path from "node:path";
import { writeHandoffs, type HandoffResult } from "../agents/content-agent/handoff.ts";
import { generateIdeas } from "../agents/content-agent/ideas.ts";
import { RepoGit } from "../agents/repository-agent/repo-git.ts";
import { detectRepoStack, scanRepo } from "../agents/repository-agent/scanner.ts";
import { buildWorkItem } from "../agents/work-analysis-agent/build.ts";
import { clusterCommits } from "../agents/work-analysis-agent/cluster.ts";
import { worstPrivacy } from "./models.ts";
import { Store } from "../db/store.ts";
import { loadConfig, type Config } from "./config.ts";

export interface Context {
  root: string;
  config: Config;
  store: Store;
  dataDir: string;
  handoffDir: string;
}

export function openContext(root: string, configDir?: string): Context {
  const config = loadConfig(configDir ?? path.join(root, "config"), { projectRoot: root });
  const dataDir = path.resolve(root, config.app.data_dir);
  const store = new Store(path.join(dataDir, "qa-agent.db"));
  for (const r of config.repos) store.upsertRepository({ name: r.name, path: r.path, enabled: r.enabled });
  return { root, config, store, dataDir, handoffDir: path.join(dataDir, "handoff") };
}

function selectRepos(ctx: Context, only?: string) {
  const enabled = ctx.config.repos.filter((r) => r.enabled);
  if (only) {
    const hit = ctx.config.repos.find((r) => r.name === only);
    if (!hit) throw new Error(`Unknown repository "${only}". Configured: ${ctx.config.repos.map((r) => r.name).join(", ") || "none"}`);
    if (!hit.enabled) throw new Error(`Repository "${only}" is disabled in config/repos.yaml`);
    return [hit];
  }
  return enabled;
}

export interface PlanEntry {
  repo: string;
  path: string;
  isGitRepo: boolean;
  previousTips: number;
  commitsReachable: number | null;
}

/** Dry run: opens each repo read-only and counts commits. Reads no commit content, writes nothing. */
export function planScan(ctx: Context, opts: { repo?: string } = {}): PlanEntry[] {
  return selectRepos(ctx, opts.repo).map((r) => {
    try {
      const git = new RepoGit(r.path);
      const n = Number(git.tryRun(["rev-list", "--count", "--branches", "--remotes"])?.trim() ?? "");
      return {
        repo: r.name,
        path: r.path,
        isGitRepo: true,
        previousTips: ctx.store.getScanState(r.name).tips.length,
        commitsReachable: Number.isFinite(n) ? n : null,
      };
    } catch {
      return { repo: r.name, path: r.path, isGitRepo: false, previousTips: 0, commitsReachable: null };
    }
  });
}

export interface ScanSummary {
  repo: string;
  status: "ok" | "error";
  error?: string;
  branch: string | null;
  commitsSeen: number;
  workItems: number;
  byPrivacy: Record<string, number>;
  warnings: string[];
}

export function runScan(ctx: Context, opts: { repo?: string; full?: boolean } = {}): ScanSummary[] {
  const out: ScanSummary[] = [];
  for (const r of selectRepos(ctx, opts.repo)) {
    try {
      const prev = opts.full ? [] : ctx.store.getScanState(r.name).tips;
      const scan = scanRepo(
        { name: r.name, path: r.path },
        {
          identity: ctx.config.app.identity,
          previousTips: prev,
          maxCommits: ctx.config.app.discovery.max_commits_per_scan,
          maxDiffBytes: ctx.config.app.discovery.max_diff_bytes,
        },
      );
      const stack = detectRepoStack(r.path);
      const items = clusterCommits(scan.commits).map((c) => buildWorkItem(r.name, c, stack, ctx.config.privacy));
      for (const w of items) ctx.store.upsertWorkItem(w);
      ctx.store.recordScan(r.name, { tips: scan.tips, commitsSeen: scan.commits.length, status: "ok", warnings: scan.warnings });
      const byPrivacy: Record<string, number> = {};
      for (const w of items) byPrivacy[w.privacy_status] = (byPrivacy[w.privacy_status] ?? 0) + 1;
      out.push({ repo: r.name, status: "ok", branch: scan.branch, commitsSeen: scan.commits.length, workItems: items.length, byPrivacy, warnings: scan.warnings });
    } catch (e) {
      const error = (e as Error).message;
      ctx.store.recordScan(r.name, { tips: ctx.store.getScanState(r.name).tips, commitsSeen: 0, status: "error", warnings: [error] });
      out.push({ repo: r.name, status: "error", error, branch: null, commitsSeen: 0, workItems: 0, byPrivacy: {}, warnings: [] });
    }
  }
  return out;
}

export interface DiscoverSummary extends HandoffResult {
  ideas: number;
  handoffDir: string;
}

/** Work items -> ideas (stored) -> redacted handoff files for the interactive agent. */
export function runDiscover(ctx: Context): DiscoverSummary {
  const works = ctx.store.listWorkItems();
  const existing = new Map(ctx.store.listIdeas().map((i) => [i.id, i]));
  const generated = generateIdeas(works, { minPotential: ctx.config.app.discovery.min_content_potential });
  for (const idea of generated) {
    // Keep an idea the agent already enriched or the user already moved on, but never let its privacy get better.
    const prev = existing.get(idea.id);
    if (prev && prev.state !== "NEW") {
      ctx.store.upsertIdea({ ...prev, privacy_status: worstPrivacy([prev.privacy_status, idea.privacy_status]) });
      continue;
    }
    ctx.store.upsertIdea(idea);
  }
  const ideas = ctx.store.listIdeas().filter((i) => i.state !== "DISMISSED");
  const res = writeHandoffs(ctx.handoffDir, ideas, works, ctx.config.privacy);
  return { ideas: ideas.length, handoffDir: ctx.handoffDir, ...res };
}
