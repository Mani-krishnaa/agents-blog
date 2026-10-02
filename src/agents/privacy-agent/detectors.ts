import type { PrivacyConfig } from "../../core/config.ts";
import { shortHash, type Finding } from "../../core/models.ts";

export type Severity = "PRIVATE" | "NEEDS_REVIEW";
export type Context = "internal" | "public";

export interface Match {
  ruleId: string;
  severity: Severity;
  message: string;
  start: number;
  end: number;
  value: string;
  /** Placeholder family used by redact(); null = detect-only (cannot be redacted meaningfully). */
  placeholder: string | null;
}

interface RegexRuleDef {
  id: string;
  severity: Severity;
  message: string;
  re: RegExp;
  placeholder: string | null;
  /** Capture group whose span is the sensitive value (default: whole match). */
  group?: number;
  validate?: (value: string, m: RegExpExecArray) => boolean;
  /** Overrides `severity` per match (e.g. private vs public IP ranges). */
  severityOf?: (value: string) => Severity;
  /** Only when scanning public assets. */
  publicOnly?: boolean;
}

export function entropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const TYPE_WORDS = new Set(["string", "number", "boolean", "undefined", "null", "true", "false", "none", "required", "optional", "object", "any"]);
const PLACEHOLDER_VALUE_RE = /(process\.env|os\.environ|getenv|\$\{|\$[A-Z_]{2,}|<[^>]*>|\{\{|your[_-]|example|changeme|xxxx|\*{3,}|redacted)/i;

const PLACEHOLDER_EMAIL_DOMAIN_RE = /@(example\.(com|org|net|edu)|[a-z0-9.-]+\.(test|invalid|localhost|example))$/i;

const PUBLIC_HOSTS = new Set([
  "playwright.dev",
  "github.com",
  "www.github.com",
  "nodejs.org",
  "developer.mozilla.org",
  "docs.pytest.org",
  "selenium.dev",
  "www.selenium.dev",
  "w3.org",
  "www.w3.org",
  "example.com",
  "example.org",
  "npmjs.com",
  "www.npmjs.com",
  "typescriptlang.org",
  "www.typescriptlang.org",
]);

const INTERNAL_TLD_RE = /\.(internal|corp|local|intranet|lan|private|intra)(?![a-z0-9-])/i;

function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const STATIC_RULES: RegexRuleDef[] = [
  { id: "aws-access-key", severity: "PRIVATE", message: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, placeholder: "SECRET" },
  {
    id: "aws-secret-key",
    severity: "PRIVATE",
    message: "AWS secret access key",
    re: /aws_secret_access_key["'\s:=]+([A-Za-z0-9/+=]{40})/gi,
    group: 1,
    placeholder: "SECRET",
  },
  {
    id: "github-token",
    severity: "PRIVATE",
    message: "GitHub token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
    placeholder: "SECRET",
  },
  { id: "slack-token", severity: "PRIVATE", message: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, placeholder: "SECRET" },
  { id: "stripe-key", severity: "PRIVATE", message: "Stripe key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, placeholder: "SECRET" },
  { id: "google-api-key", severity: "PRIVATE", message: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, placeholder: "SECRET" },
  { id: "openai-key", severity: "PRIVATE", message: "OpenAI-style API key", re: /\bsk-[A-Za-z0-9_-]{20,}/g, placeholder: "SECRET" },
  {
    id: "jwt",
    severity: "PRIVATE",
    message: "JSON Web Token",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    placeholder: "SECRET",
  },
  {
    id: "private-key-block",
    severity: "PRIVATE",
    message: "Private key block",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    placeholder: "SECRET",
  },
  { id: "bearer-token", severity: "PRIVATE", message: "Bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi, placeholder: "SECRET" },
  {
    id: "url-credentials",
    severity: "PRIVATE",
    message: "Credentials embedded in a URL or connection string",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi,
    placeholder: "SECRET",
  },
  {
    id: "secret-assignment",
    severity: "PRIVATE",
    message: "Hard-coded secret assigned to a credential-like name",
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|access[_-]?key|token)\b["']?\s*[:=]\s*["']?([^\s"',;)]{6,})/gi,
    group: 1,
    placeholder: "SECRET",
    validate: (v) => v.length >= 8 && !TYPE_WORDS.has(v.toLowerCase()) && !PLACEHOLDER_VALUE_RE.test(v) && entropy(v) >= 2.8,
  },
  {
    id: "high-entropy-token",
    severity: "NEEDS_REVIEW",
    message: "Long high-entropy string that may be a credential",
    re: /(?<![A-Za-z0-9_\-+/=])[A-Za-z0-9_\-+/=]{32,}(?![A-Za-z0-9_\-+/=])/g,
    placeholder: "SECRET",
    validate: (v) => !/^[0-9a-f]+$/i.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v) && entropy(v) >= 4.2,
  },
  {
    id: "email",
    severity: "PRIVATE",
    message: "Email address",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    placeholder: "EMAIL",
    validate: (v) => !PLACEHOLDER_EMAIL_DOMAIN_RE.test(v),
  },
  {
    id: "phone",
    severity: "PRIVATE",
    message: "Phone number",
    re: /\+\d{1,3}[\s.-]?\d{2,5}[\s.-]\d{3,5}(?:[\s.-]\d{2,5})?|\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
    placeholder: "PHONE",
  },
  {
    id: "ip-address",
    severity: "NEEDS_REVIEW",
    message: "IP address",
    re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    placeholder: "IP",
    severityOf: (v) => (isPrivateIp(v) ? "PRIVATE" : "NEEDS_REVIEW"),
    validate: (v) => {
      const parts = v.split(".").map(Number);
      if (parts.length !== 4 || parts.some((n) => n > 255)) return false;
      return !(v === "127.0.0.1" || v === "0.0.0.0" || v === "255.255.255.255");
    },
  },
  {
    id: "internal-host",
    severity: "PRIVATE",
    message: "Hostname that looks internal (.internal, .corp, .local, ...)",
    re: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:internal|corp|local|intranet|lan|private|intra)(?![a-z0-9-])(?::\d+)?/gi,
    placeholder: "HOST",
  },
  { id: "aws-arn", severity: "PRIVATE", message: "AWS ARN containing an account id", re: /arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s"'`]+/g, placeholder: "ARN" },
  { id: "s3-bucket", severity: "NEEDS_REVIEW", message: "S3 bucket name", re: /\bs3:\/\/[a-z0-9][a-z0-9._-]{2,}/g, placeholder: "S3" },
  {
    id: "aws-endpoint",
    severity: "NEEDS_REVIEW",
    message: "AWS resource endpoint",
    re: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.amazonaws\.com\b/g,
    placeholder: "AWS",
  },
  {
    id: "source-code",
    severity: "NEEDS_REVIEW",
    message: "Contains source code or a diff; verbatim company code must not be published",
    re: /```|^diff --git |^\+\+\+ |^@@ .+ @@/gm,
    placeholder: null,
    publicOnly: true,
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function termRegex(term: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(term.trim())}(?![A-Za-z0-9])`, "gi");
}

function runRegexRule(text: string, def: RegexRuleDef): Match[] {
  const out: Match[] = [];
  const re = new RegExp(def.re.source, def.re.flags.includes("d") ? def.re.flags : `${def.re.flags}d`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    let start = m.index;
    let end = m.index + m[0].length;
    let value = m[0];
    if (def.group !== undefined) {
      const span = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices?.[def.group];
      if (!span) continue;
      [start, end] = span;
      value = text.slice(start, end);
    }
    if (def.validate && !def.validate(value, m)) continue;
    out.push({
      ruleId: def.id,
      severity: def.severityOf ? def.severityOf(value) : def.severity,
      message: def.message,
      start,
      end,
      value,
      placeholder: def.placeholder,
    });
  }
  return out;
}

function termMatches(text: string, terms: string[], allow: Set<string>, id: string, severity: Severity, message: string, placeholder: string): Match[] {
  const out: Match[] = [];
  for (const t of terms) {
    if (!t.trim() || allow.has(t.trim().toLowerCase())) continue;
    const re = termRegex(t);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === "") {
        re.lastIndex++;
        continue;
      }
      out.push({ ruleId: id, severity, message, start: m.index, end: m.index + m[0].length, value: m[0].toLowerCase(), placeholder });
    }
  }
  return out;
}

