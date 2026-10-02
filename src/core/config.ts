import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const RepoSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  enabled: z.boolean().default(true),
  // Company repositories are read-only data sources. `false` is never valid.
  read_only: z.literal(true, {
    errorMap: () => ({ message: "read_only must be true: company repositories are read-only" }),
  }),
});

const ReposFileSchema = z.object({ repositories: z.array(RepoSchema).default([]) });

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

const AppSchema = z
  .object({
    identity: z
      .object({
        names: z.array(z.string()).default([]),
        emails: z.array(z.string().transform((e) => e.trim().toLowerCase())).default([]),
      })
      .default({}),
    dashboard: z
      .object({
        host: z.string().default("127.0.0.1"),
        port: z.number().int().min(1).max(65535).default(4173),
      })
      .default({}),
    discovery: z
      .object({
        max_commits_per_scan: z.number().int().positive().default(500),
        max_diff_bytes: z.number().int().positive().default(200_000),
        min_content_potential: z.number().min(0).max(1).default(0.35),
      })
      .default({}),
    data_dir: z.string().default("data"),
  })
  .passthrough()
  .superRefine((val, ctx) => {
    if (!LOOPBACK.has(val.dashboard.host)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "dashboard.host must be a loopback address (127.0.0.1, localhost or ::1)",
      });
    }
  });

const PrivacySchema = z.object({
  company_terms: z.array(z.string()).default([]),
  client_terms: z.array(z.string()).default([]),
  internal_product_terms: z.array(z.string()).default([]),
  internal_domains: z.array(z.string()).default([]),
  /** Terms the user has confirmed are safe to publish (e.g. a public tool name). */
  allowlist: z.array(z.string()).default([]),
});

export type RepoConfig = z.infer<typeof RepoSchema>;
export type AppConfig = z.infer<typeof AppSchema>;
export type PrivacyConfig = z.infer<typeof PrivacySchema>;

export interface Config {
  configDir: string;
  repos: RepoConfig[];
  app: AppConfig;
  privacy: PrivacyConfig;
}

const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|passwd|credential)/i;

function readYaml(file: string, required: boolean, hint?: string): unknown {
  if (!fs.existsSync(file)) {
    if (required) {
      throw new ConfigError(`Missing ${file}. ${hint ?? ""}`.trim());
    }
    return {};
  }
  try {
    return parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch (e) {
    throw new ConfigError(`Could not parse ${file}: ${(e as Error).message}`);
  }
}

/** Reject any YAML key that looks like a credential: keys belong in environment variables. */
function rejectSecrets(value: unknown, file: string, trail = ""): void {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && typeof v === "string" && v.length > 0) {
        throw new ConfigError(
          `${file}: "${trail}${k}" looks like a credential. Put it in an environment variable (.env), never in config files.`,
        );
      }
      rejectSecrets(v, file, `${trail}${k}.`);
    }
  }
}

function parseWith<T extends z.ZodTypeAny>(schema: T, data: unknown, file: string): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ConfigError(`${file}: ${msg}`);
  }
  return r.data;
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface LoadOptions {
  /** The agent's own project directory. A repo path may not contain or equal it. */
  projectRoot?: string;
}

export function loadConfig(configDir: string, opts: LoadOptions = {}): Config {
  const reposFile = path.join(configDir, "repos.yaml");
  const appFile = path.join(configDir, "app.yaml");
  const privacyFile = path.join(configDir, "privacy.yaml");

  const reposRaw = readYaml(reposFile, true, "Copy config/repos.example.yaml to config/repos.yaml and fill in your real paths.");
  const appRaw = readYaml(appFile, false);
  const privacyRaw = readYaml(privacyFile, false);
  rejectSecrets(reposRaw, reposFile);
  rejectSecrets(appRaw, appFile);
  rejectSecrets(privacyRaw, privacyFile);

  const repos = parseWith(ReposFileSchema, reposRaw, reposFile).repositories;
  const app = parseWith(AppSchema, appRaw, appFile);
  const privacy = parseWith(PrivacySchema, privacyRaw, privacyFile);

  const seen = new Set<string>();
  for (const r of repos) {
    if (seen.has(r.name)) throw new ConfigError(`${reposFile}: duplicate repository name "${r.name}"`);
    seen.add(r.name);
    if (!r.enabled) continue;
    if (!fs.existsSync(r.path) || !fs.statSync(r.path).isDirectory()) {
      throw new ConfigError(`${reposFile}: path for "${r.name}" does not exist or is not a directory: ${r.path}`);
    }
    if (opts.projectRoot) {
      const real = fs.realpathSync(r.path);
      const root = fs.realpathSync(opts.projectRoot);
      if (isInside(real, root)) {
        throw new ConfigError(
          `${reposFile}: "${r.name}" points at or above the agent's own project directory. Refusing, so the agent can never scan or touch itself.`,
        );
      }
    }
  }

  return { configDir, repos, app, privacy };
}
