import type { PrivacyConfig } from "../../core/config.ts";
import type { Finding, PrivacyStatus } from "../../core/models.ts";
import { detect, type Context } from "./detectors.ts";

/** PRIVATE beats NEEDS_REVIEW beats PUBLIC_SAFE. No findings => PUBLIC_SAFE. */
export function statusFromFindings(findings: Finding[]): PrivacyStatus {
  if (findings.some((f) => f.severity === "PRIVATE")) return "PRIVATE";
  if (findings.length > 0) return "NEEDS_REVIEW";
  return "PUBLIC_SAFE";
}

export interface Classification {
  status: PrivacyStatus;
  findings: Finding[];
}

/**
 * Classifies a piece of text.
 * - context "public" (drafts, captions, SVG text, articles): a clean pass is PUBLIC_SAFE.
 * - context "internal" (records derived from company repositories): never better than NEEDS_REVIEW,
 *   because deterministic detection cannot rule out confidential business logic.
 */
export function classifyText(text: string, privacy: PrivacyConfig, location: string, context: Context): Classification {
  const findings = detect(text, privacy, location, { context });
  let status = statusFromFindings(findings);
  if (context === "internal" && status === "PUBLIC_SAFE") status = "NEEDS_REVIEW";
  return { status, findings };
}
