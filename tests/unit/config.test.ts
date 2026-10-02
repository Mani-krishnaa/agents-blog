import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, ConfigError } from "../../src/core/config.ts";

let dir: string;
let repoDir: string;

function write(name: string, body: string) {
  fs.writeFileSync(path.join(dir, name), body);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa2c-cfg-"));
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa2c-repo-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads a valid repos.yaml and defaults enabled=true", () => {
    write("repos.yaml", `repositories:\n  - name: he-qa\n    path: ${repoDir}\n    read_only: true\n`);
    const cfg = loadConfig(dir);
    expect(cfg.repos).toHaveLength(1);
    expect(cfg.repos[0]).toMatchObject({ name: "he-qa", enabled: true, read_only: true });
  });

  it("refuses read_only: false", () => {
    write("repos.yaml", `repositories:\n  - name: x\n    path: ${repoDir}\n    read_only: false\n`);
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it("refuses a repo entry that omits read_only", () => {
    write("repos.yaml", `repositories:\n  - name: x\n    path: ${repoDir}\n`);
    expect(() => loadConfig(dir)).toThrow(/read_only/);
  });

  it("refuses an enabled repo whose path does not exist", () => {
    write("repos.yaml", `repositories:\n  - name: ghost\n    path: /definitely/not/here\n    read_only: true\n`);
    expect(() => loadConfig(dir)).toThrow(/does not exist/);
  });

  it("ignores missing paths for disabled repos", () => {
    write(
      "repos.yaml",
      `repositories:\n  - name: ghost\n    path: /definitely/not/here\n    enabled: false\n    read_only: true\n`,
    );
    expect(loadConfig(dir).repos[0]?.enabled).toBe(false);
  });

  it("refuses duplicate repo names", () => {
    write(
      "repos.yaml",
      `repositories:\n  - {name: a, path: ${repoDir}, read_only: true}\n  - {name: a, path: ${repoDir}, read_only: true}\n`,
    );
    expect(() => loadConfig(dir)).toThrow(/duplicate/i);
  });

  it("refuses a repo path that contains the agent's own project directory", () => {
    write("repos.yaml", `repositories:\n  - name: me\n    path: ${process.cwd()}\n    read_only: true\n`);
    expect(() => loadConfig(dir, { projectRoot: process.cwd() })).toThrow(/agent's own/);
  });

  it("gives a helpful error when repos.yaml is missing", () => {
    expect(() => loadConfig(dir)).toThrow(/repos\.example\.yaml/);
  });

  it("loads identity and privacy config with safe defaults", () => {
    write("repos.yaml", `repositories: []\n`);
    write("app.yaml", `identity:\n  emails: [Me@Example.com]\n  names: [Me Person]\n`);
    write("privacy.yaml", `company_terms: [Acme]\nclient_terms: [BigClient]\ninternal_domains: [acme.internal]\n`);
    const cfg = loadConfig(dir);
    expect(cfg.app.identity.emails).toEqual(["me@example.com"]);
    expect(cfg.privacy.company_terms).toEqual(["Acme"]);
    expect(cfg.privacy.client_terms).toEqual(["BigClient"]);
    expect(cfg.app.dashboard.host).toBe("127.0.0.1");
  });

  it("refuses a dashboard host that is not loopback", () => {
    write("repos.yaml", `repositories: []\n`);
    write("app.yaml", `dashboard:\n  host: 0.0.0.0\n`);
    expect(() => loadConfig(dir)).toThrow(/loopback/);
  });

  it("refuses API keys placed in YAML", () => {
    write("repos.yaml", `repositories: []\n`);
    write("app.yaml", `publora_api_key: sk_live_123\n`);
    expect(() => loadConfig(dir)).toThrow(/environment variable/i);
  });
});
