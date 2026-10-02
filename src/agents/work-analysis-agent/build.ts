import type { PrivacyConfig } from "../../core/config.ts";
import {
  evidenceId,
  fullHash,
  shortHash,
  type Claim,
  type Evidence,
  type Finding,
  type WorkItem,
} from "../../core/models.ts";
import { detect, redact, statusFromFindings } from "../privacy-agent/index.ts";
import type { RepoStack } from "../repository-agent/scanner.ts";
import { classify } from "./classify.ts";
import type { Cluster } from "./cluster.ts";

const MAX_FILES = 50;

/** Turns a cluster of commits into a WorkItem. Everything stored is redacted; findings are computed on the raw text. */
export function buildWorkItem(repository: string, cluster: Cluster, stack: RepoStack, privacy: PrivacyConfig): WorkItem {
  const commits = [...cluster.commits].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const cls = classify({ commits }, stack);
  const clean = (t: string) => redact(t, privacy).text;
  const findings: Finding[] = [];
  const scan = (raw: string, location: string) => {
    for (const f of detect(raw, privacy, location, { context: "internal" })) {
      if (!findings.some((x) => x.fingerprint === f.fingerprint)) findings.push(f);
    }
  };

  const lead = commits.find((c) => c.authoredByMe) ?? commits[0]!;
  const rawTitle = lead.subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "").trim() || lead.subject;
  const title = clean(rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1));
  scan(rawTitle, "title");

  const evidence: Evidence[] = [];
  const addEvidence = (kind: Evidence["kind"], rawRef: string, ref: string, excerpt?: string): string => {
    const id = evidenceId(kind, rawRef);
    if (!evidence.some((e) => e.id === id)) {
      evidence.push({ id, kind, ref, excerpt_redacted: excerpt, hash: fullHash(`${kind}:${rawRef}`) });
    }
    return id;
  };

  const commitEvidence = new Map<string, string>();
  for (const c of commits) {
    const sha8 = c.sha.slice(0, 8);
    scan(c.subject, `commit:${sha8}:subject`);
    if (c.body) scan(c.body, `commit:${sha8}:body`);
    if (c.diff) scan(c.diff, `commit:${sha8}:diff`);
    commitEvidence.set(c.sha, addEvidence("commit", c.sha, c.sha, clean(c.subject)));
  }

  const filesMap = new Map<string, { additions: number; deletions: number }>();
  for (const c of commits) {
    for (const f of c.files) {
      const cur = filesMap.get(f.path) ?? { additions: 0, deletions: 0 };
      filesMap.set(f.path, { additions: cur.additions + f.additions, deletions: cur.deletions + f.deletions });
    }
  }
  const files_changed = [...filesMap.entries()].slice(0, MAX_FILES).map(([p, v]) => {
    const cp = clean(p);
    scan(p, `file:${cp}`);
    return { path: cp, ...v };
  });

  const signalEvidenceIds: string[] = [];
  for (const s of cls.signals) {
    for (const ex of s.excerpts) {
      signalEvidenceIds.push(addEvidence("diff", `${ex.sha}:${ex.path}:${s.rule_id}`, `${ex.sha.slice(0, 8)}:${clean(ex.path)}`, clean(ex.line)));
    }
  }
  const configPaths = [...filesMap.keys()].filter((p) => /^\.circleci\/|^\.github\/workflows\/|Dockerfile|docker-compose|serverless\.ya?ml|\.tf$/.test(p)).slice(0, 5);
  for (const p of configPaths) signalEvidenceIds.push(addEvidence("config", p, clean(p)));
  for (const p of [...filesMap.keys()].filter((p) => /(^|\/)(tests?|e2e|spec)s?\//i.test(p) || /\.(spec|test)\.[jt]sx?$/.test(p)).slice(0, 5)) {
    addEvidence("test", p, clean(p));
  }

  // Problem: only what a commit message actually says. Never inferred from the diff.
  let problem: Claim | null = null;
  const narrator = commits.find((c) => c.authoredByMe && c.body.trim().length >= 15) ?? commits.find((c) => c.body.trim().length >= 15);
  if (narrator) {
    const para = narrator.body.trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, " ").slice(0, 280);
    problem = { text: clean(para), basis: "EVIDENCE", evidence_refs: [commitEvidence.get(narrator.sha)!] };
    scan(para, `commit:${narrator.sha.slice(0, 8)}:problem`);
  }

  const signalText = cls.signals.length ? ` Diff signals: ${cls.signals.map((s) => s.description).join("; ")}.` : "";
  const solution: Claim = {
    text: `${clean(lead.subject)}.${signalText}`,
    basis: "EVIDENCE",
    evidence_refs: [commitEvidence.get(lead.sha)!, ...signalEvidenceIds.slice(0, 5)],
  };

  const mine = commits.filter((c) => c.authoredByMe).length;
  const unknowns = [
    "What was difficult about this work (not visible in code)",
    "What you learned from it (not visible in code)",
    "Measurable impact (no results are recorded in the repository)",
  ];
  if (!problem) unknowns.unshift("Problem being solved (the commit message gives no explanation)");
  if (mine === 0) unknowns.unshift("Whether this was your own work (no commit is attributed to you)");

  let confidence: WorkItem["confidence"];
  if (mine === 0) confidence = "LOW_CONFIDENCE";
  else if (mine === commits.length && cls.testsTouched && cls.narrative && cls.signals.length > 0) confidence = "HIGH";
  else if (cls.signals.length === 0 && !cls.narrative) confidence = "LOW_CONFIDENCE";
  else confidence = "MEDIUM";

  // Records derived from company repositories are never auto PUBLIC_SAFE: detection cannot rule out confidential logic.
  const detected = statusFromFindings(findings);
  const privacy_status = detected === "PUBLIC_SAFE" ? "NEEDS_REVIEW" : detected;

  const dates = commits.map((c) => c.date).sort();
  return {
    id: `wi_${shortHash(repository, ...commits.map((c) => c.sha).sort())}`,
    repository,
    source_kind: "repo",
    origin: "MY_WORK",
    date_start: dates[0]!,
    date_end: dates[dates.length - 1]!,
    title,
    problem,
    solution,
    technical_area: cls.areas,
    technologies: cls.technologies,
    testing_type: cls.testingTypes,
    files_changed,
    commits: commits.map((c) => ({ sha: c.sha, subject_redacted: clean(c.subject), authored_by_me: c.authoredByMe, date: c.date })),
    evidence,
    impact: null,
    complexity: cls.complexity,
    interesting_factors: cls.signals.map((s) => ({ rule_id: s.rule_id, description: s.description })),
    privacy_status,
    privacy_findings: findings,
    content_potential: cls.contentPotential,
    confidence,
    analysis_source: "heuristic",
    unknowns,
  };
}
