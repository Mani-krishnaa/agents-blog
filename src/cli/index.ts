import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { EnrichmentError, saveEnrichment } from "../agents/content-agent/enrich.ts";
import { ConfigError } from "../core/config.ts";
import { openContext, planScan, runDiscover, runScan, type Context } from "../core/pipeline.ts";

export interface CliEnv {
  root: string;
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Commands that exist in the spec but are built in later phases. They never perform any action. */
const FUTURE: Array<{ name: string; phase: number; what: string }> = [
  { name: "draft", phase: 2, what: "LinkedIn post drafting" },
  { name: "audit", phase: 2, what: "privacy and quality audit of a draft" },
  { name: "generate-image", phase: 2, what: "visual generation" },
  { name: "generate-video", phase: 5, what: "video generation" },
  { name: "approve", phase: 3, what: "approval workflow" },
  { name: "publish", phase: 3, what: "publishing (will require PUBLIC_SAFE and explicit approval)" },
  { name: "article", phase: 4, what: "article/blog drafting" },
];

class UserError extends Error {}

export function createProgram(env: CliEnv): Command {
  const program = new Command();
  program
    .name("qa-agent")
    .description("QA Personal Brand Agent. Local only. Company repositories are read-only.")
    .option("--config <dir>", "config directory (default: <project>/config)")
    .exitOverride()
    .configureOutput({ writeOut: (s) => env.out(s.replace(/\n$/, "")), writeErr: (s) => env.err(s.replace(/\n$/, "")) });

  const withCtx = <T>(fn: (ctx: Context) => T): T => {
    const cfg = program.opts<{ config?: string }>().config;
    let ctx: Context | undefined;
    try {
      ctx = openContext(env.root, cfg ? path.resolve(cfg) : undefined);
      return fn(ctx);
    } finally {
      ctx?.store.close();
    }
  };
  const json = (v: unknown) => env.out(JSON.stringify(v, null, 2));

  const repos = program.command("repos").description("Configured repositories");
  repos
    .command("list")
    .description("List configured repositories (read-only data sources)")
    .action(() =>
      withCtx((ctx) => {
        if (ctx.config.repos.length === 0) env.out("No repositories configured. Edit config/repos.yaml.");
        for (const r of ctx.config.repos) env.out(`${r.enabled ? "enabled " : "disabled"}  ${r.name}  ${r.path}  (read-only)`);
      }),
    );

  program
    .command("scan")
    .description("Read repositories (read-only), build work items, and by default detect ideas")
    .option("--repo <name>", "only this repository")
    .option("--dry-run", "list what would be read; read no commit content and write nothing")
    .option("--full", "ignore previous scan state and rescan history (bounded by max_commits_per_scan)")
    .option("--no-discover", "do not generate ideas and handoff files after scanning")
    .action((o: { repo?: string; dryRun?: boolean; full?: boolean; discover: boolean }) =>
      withCtx((ctx) => {
        const enabled = ctx.config.repos.filter((r) => r.enabled);
        if (enabled.length === 0) {
          throw new UserError("No enabled repositories. Set real paths and `enabled: true` in config/repos.yaml, then retry.");
        }
        const id = ctx.config.app.identity;
        if (id.emails.length === 0 && id.names.length === 0) {
          env.err("warning: no identity in config/app.yaml. No commit will be attributed to you; all work will be LOW_CONFIDENCE.");
        }
        if (o.dryRun) {
          env.out("Dry run. Read-only git commands only (log, show, diff, rev-list, rev-parse, ls-files, cat-file). Nothing is written.");
          for (const p of planScan(ctx, { repo: o.repo })) {
            env.out(
              `${p.repo}  ${p.path}  git:${p.isGitRepo ? "yes" : "NO"}  commits:${p.commitsReachable ?? "?"}  previous-scan-tips:${p.previousTips}`,
            );
          }
          return;
        }
        let failed = false;
        for (const s of runScan(ctx, { repo: o.repo, full: o.full })) {
          if (s.status === "error") {
            failed = true;
            env.err(`${s.repo}: scan failed: ${s.error}`);
            continue;
          }
          const priv = Object.entries(s.byPrivacy).map(([k, v]) => `${k}:${v}`).join(" ") || "-";
          env.out(`${s.repo}  branch:${s.branch ?? "?"}  new commits:${s.commitsSeen}  work items:${s.workItems}  privacy ${priv}`);
          for (const w of s.warnings) env.err(`  warning: ${w}`);
        }
        if (o.discover) printDiscover(runDiscover(ctx));
        if (failed) throw new UserError("Scan failed for one or more repositories (see above).");
      }),
    );

  const printDiscover = (d: ReturnType<typeof runDiscover>) => {
    env.out(`ideas: ${d.ideas}  handoff files written: ${d.written.length}  withheld (PRIVATE): ${d.skippedPrivate.length}`);
    env.out(`handoff dir: ${d.handoffDir}`);
  };

  program
    .command("discover")
    .description("Generate content ideas from stored work items and write redacted handoff files")
    .action(() => withCtx((ctx) => printDiscover(runDiscover(ctx))));

  program
    .command("ideas")
    .description("List content ideas")
    .option("--json", "machine-readable output")
    .action((o: { json?: boolean }) =>
      withCtx((ctx) => {
        const ideas = ctx.store.listIdeas();
        if (o.json) return json(ideas);
        if (ideas.length === 0) return env.out("No ideas yet. Run `qa-agent scan` first.");
        for (const i of ideas) env.out(`${i.id}  [${i.state}] [${i.privacy_status}] [${i.confidence}]  ${i.title}`);
      }),
    );

  program
    .command("idea")
    .description("Idea operations")
    .command("save <ideaId>")
    .description("Save agent-produced enrichment (validated: evidence, numbers, privacy) from a JSON file")
    .requiredOption("--file <path>", "JSON file with the enrichment")
    .action((ideaId: string, o: { file: string }) =>
      withCtx((ctx) => {
        let payload: unknown;
        try {
          payload = JSON.parse(fs.readFileSync(o.file, "utf8"));
        } catch (e) {
          throw new UserError(`Could not read JSON from ${o.file}: ${(e as Error).message}`);
        }
        const r = saveEnrichment(ctx.store, ctx.config.privacy, ideaId, payload);
        env.out(`saved ${r.idea.id}: state ${r.idea.state}, privacy ${r.idea.privacy_status}`);
        for (const f of r.findings) env.out(`  ${f.severity} ${f.rule_id} @ ${f.location}: ${f.message}`);
        env.out("Nothing was published. Publishing needs PUBLIC_SAFE and your explicit approval (Phase 3).");
      }),
    );

  program
    .command("status")
    .description("Counts of what is stored")
    .action(() =>
      withCtx((ctx) => {
        const works = ctx.store.listWorkItems();
        const by = (xs: string[]) => {
          const m: Record<string, number> = {};
          for (const x of xs) m[x] = (m[x] ?? 0) + 1;
          return Object.entries(m).map(([k, v]) => `${k}:${v}`).join(" ") || "-";
        };
        env.out(`repositories: ${ctx.config.repos.length} (${ctx.config.repos.filter((r) => r.enabled).length} enabled)`);
        env.out(`work items: ${works.length}  privacy ${by(works.map((w) => w.privacy_status))}`);
        const ideas = ctx.store.listIdeas();
        env.out(`ideas: ${ideas.length}  state ${by(ideas.map((i) => i.state))}`);
        env.out(`database: ${path.join(ctx.dataDir, "qa-agent.db")}`);
      }),
    );

  program
    .command("privacy")
    .description("Privacy review")
    .command("review")
    .description("List unresolved privacy findings on work items (never shows matched text)")
    .action(() =>
      withCtx((ctx) => {
        let n = 0;
        for (const w of ctx.store.listWorkItems()) {
          const open = ctx.store.listFindings("work_item", w.id).filter((f) => !f.resolution);
          if (open.length === 0) continue;
          env.out(`${w.id}  [${w.privacy_status}]  ${w.title}`);
          for (const f of open) {
            n++;
            env.out(`  ${f.severity}  ${f.rule_id}  @ ${f.location}  ${f.fingerprint}  ${f.message}`);
          }
        }
        if (n === 0) env.out("No unresolved findings.");
      }),
    );

  program
    .command("skills")
    .description("Skill management")
    .command("sync")
    .description("Fetch whitelisted skill sources at pinned versions")
    .action(() => {
      throw new UserError("`skills sync` is not implemented yet.");
    });

  for (const f of FUTURE) {
    program
      .command(f.name)
      .description(`Not available until Phase ${f.phase}`)
      .allowUnknownOption()
      .allowExcessArguments()
      .action(() => {
        throw new UserError(`\`${f.name}\` (${f.what}) is not available until Phase ${f.phase}. Nothing was done.`);
      });
  }

  return program;
}

export async function main(argv: string[], env?: Partial<CliEnv>): Promise<number> {
  const root = env?.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const e: CliEnv = { root, out: env?.out ?? ((s) => console.log(s)), err: env?.err ?? ((s) => console.error(s)) };
  try {
    await createProgram(e).parseAsync(argv, { from: "node" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    if (err instanceof UserError || err instanceof ConfigError || err instanceof EnrichmentError) {
      e.err(`error: ${err.message}`);
      return 1;
    }
    e.err(`error: ${(err as Error).message}`);
    return 1;
  }
}
