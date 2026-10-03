import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createSecretScanner, type EffectiveSettings, type Random } from "@mitori/core";
import type { BundleInput } from "../../contract.ts";
import type { BundleBuilderDeps } from "../deps.ts";
import { settings } from "./builders.ts";
import { hasher } from "./fake-anchor.ts";
import { type FakeSection, fakeDoc } from "./fake-doc.ts";
import { type FakeIndexer, type FakeIndexerOptions, fakeIndexer } from "./fake-indexer.ts";

/** Deterministic entropy: a counter-driven byte stream (each call yields different bytes). */
export function seededRandom(seed = 1): Random {
  let n = seed;
  return {
    bytes: (len) => {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
        out[i] = n >>> 24;
      }
      return out;
    },
  };
}

export interface WorldOptions extends FakeIndexerOptions {
  files: Record<string, string>;
  sections?: FakeSection[];
  deny?: string[];
  trust?: "trusted" | "denied" | "pending";
  secretScan?: boolean;
  docLang?: "ja" | "en";
  rules?: string[];
  limits?: Partial<EffectiveSettings["global"]["limits"]>;
}

export interface World {
  deps: BundleBuilderDeps & { indexer: FakeIndexer };
  doc: ReturnType<typeof fakeDoc>;
}

export function world(o: WorldOptions): World {
  const indexer = fakeIndexer(o.files, o);
  const doc = fakeDoc(o.sections ?? []);
  const s = settings({
    ...(o.deny ? { deny: o.deny } : {}),
    ...(o.secretScan !== undefined ? { secretScan: o.secretScan } : {}),
    ...(o.docLang ? { docLang: o.docLang } : {}),
    ...(o.rules ? { rules: o.rules } : {}),
    ...(o.limits ? { limits: o.limits } : {}),
  });
  return {
    doc,
    deps: {
      indexer,
      doc,
      settings: () => s,
      secrets: createSecretScanner(),
      random: seededRandom(7),
      hasher,
      trust: () => o.trust ?? "trusted",
    },
  };
}

/** `fixtures/repos/go-small` of this checkout. */
export const GO_SMALL_ROOT = join(import.meta.dir, "../../../../../fixtures/repos/go-small");

/** The go-small fixture repo (step 0 working tree) as a path → text map, without its fixture-only directories. */
export function goSmallFiles(root: string = GO_SMALL_ROOT): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs);
      if (e.isDirectory()) {
        if (rel === "history" || rel === "dirty") continue;
        walk(abs);
      } else if (/\.(go|md|mod|sql)$/.test(e.name) || e.name === "Makefile") out[rel] = readFileSync(abs, "utf8");
    }
  };
  walk(root);
  return out;
}

/** A minimal bundle input; override what a test cares about. */
export function bundleInput(over: Partial<BundleInput> & Pick<BundleInput, "threads">): BundleInput {
  return {
    mode: "patch",
    extra: [],
    removed: [],
    write: [],
    deny: [],
    gates: [],
    out: "patch/1",
    budget: { in: 4000, out: 1500, usd: 0.1 },
    nonce: "7k2m9q4p",
    ...over,
  };
}