function urlMatches(text: string, privacy: PrivacyConfig): Match[] {
  const out: Match[] = [];
  const re = /https?:\/\/[^\s)>\]"'`]+/gi;
  const internalDomains = privacy.internal_domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let host = "";
    try {
      host = new URL(m[0].replace(/[.,;:]+$/, "")).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (INTERNAL_TLD_RE.test(host)) continue; // reported by internal-host
    if (internalDomains.some((d) => host === d || host.endsWith(`.${d}`))) continue; // reported by internal-domain
    if (PUBLIC_HOSTS.has(host) || host === "localhost" || host === "127.0.0.1") continue;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) continue; // reported by ip-address
    out.push({
      ruleId: "external-url",
      severity: "NEEDS_REVIEW",
      message: "URL to a host that is not on the public-documentation allowlist",
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
      placeholder: "URL",
    });
  }
  return out;
}

/** All raw matches for a text, before overlap resolution. */
export function findMatches(text: string, privacy: PrivacyConfig, context: Context = "internal"): Match[] {
  const out: Match[] = [];
  for (const def of STATIC_RULES) {
    if (def.publicOnly && context !== "public") continue;
    out.push(...runRegexRule(text, def));
  }
  out.push(...urlMatches(text, privacy));

  const allow = new Set(privacy.allowlist.map((a) => a.trim().toLowerCase()));
  for (const d of privacy.internal_domains) {
    const dom = d.trim();
    if (!dom) continue;
    const re = new RegExp(`(?<![A-Za-z0-9-])(?:[A-Za-z0-9-]+\\.)*${dom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9-])`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({
        ruleId: "internal-domain",
        severity: "PRIVATE",
        message: "Configured internal company domain",
        start: m.index,
        end: m.index + m[0].length,
        value: m[0].toLowerCase(),
        placeholder: "HOST",
      });
    }
  }
  out.push(...termMatches(text, privacy.client_terms, allow, "client-term", "PRIVATE", "Client/customer name from privacy config", "CLIENT"));
  out.push(...termMatches(text, privacy.company_terms, allow, "company-term", "NEEDS_REVIEW", "Company name from privacy config", "COMPANY"));
  out.push(
    ...termMatches(text, privacy.internal_product_terms, allow, "internal-product-term", "NEEDS_REVIEW", "Internal product/project name from privacy config", "PRODUCT"),
  );
  return out;
}

