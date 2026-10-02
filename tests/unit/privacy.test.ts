import { describe, it, expect } from "vitest";
import { detect, redact, statusFromFindings, classifyText } from "../../src/agents/privacy-agent/index.ts";
import type { PrivacyConfig } from "../../src/core/config.ts";

const empty: PrivacyConfig = { company_terms: [], client_terms: [], internal_product_terms: [], internal_domains: [], allowlist: [] };
const cfg: PrivacyConfig = {
  company_terms: ["Acme"],
  client_terms: ["BigClient"],
  internal_product_terms: ["Project Falcon"],
  internal_domains: ["acme-corp.com"],
  allowlist: [],
};

// Fake credentials are assembled at runtime so this file never contains a real-looking secret literal.
const FAKE = {
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  gh: "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
  slack: "xoxb-" + "1234567890-abcdefghij",
  stripe: "sk_" + "live_" + "abcdefghijklmnop1234",
  google: "AIza" + "SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
  openai: "sk-" + "proj-abcdefghijklmnopqrstuv",
  jwt: "eyJ" + "hbGciOiJIUzI1" + "." + "eyJzdWIiOiIxMjM0NTY3" + "." + "SflKxwRJSMeKKF2QT4fwpM",
  pem: "-----BEGIN " + "RSA PRIVATE KEY-----",
  bearer: "Bearer " + "abcdefghijklmnopqrstuvwxyz0123456789",
};

const ids = (text: string, c: PrivacyConfig = empty) => detect(text, c, "test").map((f) => f.rule_id);

describe("secret detection (hits are PRIVATE)", () => {
  it.each([
    ["aws-access-key", `key=${FAKE.aws}`],
    ["github-token", `token ${FAKE.gh}`],
    ["slack-token", `${FAKE.slack}`],
    ["stripe-key", `${FAKE.stripe}`],
    ["google-api-key", `${FAKE.google}`],
    ["openai-key", `${FAKE.openai}`],
    ["jwt", `${FAKE.jwt}`],
    ["private-key-block", `${FAKE.pem}\nabc`],
    ["bearer-token", `Authorization: ${FAKE.bearer}`],
    ["url-credentials", "postgres://admin:hunter2pass@db.example.org:5432/app"],
    ["secret-assignment", "const password = 'Zx9!kQ2mPz7w'"],
  ])("detects %s", (rule, text) => {
    const f = detect(text, empty, "t");
    expect(f.map((x) => x.rule_id)).toContain(rule);
    expect(f.find((x) => x.rule_id === rule)?.severity).toBe("PRIVATE");
  });

  it("never puts the matched secret inside a finding", () => {
    const f = detect(`token ${FAKE.gh}`, empty, "loc");
    expect(JSON.stringify(f)).not.toContain(FAKE.gh);
  });

  it.each([
    "password = process.env.DB_PASSWORD",
    "password: string",
    "const token = os.environ['TOKEN']",
    "api_key = '<your-api-key>'",
    "secret: ${SECRET}",
    "commit 3f786850e387550fdab836ed7e6dc881de23001b",
    "version 1.2.3 build 20260101",
  ])("does not flag benign text: %s", (t) => {
    expect(ids(t)).toEqual([]);
  });

  it("flags long high-entropy tokens for review, not hex hashes", () => {
    const tok = "aZ3kP9xQ2mW7vB5nC8dF1gH4jL6sT0yU2eR9tY3uI5oP7";
    expect(detect(`value ${tok}`, empty, "t").find((f) => f.rule_id === "high-entropy-token")?.severity).toBe("NEEDS_REVIEW");
    expect(ids("sha256 " + "a".repeat(10) + "0123456789abcdef".repeat(4))).not.toContain("high-entropy-token");
  });
});

describe("PII", () => {
  it("flags real-looking emails as PRIVATE but allows placeholder domains", () => {
    expect(detect("contact jane.doe@somecompany.io", empty, "t").find((f) => f.rule_id === "email")?.severity).toBe("PRIVATE");
    expect(ids("user test@example.com and a@example.org")).toEqual([]);
  });

  it.each(["+91 98765 43210", "(415) 555-2671", "415-555-2671", "+1 415 555 2671"])("flags phone %s", (p) => {
    expect(ids(`call ${p} now`)).toContain("phone");
  });

  it("does not flag timestamps or build numbers as phones", () => {
    expect(ids("took 1700000000000 ms, build 20260101123456")).toEqual([]);
  });
});

describe("internal URLs, hosts and infrastructure", () => {
  it("flags private IPs as PRIVATE and public IPs for review", () => {
    expect(detect("host 10.12.3.4", empty, "t").find((f) => f.rule_id === "ip-address")?.severity).toBe("PRIVATE");
    expect(detect("host 192.168.1.20", empty, "t").find((f) => f.rule_id === "ip-address")?.severity).toBe("PRIVATE");
    expect(detect("host 8.8.8.8", empty, "t").find((f) => f.rule_id === "ip-address")?.severity).toBe("NEEDS_REVIEW");
    expect(ids("localhost 127.0.0.1 and 0.0.0.0")).toEqual([]);
  });

  it("flags internal-looking hostnames and configured internal domains", () => {
    expect(ids("see https://jenkins.corp/job/1")).toContain("internal-host");
    expect(ids("db.prod.internal:5432")).toContain("internal-host");
    expect(ids("https://qa.acme-corp.com/login", cfg)).toContain("internal-domain");
  });

  it("flags unknown URLs for review but not public documentation hosts", () => {
    expect(ids("see https://some-random-host.io/page")).toContain("external-url");
    expect(ids("see https://playwright.dev/docs/locators and https://github.com/microsoft/playwright")).toEqual([]);
  });

  it("flags AWS ARNs with account ids and bucket names", () => {
    expect(ids("arn:aws:lambda:ap-south-1:123456789012:function:thing")).toContain("aws-arn");
    expect(ids("aws s3 cp x s3://my-private-bucket/path")).toContain("s3-bucket");
    expect(ids("abc.execute-api.ap-south-1.amazonaws.com")).toContain("aws-endpoint");
  });
});

