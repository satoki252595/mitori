import { DEFAULT_DENY_GLOBS, type ThreadDetail } from "@mitori/core";
import type { Bundle, BundleBuilder, BundleInput } from "../../contract.ts";
import { codeAnchor, docAnchor, msg, thread } from "./builders.ts";
import type { FakeSection } from "./fake-doc.ts";
import { bundleInput, goSmallFiles, type World, world } from "./world.ts";

// The golden bundle cases of WP-08a over the go-small fixture (step 0 working tree) plus a virtual AGENTS.md and a
// small design doc. `fixtures/golden/go-small/bundles/<case>.<tier>.txt` + `.tokens` hold their bytes.

export const FETCH = "internal/meta/fetch.go";
export const SERVER = "internal/server/server.go";
export const MEMORY = "internal/store/memory.go";

export const AGENTS_MD = [
  "# Conventions",
  "",
  "## Go",
  "- gofmt と go vet が gate。エラーは fmt.Errorf で wrap する。",
  "- 定数は package の先頭にまとめる。",
  "",
  "## Errors",
  "sentinel error は store.ErrNotFound のように公開し、errors.Is で判定する。",
  "",
  "## Tests",
  "テストは table-driven にする。変更したパッケージのテストを必ず更新する。",
  "",
  "## Deploy",
  "デプロイは Cloudflare を使う。",
  "",
].join("\n");

const cite = (path: string, start: number, end: number) => ({ path, start, end, blob: "x", snippet: "y", precision: "exact" as const });

export const SECTIONS: FakeSection[] = [
  {
    id: "s6/meta",
    title: "メタデータ取得",
    blocks: [
      { id: "b_meta0001", kind: "heading", md: "## 取得 <!-- b_meta0001 -->" },
      {
        id: "b_meta0002",
        md: "ISBN を正規化し、カタログ API に 1 回だけ問い合わせる。失敗はそのまま呼び出し元へ返す。（[internal/meta/fetch.go:41-49](internal/meta/fetch.go#L41-L49)） <!-- b_meta0002 -->",
        claims: [{ id: "cl_meta0001", cites: [cite(FETCH, 41, 49)], quote: "失敗はそのまま呼び出し元へ返す" }],
      },
      {
        id: "b_meta0003",
        md: "HTTP 200 以外、または応答に該当エントリが無い場合はエラーにする。（[internal/meta/fetch.go:64-76](internal/meta/fetch.go#L64-L76)） <!-- b_meta0003 -->",
        claims: [{ id: "cl_meta0002", cites: [cite(FETCH, 64, 76)] }],
      },
    ],
  },
  {
    id: "s6/server",
    title: "HTTP サーバ",
    blocks: [
      { id: "b_srv00001", kind: "heading", md: "## 登録 API <!-- b_srv00001 -->" },
      {
        id: "b_srv00002",
        md: "POST /api/books は ISBN からメタデータを補完して本を登録する。（[internal/server/server.go:83-115](internal/server/server.go#L83-L115)） <!-- b_srv00002 -->",
        claims: [{ id: "cl_srv00001", cites: [cite(SERVER, 83, 115)] }],
      },
    ],
  },
];

export function goSmallWorld(over: Partial<Parameters<typeof world>[0]> = {}): World {
  return world({ files: { ...goSmallFiles(), "AGENTS.md": AGENTS_MD }, module: "example.com/tsundoku", sections: SECTIONS, ...over });
}

const human = (id: number, text: string, round = 1) => msg("human", text, round, "comment", id);
const agent = (id: number, text: string, round = 1) => msg("agent:claude-cli/claude-sonnet-5-5", text, round, "answer", id);

export interface BundleCase {
  name: string;
  tier: "XS" | "S" | "M" | "L";
  /** Token window of the tier is asserted (the tiers are for push bundles; pull / copy / repair only pin their bytes). */
  window: boolean;
  run(b: BundleBuilder, w: World): Promise<{ text: string; tokens: number }>;
}

