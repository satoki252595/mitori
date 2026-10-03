/**
 * Deterministic API fixtures for the WP-10a e2e suite (typed with core DTOs; no server code involved). A crit-like
 * Go repository: 4 zones × 12 rooms (ELK-container-like layout), the fixed TOC (§0–§13 + §6 modules), server HTML
 * that follows `HTML_CONTRACT`, three generation estimates, engine states for AC-U-EN and a 50k-item palette.
 */
import {
  type BlockId,
  type BlockView,
  type Claim,
  type DiagramEdge,
  type DiagramNode,
  DOC_TEMPLATE,
  type DocOutline,
  type EngineStatus,
  type GenEstimate,
  type GlossaryEntry,
  ID_ALPHABET,
  type MapView,
  type ModuleInfo,
  type OutlineBlock,
  type PaletteItem,
  type SectionId,
  type SectionNode,
  type SectionView,
  type SettingsView,
  type WorkspaceKey,
  type WorkspaceStatus,
} from "@mitori/core";

export const WS: WorkspaceKey = "ws_cr1t00000000";

function id<P extends string>(prefix: P, n: number, len: number): `${P}${string}` {
  let s = "";
  let v = n;
  for (let i = 0; i < len; i++) {
    s = ID_ALPHABET[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return `${prefix}${s}` as `${P}${string}`;
}
const bid = (n: number) => id("b_", n, 8) as BlockId;
const clid = (n: number) => id("cl_", n, 8) as `cl_${string}`;
const glid = (n: number) => id("gl_", n, 8) as `gl_${string}`;

export interface FixtureOptions {
  generated: boolean;
  /** Blocks on the big module page s6/big (0 = no big page). */
  bigBlocks: number;
  engine: "ok" | "notInstalled" | "notLoggedIn" | "capabilityLost";
  billing: "subscription-window" | "metered-api" | "overage" | "unknown";
  calibrated: boolean;
  plan: "pro" | "max5" | "unknown";
  policyAcked: boolean;
  paletteItems: number;
  /** 5h-window utilization (0–1) reported by `GET /usage/summary`. */
  utilization: number;
}

export const DEFAULTS: FixtureOptions = {
  generated: true,
  bigBlocks: 0,
  engine: "ok",
  billing: "subscription-window",
  calibrated: true,
  plan: "max5",
  policyAcked: true,
  paletteItems: 400,
  utilization: 0.23,
};

const ZONES = [
  { id: "g_entry", label: "入口" },
  { id: "g_core", label: "常駐・中核" },
  { id: "g_io", label: "外部連携" },
  { id: "g_ui", label: "UI" },
];

const ROOMS: { id: string; label: string; path: string; zone: string; loc: number; files: number; syms: string[] }[] = [
  { id: "md_cli00000", label: "CLI入口", path: "cmd/crit", zone: "g_entry", loc: 5400, files: 6, syms: ["main", "run", "parseFlags"] },
  { id: "md_cfg00000", label: "設定ほか", path: "internal/config", zone: "g_entry", loc: 2300, files: 4, syms: ["Load", "Config"] },
  { id: "md_integ000", label: "統合ファイル", path: "integrations", zone: "g_entry", loc: 8300, files: 15, syms: ["Install"] },
  { id: "md_daemon00", label: "デーモンとAPI", path: "internal/daemon", zone: "g_core", loc: 7400, files: 9, syms: ["Serve", "SessionKey", "Handler"] },
  {
    id: "md_session0",
    label: "セッションとコメント",
    path: "internal/session",
    zone: "g_core",
    loc: 14000,
    files: 18,
    syms: ["carryForwardComments", "remapLines", "Watch"],
  },
  { id: "md_story000", label: "storyとprompt", path: "internal/story", zone: "g_core", loc: 1900, files: 5, syms: ["Ingest", "Prep"] },
  { id: "md_live0000", label: "liveプロキシ", path: "internal/live", zone: "g_core", loc: 1600, files: 3, syms: ["Proxy"] },
  { id: "md_vcs00000", label: "差分とVCS", path: "internal/vcs", zone: "g_io", loc: 4800, files: 7, syms: ["Diff", "Focus"] },
  { id: "md_prmr0000", label: "PR/MR同期と共有", path: "internal/github", zone: "g_io", loc: 7600, files: 11, syms: ["Sync", "Share"] },
  { id: "md_webui000", label: "web UI（埋め込み）", path: "web", zone: "g_ui", loc: 34600, files: 63, syms: ["app.js", "style.css"] },
  { id: "md_agent000", label: "エージェント", path: "external/agent", zone: "g_io", loc: 0, files: 0, syms: [] },
  { id: "md_browser0", label: "ブラウザ（人）", path: "external/browser", zone: "g_ui", loc: 0, files: 0, syms: [] },
];

const EDGES: [string, string][] = [
  ["md_cli00000", "md_daemon00"],
  ["md_cli00000", "md_cfg00000"],
  ["md_daemon00", "md_session0"],
  ["md_session0", "md_vcs00000"],
  ["md_session0", "md_story000"],
  ["md_daemon00", "md_live0000"],
  ["md_prmr0000", "md_session0"],
  ["md_webui000", "md_daemon00"],
  ["md_agent000", "md_cli00000"],
  ["md_browser0", "md_webui000"],
  ["md_integ000", "md_cli00000"],
];

export function mapView(o: FixtureOptions): MapView {
  // columns per zone, rooms stacked with LOC-weighted heights
  const W = 1160;
  const H = 720;
  const colW = (W - 50) / ZONES.length;
  const groups: MapView["layout"]["groups"] = [];
  const nodes: MapView["layout"]["nodes"] = [];
  ZONES.forEach((z, zi) => {
    const x = 10 + zi * (colW + 10);
    groups.push({ id: z.id, x, y: 10, w: colW, h: H - 20 });
    const rooms = ROOMS.filter((r) => r.zone === z.id);
    const weights = rooms.map((r) => Math.sqrt(Math.max(400, r.loc)));
    const total = weights.reduce((a, b) => a + b, 0);
    let y = 40;
    const avail = H - 60 - (rooms.length - 1) * 10;
    rooms.forEach((r, i) => {
      const h = Math.round((avail * (weights[i] as number)) / total);
      nodes.push({ id: r.id, x: x + 12, y, w: colW - 24, h });
      y += h + 10;
    });
  });
  const center = (nid: string) => {
    const n = nodes.find((x) => x.id === nid) as { x: number; y: number; w: number; h: number };
    return [n.x + n.w / 2, n.y + n.h / 2] as [number, number];
  };
  const dnodes: DiagramNode[] = ROOMS.map((r) => ({
    id: r.id,
    label: r.label,
    sublabel: r.path,
    group: r.zone,
    ...(r.loc > 0 ? { ref: { module: r.id as `md_${string}`, section: `s6/${r.path.split("/").pop()}` as SectionId } } : {}),
    ...(r.loc === 0 ? { shape: "external" as const } : {}),
  }));
  const dedges: DiagramEdge[] = EDGES.map(([a, b], i) => ({ id: `e${i}`, from: a, to: b, kind: "imports" }));
  const modules: (ModuleInfo & { topFiles?: { path: string; loc: number; symbols: string[] }[] })[] = ROOMS.filter((r) => r.loc > 0).map((r, i) => ({
    id: r.id as `md_${string}`,
    slug: r.path.split("/").pop() as string,
    name: r.label,
    children: [],
    paths: Array.from({ length: r.files }, (_, k) => `${r.path}/f${k}.go`),
    loc: r.loc,
    rank: 1 - i / 20,
    membersDigest: "0",
    ifaceDigest: "0",
    crossCutting: false,
    topoOrder: i,
    topFiles: [{ path: `${r.path}/main.go`, loc: Math.round(r.loc / 3), symbols: r.syms }],
  }));
  return {
    diagram: {
      id: "dg_map00000",
      kind: "container",
      nodes: dnodes,
      edges: dedges,
      groups: ZONES.map((z) => ({ id: z.id, label: z.label })),
      direction: "RIGHT",
      origin: "static",
    },
    layout: {
      diagram: "dg_map00000",
      irHash: "0",
      engine: "elk@0.11/layered",
      width: W,
      height: H,
      nodes,
      edges: EDGES.map(([a, b], i) => ({ id: `e${i}`, points: [center(a), center(b)] })),
      groups,
    },
    fallback: "container",
    overlays: { comments: { md_session0: 2, md_daemon00: 1 }, working: o.generated ? {} : {}, churn: {}, freshness: { md_session0: "stale" } },
    modules,
    quick: [],
  };
}

// ---------------------------------------------------------------- doc
const PARAS = [
  "エージェントは<code>crit</code>をバックグラウンドで実行する。",
  "デーモンは準備が整うまで、セッションに依存するAPIへ503を返す。",
  "CLIは<code>/api/session</code>を500ミリ秒ごとに問い合わせ、5分たっても503なら諦める。",
  "未解決のコメントは次のラウンドへ持ち越される。行番号は差分から付け直される。",
  "storyはエージェントに書かせ、壊れた出力は1回だけ再試行する。",
  "設定ファイルはリポジトリの外に置き、秘密情報は環境変数からだけ読む。",
];

let claimSeq = 0;
function claimHtml(text: string, verdict: Claim["verdict"], cite: string | null, term: { id: string; label: string } | null): { html: string; claim: Claim } {
  const cid = clid(++claimSeq);
  const body = term ? text.replace("セッション", `<abbr class="mterm" data-term="${term.id}" data-first>${term.label}</abbr>`) : text;
  const chip = cite
    ? `<a class="mcite" data-cite="${cite}" data-blob="d94e6b7a1c" href="/w/${WS}/code/${cite.split(":")[0]}#L${cite.split(":")[1]?.split("-")[0]}-L${cite.split("-")[1]}"><span class="cs">${cite.split("/").pop()?.replace(/-\d+$/, "")}</span><span class="cl">${cite.replace("-", "–")}</span></a>`
    : "";
  const [path, range] = cite ? (cite.split(":") as [string, string]) : ["", "1-1"];
  const [a, b] = range.split("-").map(Number) as [number, number];
  return {
    html: `<span class="mc" data-claim="${cid}" data-verdict="${verdict}">${body}${chip}</span>`,
    claim: {
      id: cid,
      block: "b_00000000",
      kind: "behavior",
      quote: text,
      cites: cite ? [{ path, start: a, end: b, blob: "d94e6b7a1c", snippet: "0", precision: "exact" }] : [],
      verdict,
      checks: { l0: true, l1: verdict === "verified" ? "pass" : "vacuous", l2: verdict !== "stale", checkedAt: "2026-10-02T00:00:00Z" },
    },
  };
}

const TERMS: GlossaryEntry[] = [
  {
    id: glid(1),
    term: "セッションキー",
    yomi: "せっしょんきー",
    romaji: "sesshonki",
    en: "session key",
    definition: "cwdとブランチから作る12文字の識別子。",
    usedIn: [],
    symbol: "internal/daemon/daemon.go#SessionKey",
  },
  {
    id: glid(2),
    term: "持ち越し",
    yomi: "もちこし",
    romaji: "mochikoshi",
    en: "carry-forward",
    definition: "未解決のコメントを次のラウンドへ引き継ぐこと。",
    usedIn: [],
  },
  {
    id: glid(3),
    term: "認証",
    yomi: "にんしょう",
    romaji: "ninshou",
    en: "authentication",
    definition: "ブラウザのタブをdaemonに結び付ける手順。",
    usedIn: [],
  },
];

function makeBlock(
  n: number,
  section: SectionId,
  file: string,
  ord: number,
  kind: BlockView["kind"],
  depth: BlockView["depth"],
  status: BlockView["status"] = "ready",
): BlockView {
  const id = bid(n);
  const claims: Claim[] = [];
  let inner = "";
  if (kind === "heading") inner = `<h3>${["前提", "流れ", "例外"][n % 3]}</h3>`;
  else if (kind === "learn")
    inner = `<span class="lbl-k">この章で分かること</span><ol><li>エージェントと人が1往復する仕組み</li><li>storyをエージェントに書かせる流れ</li><li>未解決のコメントが次のラウンドへ運ばれる仕組み</li></ol>`;
  else if (kind === "recap")
    inner = `<span class="lbl-k">まとめ</span><ul><li>デーモンはセッションキーで1つにまとまる。</li><li>コメントは持ち越される。</li></ul>`;
  else if (kind === "pitfall") inner = `<span class="lbl-k">落とし穴</span><p>ブランチを切り替えると別のデーモンに繋がる。</p>`;
  else if (kind === "deepdive") inner = `<details class="mdeep"><summary>Deep Dive · 約2分</summary><p>${PARAS[n % PARAS.length]}</p></details>`;
  else if (kind === "why") inner = `<details class="why"><summary>なぜブランチを含めるのか</summary><p>${PARAS[(n + 1) % PARAS.length]}</p></details>`;
  else if (kind === "code")
    inner = `<pre class="mcode shiki" data-lang="go" data-start="178"><code><span data-line="178"><span class="ln">178</span><span style="color:var(--shiki-token-keyword)">func</span> SessionKey(cwd, branch <span style="color:var(--shiki-token-keyword)">string</span>) <span style="color:var(--shiki-token-keyword)">string</span> {</span>
<span data-line="179"><span class="ln">179</span>  h := sha256.New()</span></code></pre>`;
  else if (kind === "table")
    inner = `<table class="ptable"><thead><tr><th>ルート</th><th>処理</th></tr></thead><tbody><tr><td>GET /api/session</td><td>セッションを返す</td></tr><tr><td>POST /api/review-cycle</td><td>1往復を始める</td></tr></tbody></table>`;
  else {
    const verdict: Claim["verdict"] = n % 7 === 3 ? "inferred" : n % 11 === 5 ? "stale" : n % 13 === 9 ? "unsupported" : "verified";
    const c1 = claimHtml(
      PARAS[n % PARAS.length] as string,
      verdict,
      verdict === "inferred" ? null : `internal/daemon/daemon.go:${170 + (n % 30)}-${180 + (n % 30)}`,
      n % 4 === 0 ? { id: TERMS[0]?.id as string, label: "セッション" } : null,
    );
    const c2 = claimHtml(PARAS[(n + 2) % PARAS.length] as string, "verified", `internal/session/watch.go:${400 + (n % 60)}-${420 + (n % 60)}`, null);
    claims.push({ ...c1.claim, block: id }, { ...c2.claim, block: id });
    inner = kind === "list" ? `<ul><li>${c1.html}</li><li>${c2.html}</li></ul>` : `<p>${c1.html}${c2.html}</p>`;
  }
  const html = `<div class="mb" data-block="${id}" data-kind="${kind}" data-depth="${depth}" data-fresh="fresh" data-ln="${10 + ord * 3}">${inner}</div>`;
  return {
    id,
    section,
    file,
    ord,
    kind,
    depth,
    audience: ["dev"],
    lang: "ja",
    origin: "ai",
    status,
    freshness: "fresh",
    hash: "0",
    claims: claims.map((c) => c.id),
    readingSec: kind === "prose" ? 22 : 10,
    html,
    mdLine: 10 + ord * 3,
    htmlLang: "ja",
    claimViews: claims,
    threads: { open: n % 17 === 2 ? 1 : 0, total: n % 17 === 2 ? 1 : 0 },
    proposals: [],
  };
}

const KINDS: BlockView["kind"][] = ["prose", "prose", "list", "why", "prose", "pitfall", "prose", "deepdive", "prose", "table", "prose", "code"];
const DEPTHS: BlockView["depth"][] = ["L1", "L1", "L2", "L1", "L2", "L1", "L2", "L3", "L3", "L2", "L1", "L2"];

export interface DocFixture {
  outline: DocOutline;
  sections: Map<SectionId, SectionView>;
  terms: GlossaryEntry[];
}

export function docFixture(o: FixtureOptions): DocFixture {
  claimSeq = 0;
  const sections: SectionNode[] = [];
  const views = new Map<SectionId, SectionView>();
  const outlineBlocks: OutlineBlock[] = [];
  let n = 1;
  const modChildren: SectionId[] = ROOMS.filter((r) => r.loc > 0).map((r) => `s6/${r.path.split("/").pop()}` as SectionId);
  if (o.bigBlocks > 0) modChildren.push("s6/big");
  const mkSection = (
    sid: SectionId,
    title: string,
    file: string,
    count: number,
    children: SectionId[] = [],
    state: SectionNode["state"] = o.generated ? "generated" : "pending",
  ) => {
    const blocks: BlockView[] = [];
    for (let i = 0; i < count; i++) {
      const kind = i === 0 && !sid.includes("/") ? "learn" : i === count - 1 && count > 4 ? "recap" : (KINDS[i % KINDS.length] as BlockView["kind"]);
      const depth = kind === "learn" || kind === "recap" ? "L1" : (DEPTHS[i % DEPTHS.length] as BlockView["depth"]);
      const b = makeBlock(n++, sid, file, i, kind, depth, !o.generated && state === "pending" && i > 1 ? "placeholder" : "ready");
      blocks.push(b);
      const worst = b.claimViews.some((c) => c.verdict === "unsupported")
        ? "unsupported"
        : b.claimViews.some((c) => c.verdict === "stale")
          ? "stale"
          : b.claimViews.some((c) => c.verdict === "inferred")
            ? "inferred"
            : b.claimViews.length
              ? "verified"
              : null;
      outlineBlocks.push([b.id, sid, b.depth, b.kind, worst, i, "fresh"]);
    }
    const node: SectionNode = {
      id: sid,
      title,
      file,
      blocks: blocks.map((b) => b.id),
      children,
      ...(sid.startsWith("s6/") ? { module: ROOMS.find((r) => sid.endsWith(r.path.split("/").pop() as string))?.id as `md_${string}` } : {}),
      state,
      readingSec: blocks.reduce((a, b) => a + b.readingSec, 0),
      ...(state === "pending" ? { est: { inTokens: 12_000, outTokens: 3_000 } } : {}),
    };
    sections.push(node);
    views.set(sid, { section: node, blocks, breadcrumbs: [{ id: sid, title }], terms: TERMS });
  };
  for (const t of DOC_TEMPLATE) {
    if (t.id === "s3") {
      mkSection("s3", t.titleJa, t.file, 6, ["s3/review-cycle", "s3/story"]);
      mkSection("s3/review-cycle", "レビューの1往復", t.file, 8);
      mkSection("s3/story", "storyの生成", t.file, 5);
    } else if (t.id === "s6") {
      mkSection("s6", t.titleJa, t.file, 3, modChildren);
      for (const r of ROOMS.filter((x) => x.loc > 0))
        mkSection(`s6/${r.path.split("/").pop()}` as SectionId, r.label, `doc/modules/${r.path.split("/").pop()}.md`, 9);
      if (o.bigBlocks > 0) mkSection("s6/big", "大きなモジュール", "doc/modules/big.md", o.bigBlocks);
    } else mkSection(t.id, t.titleJa, t.file, t.source === "static" ? 4 : 7, [], t.source === "static" ? "static_only" : o.generated ? "generated" : "pending");
  }
  // section views carry their own-section blocks only; the page view (s3) also lists its children's blocks
  const outline: DocOutline = {
    manifest: {
      docId: "doc_cr1t00000000",
      title: "crit",
      primaryLang: "ja",
      effort: o.generated ? "standard" : null,
      coverage: {
        filesTotal: 1219,
        filesIncluded: 393,
        filesExcluded: { vendored: 700 },
        locIncluded: 45672,
        modulesTotal: 10,
        modulesGenerated: o.generated ? 10 : 0,
        claimsTotal: 300,
        claimsVerified: 250,
      },
      usageTotals: o.generated
        ? { calls: 30, in: 190_000, cacheWrite: 10_000, cacheRead: 190_000, out: 52_000, apiUsd: 1.27 }
        : { calls: 0, in: 0, cacheWrite: 0, cacheRead: 0, out: 0, apiUsd: 0 },
      generatedAt: o.generated ? "2026-10-02T09:00:00Z" : null,
      models: o.generated ? ["claude-sonnet-5-5"] : [],
    },
    sections,
    blocks: outlineBlocks,
    readingPaths: [
      {
        id: "30min",
        title: "30分コース",
        audience: "newcomer",
        steps: ["s0", "s1", "s2", "s3", "s4", "s5", "s6"].map((s) => ({ section: s as SectionId })),
        readingSec: 1800,
      },
      { id: "5min", title: "5分コース", audience: "newcomer", steps: ["s0", "s1", "s2"].map((s) => ({ section: s as SectionId })), readingSec: 300 },
    ],
    glossaryCount: TERMS.length,
    counts: { blocks: outlineBlocks.length, claims: 300, stale: 3, verified: 250, openThreads: 4, proposals: 0 },
    outlineRev: 1,
  };
  return { outline, sections: views, terms: TERMS };
}

// ---------------------------------------------------------------- workspace, engines, estimates, settings
export function workspaceStatus(o: FixtureOptions): WorkspaceStatus {
  return {
    info: { key: WS, root: "/Users/me/src/crit", kind: "git", name: "crit", docDir: ".mitori", docCommitted: false, lastOpenedAt: "2026-10-03T00:00:00Z" },
    state: "ready",
    counts: { files: 1219, loc: 45672, modules: 10, openThreads: 4, staleBlocks: 3, runningJobs: 0 },
    doc: { exists: true, generatedAt: o.generated ? "2026-10-02T09:00:00Z" : null, effort: o.generated ? "standard" : null, lang: "ja", commitsBehind: 0 },
    snapshot: {
      commit: "406875d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7",
      tree: null,
      branch: "main",
      dirty: false,
      indexDigest: "abcd1234",
      takenAt: "2026-10-03T00:00:00Z",
    },
    scan: {
      state: "done",
      done: 1219,
      total: 1219,
      summary: {
        files: 1219,
        included: 393,
        excluded: { vendored: 700, generated: 126 },
        loc: 45672,
        languages: [
          { lang: "go", files: 186, loc: 45672 },
          { lang: "javascript", files: 63, loc: 34600 },
        ],
        modules: 10,
        facts: { entry: 3, route: 14, env: 6, cli: 9, test: 259, todo: 12 },
        tokensNaive: 900_000,
        tokensFiltered: 380_000,
        ms: 270,
        stageMs: { S0: 13, S1: 120, S2: 40, S3: 56, S4: 41 },
      },
    },
    gen: null,
    trustPending: 0,
    notices: [],
    rev: 10,
    connectedTabs: 1,
    genEngine: "claude-cli",
  };
}

export function engines(o: FixtureOptions): EngineStatus[] {
  const base: EngineStatus = {
    engine: "claude-cli",
    installed: true,
    version: "2.1.0",
    auth: "subscription",
    plan: o.plan,
    capabilities: ["system-prompt-file"],
    billing: o.billing,
    problems: [],
    dataPolicyKey: o.plan === "pro" ? "claude-cli.pro" : "claude-cli.max",
    checkedAt: "2026-10-03T00:00:00Z",
  };
  if (o.engine === "notInstalled") return [{ ...base, installed: false, auth: "unknown", problems: [{ code: "E_AGENT_NOT_INSTALLED", message: "not found" }] }];
  if (o.engine === "notLoggedIn") return [{ ...base, auth: "none", problems: [{ code: "E_AGENT_AUTH", message: "not logged in" }] }];
  if (o.engine === "capabilityLost") return [{ ...base, problems: [{ code: "E_AGENT_CAPABILITY", message: "--bare default" }] }];
  return [base];
}

const EST = {
  overview: { tok: 120_000, usd: 0.41, sec: 120 },
  standard: { tok: 400_000, usd: 1.31, sec: 360 },
  complete: { tok: 1_100_000, usd: 3.6, sec: 1020 },
};

export function estimate(o: FixtureOptions, effort: "overview" | "standard" | "complete", engine: string, seq: number): GenEstimate {
  const e = EST[effort];
  return {
    id: id("es_", 1000 + seq, 10) as `es_${string}`,
    engine: engine as "claude-cli",
    model: "claude-sonnet-5-5",
    inTokens: Math.round(e.tok * 0.45),
    cacheReadTokens: Math.round(e.tok * 0.4),
    cacheWriteTokens: Math.round(e.tok * 0.03),
    outTokens: Math.round(e.tok * 0.12),
    apiUsd: e.usd,
    seconds: { p50: e.sec, p90: Math.round(e.sec * 1.4) },
    concurrency: 3,
    windowDeltaPct: o.calibrated ? Math.round(e.usd * 8) : null,
    ...(o.calibrated ? {} : { windowDeltaRange: { low: Math.round(e.usd * 12), high: Math.round(e.usd * 30) } }),
    billing: o.billing,
    confidencePct: o.calibrated ? 12 : 25,
    calibrationN: o.calibrated ? 12 : 1,
    band: e.tok > 200_000 ? "gt200k" : "50k_200k",
    items: [],
    requiresConfirm: false,
    confirmReasons: [
      ...(o.billing === "overage" ? (["billing_overage"] as const) : []),
      // generation.md §9.4 (+ UXP-08): utilization + delta (uncalibrated ⇒ the prior's upper bound) > yieldAtFiveHour 0.8
      ...(o.utilization * 100 + (o.calibrated ? Math.round(e.usd * 8) : Math.round(e.usd * 30)) > 80 ? (["window_risk"] as const) : []),
    ],
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    effort,
    stages: [
      { stage: "S5", tasks: 10, inTokens: e.tok * 0.6, outTokens: e.tok * 0.08, apiUsd: e.usd * 0.6, seconds: e.sec * 0.6 },
      { stage: "S6o", tasks: 1, inTokens: e.tok * 0.2, outTokens: e.tok * 0.02, apiUsd: e.usd * 0.25, seconds: e.sec * 0.3 },
      { stage: "S7", tasks: 6, inTokens: e.tok * 0.2, outTokens: e.tok * 0.02, apiUsd: e.usd * 0.15, seconds: e.sec * 0.1 },
    ],
    criticalPathSeconds: e.sec * 0.3,
    alternatives: [
      { engine: "claude-cli", concurrency: 3, seconds: e.sec, apiUsd: e.usd },
      { engine: "session", concurrency: 1, seconds: e.sec * 3, apiUsd: e.usd, sessionTokens: e.tok * 1.2, batches: 4, uncalibrated: true },
    ],
    dataPolicyKey: "claude-cli.max",
  };
}

export function settings(o: FixtureOptions): SettingsView {
  return {
    settings: {
      schemaVersion: 1,
      ui: {
        lang: "ja",
        theme: "system",
        readerLevel: "standard",
        singleKeyShortcuts: true,
        keymap: {},
        showUsd: true,
        notifyOnDone: null,
        openBrowser: true,
        editor: "none",
        defaultExecPath: "push",
      },
      defaultEngine: "claude-cli",
      defaultGenEngine: "claude-cli",
      defaultEffort: "standard",
      defaultDocLang: "ja",
      privacy: {
        dataPolicyAck: o.policyAcked ? { "claude-cli": { at: "2026-10-01T00:00:00Z", shownAt: "2026-10-01T00:00:00Z", plan: o.plan } } : {},
        logContent: false,
        keepRawStreams: false,
      },
      workspaces: {},
    } as unknown as SettingsView["settings"],
    path: "/Users/me/.mitori/config.json",
    version: 3,
  };
}

// ---------------------------------------------------------------- palette (AC-J46 / J46b and the 50k budget)
export function paletteItems(o: FixtureOptions, doc: DocFixture): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const t of doc.terms)
    items.push({
      k: "t",
      i: t.id,
      l: t.term,
      ...(t.yomi ? { y: t.yomi } : {}),
      ...(t.romaji ? { r: t.romaji } : {}),
      al: [t.en ?? "", ...(t.romaji === "mochikoshi" ? ["motikosi"] : [])],
      h: `/w/${WS}/doc/s12`,
    });
  for (const s of doc.outline.sections) items.push({ k: "s", i: s.id, l: `§${s.id.replace(/^s/, "")} ${s.title}`, h: `/w/${WS}/doc/${s.id}` });
  for (const r of ROOMS) items.push({ k: "m", i: r.id, l: r.label, s: r.path, h: `/w/${WS}?room=${r.id}` });
  const syms: [string, string, string | undefined][] = [
    ["carryForwardComments", "internal/session/watch.go:464", glid(2)],
    ["carryForwardAllComments", "internal/session/watch.go:532", glid(2)],
    ["remapLines", "internal/session/watch.go:1098", glid(2)],
    ["WorkerPool", "internal/pool/pool.go:12", undefined],
    ["loop", "internal/agent/loop.go:3", undefined],
    ["route", "internal/router/route.go:3", undefined],
    ["routeTable", "internal/router/table.go:10", undefined],
    ["chunkSize", "internal/stream/chunk.go:9", undefined],
    ["chunkReader", "internal/stream/chunk.go:30", undefined],
    ["Login", "internal/auth/login.go:40", glid(3)],
    ["loginHandler", "internal/auth/http.go:12", glid(3)],
    ["SessionKey", "internal/daemon/daemon.go:178", glid(1)],
  ];
  for (const [l, s, via] of syms) items.push({ k: "y", i: `${s.split(":")[0]}#${l}`, l, s, h: `/w/${WS}/code/${s.split(":")[0]}`, ...(via ? { via } : {}) });
  const words = ["session", "watch", "comment", "daemon", "router", "stream", "reader", "writer", "agent", "story", "diff", "vcs", "github", "share"];
  for (let i = 0; items.length < o.paletteItems; i++) {
    const a = words[i % words.length] as string;
    const b = words[(i * 7 + 3) % words.length] as string;
    items.push({
      k: i % 9 === 0 ? "f" : "y",
      i: `gen/${i}`,
      l: `${a}${b.charAt(0).toUpperCase()}${b.slice(1)}${i}`,
      s: `internal/${a}/${b}.go:${(i % 400) + 1}`,
      h: `/w/${WS}/code/internal/${a}/${b}.go`,
    });
  }
  return items;
}