describe("configured company terms", () => {
  it("company terms need review, client terms are private, product terms need review", () => {
    expect(detect("worked at Acme today", cfg, "t").find((f) => f.rule_id === "company-term")?.severity).toBe("NEEDS_REVIEW");
    expect(detect("for BigClient onboarding", cfg, "t").find((f) => f.rule_id === "client-term")?.severity).toBe("PRIVATE");
    expect(detect("the Project Falcon suite", cfg, "t").find((f) => f.rule_id === "internal-product-term")?.severity).toBe("NEEDS_REVIEW");
  });

  it("matches case-insensitively on word boundaries only", () => {
    expect(ids("ACME rocks", cfg)).toContain("company-term");
    expect(ids("acmeology is a word", cfg)).not.toContain("company-term");
  });

  it("honours the allowlist", () => {
    expect(ids("Acme", { ...cfg, allowlist: ["Acme"] })).not.toContain("company-term");
  });

  it("escapes regex metacharacters in configured terms", () => {
    const c = { ...empty, company_terms: ["C++ Corp (EU)"] };
    expect(() => detect("hello", c, "t")).not.toThrow();
    expect(ids("at C++ Corp (EU) now", c)).toContain("company-term");
  });
});

describe("source code exposure (public assets only)", () => {
  const code = "Here is what I changed:\n```ts\nawait page.waitForTimeout(3000);\n```";
  it("flags fenced code and diffs in public context but not in internal context", () => {
    expect(detect(code, empty, "draft", { context: "public" }).map((f) => f.rule_id)).toContain("source-code");
    expect(detect(code, empty, "work", { context: "internal" }).map((f) => f.rule_id)).not.toContain("source-code");
    expect(detect("diff --git a/x b/x\n+++ b/x\n@@ -1 +1 @@", empty, "d", { context: "public" }).map((f) => f.rule_id)).toContain("source-code");
  });
});

describe("redact", () => {
  it("replaces secrets, emails and company terms with stable placeholders", () => {
    const text = `Acme dev jane@somecompany.io used ${FAKE.gh} and again jane@somecompany.io for BigClient`;
    const r = redact(text, cfg);
    expect(r.text).not.toContain("jane@somecompany.io");
    expect(r.text).not.toContain(FAKE.gh);
    expect(r.text).not.toMatch(/Acme|BigClient/i);
    expect(r.text.match(/<EMAIL_1>/g)).toHaveLength(2); // same value, same placeholder
    expect(r.text).toContain("<SECRET_1>");
    expect(r.text).toContain("<COMPANY>");
    expect(r.text).toContain("<CLIENT_1>");
  });

  it("redacts only the value of a secret assignment", () => {
    const r = redact("const password = 'Zx9!kQ2mPz7w';", empty);
    expect(r.text).toContain("password");
    expect(r.text).not.toContain("Zx9!kQ2mPz7w");
  });

  it("redacted output re-scans clean for secrets", () => {
    const text = [FAKE.aws, FAKE.gh, FAKE.jwt, FAKE.pem, "postgres://u:pw12345678@h.io/db", "10.0.0.5", "bob@corp-mail.io"].join("\n");
    const again = detect(redact(text, cfg).text, cfg, "t").filter((f) => f.severity === "PRIVATE");
    expect(again).toEqual([]);
  });

  it("is a no-op on clean text", () => {
    expect(redact("Replaced waitForTimeout with a web-first assertion.", cfg).text).toBe("Replaced waitForTimeout with a web-first assertion.");
  });
});

describe("status assignment", () => {
  it("PRIVATE beats NEEDS_REVIEW beats PUBLIC_SAFE", () => {
    const priv = detect(FAKE.aws, empty, "t");
    const rev = detect("Acme", cfg, "t");
    expect(statusFromFindings([...priv, ...rev])).toBe("PRIVATE");
    expect(statusFromFindings(rev)).toBe("NEEDS_REVIEW");
    expect(statusFromFindings([])).toBe("PUBLIC_SAFE");
  });

  it("classifyText of clean public text is PUBLIC_SAFE; uncertain text is NEEDS_REVIEW", () => {
    expect(classifyText("Web-first assertions retry until the condition holds.", empty, "d", "public").status).toBe("PUBLIC_SAFE");
    expect(classifyText("See https://some-random-host.io", empty, "d", "public").status).toBe("NEEDS_REVIEW");
    expect(classifyText(FAKE.gh, empty, "d", "public").status).toBe("PRIVATE");
  });

  it("repo-derived internal records are never auto PUBLIC_SAFE", () => {
    expect(classifyText("fix flaky login test", empty, "work", "internal").status).toBe("NEEDS_REVIEW");
  });

  it("gives identical findings fingerprints for identical input and different ones for different locations", () => {
    const a = detect(FAKE.aws, empty, "a")[0]!;
    const b = detect(FAKE.aws, empty, "a")[0]!;
    const c = detect(FAKE.aws, empty, "b")[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});