/** Removes overlaps: earlier start wins, then PRIVATE over NEEDS_REVIEW, then the longer span. */
export function resolveOverlaps(matches: Match[]): Match[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || Number(b.severity === "PRIVATE") - Number(a.severity === "PRIVATE") || b.end - b.start - (a.end - a.start),
  );
  const out: Match[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

export interface DetectOptions {
  context?: Context;
}

/** Findings never contain the matched text: only a fingerprint derived from it. */
export function detect(text: string, privacy: PrivacyConfig, location: string, opts: DetectOptions = {}): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const m of findMatches(text, privacy, opts.context ?? "internal")) {
    const fingerprint = shortHash(m.ruleId, location, m.value);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    findings.push({ rule_id: m.ruleId, severity: m.severity, message: m.message, location, fingerprint });
  }
  return findings;
}

export interface RedactResult {
  text: string;
  findings: Finding[];
}

/** Replaces sensitive spans with stable placeholders (same value => same placeholder within one call). */
export function redact(text: string, privacy: PrivacyConfig, opts: DetectOptions & { location?: string } = {}): RedactResult {
  const location = opts.location ?? "redact";
  const matches = resolveOverlaps(findMatches(text, privacy, opts.context ?? "internal"));
  const counters = new Map<string, number>();
  const assigned = new Map<string, string>();
  let out = "";
  let cursor = 0;
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const fp = shortHash(m.ruleId, location, m.value);
    if (!seen.has(fp)) {
      seen.add(fp);
      findings.push({ rule_id: m.ruleId, severity: m.severity, message: m.message, location, fingerprint: fp });
    }
    if (m.placeholder === null) continue;
    const key = `${m.placeholder}\u0000${m.value}`;
    let ph = assigned.get(key);
    if (!ph) {
      if (m.placeholder === "COMPANY") {
        ph = "<COMPANY>";
      } else {
        const n = (counters.get(m.placeholder) ?? 0) + 1;
        counters.set(m.placeholder, n);
        ph = `<${m.placeholder}_${n}>`;
      }
      assigned.set(key, ph);
    }
    out += text.slice(cursor, m.start) + ph;
    cursor = m.end;
  }
  out += text.slice(cursor);
  return { text: out, findings };
}
