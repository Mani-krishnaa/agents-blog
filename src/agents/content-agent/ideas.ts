import { shortHash, worstPrivacy, type Idea, type WorkItem } from "../../core/models.ts";
import { TOPICS, TOPIC_PRIORITY } from "./topics.ts";

export interface IdeaOptions {
  minPotential: number;
}

const MAX_COMMIT_EVIDENCE = 3;
const MAX_SIGNAL_EVIDENCE = 5;

/**
 * One idea per eligible work item. Titles/hooks come from general topic templates; the link to the user's
 * actual work is carried by source_work and evidence ids, never by invented first-person claims.
 */
export function generateIdeas(items: WorkItem[], opts: IdeaOptions): Idea[] {
  const eligible = items
    .filter((w) => w.content_potential >= opts.minPotential && w.interesting_factors.length > 0)
    .sort((a, b) => b.content_potential - a.content_potential || a.id.localeCompare(b.id));

  const ideas: Idea[] = [];
  for (const w of eligible) {
    const rule = TOPIC_PRIORITY.find((r) => w.interesting_factors.some((f) => f.rule_id === r));
    if (!rule) continue;
    const topic = TOPICS[rule];
    const commitEv = w.evidence.filter((e) => e.kind === "commit").slice(0, MAX_COMMIT_EVIDENCE);
    const signalEv = w.evidence.filter((e) => e.kind === "diff" || e.kind === "config").slice(0, MAX_SIGNAL_EVIDENCE);
    const evidence = [...commitEv, ...signalEv].map((e) => e.id);
    if (evidence.length === 0) continue;
    ideas.push({
      id: `idea_${shortHash(w.id, rule)}`,
      title: topic.title,
      hook: topic.hook,
      source_work: [w.id],
      technical_lesson: { text: topic.lesson, basis: "GENERAL_KNOWLEDGE", evidence_refs: [] },
      audience: topic.audience,
      recommended_format: topic.format,
      privacy_status: worstPrivacy([w.privacy_status]),
      confidence: w.confidence,
      evidence,
      state: "NEW",
    });
  }
  return ideas;
}
