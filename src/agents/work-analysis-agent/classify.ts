import type { RawCommit } from "../repository-agent/scanner.ts";
import type { RepoStack } from "../repository-agent/scanner.ts";
import type { TechnicalArea, TestingType } from "../../core/models.ts";
import type { Cluster } from "./cluster.ts";

export interface Excerpt {
  sha: string;
  path: string;
  line: string;
}

export interface Signal {
  rule_id: string;
  /** Plain-language description. Must not contain numbers or code. */
  description: string;
  excerpts: Excerpt[];
  areas: TechnicalArea[];
  weight: number;
}

export interface Classification {
  areas: TechnicalArea[];
  technologies: string[];
  testingTypes: TestingType[];
  signals: Signal[];
  complexity: "low" | "medium" | "high";
  contentPotential: number;
  testsTouched: boolean;
  narrative: boolean;
}

interface DiffFile {
  path: string;
  added: string[];
  removed: string[];
}

export function parseDiff(diff: string): DiffFile[] {
  const out: DiffFile[] = [];
  for (const section of diff.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(section);
    if (!m) continue;
    const f: DiffFile = { path: m[2]!, added: [], removed: [] };
    for (const line of section.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) f.added.push(line.slice(1));
      else if (line.startsWith("-")) f.removed.push(line.slice(1));
    }
    out.push(f);
  }
  return out;
}

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|e2e|spec|specs|cypress|playwright)\/|\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/i;

const MAX_EXCERPTS = 3;
const trimLine = (s: string) => s.trim().slice(0, 160);

interface Ctx {
  commits: RawCommit[];
  diffs: Array<{ sha: string; files: DiffFile[] }>;
  paths: string[];
  text: string;
  stack: RepoStack;
}

function collect(ctx: Ctx, side: "added" | "removed", re: RegExp, pathRe?: RegExp): Excerpt[] {
  const out: Excerpt[] = [];
  for (const d of ctx.diffs) {
    for (const f of d.files) {
      if (pathRe && !pathRe.test(f.path)) continue;
      for (const line of f[side]) {
        if (re.test(line)) {
          out.push({ sha: d.sha, path: f.path, line: trimLine(line) });
          if (out.length >= MAX_EXCERPTS) return out;
        }
      }
    }
  }
  return out;
}

type Detector = (ctx: Ctx) => Signal | null;

const sig = (rule_id: string, description: string, areas: TechnicalArea[], weight: number, excerpts: Excerpt[] = []): Signal => ({
  rule_id,
  description,
  areas,
  weight,
  excerpts,
});

