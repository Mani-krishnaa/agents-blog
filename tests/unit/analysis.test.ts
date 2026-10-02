import { describe, it, expect } from "vitest";
import { clusterCommits } from "../../src/agents/work-analysis-agent/cluster.ts";
import { classify } from "../../src/agents/work-analysis-agent/classify.ts";
import { buildWorkItem } from "../../src/agents/work-analysis-agent/build.ts";
import { WorkItem } from "../../src/core/models.ts";
import type { PrivacyConfig } from "../../src/core/config.ts";
import { mkCommit } from "../helpers.ts";

const noPrivacy: PrivacyConfig = { company_terms: [], client_terms: [], internal_product_terms: [], internal_domains: [], allowlist: [] };
const stack = { technologies: ["Playwright", "TypeScript"], hasPlaywrightConfig: true };

const rules = (commits: ReturnType<typeof mkCommit>[]) => classify({ commits }, stack).signals.map((s) => s.rule_id);

describe("clusterCommits", () => {
  it("drops merge commits and trivial chore commits", () => {
    const c = clusterCommits([
      mkCommit({ subject: "Merge branch 'x'", isMerge: true }),
      mkCommit({ subject: "chore: bump version to 1.2.3", files: ["package.json"] }),
      mkCommit({ subject: "fix: stabilise login test" }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.commits[0]!.subject).toContain("stabilise");
  });

  it("groups commits that share a PR number", () => {
    const c = clusterCommits([
      mkCommit({ subject: "fix: a (#7)", date: "2026-01-01T10:00:00Z", files: ["a/x.ts"] }),
      mkCommit({ subject: "fix: b (#7)", date: "2026-03-01T10:00:00Z", files: ["b/y.ts"] }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.commits).toHaveLength(2);
  });

  it("groups same-author commits close in time that touch the same directory", () => {
    const c = clusterCommits([
      mkCommit({ subject: "fix: a", date: "2026-01-01T10:00:00Z", files: ["tests/auth/a.spec.ts"] }),
      mkCommit({ subject: "fix: b", date: "2026-01-01T15:00:00Z", files: ["tests/auth/b.spec.ts"] }),
    ]);
    expect(c).toHaveLength(1);
  });

  it("keeps commits apart when far apart in time or in different areas", () => {
    expect(
      clusterCommits([
        mkCommit({ subject: "fix: a", date: "2026-01-01T10:00:00Z", files: ["tests/auth/a.spec.ts"] }),
        mkCommit({ subject: "fix: b", date: "2026-02-01T10:00:00Z", files: ["tests/auth/b.spec.ts"] }),
      ]),
    ).toHaveLength(2);
    expect(
      clusterCommits([
        mkCommit({ subject: "fix: a", date: "2026-01-01T10:00:00Z", files: ["tests/auth/a.spec.ts"] }),
        mkCommit({ subject: "fix: b", date: "2026-01-01T11:00:00Z", files: [".circleci/config.yml"] }),
      ]),
    ).toHaveLength(2);
  });

  it("does not merge different authors unless they share a PR/ticket", () => {
    const c = clusterCommits([
      mkCommit({ subject: "fix: a", date: "2026-01-01T10:00:00Z", files: ["tests/a.ts"], email: "me@example.com" }),
      mkCommit({ subject: "fix: b", date: "2026-01-01T11:00:00Z", files: ["tests/b.ts"], email: "other@example.com", mine: false }),
    ]);
    expect(c).toHaveLength(2);
  });
});

describe("classify signals", () => {
  it("detects removal of fixed waits as flaky-test work", () => {
    const c = classify(
      { commits: [mkCommit({ lines: ["-  await page.waitForTimeout(3000);", "+  await expect(page.getByRole('button')).toBeVisible();"] })] },
      stack,
    );
    expect(c.signals.map((s) => s.rule_id)).toEqual(expect.arrayContaining(["flaky.remove-hard-wait", "assertions.web-first"]));
    expect(c.areas).toEqual(expect.arrayContaining(["flaky tests", "test reliability", "Playwright"]));
    expect(c.signals.find((s) => s.rule_id === "flaky.remove-hard-wait")!.excerpts[0]!.line).toContain("waitForTimeout");
  });

  it("detects python sleeps removal", () => {
    expect(rules([mkCommit({ files: ["tests/test_login.py"], lines: ["-    time.sleep(5)", "+    wait.until(EC.visible)"] })])).toContain("flaky.remove-hard-wait");
  });

  it("detects flakiness from commit text", () => {
    expect(rules([mkCommit({ subject: "fix: intermittent failure in checkout test" })])).toContain("flaky.keywords");
  });

  it("detects locator strategy changes", () => {
    expect(
      rules([mkCommit({ lines: [`-  page.locator('//div[@id="x"]/span')`, `+  page.getByRole('button', { name: 'Save' })`] })]),
    ).toContain("locator.strategy");
  });

  it("detects Selenium to Playwright migration", () => {
    const r = classify(
      {
        commits: [
          mkCommit({
            subject: "migrate login suite from Selenium to Playwright",
            files: [{ path: "tests/playwright/login.spec.ts", additions: 40, deletions: 0 }, { path: "selenium/login_test.py", additions: 0, deletions: 60 }],
          }),
        ],
      },
      stack,
    );
    expect(r.signals.map((s) => s.rule_id)).toContain("migration.selenium-to-playwright");
    expect(r.areas).toEqual(expect.arrayContaining(["Selenium", "Playwright"]));
  });

  it.each([
    [".circleci/config.yml", "ci.config", ["CI/CD", "CircleCI"]],
    [".github/workflows/e2e.yml", "ci.config", ["CI/CD", "GitHub"]],
    ["Dockerfile", "docker", ["Docker"]],
    ["infra/serverless.yml", "aws", ["AWS"]],
    ["lambda/handler.ts", "aws", ["Lambda"]],
  ])("detects %s", (file, rule, areas) => {
    const c = classify({ commits: [mkCommit({ files: [file], lines: ["+x: 1"] })] }, stack);
    expect(c.signals.map((s) => s.rule_id)).toContain(rule);
    expect(c.areas).toEqual(expect.arrayContaining(areas as never[]));
  });

  it("detects accessibility testing", () => {
    const c = classify({ commits: [mkCommit({ lines: ["+  const results = await new AxeBuilder({ page }).analyze();"] })] }, stack);
    expect(c.signals.map((s) => s.rule_id)).toContain("accessibility");
    expect(c.areas).toContain("accessibility");
  });

  it("detects generative-AI related work from text", () => {
    const c = classify({ commits: [mkCommit({ subject: "feat: ChatGPT-assisted test data generation" })] }, stack);
    expect(c.areas).toContain("Generative AI");
    expect(c.signals.map((s) => s.rule_id)).toContain("genai");
  });

  it("detects API testing and test types", () => {
    const c = classify({ commits: [mkCommit({ files: ["tests/api/smoke/users.spec.ts"], lines: ["+  const res = await request.get('/users');"] })] }, stack);
    expect(c.areas).toContain("API testing");
    expect(c.testingTypes).toEqual(expect.arrayContaining(["api", "smoke"]));
  });

  it("detects test framework design (page objects, fixtures)", () => {
    const c = classify(
      { commits: [mkCommit({ files: ["tests/pages/LoginPage.ts", "tests/fixtures/auth.ts"], lines: ["+export class LoginPage {"] })] },
      stack,
    );
    expect(c.signals.map((s) => s.rule_id)).toContain("framework.design");
    expect(c.areas).toEqual(expect.arrayContaining(["test framework design", "test architecture"]));
  });

  it("finds nothing interesting in a docs-only change and scores it low", () => {
    const c = classify({ commits: [mkCommit({ subject: "docs: update readme", files: ["README.md"], lines: ["+hello"] })] }, stack);
    expect(c.signals).toEqual([]);
    expect(c.contentPotential).toBeLessThan(0.35);
  });

  it("scores interesting, narrated, own-authored work higher than the same work by someone else", () => {
    const mk = (mine: boolean) =>
      classify(
        {
          commits: [
            mkCommit({
              mine,
              subject: "fix: remove sleeps from checkout test",
              body: "The checkout test failed one run in ten because of a fixed wait; replaced with a web-first assertion.",
              lines: ["-  await page.waitForTimeout(3000);"],
            }),
          ],
        },
        stack,
      );
    expect(mk(true).contentPotential).toBeGreaterThan(mk(false).contentPotential);
    expect(mk(true).contentPotential).toBeGreaterThan(0.5);
  });

  it("rates complexity from size and breadth", () => {
    const small = classify({ commits: [mkCommit({ files: [{ path: "a.ts", additions: 3, deletions: 1 }] })] }, stack);
    const big = classify(
      { commits: [mkCommit({ files: Array.from({ length: 12 }, (_, i) => ({ path: `tests/f${i}.ts`, additions: 50, deletions: 10 })) })] },
      stack,
    );
    expect(small.complexity).toBe("low");
    expect(big.complexity).toBe("high");
  });
});

describe("buildWorkItem", () => {
  const flaky = () =>
    mkCommit({
      subject: "fix: remove sleeps from checkout test (#12)",
      body: "Checkout test failed intermittently because of a fixed wait.\n\nSwitched to a web-first assertion.",
      files: ["tests/checkout.spec.ts"],
      lines: ["-  await page.waitForTimeout(3000);", "+  await expect(page.getByText('Done')).toBeVisible();"],
    });

  it("builds a schema-valid WorkItem with evidence, claims that cite it, and unknowns", () => {
    const wi = buildWorkItem("he-qa", { commits: [flaky()] }, stack, noPrivacy);
    expect(() => WorkItem.parse(wi)).not.toThrow();
    expect(wi.repository).toBe("he-qa");
    expect(wi.technical_area).toEqual(expect.arrayContaining(["flaky tests", "Playwright"]));
    expect(wi.problem?.basis).toBe("EVIDENCE");
    expect(wi.problem?.text).toContain("failed intermittently");
    const ids = new Set(wi.evidence.map((e) => e.id));
    for (const claim of [wi.problem, wi.solution]) for (const r of claim?.evidence_refs ?? []) expect(ids.has(r)).toBe(true);
    expect(wi.impact).toBeNull();
    expect(wi.unknowns).toEqual(expect.arrayContaining([expect.stringMatching(/difficult/i), expect.stringMatching(/learn/i)]));
    expect(wi.analysis_source).toBe("heuristic");
  });

  it("does not invent a problem when the commit message has no body", () => {
    const wi = buildWorkItem("r", { commits: [mkCommit({ subject: "fix: tweak", lines: ["-  await page.waitForTimeout(3000);"] })] }, stack, noPrivacy);
    expect(wi.problem).toBeNull();
    expect(wi.unknowns.join(" ")).toMatch(/problem/i);
  });

  it("never fabricates numbers: every digit in claims comes from the commit text", () => {
    const wi = buildWorkItem("r", { commits: [flaky()] }, stack, noPrivacy);
    const source = `${flaky().subject} ${flaky().body}`;
    for (const claim of [wi.problem, wi.solution, wi.impact]) {
      for (const num of claim?.text.match(/\d+/g) ?? []) expect(source).toContain(num);
    }
  });

  it("is LOW_CONFIDENCE when the work is not attributable to the user", () => {
    const wi = buildWorkItem("r", { commits: [{ ...flaky(), authoredByMe: false }] }, stack, noPrivacy);
    expect(wi.confidence).toBe("LOW_CONFIDENCE");
  });

  it("is HIGH confidence for own, narrated, test-touching work with a clear signal", () => {
    expect(buildWorkItem("r", { commits: [flaky()] }, stack, noPrivacy).confidence).toBe("HIGH");
  });

  it("is never PUBLIC_SAFE (repo-derived), at best NEEDS_REVIEW", () => {
    expect(buildWorkItem("r", { commits: [flaky()] }, stack, noPrivacy).privacy_status).toBe("NEEDS_REVIEW");
  });

  it("marks the item PRIVATE when a secret is in the commit message, and does not store it", () => {
    const secret = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
    const wi = buildWorkItem("r", { commits: [mkCommit({ subject: `fix: use token ${secret}` })] }, stack, noPrivacy);
    expect(wi.privacy_status).toBe("PRIVATE");
    expect(JSON.stringify(wi)).not.toContain(secret);
  });

  it("marks the item PRIVATE when a secret appears only in the raw diff, and does not store it", () => {
    const secret = "AKIA" + "ABCDEFGHIJKLMNOP";
    const wi = buildWorkItem("r", { commits: [mkCommit({ lines: [`+const k = '${secret}';`] })] }, stack, noPrivacy);
    expect(wi.privacy_status).toBe("PRIVATE");
    expect(JSON.stringify(wi)).not.toContain(secret);
  });

  it("redacts configured company/client terms in titles, subjects and paths, and flags them", () => {
    const priv: PrivacyConfig = { ...noPrivacy, company_terms: ["Acme"], client_terms: ["BigClient"] };
    const wi = buildWorkItem(
      "r",
      { commits: [mkCommit({ subject: "fix: BigClient login on Acme portal", files: ["tests/acme-portal/login.spec.ts"] })] },
      stack,
      priv,
    );
    const dump = JSON.stringify(wi);
    expect(dump).not.toMatch(/bigclient/i);
    expect(dump).not.toMatch(/acme/i);
    expect(wi.privacy_status).toBe("PRIVATE"); // client term
    expect(wi.privacy_findings.map((f) => f.rule_id)).toEqual(expect.arrayContaining(["client-term", "company-term"]));
  });

  it("has a deterministic id from repo and commits", () => {
    const c = flaky();
    expect(buildWorkItem("r", { commits: [c] }, stack, noPrivacy).id).toBe(buildWorkItem("r", { commits: [c] }, stack, noPrivacy).id);
    expect(buildWorkItem("r", { commits: [c] }, stack, noPrivacy).id).not.toBe(buildWorkItem("other", { commits: [c] }, stack, noPrivacy).id);
  });
});
