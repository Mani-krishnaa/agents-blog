import { describe, it, expect, afterEach } from "vitest";
import { scanRepo, detectRepoStack } from "../../src/agents/repository-agent/scanner.ts";
import { createFixtureRepo, rmFixture, snapshotTree, ME, OTHER } from "../fixtures/fixture-repo.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmFixture(dirs.pop()!);
});
const identity = { names: ["Test Me"], emails: ["me@example.com"] };

function fixture() {
  const d = createFixtureRepo([
    {
      message: "chore: init",
      files: { "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.50.0" } }), "playwright.config.ts": "export default {};\n" },
    },
    {
      message: "fix(e2e): stabilise login test (#42)\n\nReplaced waitForTimeout with expect.toBeVisible to remove flakiness.",
      files: { "tests/login.spec.ts": "await page.waitForTimeout(3000);\n" },
    },
    {
      message: "fix(e2e): use web-first assertion",
      files: { "tests/login.spec.ts": "await expect(page.getByRole('button')).toBeVisible();\n", "package-lock.json": "{\"lock\": true}\n" },
    },
    { message: "feat: teammate change", author: OTHER, files: { "src/app.ts": "export {};\n" } },
  ]);
  dirs.push(d);
  return d;
}

describe("scanRepo", () => {
  it("extracts commits with authorship, stats and ticket/PR tokens", async () => {
    const d = fixture();
    const r = scanRepo({ name: "he-qa", path: d }, { identity });
    expect(r.commits).toHaveLength(4);
    const fix = r.commits.find((c) => c.subject.includes("stabilise"))!;
    expect(fix.authoredByMe).toBe(true);
    expect(fix.prNumbers).toEqual(["42"]);
    expect(fix.body).toContain("waitForTimeout");
    expect(fix.files.map((f) => f.path)).toEqual(["tests/login.spec.ts"]);
    expect(fix.files[0]).toMatchObject({ additions: 1, deletions: 0 });
    const mate = r.commits.find((c) => c.subject.includes("teammate"))!;
    expect(mate.authoredByMe).toBe(false);
  });

  it("marks nothing as mine when no identity is configured", () => {
    const d = fixture();
    const r = scanRepo({ name: "x", path: d }, { identity: { names: [], emails: [] } });
    expect(r.commits.every((c) => !c.authoredByMe)).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/identity/i);
  });

  it("matches identity case-insensitively by email or name", () => {
    const d = createFixtureRepo([{ message: "a", author: { name: "Someone", email: "ME@Example.com" }, files: { "a.txt": "1" } }]);
    dirs.push(d);
    const r = scanRepo({ name: "x", path: d }, { identity });
    expect(r.commits[0]?.authoredByMe).toBe(true);
  });

  it("is incremental: a second scan from the previous tips returns only new commits", () => {
    const d = fixture();
    const first = scanRepo({ name: "x", path: d }, { identity });
    const none = scanRepo({ name: "x", path: d }, { identity, previousTips: first.tips });
    expect(none.commits).toHaveLength(0);
    expect(none.tips).toEqual(first.tips);
  });

  it("falls back to a full scan when a previous tip no longer exists", () => {
    const d = fixture();
    const r = scanRepo({ name: "x", path: d }, { identity, previousTips: ["0".repeat(40)] });
    expect(r.commits).toHaveLength(4);
  });

  it("honours the max commit limit by keeping the most recent commits, oldest first", () => {
    const d = fixture();
    const r = scanRepo({ name: "x", path: d }, { identity, maxCommits: 2 });
    expect(r.commits.map((c) => c.subject)).toEqual(["fix(e2e): use web-first assertion", "feat: teammate change"]);
  });

  it("returns bounded diffs and skips lockfiles", () => {
    const d = fixture();
    const r = scanRepo({ name: "x", path: d }, { identity, maxDiffBytes: 5000 });
    const c = r.commits.find((c) => c.subject.includes("web-first"))!;
    expect(c.diff).toContain("tests/login.spec.ts");
    expect(c.diff).not.toContain("package-lock.json");
    const tiny = scanRepo({ name: "x", path: d }, { identity, maxDiffBytes: 40 });
    expect(tiny.commits.find((c) => c.subject.includes("web-first"))!.diff.length).toBeLessThanOrEqual(80);
  });

  it("never modifies the repository (before/after snapshot identical)", () => {
    const d = fixture();
    const before = snapshotTree(d);
    scanRepo({ name: "x", path: d }, { identity });
    scanRepo({ name: "x", path: d }, { identity, previousTips: [] });
    detectRepoStack(d);
    expect(snapshotTree(d)).toBe(before);
  });
});

describe("detectRepoStack", () => {
  it("finds Playwright from package.json and config, without reading sensitive files", () => {
    const d = createFixtureRepo([
      {
        message: "init",
        files: {
          "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "1.0.0", typescript: "5" } }),
          "playwright.config.ts": "export default {};",
          ".circleci/config.yml": "version: 2.1\n",
          Dockerfile: "FROM node\n",
          ".env": "SECRET=shh\n",
          "requirements.txt": "pytest==8\nselenium==4\n",
        },
      },
    ]);
    dirs.push(d);
    const s = detectRepoStack(d);
    expect(s.technologies).toEqual(expect.arrayContaining(["Playwright", "TypeScript", "CircleCI", "Docker", "Pytest", "Selenium", "Python"]));
    expect(JSON.stringify(s)).not.toContain("shh");
  });
});

void ME;
