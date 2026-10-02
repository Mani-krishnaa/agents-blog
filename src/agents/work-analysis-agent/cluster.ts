import type { RawCommit } from "../repository-agent/scanner.ts";

export interface Cluster {
  commits: RawCommit[];
}

const TRIVIAL_RE = /^(chore(\([^)]*\))?:\s*(bump|release|version|update (deps|dependencies|lockfile))|bump |release |version bump|merge |wip$|typo|fix typo|format|prettier|lint)/i;
const WINDOW_MS = 48 * 3600 * 1000;

function dirsOf(c: RawCommit): Set<string> {
  const out = new Set<string>();
  for (const f of c.files) {
    const parts = f.path.split("/");
    if (parts.length < 2) continue; // root-level files do not imply a shared area
    out.add(parts.slice(0, Math.min(parts.length - 1, 2)).join("/"));
  }
  return out;
}

function intersects<T>(a: Iterable<T>, b: Set<T>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** Groups commits into pieces of work. Merge and trivial commits are dropped. */
export function clusterCommits(commits: RawCommit[]): Cluster[] {
  const kept = commits
    .filter((c) => !c.isMerge && !TRIVIAL_RE.test(c.subject.trim()) && (c.files.length > 0 || c.diff.length > 0))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const parent = kept.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  const dirs = kept.map(dirsOf);
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i]!;
      const b = kept[j]!;
      const sharedRef = intersects(a.prNumbers, new Set(b.prNumbers)) || intersects(a.tickets, new Set(b.tickets));
      const near =
        a.authorEmail.toLowerCase() === b.authorEmail.toLowerCase() &&
        Math.abs(Date.parse(b.date) - Date.parse(a.date)) <= WINDOW_MS &&
        intersects(dirs[i]!, dirs[j]!);
      if (sharedRef || near) union(i, j);
    }
  }

  const groups = new Map<number, RawCommit[]>();
  kept.forEach((c, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), c]);
  });
  return [...groups.values()]
    .map((cs) => ({ commits: cs }))
    .sort((a, b) => Date.parse(a.commits[0]!.date) - Date.parse(b.commits[0]!.date));
}
