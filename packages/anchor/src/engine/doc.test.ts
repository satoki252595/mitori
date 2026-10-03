import { describe, expect, test } from "bun:test";
import type { BlockId, ClaimId, DocAnchor } from "@mitori/core";
import { testHasher } from "../testing.ts";
import { createAnchorEngine } from "./index.ts";

const eng = createAnchorEngine({ hasher: testHasher() });
const B1 = "b_11111111" as BlockId;
const B2 = "b_22222222" as BlockId;
const TEXT = "認証は internal/auth/login.go の Login で行う。失敗が 5 回続くとロックする。";

function anchorOn(text: string, sel: string): DocAnchor {
  const s = text.indexOf(sel);
  return eng.docAnchor(B1, text, "h0", s, s + sel.length);
}

describe("AR3 doc anchor D1–D4 (§1.6.1)", () => {
  test("D1 same hash ⇒ ok/identity", () => {
    const a = anchorOn(TEXT, "Login で行う");
    const r = eng.reanchorDoc({ anchor: a, blockText: TEXT, blockHash: "h0", siblings: [], claims: [] });
    expect([r.health, r.method]).toEqual(["ok", "identity"]);
  });

  test("D2 whole-block anchor follows a rewritten block", () => {
    const a: DocAnchor = { block: B1, blockHash: "h0" };
    const r = eng.reanchorDoc({ anchor: a, blockText: "全く別の本文", blockHash: "h9", siblings: [], claims: [] });
    expect([r.health, r.method, r.anchor.blockHash]).toEqual(["ok", "identity", "h9"]);
  });

  test("D3 typo fix elsewhere ⇒ ok; sentence inserted before ⇒ moved; paraphrase ⇒ fuzzy", () => {
    const a = anchorOn(TEXT, "失敗が 5 回続くとロックする");
    const typo = TEXT.replace("認証は", "認証は、");
    const moved = eng.reanchorDoc({ anchor: a, blockText: typo, blockHash: "h1", siblings: [], claims: [] });
    expect([moved.health, moved.method]).toEqual(["moved", "quote"]);
    expect(moved.anchor.offset).toBe(typo.indexOf("失敗が"));
    const same = eng.reanchorDoc({ anchor: a, blockText: `${TEXT}追記。`, blockHash: "h2", siblings: [], claims: [] });
    expect(same.health).toBe("ok");
    const para = TEXT.replace("失敗が 5 回", "失敗が 3 回");
    const fz = eng.reanchorDoc({ anchor: a, blockText: para, blockHash: "h3", siblings: [], claims: [] });
    expect([fz.health, fz.method]).toEqual(["fuzzy", "quote"]);
  });

  test("regenerated with the same id ⇒ quote found again; claim re-bound", () => {
    const a = anchorOn(TEXT, "Login で行う");
    const claims = [{ id: "cl_cccccccc" as ClaimId, start: 20, end: 40 }];
    const r = eng.reanchorDoc({ anchor: a, blockText: TEXT, blockHash: "h5", siblings: [], claims });
    expect(r.health).toBe("ok");
    expect(r.anchor.claim).toBe("cl_cccccccc");
  });

  test("D4 block deleted ⇒ moved into the sibling that holds the quote; otherwise outdated", () => {
    const a = anchorOn(TEXT, "失敗が 5 回続くとロックする");
    const sib = { block: B2, text: `前置き。${TEXT}`, hash: "hs" };
    const r = eng.reanchorDoc({ anchor: a, blockText: null, blockHash: null, siblings: [sib], claims: [] });
    expect([r.health, r.method, r.anchor.block]).toEqual(["moved", "quote", B2]);
    const gone = eng.reanchorDoc({ anchor: a, blockText: null, blockHash: null, siblings: [{ block: B2, text: "無関係", hash: "x" }], claims: [] });
    expect([gone.health, gone.anchor]).toEqual(["outdated", a]);
  });

  test("the same sentence twice ⇒ the one nearest the old offset", () => {
    const twice = "同じ文。前置き。同じ文。";
    const s = twice.lastIndexOf("同じ文");
    const a = eng.docAnchor(B1, twice, "h0", s, s + 3);
    const r = eng.reanchorDoc({ anchor: a, blockText: `${twice}追記`, blockHash: "h1", siblings: [], claims: [] });
    expect(r.anchor.offset).toBe(s);
  });
});

describe("AR4 diagram anchor (§1.6.2)", () => {
  const dg = "dg_aaaaaaaa" as const;
  test("node id kept ⇒ ok; ids changed but ref kept ⇒ moved; label only ⇒ moved; deleted ⇒ outdated", () => {
    const anchor = { diagram: dg, node: "n1" };
    const snapshot = { label: "AuthService", ref: { module: "md_auth0000" as const } };
    const kept = eng.reanchorDiagram({ anchor, snapshot, nodes: [{ id: "n1", label: "AuthService" }], edges: [] });
    expect(kept.health).toBe("ok");
    const byRef = eng.reanchorDiagram({ anchor, snapshot, nodes: [{ id: "n9", label: "Auth", ref: { module: "md_auth0000" } }], edges: [] });
    expect([byRef.health, byRef.anchor.node]).toEqual(["moved", "n9"]);
    const byLabel = eng.reanchorDiagram({ anchor, snapshot, nodes: [{ id: "n7", label: "AuthService" }], edges: [] });
    expect([byLabel.health, byLabel.anchor.node]).toEqual(["moved", "n7"]);
    const two = eng.reanchorDiagram({
      anchor,
      snapshot,
      nodes: [
        { id: "n7", label: "AuthService" },
        { id: "n8", label: "AuthService" },
      ],
      edges: [],
    });
    expect(two.health).toBe("fuzzy");
    const gone = eng.reanchorDiagram({ anchor, snapshot, nodes: [{ id: "n2", label: "Other" }], edges: [] });
    expect(gone.health).toBe("outdated");
    expect(eng.reanchorDiagram({ anchor, snapshot, nodes: null, edges: [] }).health).toBe("outdated");
  });

  test("edges: kept ⇒ ok, gone ⇒ outdated", () => {
    const anchor = { diagram: dg, edge: "e1" };
    expect(eng.reanchorDiagram({ anchor, snapshot: {}, nodes: [], edges: ["e1"] }).health).toBe("ok");
    expect(eng.reanchorDiagram({ anchor, snapshot: {}, nodes: [], edges: ["e2"] }).health).toBe("outdated");
  });
});
