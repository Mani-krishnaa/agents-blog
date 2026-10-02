import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../../src/db/store.ts";
import { buildWorkItem } from "../../src/agents/work-analysis-agent/build.ts";
import type { PrivacyConfig } from "../../src/core/config.ts";
import type { Idea } from "../../src/core/models.ts";
import { mkCommit } from "../helpers.ts";

const privacy: PrivacyConfig = { company_terms: [], client_terms: [], internal_product_terms: [], internal_domains: [], allowlist: [] };
const stack = { technologies: ["Playwright"], hasPlaywrightConfig: true };

function wi(repo = "he-qa", subject = "fix: remove sleeps (#1)") {
  return buildWorkItem(repo, { commits: [mkCommit({ subject, body: "Test failed intermittently because of a fixed wait.", lines: ["-  await page.waitForTimeout(3000);"] })] }, stack, privacy);
}

let store: Store;
beforeEach(() => {
  store = new Store(":memory:");
});

describe("migrations", () => {
  it("are idempotent and create all tables", () => {
    store.close();
    const s = new Store(":memory:");
    s.migrate();
    s.migrate();
    const tables = s.tableNames();
    for (const t of ["repositories", "scans", "work_items", "evidence", "privacy_findings", "content_ideas", "drafts", "audit_reports", "assets", "approvals", "publishing_history"]) {
      expect(tables).toContain(t);
    }
  });

  it("enforces read_only = 1 on repositories at the database level", () => {
    store.upsertRepository({ name: "a", path: "/tmp/a", enabled: true });
    expect(() => store.rawExec("UPDATE repositories SET read_only = 0")).toThrow();
  });
});

describe("repositories and scans", () => {
  it("stores scan state per repository and returns the latest tips", () => {
    store.upsertRepository({ name: "he-qa", path: "/tmp/x", enabled: true });
    expect(store.getScanState("he-qa").tips).toEqual([]);
    store.recordScan("he-qa", { tips: ["aaa", "bbb"], commitsSeen: 3, status: "ok", warnings: ["w"] });
    const s = store.getScanState("he-qa");
    expect(s.tips).toEqual(["aaa", "bbb"]);
    expect(s.lastScanAt).toBeTruthy();
  });

  it("upserting a repository twice keeps one row", () => {
    store.upsertRepository({ name: "a", path: "/tmp/a", enabled: true });
    store.upsertRepository({ name: "a", path: "/tmp/b", enabled: false });
    expect(store.listRepositories()).toHaveLength(1);
    expect(store.listRepositories()[0]).toMatchObject({ path: "/tmp/b", enabled: false });
  });
});

describe("work items", () => {
  it("round-trips a validated WorkItem with evidence and findings", () => {
    store.upsertRepository({ name: "he-qa", path: "/tmp/x", enabled: true });
    const item = wi();
    store.upsertWorkItem(item);
    expect(store.getWorkItem(item.id)).toEqual(item);
    expect(store.evidenceIdsFor([item.id]).size).toBe(item.evidence.length);
  });

  it("upsert replaces the same id instead of duplicating", () => {
    store.upsertRepository({ name: "he-qa", path: "/tmp/x", enabled: true });
    const item = wi();
    store.upsertWorkItem(item);
    store.upsertWorkItem({ ...item, title: "Changed" });
    expect(store.listWorkItems()).toHaveLength(1);
    expect(store.getWorkItem(item.id)?.title).toBe("Changed");
  });

  it("filters by repository, privacy status and content potential", () => {
    store.upsertRepository({ name: "a", path: "/tmp/a", enabled: true });
    store.upsertRepository({ name: "b", path: "/tmp/b", enabled: true });
    const x = wi("a", "fix: one (#1)");
    const y = { ...wi("b", "fix: two (#2)"), privacy_status: "PRIVATE" as const, content_potential: 0.1 };
    store.upsertWorkItem(x);
    store.upsertWorkItem(y);
    expect(store.listWorkItems({ repository: "a" }).map((w) => w.id)).toEqual([x.id]);
    expect(store.listWorkItems({ privacyStatus: "PRIVATE" }).map((w) => w.id)).toEqual([y.id]);
    expect(store.listWorkItems({ minPotential: 0.5 }).map((w) => w.id)).toEqual([x.id]);
  });

  it("refuses a work item for an unknown repository", () => {
    expect(() => store.upsertWorkItem(wi("ghost"))).toThrow(/repository/i);
  });

  it("keeps a user's finding resolution when the same work item is rediscovered", () => {
    store.upsertRepository({ name: "he-qa", path: "/tmp/x", enabled: true });
    const secret = "AKIA" + "ABCDEFGHIJKLMNOP";
    const item = buildWorkItem("he-qa", { commits: [mkCommit({ subject: `fix: key ${secret}`, sha: "c".repeat(40) })] }, stack, privacy);
    store.upsertWorkItem(item);
    const f = store.listFindings("work_item", item.id)[0]!;
    store.resolveFinding(f.fingerprint, "redacted");
    store.upsertWorkItem(item);
    expect(store.listFindings("work_item", item.id).find((x) => x.fingerprint === f.fingerprint)?.resolution).toBe("redacted");
  });
});

describe("ideas", () => {
  const idea = (workId: string): Idea => ({
    id: "idea_1",
    title: "Replace fixed waits",
    hook: "A test that failed intermittently",
    source_work: [workId],
    technical_lesson: { text: "Fixed waits make tests flaky.", basis: "GENERAL_KNOWLEDGE", evidence_refs: [] },
    audience: "QA/SDET engineers",
    recommended_format: "debugging story",
    privacy_status: "NEEDS_REVIEW",
    confidence: "MEDIUM",
    evidence: [],
    state: "NEW",
  });

  it("round-trips and updates ideas", () => {
    store.upsertRepository({ name: "he-qa", path: "/tmp/x", enabled: true });
    const w = wi();
    store.upsertWorkItem(w);
    store.upsertIdea(idea(w.id));
    expect(store.getIdea("idea_1")).toEqual(idea(w.id));
    store.setIdeaState("idea_1", "DISMISSED");
    expect(store.getIdea("idea_1")?.state).toBe("DISMISSED");
    expect(store.listIdeas({ state: "NEW" })).toHaveLength(0);
  });

  it("counts for the status summary", () => {
    store.upsertRepository({ name: "he-qa", path: "/tmp/x", enabled: true });
    const w = wi();
    store.upsertWorkItem(w);
    store.upsertIdea(idea(w.id));
    expect(store.counts()).toMatchObject({ repositories: 1, work_items: 1, ideas: 1, drafts: 0 });
  });
});
