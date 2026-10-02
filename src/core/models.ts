import crypto from "node:crypto";
import { z } from "zod";

export const PRIVACY_STATUSES = ["PUBLIC_SAFE", "NEEDS_REVIEW", "PRIVATE"] as const;
export const PrivacyStatus = z.enum(PRIVACY_STATUSES);
export type PrivacyStatus = z.infer<typeof PrivacyStatus>;

/** Worst (most restrictive) first. Used so derived items inherit the strictest status of their sources. */
export function worstPrivacy(statuses: PrivacyStatus[]): PrivacyStatus {
  if (statuses.length === 0) return "NEEDS_REVIEW";
  if (statuses.includes("PRIVATE")) return "PRIVATE";
  if (statuses.includes("NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "PUBLIC_SAFE";
}

export const Confidence = z.enum(["LOW_CONFIDENCE", "MEDIUM", "HIGH"]);
export type Confidence = z.infer<typeof Confidence>;

export const TECHNICAL_AREAS = [
  "Playwright",
  "Selenium",
  "TypeScript",
  "JavaScript",
  "Python",
  "Pytest",
  "API testing",
  "UI testing",
  "CI/CD",
  "CircleCI",
  "GitHub",
  "Docker",
  "AWS",
  "Lambda",
  "accessibility",
  "regression testing",
  "smoke testing",
  "sanity testing",
  "test architecture",
  "test automation",
  "debugging",
  "flaky tests",
  "test reliability",
  "test framework design",
  "Generative AI",
] as const;
export const TechnicalArea = z.enum(TECHNICAL_AREAS);
export type TechnicalArea = z.infer<typeof TechnicalArea>;

export const TESTING_TYPES = ["ui", "api", "e2e", "unit", "integration", "regression", "smoke", "sanity", "accessibility", "performance"] as const;
export const TestingType = z.enum(TESTING_TYPES);
export type TestingType = z.infer<typeof TestingType>;

export const ClaimBasis = z.enum(["EVIDENCE", "INFERRED", "GENERAL_KNOWLEDGE", "USER_STATED"]);
export type ClaimBasis = z.infer<typeof ClaimBasis>;

/** A statement plus where it comes from. A claim with basis EVIDENCE/INFERRED must cite evidence ids. */
export const Claim = z
  .object({
    text: z.string().min(1),
    basis: ClaimBasis,
    evidence_refs: z.array(z.string()).default([]),
  })
  .superRefine((c, ctx) => {
    if ((c.basis === "EVIDENCE" || c.basis === "INFERRED") && c.evidence_refs.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${c.basis} claim must cite evidence_refs` });
    }
  });
export type Claim = z.infer<typeof Claim>;

export const EvidenceKind = z.enum(["commit", "file", "diff", "test", "config", "note"]);
export const Evidence = z.object({
  id: z.string(),
  kind: EvidenceKind,
  ref: z.string(), // commit sha, file path, "sha:path"
  excerpt_redacted: z.string().optional(),
  hash: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Finding = z.object({
  rule_id: z.string(),
  severity: z.enum(["PRIVATE", "NEEDS_REVIEW"]),
  message: z.string(),
  /** Where it was found: "title", "commit:<sha>:subject", "file:<path>", "draft:body" ... Never contains the matched secret. */
  location: z.string(),
  /** Stable hash of rule+location+matched text so a resolution can be tied to the exact finding. */
  fingerprint: z.string(),
});
export type Finding = z.infer<typeof Finding>;

export const WorkCommit = z.object({
  sha: z.string(),
  subject_redacted: z.string(),
  authored_by_me: z.boolean(),
  date: z.string(),
});

export const FileChange = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const WorkItem = z.object({
  id: z.string(),
  repository: z.string(),
  source_kind: z.enum(["repo", "note", "external", "milestone"]).default("repo"),
  origin: z.enum(["MY_WORK", "INDUSTRY_UPDATE", "CAREER_MILESTONE"]).default("MY_WORK"),
  date_start: z.string(),
  date_end: z.string(),
  title: z.string(),
  problem: Claim.nullable(),
  solution: Claim.nullable(),
  technical_area: z.array(TechnicalArea),
  technologies: z.array(z.string()),
  testing_type: z.array(TestingType),
  files_changed: z.array(FileChange),
  commits: z.array(WorkCommit),
  evidence: z.array(Evidence),
  impact: Claim.nullable(),
  complexity: z.enum(["low", "medium", "high"]),
  interesting_factors: z.array(z.object({ rule_id: z.string(), description: z.string() })),
  privacy_status: PrivacyStatus,
  privacy_findings: z.array(Finding),
  content_potential: z.number().min(0).max(1),
  confidence: Confidence,
  analysis_source: z.enum(["heuristic", "heuristic+agent"]).default("heuristic"),
  /** Things we could not learn from code and need the user to supply (feeds the Phase 2 interview). */
  unknowns: z.array(z.string()).default([]),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const IdeaFormat = z.enum([
  "technical story",
  "lesson learned",
  "debugging story",
  "tutorial",
  "mistake/lesson",
  "comparison",
  "checklist",
  "short technical insight",
  "carousel introduction",
]);

export const Idea = z.object({
  id: z.string(),
  title: z.string(),
  hook: z.string(),
  source_work: z.array(z.string()).min(1),
  technical_lesson: Claim,
  audience: z.string(),
  recommended_format: IdeaFormat,
  privacy_status: PrivacyStatus,
  confidence: Confidence,
  evidence: z.array(z.string()),
  state: z.enum(["NEW", "ENRICHED", "DRAFTED", "DISMISSED"]).default("NEW"),
});
export type Idea = z.infer<typeof Idea>;

export function shortHash(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}

export function fullHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function evidenceId(kind: string, ref: string): string {
  return `ev_${shortHash(kind, ref).slice(0, 8)}`;
}