const DETECTORS: Detector[] = [
  (c) => {
    const ex = collect(c, "removed", /waitForTimeout\(|time\.sleep\(|Thread\.sleep\(|cy\.wait\(\d|\bsleep\(\d/);
    return ex.length ? sig("flaky.remove-hard-wait", "Removed fixed sleeps or hard waits from tests", ["flaky tests", "test reliability"], 0.2, ex) : null;
  },
  (c) => {
    const ex = collect(c, "added", /expect\(.*\)\.(not\.)?to(BeVisible|HaveText|HaveURL|BeEnabled|HaveCount|ContainText|HaveValue|BeChecked|BeHidden)/);
    return ex.length ? sig("assertions.web-first", "Added web-first (auto-retrying) assertions", ["test reliability"], 0.08, ex) : null;
  },
  (c) =>
    /\b(flak(y|iness|e)|intermittent(ly)?|unstable|non-?deterministic|race condition)\b/i.test(c.text)
      ? sig("flaky.keywords", "Commit text describes flaky or intermittent behaviour", ["flaky tests", "test reliability"], 0.2)
      : null,
  (c) => {
    const re = /\b(retries|timeout|actionTimeout|navigationTimeout)\b/;
    const cfg = /(playwright|jest|vitest)\.config\.|pytest\.ini|conftest\.py|setup\.cfg/;
    const ex = [...collect(c, "added", re, cfg), ...collect(c, "removed", re, cfg)].slice(0, MAX_EXCERPTS);
    return ex.length ? sig("flaky.retries-config", "Changed retry or timeout configuration", ["test reliability"], 0.12, ex) : null;
  },
  (c) => {
    const ex = collect(c, "added", /getBy(Role|TestId|Label|Text|Placeholder)\(|data-test-?id/);
    return ex.length ? sig("locator.strategy", "Changed how elements are located (user-facing or test-id locators)", ["UI testing", "test architecture"], 0.12, ex) : null;
  },
  (c) => {
    const addedPw = c.commits.some((x) => x.files.some((f) => f.additions > 0 && /playwright|\.spec\.[jt]s$/i.test(f.path)));
    const removedSel = c.commits.some((x) => x.files.some((f) => f.deletions > 0 && f.additions === 0 && /selenium|webdriver/i.test(f.path)));
    const text = /(selenium[\s\S]*playwright|playwright[\s\S]*selenium)/i.test(c.text) && /(migrat|port|replac|convert|mov)/i.test(c.text);
    return (addedPw && removedSel) || text
      ? sig("migration.selenium-to-playwright", "Migration from Selenium to Playwright", ["Selenium", "Playwright", "test automation"], 0.25)
      : null;
  },
  (c) => {
    const ci = c.paths.filter((p) => /^\.circleci\/|^\.github\/workflows\/|(^|\/)Jenkinsfile$|\.gitlab-ci\.ya?ml$|azure-pipelines/.test(p));
    if (!ci.length) return null;
    const areas: TechnicalArea[] = ["CI/CD"];
    if (ci.some((p) => p.startsWith(".circleci/"))) areas.push("CircleCI");
    if (ci.some((p) => p.startsWith(".github/workflows/"))) areas.push("GitHub");
    return sig("ci.config", "Changed CI/CD pipeline configuration", areas, 0.1);
  },
  (c) =>
    /\b(parallel(i[sz]e|ism)?|shard(ing|s)?|speed(ing)? up|faster|execution time|run ?time|duration|caching|workers)\b/i.test(c.text)
      ? sig("perf.execution-time", "Work aimed at making test runs faster", ["test automation", "test reliability"], 0.15)
      : null,
  (c) =>
    c.paths.some((p) => /(^|\/)(Dockerfile[^/]*|docker-compose[^/]*\.ya?ml)$/.test(p)) ? sig("docker", "Changed Docker configuration", ["Docker"], 0.05) : null,
  (c) => {
    const aws = c.paths.filter((p) => /(serverless\.ya?ml|(^|\/)template\.ya?ml|cdk\.json|\.tf$|cloudformation)/i.test(p));
    const lambda = c.paths.filter((p) => /lambda/i.test(p));
    if (!aws.length && !lambda.length) return null;
    const areas: TechnicalArea[] = [];
    if (aws.length) areas.push("AWS");
    if (lambda.length) areas.push("Lambda");
    return sig("aws", "Changed AWS or Lambda related files", areas, 0.08);
  },
  (c) => {
    const re = /\b(axe|AxeBuilder|a11y|aria-[a-z]+|accessib(le|ility)|toHaveAccessible\w*|wcag)\b/i;
    const ex = collect(c, "added", re);
    return ex.length || re.test(c.text) ? sig("accessibility", "Accessibility testing work", ["accessibility"], 0.15, ex) : null;
  },
  (c) => {
    const re = /\b(LLM|GenAI|ChatGPT|OpenAI|Copilot|Claude|Anthropic|Gemini|generative ai|ai-assisted|ai-generated)\b/i;
    const ex = collect(c, "added", re);
    return ex.length || re.test(c.text) ? sig("genai", "Involves generative AI tooling", ["Generative AI"], 0.15, ex) : null;
  },
  (c) => {
    const testFile = (p: string) => TEST_PATH_RE.test(p);
    const apiDir = c.paths.some((p) => testFile(p) && /(^|\/)apis?\//i.test(p));
    const ex = collect(c, "added", /\b(request\.(get|post|put|delete|patch)\(|supertest|APIRequestContext|requests\.(get|post|put|delete)\()/, TEST_PATH_RE);
    return apiDir || ex.length ? sig("api-testing", "API-level test work", ["API testing"], 0.1, ex) : null;
  },
  (c) => {
    const fw = c.paths.filter((p) => /(^|\/)(pages?|page-objects?|fixtures?|helpers?|utils?|support|base)\//i.test(p) && /tests?|e2e|cypress|playwright/i.test(p));
    const cls = collect(c, "added", /\bclass \w+Page\b|extends Base\w*/);
    return fw.length >= 2 || cls.length ? sig("framework.design", "Test framework structure (page objects, fixtures, helpers)", ["test framework design", "test architecture"], 0.15, cls) : null;
  },
  (c) =>
    /\b(debug|root cause|investigat|trace viewer|stack trace|diagnos)/i.test(c.text) ? sig("debugging", "Commit text describes debugging or investigation", ["debugging"], 0.1) : null,
];

function testingTypesOf(ctx: Ctx, areas: Set<TechnicalArea>): TestingType[] {
  const t = new Set<TestingType>();
  const paths = ctx.paths.join("\n");
  const testPaths = ctx.paths.filter((p) => TEST_PATH_RE.test(p));
  if (/(^|\/)e2e\//i.test(paths) || (areas.has("Playwright") && testPaths.length)) t.add("e2e");
  if (areas.has("UI testing") || areas.has("Selenium") || areas.has("Playwright")) t.add("ui");
  if (areas.has("API testing")) t.add("api");
  if (/(^|\/)unit\/|\.test\.[cm]?[jt]sx?$/i.test(paths)) t.add("unit");
  if (/integration/i.test(paths)) t.add("integration");
  if (/smoke/i.test(paths) || /\bsmoke\b/i.test(ctx.text)) t.add("smoke");
  if (/sanity/i.test(paths) || /\bsanity\b/i.test(ctx.text)) t.add("sanity");
  if (/regression/i.test(paths) || /\bregression\b/i.test(ctx.text)) t.add("regression");
  if (areas.has("accessibility")) t.add("accessibility");
  return [...t];
}

export function classify(cluster: Cluster, stack: RepoStack): Classification {
  const commits = cluster.commits;
  const paths = [...new Set(commits.flatMap((c) => c.files.map((f) => f.path)))];
  const ctx: Ctx = {
    commits,
    diffs: commits.map((c) => ({ sha: c.sha, files: parseDiff(c.diff) })),
    paths,
    text: commits.map((c) => `${c.subject}\n${c.body}`).join("\n"),
    stack,
  };

  const signals = DETECTORS.map((d) => d(ctx)).filter((s): s is Signal => s !== null);
  const areas = new Set<TechnicalArea>(signals.flatMap((s) => s.areas));

  const testFiles = paths.filter((p) => TEST_PATH_RE.test(p));
  const testsTouched = testFiles.length > 0;
  if (testsTouched) areas.add("test automation");
  const pwInDiff = ctx.diffs.some((d) => d.files.some((f) => [...f.added, ...f.removed].some((l) => /@playwright\/test|\bpage\.(goto|locator|getBy)/.test(l))));
  if ((testsTouched && stack.technologies.includes("Playwright")) || pwInDiff) areas.add("Playwright");
  if (paths.some((p) => /\.tsx?$/.test(p))) areas.add("TypeScript");
  if (paths.some((p) => /\.[cm]?jsx?$/.test(p))) areas.add("JavaScript");
  if (paths.some((p) => /\.py$/.test(p))) {
    areas.add("Python");
    const pytestUse = ctx.diffs.some((d) => d.files.some((f) => f.added.some((l) => /import pytest|def test_/.test(l)))) || paths.some((p) => /(^|\/)test_[^/]+\.py$/.test(p));
    if (pytestUse && stack.technologies.includes("Pytest")) areas.add("Pytest");
  }

  const toolNames = new Set(["Playwright", "Selenium", "TypeScript", "JavaScript", "Python", "Pytest", "CircleCI", "GitHub", "Docker", "AWS", "Lambda"]);
  const technologies = [...areas].filter((a) => toolNames.has(a));

  const churn = commits.reduce((n, c) => n + c.files.reduce((m, f) => m + f.additions + f.deletions, 0), 0);
  const complexity: Classification["complexity"] =
    paths.length >= 10 || churn > 400 || signals.length >= 4 ? "high" : paths.length <= 2 && churn < 60 && signals.length <= 1 ? "low" : "medium";

  const mineShare = commits.filter((c) => c.authoredByMe).length / Math.max(commits.length, 1);
  const narrative = commits.some((c) => c.body.trim().length >= 40);
  let potential = 0.1;
  if (signals.length > 0 || testsTouched) potential += 0.2 * mineShare;
  potential += Math.min(0.45, signals.reduce((n, s) => n + s.weight, 0));
  if (narrative) potential += 0.1;
  if (testsTouched) potential += 0.1;
  const contentPotential = Math.round(Math.min(1, Math.max(0, potential)) * 100) / 100;

  return {
    areas: [...areas],
    technologies,
    testingTypes: testingTypesOf(ctx, areas),
    signals,
    complexity,
    contentPotential,
    testsTouched,
    narrative,
  };
}
