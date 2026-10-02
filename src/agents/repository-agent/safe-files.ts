import fs from "node:fs";
import path from "node:path";

export class SensitiveFileError extends Error {
  constructor(rel: string) {
    super(`Refusing to read sensitive file: ${rel}`);
    this.name = "SensitiveFileError";
  }
}

const SAFE_ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template", ".env.dist"]);

const SENSITIVE_BASENAME_RE: RegExp[] = [
  /^\.env(\..+)?$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx)$/i,
  /^credentials(\..*)?$/i,
  /^secrets?(\..*)?$/i,
  /^\.(npmrc|pypirc|netrc|pgpass|htpasswd)$/,
  /\.(tfstate|tfvars)(\..*)?$/i,
  /^kubeconfig$/i,
  /^service[-_]?account.*\.json$/i,
];

const SENSITIVE_DIR_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);

/** True when the file's contents must never be read or shown. Names may still be listed. */
export function isSensitivePath(rel: string): boolean {
  const norm = rel.split(path.sep).join("/");
  const parts = norm.split("/");
  if (parts.some((p) => SENSITIVE_DIR_SEGMENTS.has(p))) return true;
  const base = parts[parts.length - 1] ?? "";
  if (SAFE_ENV_TEMPLATES.has(base)) return false;
  return SENSITIVE_BASENAME_RE.some((re) => re.test(base));
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface ReadOptions {
  maxBytes?: number;
}

/**
 * Reads a file inside a repository. Refuses sensitive names, path traversal, and symlinks that escape the repo.
 * Read-only: opens with O_RDONLY.
 */
export function readRepoFile(root: string, rel: string, opts: ReadOptions = {}): string {
  const maxBytes = opts.maxBytes ?? 200_000;
  if (isSensitivePath(rel)) throw new SensitiveFileError(rel);
  const rootReal = fs.realpathSync(root);
  const abs = path.resolve(rootReal, rel);
  if (!isInside(rootReal, abs)) throw new Error(`Path is outside the repository: ${rel}`);
  const real = fs.realpathSync(abs);
  if (!isInside(rootReal, real)) throw new Error(`Path resolves outside the repository: ${rel}`);
  const realRel = path.relative(rootReal, real);
  if (isSensitivePath(realRel)) throw new SensitiveFileError(realRel);
  const fd = fs.openSync(real, fs.constants.O_RDONLY);
  try {
    const size = Math.min(fs.fstatSync(fd).size, maxBytes);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