const T = (id: string, over: Partial<ThreadDetail> = {}): ThreadDetail => thread({ id: id as ThreadDetail["id"], ...over });
const gates = [
  { id: "fmt:gofmt" as const, trusted: true },
  { id: "typecheck:govet" as const, trusted: true },
  { id: "test:related" as const, trusted: true },
];

const build = (b: BundleBuilder, input: BundleInput, budget: number) => b.build(input, budget).then((r: Bundle) => ({ text: r.text, tokens: r.tokens }));

/** A batch of change threads, one whole-or-part anchor each. */
function batch(anchors: { id: string; path: string; start: number; end: number; ask: string }[], extra: Partial<ThreadDetail> = {}): ThreadDetail[] {
  return anchors.map((a, i) =>
    T(a.id, {
      intent: "change",
      anchor: codeAnchor(a.path, a.start, a.end),
      messages: [
        human(i * 3 + 1, "前に出した方針を覚えているか確認したい", 1),
        agent(i * 3 + 2, "はい、定数にまとめる方針でした。", 1),
        human(i * 3 + 3, a.ask, 2),
      ],
      round: 2,
      ...extra,
    }),
  );
}

export const CASES: BundleCase[] = [
  {
    name: "question",
    tier: "XS",
    window: true,
    run: (b) =>
      build(
        b,
        bundleInput({
          mode: "answer",
          out: "answer/1",
          threads: [
            T("th_91c0de7m", {
              intent: "question",
              anchor: {
                ...docAnchor("b_meta0003", { claim: "cl_meta0002", quote: { prefix: "", exact: "応答に該当エントリが無い場合はエラーにする", suffix: "" } }),
              },
              messages: [human(1, "なぜ再試行しないのか?上限 3 回の再試行を入れても問題ないか知りたい。")],
            }),
          ],
          budget: { in: 2000, out: 600, usd: 0.02 },
        }),
        800,
      ),
  },
  {
    name: "findings",
    tier: "XS",
    window: true,
    run: (b) =>
      build(
        b,
        bundleInput({
          mode: "findings",
          out: "findings/1",
          threads: [T("th_5e7d1a40", { intent: "review", anchor: codeAnchor(FETCH, 51, 77), messages: [human(1, "エラー処理に抜けがないか見てほしい。")] })],
          budget: { in: 2500, out: 1000, usd: 0.03 },
        }),
        800,
      ),
  },
  {
    name: "change",
    tier: "S",
    window: true,
    run: (b) =>
      build(
        b,
        bundleInput({
          threads: [
            T("th_17ab3c9d", {
              intent: "change",
              round: 2,
              anchor: { ...codeAnchor(FETCH, 41, 77), doc: { block: "b_meta0003", blockHash: "x", quote: { prefix: "", exact: "エラーにする", suffix: "" } } },
              messages: [
                human(1, "HTTP エラーのときにステータスを返したい", 1),
                agent(2, "いまは文字列に埋め込んでいます。[[internal/meta/fetch.go:65-65]]", 1),
                human(3, "ステータスコードを持つエラー型にして、404 は ErrNotFound として返して。設計書の記述も合わせて。", 2),
              ],
            }),
          ],
          write: [FETCH],
          gates,
          budget: { in: 4000, out: 1500, usd: 0.1 },
        }),
        1500,
      ),
  },
  {
    name: "agent",
    tier: "S",
    window: true,
    run: (b) =>
      build(
        b,
        bundleInput({
          mode: "agent",
          out: "agent/1",
          threads: [
            T("th_8c4f20be", {
              intent: "change",
              anchor: codeAnchor(SERVER, 83, 125),
              messages: [human(1, "ISBN が空のときは 400 を返してほしい。テストも足して。")],
            }),
          ],
          write: [SERVER, "internal/server/server_test.go"],
          gates: gates.slice(0, 2),
          budget: { in: 12000, out: 3000, usd: 0.4 },
        }),
        1500,
      ),
  },
  {
    name: "batch3",
    tier: "M",
    window: true,
    run: (b) =>
      build(
        b,
        bundleInput({
          threads: batch([
            { id: "th_a0000001", path: FETCH, start: 1, end: 77, ask: "Client に User-Agent を付ける" },
            { id: "th_a0000002", path: SERVER, start: 56, end: 150, ask: "登録 API のエラーを JSON で返す" },
            { id: "th_a0000003", path: MEMORY, start: 1, end: 76, ask: "Create の重複判定を ISBN でも行う" },
          ]),
          write: [FETCH, MEMORY, SERVER],
          gates,
          budget: { in: 6000, out: 3000, usd: 0.2 },
        }),
        5000,
      ),
  },
  {
    name: "batch8",
    tier: "L",
    window: true,
    run: (b) =>
      build(
        b,
        bundleInput({
          threads: batch([
            { id: "th_b0000001", path: FETCH, start: 1, end: 77, ask: "リトライ回数を設定できるようにする" },
            { id: "th_b0000002", path: SERVER, start: 1, end: 151, ask: "ログを構造化する" },
            { id: "th_b0000003", path: MEMORY, start: 1, end: 76, ask: "List の並びを AddedAt 順にする" },
            { id: "th_b0000004", path: "internal/store/store.go", start: 1, end: 52, ask: "Status の検証を Store で行う" },
            { id: "th_b0000005", path: "internal/config/config.go", start: 1, end: 38, ask: "環境変数名を TSUNDOKU_ に統一する" },
            { id: "th_b0000006", path: "cmd/tsundoku/main.go", start: 1, end: 119, ask: "サブコマンドの usage を揃える" },
            { id: "th_b0000007", path: "cmd/tsundoku-cobra/main.go", start: 1, end: 63, ask: "cobra 版にも --token を足す" },
            { id: "th_b0000008", path: "internal/store/memory_test.go", start: 1, end: 43, ask: "並行アクセスのテストを足す" },
          ]),
          write: [
            FETCH,
            SERVER,
            MEMORY,
            "internal/store/store.go",
            "internal/config/config.go",
            "cmd/tsundoku/main.go",
            "cmd/tsundoku-cobra/main.go",
            "internal/store/memory_test.go",
          ],
          // context chips (`@`): neighbouring routes, the README, the Makefile, the schema and the ADR
          extra: [
            { path: "internal/server/chi_routes.go", start: 1, end: 21 },
            { path: "README.md", start: 1, end: 38 },
            { path: "Makefile", start: 1, end: 13 },
            { path: "migrations/0001_init.up.sql", start: 1, end: 19 },
            { path: "docs/adr/0001-use-net-http.md", start: 1, end: 20 },
          ],
          gates,
          budget: { in: 12000, out: 6000, usd: 0.5 },
        }),
        12000,
      ),
  },
  {
    name: "pull-question",
    tier: "XS",
    window: false,
    run: (b) =>
      build(
        b,
        bundleInput({
          mode: "pull",
          out: "reply",
          threads: [
            T("th_91c0de7m", { intent: "question", anchor: codeAnchor(FETCH, 41, 49), messages: [human(1, "Fetch はなぜ 1 回しか問い合わせないのか?")] }),
          ],
          budget: { in: 800, out: 400, usd: 0.01 },
        }),
        4000,
      ),
  },
  {
    name: "pull-change",
    tier: "S",
    window: false,
    run: (b) =>
      build(
        b,
        bundleInput({
          mode: "pull",
          out: "reply",
          threads: [T("th_17ab3c9d", { intent: "change", anchor: codeAnchor(FETCH, 60, 72), messages: [human(1, "404 のときは ErrNotFound を返して")] })],
          write: [FETCH],
          budget: { in: 1500, out: 600, usd: 0.02 },
        }),
        4000,
      ),
  },
  {
    name: "copy-change",
    tier: "S",
    window: false,
    run: (b) =>
      build(
        b,
        bundleInput({
          mode: "copy",
          out: "reply",
          target: "claude-code",
          threads: [T("th_17ab3c9d", { intent: "change", anchor: codeAnchor(FETCH, 60, 72), messages: [human(1, "404 のときは ErrNotFound を返して")] })],
          write: [FETCH],
          deny: [...DEFAULT_DENY_GLOBS],
          budget: { in: 4000, out: 1500, usd: 0.1 },
        }),
        4000,
      ),
  },
];
