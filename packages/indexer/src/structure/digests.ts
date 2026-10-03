/** Module digests (spec §6.7): sorted `\n`-joined lines hashed with xxh3. Edges contribute presence only. */
import type { Fact, ModuleId, RepoPath, Xxh3 } from "@mitori/core";
import type { StageFile } from "../resolve/files.ts";

const digest = (xxh3: (s: string) => Xxh3, lines: string[]): Xxh3 => xxh3(lines.sort().join("\n"));

export interface ModuleDigests {
  membersDigest: Xxh3;
  ifaceDigest: Xxh3;
  bodyDigest: Xxh3;
  factsDigest: Xxh3;
  testsDigest: Xxh3;
}

/** Normalized fact line: kind, detector and values — never the line number or blob. */
export function factLine(f: Fact): string {
  const { kind, detector, path, line: _l, blob: _b, ...rest } = f;
  const vals = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${JSON.stringify((rest as Record<string, unknown>)[k])}`)
    .join(" ");
  return `${kind} ${detector} ${path} ${vals}`;
}

export function moduleDigests(
  xxh3: (s: string) => Xxh3,
  members: readonly StageFile[],
  tests: readonly StageFile[],
  facts: readonly Fact[],
  outIds: readonly ModuleId[],
  inIds: readonly ModuleId[],
): ModuleDigests {
  const iface = ["iface/1"];
  const body: string[] = [];
  for (const f of members)
    for (const s of f.symbols) {
      if (s.exported) iface.push(`S ${s.key} ${s.sigHash}`);
      body.push(`B ${s.key} ${s.bodyHash}`);
    }
  for (const id of outIds) iface.push(`O ${id}`);
  for (const id of inIds) iface.push(`I ${id}`);
  const testLines: string[] = [];
  for (const t of tests) for (const c of t.tests) testLines.push(`T ${t.path}: ${c.name}`);
  for (const f of facts) if (f.kind === "test") testLines.push(`T ${f.path}: ${f.name}`);
  return {
    membersDigest: digest(
      xxh3,
      members.map((f) => f.path as RepoPath),
    ),
    ifaceDigest: digest(xxh3, iface),
    bodyDigest: digest(xxh3, body),
    factsDigest: digest(xxh3, facts.filter((f) => f.kind !== "test").map(factLine)),
    testsDigest: digest(xxh3, [...new Set(testLines)]),
  };
}
