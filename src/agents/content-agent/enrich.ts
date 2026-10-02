import { z } from "zod";
import type { PrivacyConfig } from "../../core/config.ts";
import { Claim, IdeaFormat, worstPrivacy, type Finding, type Idea } from "../../core/models.ts";
import type { Store } from "../../db/store.ts";
import { detect, statusFromFindings } from "../privacy-agent/index.ts";

export class EnrichmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentError";
  }
}

const Enrichment = z
  .object({
    title: z.string().min(3).max(140).optional(),
    hook: z.string().min(3).max(300).optional(),
    audience: z.string().min(2).max(120).optional(),
    recommended_format: IdeaFormat.optional(),
    technical_lesson: Claim.optional(),
  })
  .strict();

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

export interface EnrichmentResult {
  idea: Idea;
  findings: Finding[];
}

/**
 * The only way an agent's output enters the database. Validates shape, evidence references, invented numbers
 * and privacy before anything is stored. The agent's output is never trusted.
 */
export function saveEnrichment(store: Store, privacy: PrivacyConfig, ideaId: string, payload: unknown): EnrichmentResult {
  const idea = store.getIdea(ideaId);
  if (!idea) throw new EnrichmentError(`Idea ${ideaId} not found`);
  if (idea.privacy_status === "PRIVATE") {
    throw new EnrichmentError(`Idea ${ideaId} is PRIVATE and cannot be enriched. Resolve its privacy findings first.`);
  }

  const parsed = Enrichment.safeParse(payload);
  if (!parsed.success) {
    throw new EnrichmentError(`Invalid enrichment: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  if (Object.keys(e).length === 0) throw new EnrichmentError("Enrichment contains no fields");

  const works = idea.source_work.map((id) => store.getWorkItem(id)).filter((w): w is NonNullable<typeof w> => w !== null);
  if (works.length === 0) throw new EnrichmentError("Source work for this idea no longer exists");
  if (works.some((w) => w.privacy_status === "PRIVATE")) throw new EnrichmentError("Source work is PRIVATE");

  // Evidence references must belong to this idea's source work.
  if (e.technical_lesson) {
    const allowed = new Set([...idea.evidence, ...store.evidenceIdsFor(idea.source_work)]);
    if (e.technical_lesson.basis === "USER_STATED") {
      throw new EnrichmentError("USER_STATED claims can only come from the user (qa-agent interview), not from an agent");
    }
    for (const ref of e.technical_lesson.evidence_refs) {
      if (!allowed.has(ref)) throw new EnrichmentError(`Evidence reference ${ref} does not belong to the source work of ${ideaId}`);
    }
  }

  // Privacy: text produced here is headed for public content, so check it as public text.
  const findings: Finding[] = [];
  const fields: Array<[string, string | undefined]> = [
    ["idea:title", e.title],
    ["idea:hook", e.hook],
    ["idea:audience", e.audience],
    ["idea:lesson", e.technical_lesson?.text],
  ];
  for (const [loc, text] of fields) if (text) findings.push(...detect(text, privacy, loc, { context: "public" }));
  if (statusFromFindings(findings) === "PRIVATE") {
    throw new EnrichmentError(
      `Enrichment rejected: it contains PRIVATE material (${findings.filter((f) => f.severity === "PRIVATE").map((f) => f.rule_id).join(", ")}). Remove it and save again.`,
    );
  }

  // Numbers must already exist in the source material: no invented metrics.
  const corpus = [
    idea.title,
    idea.hook,
    idea.technical_lesson.text,
    ...works.flatMap((w) => [
      w.title,
      w.problem?.text ?? "",
      w.solution?.text ?? "",
      ...w.commits.map((c) => c.subject_redacted),
      ...w.evidence.map((x) => x.excerpt_redacted ?? ""),
    ]),
  ].join("\n");
  const newTexts = [e.title, e.hook, e.audience, e.technical_lesson?.text].filter((t): t is string => typeof t === "string");
  for (const t of newTexts) {
    for (const n of t.match(NUMBER_RE) ?? []) {
      if (!corpus.includes(n)) throw new EnrichmentError(`The number "${n}" does not appear in the source work. Never invent metrics or results.`);
    }
  }

  const updated: Idea = {
    ...idea,
    title: e.title ?? idea.title,
    hook: e.hook ?? idea.hook,
    audience: e.audience ?? idea.audience,
    recommended_format: e.recommended_format ?? idea.recommended_format,
    technical_lesson: e.technical_lesson ?? idea.technical_lesson,
    privacy_status: worstPrivacy([idea.privacy_status, statusFromFindings(findings)].map((s) => (s === "PUBLIC_SAFE" ? "NEEDS_REVIEW" : s))),
    state: "ENRICHED",
  };
  store.upsertIdea(updated);
  if (findings.length) store.saveFindings("idea", idea.id, findings);
  return { idea: updated, findings };
}
