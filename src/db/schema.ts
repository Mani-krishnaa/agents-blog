/** Ordered, append-only migrations. Never edit an applied migration; add a new one. */
export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Company repositories are read-only data sources. The database refuses anything else.
  read_only INTEGER NOT NULL DEFAULT 1 CHECK (read_only = 1),
  last_scan_tips TEXT NOT NULL DEFAULT '[]',
  last_scan_at TEXT
);

CREATE TABLE scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  commits_seen INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  json TEXT NOT NULL,                 -- redacted WorkItem
  privacy_status TEXT NOT NULL CHECK (privacy_status IN ('PUBLIC_SAFE','NEEDS_REVIEW','PRIVATE')),
  confidence TEXT NOT NULL,
  content_potential REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_work_items_repo ON work_items(repo_id);

CREATE TABLE evidence (
  id TEXT NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  excerpt_redacted TEXT,
  hash TEXT NOT NULL,
  PRIMARY KEY (work_item_id, id)
);

CREATE TABLE privacy_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,         -- work_item | idea | draft | asset
  subject_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('PRIVATE','NEEDS_REVIEW')),
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resolution TEXT,
  resolved_at TEXT,
  UNIQUE (subject_type, subject_id, fingerprint)
);

CREATE TABLE content_ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hook TEXT NOT NULL,
  json TEXT NOT NULL,
  privacy_status TEXT NOT NULL CHECK (privacy_status IN ('PUBLIC_SAFE','NEEDS_REVIEW','PRIVATE')),
  confidence TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  idea_id TEXT REFERENCES content_ideas(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                 -- linkedin | article
  format TEXT,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'DRAFT',
  privacy_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (privacy_status IN ('PUBLIC_SAFE','NEEDS_REVIEW','PRIVATE')),
  user_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  passed INTEGER NOT NULL,
  blockers TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  draft_id TEXT REFERENCES drafts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- image | carousel | video | thumbnail | svg
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  privacy_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK (privacy_status IN ('PUBLIC_SAFE','NEEDS_REVIEW','PRIVATE')),
  generator TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  decision TEXT NOT NULL,             -- approved | rejected | privacy_override
  content_hash TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE publishing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  remote_id TEXT,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  error TEXT
);
`,
  },
];
