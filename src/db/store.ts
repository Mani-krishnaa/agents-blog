import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { Idea, WorkItem, type Finding, type PrivacyStatus } from "../core/models.ts";
import { MIGRATIONS } from "./schema.ts";

export interface RepoRow {
  id: number;
  name: string;
  path: string;
  enabled: boolean;
  lastScanAt: string | null;
}

export interface FindingRow extends Finding {
  resolution: string | null;
  resolved_at: string | null;
}

export interface WorkItemFilter {
  repository?: string;
  privacyStatus?: PrivacyStatus;
  minPotential?: number;
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;
const now = () => new Date().toISOString();

// Loaded via require so bundlers/test runners that don't know the `node:sqlite` builtin leave it alone.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

export class Store {
  private db: DatabaseSyncType;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set((this.db.prepare("SELECT version FROM schema_migrations").all() as Row[]).map((r) => Number(r.version)));
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.tx(() => {
        this.db.exec(m.sql);
        this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, now());
      });
    }
  }

  tableNames(): string[] {
    return (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) => String(r.name));
  }

  /** Test helper only. */
  rawExec(sql: string): void {
    this.db.exec(sql);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---- repositories & scans ----

  upsertRepository(r: { name: string; path: string; enabled: boolean }): void {
    this.db
      .prepare(
        `INSERT INTO repositories (name, path, enabled, read_only) VALUES (?, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET path = excluded.path, enabled = excluded.enabled`,
      )
      .run(r.name, r.path, r.enabled ? 1 : 0);
  }

  listRepositories(): RepoRow[] {
    return (this.db.prepare("SELECT id, name, path, enabled, last_scan_at FROM repositories ORDER BY name").all() as Row[]).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      path: String(r.path),
      enabled: r.enabled === 1,
      lastScanAt: (r.last_scan_at as string | null) ?? null,
    }));
  }

  private repoId(name: string): number {
    const r = this.db.prepare("SELECT id FROM repositories WHERE name = ?").get(name) as Row | undefined;
    if (!r) throw new Error(`Unknown repository "${name}". Run a scan or check config/repos.yaml.`);
    return Number(r.id);
  }

  getScanState(repoName: string): { tips: string[]; lastScanAt: string | null } {
    const r = this.db.prepare("SELECT last_scan_tips, last_scan_at FROM repositories WHERE name = ?").get(repoName) as Row | undefined;
    if (!r) throw new Error(`Unknown repository "${repoName}".`);
    return { tips: JSON.parse(String(r.last_scan_tips)) as string[], lastScanAt: (r.last_scan_at as string | null) ?? null };
  }

  recordScan(repoName: string, s: { tips: string[]; commitsSeen: number; status: string; warnings: string[] }): void {
    const id = this.repoId(repoName);
    const t = now();
    this.tx(() => {
      this.db
        .prepare("INSERT INTO scans (repo_id, started_at, finished_at, commits_seen, status, warnings) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, t, t, s.commitsSeen, s.status, JSON.stringify(s.warnings));
      if (s.status === "ok") {
        this.db.prepare("UPDATE repositories SET last_scan_tips = ?, last_scan_at = ? WHERE id = ?").run(JSON.stringify(s.tips), t, id);
      }
    });
  }

  // ---- work items ----

  upsertWorkItem(input: WorkItem): void {
    const item = WorkItem.parse(input);
    const repoId = this.repoId(item.repository);
    this.tx(() => {
      const carried = new Map<string, { resolution: string | null; resolved_at: string | null }>();
      for (const r of this.db
        .prepare("SELECT fingerprint, resolution, resolved_at FROM privacy_findings WHERE subject_type = 'work_item' AND subject_id = ?")
        .all(item.id) as Row[]) {
        carried.set(String(r.fingerprint), { resolution: (r.resolution as string | null) ?? null, resolved_at: (r.resolved_at as string | null) ?? null });
      }
      const exists = this.db.prepare("SELECT created_at FROM work_items WHERE id = ?").get(item.id) as Row | undefined;
      const t = now();
      this.db
        .prepare(
          `INSERT INTO work_items (id, repo_id, title, date_start, date_end, json, privacy_status, confidence, content_potential, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, date_start = excluded.date_start, date_end = excluded.date_end,
             json = excluded.json, privacy_status = excluded.privacy_status, confidence = excluded.confidence,
             content_potential = excluded.content_potential, updated_at = excluded.updated_at`,
        )
        .run(item.id, repoId, item.title, item.date_start, item.date_end, JSON.stringify(item), item.privacy_status, item.confidence, item.content_potential, String(exists?.created_at ?? t), t);

      this.db.prepare("DELETE FROM evidence WHERE work_item_id = ?").run(item.id);
      const insEv = this.db.prepare("INSERT OR REPLACE INTO evidence (id, work_item_id, kind, ref, excerpt_redacted, hash) VALUES (?, ?, ?, ?, ?, ?)");
      for (const e of item.evidence) insEv.run(e.id, item.id, e.kind, e.ref, e.excerpt_redacted ?? null, e.hash);

      this.db.prepare("DELETE FROM privacy_findings WHERE subject_type = 'work_item' AND subject_id = ?").run(item.id);
      const insF = this.db.prepare(
        `INSERT OR IGNORE INTO privacy_findings (subject_type, subject_id, rule_id, severity, location, message, fingerprint, resolution, resolved_at)
         VALUES ('work_item', ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const f of item.privacy_findings) {
        const c = carried.get(f.fingerprint);
        insF.run(item.id, f.rule_id, f.severity, f.location, f.message, f.fingerprint, c?.resolution ?? null, c?.resolved_at ?? null);
      }
    });
  }

  getWorkItem(id: string): WorkItem | null {
    const r = this.db.prepare("SELECT json FROM work_items WHERE id = ?").get(id) as Row | undefined;
    return r ? WorkItem.parse(JSON.parse(String(r.json))) : null;
  }

  listWorkItems(f: WorkItemFilter = {}): WorkItem[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (f.repository) {
      where.push("r.name = ?");
      args.push(f.repository);
    }
    if (f.privacyStatus) {
      where.push("w.privacy_status = ?");
      args.push(f.privacyStatus);
    }
    if (f.minPotential !== undefined) {
      where.push("w.content_potential >= ?");
      args.push(f.minPotential);
    }
    const sql = `SELECT w.json FROM work_items w JOIN repositories r ON r.id = w.repo_id
                 ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY w.content_potential DESC, w.date_end DESC`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => WorkItem.parse(JSON.parse(String(r.json))));
  }

  evidenceIdsFor(workItemIds: string[]): Set<string> {
    const out = new Set<string>();
    const stmt = this.db.prepare("SELECT id FROM evidence WHERE work_item_id = ?");
    for (const w of workItemIds) for (const r of stmt.all(w) as Row[]) out.add(String(r.id));
    return out;
  }

  // ---- findings ----

  listFindings(subjectType: string, subjectId: string): FindingRow[] {
    return (
      this.db
        .prepare("SELECT rule_id, severity, location, message, fingerprint, resolution, resolved_at FROM privacy_findings WHERE subject_type = ? AND subject_id = ? ORDER BY id")
        .all(subjectType, subjectId) as Row[]
    ).map((r) => ({
      rule_id: String(r.rule_id),
      severity: r.severity as Finding["severity"],
      location: String(r.location),
      message: String(r.message),
      fingerprint: String(r.fingerprint),
      resolution: (r.resolution as string | null) ?? null,
      resolved_at: (r.resolved_at as string | null) ?? null,
    }));
  }

  saveFindings(subjectType: string, subjectId: string, findings: Finding[]): void {
    const ins = this.db.prepare(
      `INSERT OR IGNORE INTO privacy_findings (subject_type, subject_id, rule_id, severity, location, message, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.tx(() => {
      for (const f of findings) ins.run(subjectType, subjectId, f.rule_id, f.severity, f.location, f.message, f.fingerprint);
    });
  }

  resolveFinding(fingerprint: string, resolution: string): number {
    const res = this.db.prepare("UPDATE privacy_findings SET resolution = ?, resolved_at = ? WHERE fingerprint = ?").run(resolution, now(), fingerprint);
    return Number(res.changes);
  }

  // ---- ideas ----

  upsertIdea(input: Idea): void {
    const idea = Idea.parse(input);
    const t = now();
    this.db
      .prepare(
        `INSERT INTO content_ideas (id, title, hook, json, privacy_status, confidence, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, hook = excluded.hook, json = excluded.json,
           privacy_status = excluded.privacy_status, confidence = excluded.confidence, state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(idea.id, idea.title, idea.hook, JSON.stringify(idea), idea.privacy_status, idea.confidence, idea.state, t, t);
  }

  getIdea(id: string): Idea | null {
    const r = this.db.prepare("SELECT json, state FROM content_ideas WHERE id = ?").get(id) as Row | undefined;
    return r ? Idea.parse({ ...JSON.parse(String(r.json)), state: r.state }) : null;
  }

  listIdeas(f: { state?: Idea["state"]; privacyStatus?: PrivacyStatus } = {}): Idea[] {
    const where: string[] = [];
    const args: string[] = [];
    if (f.state) {
      where.push("state = ?");
      args.push(f.state);
    }
    if (f.privacyStatus) {
      where.push("privacy_status = ?");
      args.push(f.privacyStatus);
    }
    const sql = `SELECT json, state FROM content_ideas ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => Idea.parse({ ...JSON.parse(String(r.json)), state: r.state }));
  }

  setIdeaState(id: string, state: Idea["state"]): void {
    this.db.prepare("UPDATE content_ideas SET state = ?, updated_at = ? WHERE id = ?").run(state, now(), id);
  }

  counts(): Record<"repositories" | "work_items" | "ideas" | "drafts" | "assets" | "publishing_history", number> {
    const c = (t: string) => Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as Row).n);
    return {
      repositories: c("repositories"),
      work_items: c("work_items"),
      ideas: c("content_ideas"),
      drafts: c("drafts"),
      assets: c("assets"),
      publishing_history: c("publishing_history"),
    };
  }
}
