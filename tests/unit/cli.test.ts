import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../../src/cli/index.ts";
import { createFixtureRepo, rmFixture, snapshotTree, ME, OTHER } from "../fixtures/fixture-repo.ts";

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) rmFixture(cleanup.pop()!);
});

function project(opts: { enabled?: boolean; identity?: boolean; repoDir?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa2c-proj-"));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, "config"));
  const repoPath = opts.repoDir ?? "/does/not/exist";
  fs.writeFileSync(
    path.join(root, "config", "repos.yaml"),
    `repositories:\n  - name: he-qa\n    path: ${repoPath}\n    enabled: ${opts.enabled ?? true}\n    read_only: true\n`,
  );
  fs.writeFileSync(
    path.join(root, "config", "app.yaml"),
    opts.identity === false ? "{}\n" : `identity:\n  names: ["${ME.name}"]\n  emails: ["${ME.email}"]\n`,
  );
  fs.writeFileSync(path.join(root, "config", "privacy.yaml"), "company_terms: [Acme]\nclient_terms: [BigClient]\n");
  return root;
}

async function run(root: string, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(["node", "qa-agent", ...args], { root, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function companyRepo() {
  const d = createFixtureRepo([
    { message: "chore: init", files: { "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.50.0" } }), "playwright.config.ts": "export default {};\n", ".env": "SECRET=hunter2-should-never-be-read\n" } },
    {
      message: "fix(e2e): remove sleeps from Acme checkout test (#12)\n\nCheckout failed intermittently because of a fixed wait.",
      files: { "tests/checkout.spec.ts": "await page.waitForTimeout(3000);\n" },
    },
    { message: "fix(e2e): use web-first assertion", files: { "tests/checkout.spec.ts": "await expect(page.getByText('Done')).toBeVisible();\n" } },
    { message: "feat: teammate change", author: OTHER, files: { "src/app.ts": "export {};\n" } },
  ]);
  cleanup.push(d);
  return d;
}

describe("qa-agent CLI", () => {
  it("refuses to scan when no repository is enabled", async () => {
    const r = await run(project({ enabled: false }), "scan");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/No enabled repositories/);
  });

  it("dry run reads no commit content and leaves the repository untouched", async () => {
    const repo = companyRepo();
    const before = snapshotTree(repo);
    const r = await run(project({ repoDir: repo }), "scan", "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("he-qa");
    expect(r.out).toMatch(/commits:4/);
    expect(snapshotTree(repo)).toBe(before);
  });

  it("scans, builds work items, detects ideas and writes redacted handoff files without touching the repo", async () => {
    const repo = companyRepo();
    const root = project({ repoDir: repo });
    const before = snapshotTree(repo);

    const r = await run(root, "scan");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/he-qa .*work items:3/);
    expect(r.out).toMatch(/ideas: 1/);
    expect(snapshotTree(repo)).toBe(before);

    const handoffDir = path.join(root, "data", "handoff");
    const files = fs.readdirSync(handoffDir).filter((f) => f.startsWith("idea_"));
    expect(files).toHaveLength(1);
    const md = fs.readFileSync(path.join(handoffDir, files[0]!), "utf8");
    expect(md).not.toMatch(/acme/i);
    expect(md).not.toContain("hunter2");

    const status = await run(root, "status");
    expect(status.out).toMatch(/work items: 3/);
    const ideas = await run(root, "ideas");
    expect(ideas.out).toMatch(/\[NEW\] \[NEEDS_REVIEW\]/);
  });

  it("is incremental: a second scan sees no new commits", async () => {
    const repo = companyRepo();
    const root = project({ repoDir: repo });
    await run(root, "scan");
    const r = await run(root, "scan", "--no-discover");
    expect(r.out).toMatch(/new commits:0/);
  });

  it("saves validated enrichment and rejects invalid enrichment", async () => {
    const repo = companyRepo();
    const root = project({ repoDir: repo });
    await run(root, "scan");
    const [idea] = JSON.parse((await run(root, "ideas", "--json")).out) as Array<{ id: string; evidence: string[] }>;
    const good = path.join(root, "good.json");
    fs.writeFileSync(good, JSON.stringify({ hook: "What replaces a fixed wait in a browser test?", technical_lesson: { text: "Wait on a condition, not a duration.", basis: "EVIDENCE", evidence_refs: [idea!.evidence[0]] } }));
    const ok = await run(root, "idea", "save", idea!.id, "--file", good);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/state ENRICHED/);

    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ hook: "Cut run time by 87%" }));
    const no = await run(root, "idea", "save", idea!.id, "--file", bad);
    expect(no.code).toBe(1);
    expect(no.err).toMatch(/87/);
  });

  it("future commands do nothing and fail, including publish", async () => {
    const root = project();
    for (const cmd of ["publish", "approve", "draft", "article", "generate-image", "generate-video", "audit"]) {
      const r = await run(root, cmd, "--confirm", "anything");
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/not available until Phase/);
    }
  });

  it("reports config errors clearly", async () => {
    const root = project();
    fs.writeFileSync(path.join(root, "config", "repos.yaml"), "repositories:\n  - name: x\n    path: /tmp\n    read_only: false\n");
    const r = await run(root, "repos", "list");
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/read_only must be true/);
  });
});
