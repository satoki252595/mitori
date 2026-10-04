# UI 継続検証（2026-10-04）

生成/文言の最後の修正後も出荷assetでsize2/2成功。JSはS1/S2 **87.4/91.3KB gz**、CSS **18.7/16.4KB**、初期font/CM6なし。証拠は `continuation-checks/size.log`。CSSはfirst useful paintまでに取得した資産の値。

最終の費用・timeout修正後に出荷資産を再buildし、Settings2件とsize2件は4/4成功。served gzipはS1/S2 JS **87.4/91.3KB**、CSS **18.7/17.6KB**。証拠は `continuation-checks/provider-browser.log`。以下の前段の測定値は各段階の記録として残す。

## 初期 JS の最小修正

- `packages/client/src/http/index.ts`: API クライアントが参照していた全 `ROUTE_META` を、必要な SSE / text / download の応答形式だけへ縮小した。サーバーの認証・呼び出し元・single-writer 契約は変更していない。
- `packages/client/src/http/http.test.ts`: 全 canonical route に対する実際の応答デコードを検査する。今後 text / download / SSE route が増えると不整合を検出する。
- `apps/web/vite.config.ts`: core / client 全体を entry に強制的にまとめる指定を外した。lazy UI のみで使用する helper は、その UI と一緒に読み込まれる。

変更後の mock daemon による **first useful paint までの served gzip**（KB = 1,024 B）:

| route | 初期 JS | entry | base catalog | route 本体 | その他 |
|---|---:|---:|---:|---:|---:|
| S1 地図 | **85.8 KB** | 60,088 B | 9,966 B | map 16,805 B | boot 656 B、engine 324 B |
| S2 Reader | **89.6 KB** | 60,088 B | 9,966 B | reader 18,956 B | boot 656 B、decorate 1,645 B、levels 423 B |

CSS は S1 18.7 KB、S2 17.6 KB（25 KB cap 内）。web fonts と初回 CM6 読み込みは 0。
測定中に並行修正されたファイルがあるため、この数値は統合全変更の最終 build の値ではない。後続の統合 browser 計測は末尾に記載した。

同じ作業中の source を使い、HTTP client と entry grouping だけを HEAD の内容へ戻した対照 build の entry は 61,210 B gz。
変更後の entry は 60,088 B gz で **1,122 B 減**。対照 route の browser 測定は実施していない。

検証:

```sh
scripts/nd bun test packages/client
# 17 pass、179 expect、0 fail（canonical route parity を含む）
scripts/nd bunx biome check packages/client/src/http/index.ts packages/client/src/http/http.test.ts apps/web/vite.config.ts
# ok
scripts/nd bunx vite build --config apps/web/vite.config.ts
# ok
MITORI_E2E_SKIP_BUILD=1 MOCK_PORT=4391 scripts/nd bunx playwright test -c e2e/web/playwright.config.ts size.pw.ts
# 2 pass、上記 first useful paint 計測
```

**この中間 build でも60 KB target は未達**。残りは S1 約 25.8 KB、S2 約 29.6 KB gz。最終計測の不足量は末尾を参照する。
Header / Rail は両 route の初期表示に必要であり、単に別 chunk にしても first useful paint までの総転送量は減らない。
`createStores` は boot 時に全 store を作り、Shell と SSE が横断して参照する。Svelte runtime、shell、store、route renderer の初期依存を実際に減らすには、初期表示と store 境界を再設計する必要がある。
route catalog を分割しても追加削減はおおむね 2〜3 KB で、60 KB には届かない。今回の最小修正には含めていない。

## 任意 LLM / Muse 用 UI の調査と実装

生成のエンジン選択 radio は `apps/web/src/gen/GenEstimateCard.svelte` で **`est.alternatives` をそのまま列挙**する。
バックエンドが generic / Muse を alternatives に返せば UI の候補列挙は再利用できる。Settings も `s.session.engines` を列挙するため、adapter が status を公開すれば一覧には現れる。

調査で確認した箇所（下記の UI 修正へ反映）:

1. `apps/web/src/map/MapPage.svelte:50`: status を workspace の旧 `genEngine` から取得するため、カード内で `s.gen.setEngine()` を変更しても選択中エンジンの状態へ追従しない。`s.gen.engine` を基準にする。
2. `apps/web/src/stores/gen.svelte.ts:25` / `apps/web/src/shell/Shell.svelte:114`: 初期値は `claude-cli`、workspace status があるとその値を入れる。バックエンドの `defaultGenEngine` を反映する初期化に揃える。
3. `apps/web/src/map/engine.ts` / `EngineCard.svelte`: 全 engine の修復コマンドを Claude 向けとして表示する。現在 `npm install -g @anthropic-ai/claude-code` が埋め込まれており、ユーザーの nix 運用ルールとも不整合。engine-aware な手順へ変更し、Muse に Claude の login / update を勧めない。
4. `apps/web/src/gen/GenEstimateCard.svelte`: 現在候補と履歴に表示するのは engine id だけ。`generic:muse-spark-1.3-contributor` / effort `max` が設定されたことを、見積りに含まれる model 情報と合わせて確認できる表示が必要。
5. `apps/web/i18n/gen.{ja,en}.json` の `gen.session.step1` は Claude Code 固定。任意エンジンの session 説明を出す場合は選択中 engine に合う表記へ変更する。

バックエンド側の制限は `GenEngineId`、`engineFor`、見積り alternatives / model routing にある。UI の選択候補だけを増やしても generic 生成は動かない。core / settings / gen と Muse adapter の担当者が所有する範囲で対応する。

### UI の実装結果

- Settings に generic の model id / argv JSON 配列 / 出力 protocol / reasoning / 明示価格の入力を追加した。後続の統合確認で SEC-06 の境界（ブラウザは実行設定を書き換えない）を確認し、実行設定は利用者がコピーできる `mitori config set engines.generic …` コマンドで登録する方式へ修正した。CLI 適用後の設定を読み直して一致を確認してから、models / defaults / reasoning を保存する。argv は shell 文字列として解釈しない。
- Muse preset は `generic:muse-spark-1.3-contributor`、reasoning `max`、`muse-jsonl`、入力 $0.10 / 出力 $0.20 / cache read $0.002 per 1M tok を入力する。既存設定に検証済み `.../muse-bin` がある場合だけ実行ファイルを引き継ぐ。それ以外は先頭 argv を空欄にして、利用者が実際の native binary を指定するまで保存を拒否する。private な絶対パスは source / この資料へ埋め込んでいない。
- preset の argv は adapter 担当者が確認した `exec --json`、model / effort / promptFile、emptyCwd、worktree off、shell / write / web 無効、foreign personal context / session log 無効、max model steps 1、untrusted approval / judge off を使用する。reminder / hook の無効化は Muse adapter の責任範囲。
- default engine を設定取得後に解決し、手動選択が late workspace status で戻らないよう `engineChosen` を持つ。map の問題カードは現在選択中 engine の status を参照する。Claude 以外に Claude の login / update を表示しない。インストール手順は nix の案内へ変更した。
- 生成カードに選択した reasoning を表示する。既存 detail line の model id と合わせて Muse / max を確認できる。
- Contributor の送信先・入力と出力の学習利用を明示した。unknown provider の fallback は Anthropic 固定の表記を廃止した。generic の確認済み状態は adapter の安定した `status.plan` と保存済み ack.plan が一致するときだけ有効で、provider / model / argv が変われば確認し直す。設定保存・preset 入力によって privacy ack は作らない。

Contributor のデータ利用と価格は [Meta の公開資料](https://dev.meta.ai/docs/pricing-rate-limits) を2026-10-04に確認した。Contributor は入力・出力をモデル学習に利用する許可と引き換えに割引される。Standard の扱いを流用していない。

追加検証（LLM 呼び出し 0、build は未実施）:

```sh
scripts/nd bun test apps/web/src/map/map.test.ts apps/web/src/settings/provider.test.ts apps/web/src/gen/gen.test.ts apps/web/src/shell/i18n-ns.test.ts
# 62 pass、999 expect、0 fail
scripts/nd bun run check:web
# 0 errors、0 warnings
```

変更した15ファイルの Biome check は成功。後続の統合 browser 検証と served asset の計測は末尾に記載した。

## F6: 大きな節の範囲取得・圧縮（CR ui-3）

`GET /ws/:ws/doc/sections/:section` に互換な query を追加した。`from` は 0〜1,000,000、`limit` は 1〜512（省略時150）。範囲を指定した最初の応答は全 block の実際の metadata と対象範囲の HTML を返し、範囲外の `html` は空。`total` は全 block 数、`from` は block 数まで clamp した先頭位置。後続の `outline=false` は対象範囲の block のみ返す。`outline` は範囲指定時に限り `true` / `false` を受け付ける。不正値は domain を読む前に `E_INVALID_INPUT`。範囲を指定しない呼び出しは従来どおり全 HTML を返し、`total` / `from` は付かない。canonical block の metadata / ord / outlineRev は変更しない。

この section route の JSON が 8,192 B 以上の場合に限り、既存 `negotiate` と標準 `node:zlib` で br（quality4）/ gzip を選ぶ。`q=0` を尊重し、`Vary: accept-encoding` を付ける。auth / no-store / security headers は既存 HTTP wrapper を通る。他の JSON route の挙動は変更していない。

Reader は最初に anchor の50 block 前から150 block の HTML を要求し、残りを native `requestIdleCallback`（未対応環境は timer）で150ずつ補充する。空 HTML は推定高さの skeleton を表示し、生成 placeholder と区別する。SSE の upsert / removal / freshness を保つため、補充時は現在の metadata と順序へ id で HTML を merge し、既に描画済みの upsert を上書きしない。workspace reset 後の返信は破棄する。全 HTML が揃うまで既読 marker を観測せず、⌘K DocText は partial cache を索引に使わず従来の full response を読む。補充の通信失敗は次の navigation で再試行する。

10,000 block の cold cache では `MdLines.lineOf` が同じ file を10,000回並行して読んでいたため、既存 mtime cache に進行中の Promise を保持して1回へまとめた。mtime 更新時の再読込と、範囲外 block の正確な mdLine は維持する。

検証（LLM 呼び出し0、追加 buildなし）:

```sh
scripts/nd bun test packages/server/src/wiring/sections.test.ts apps/web/src/stores/doc.test.ts apps/web/src/palette/doctext.test.ts apps/web/src/reader/page.test.ts
# 31 pass、163 expect、0 fail
scripts/nd bunx tsc -b packages/server --pretty false
scripts/nd bun run check:web
# 0 errors、0 warnings
```

範囲の上限・不正値、outline=false、default full、10,000 block で150件のみ render / file read1回、br/gzip/q=0 と復号一致、anchor 先行、補充中の SSE stale/upsert/removal、workspace reset、DocText の full取得を検証した。変更した F6 11ファイルの Biome check と `git diff --check` は成功。

## 統合 browser 計測と CLS 修正

出荷用 `dist/.build/web` の production assets を別ディレクトリへコピーし、`MITORI_E2E_SKIP_BUILD=1` と既存 Chromium で32件を実行した。**30 pass / 2 fail**で、失敗は地図の boot CLS（1440×900、1280×800）だけだった。古い `apps/web/dist` を使った途中の実行は最終結果に含めていない。

mock の version を配信 assets と合わせた後も、1440×900 では非同期の見積り表示とタイトルの高さ変化で CLS が発生した。`MapPage.svelte` の見積り領域を最初の描画から484px確保し、タイトルの1行分を確保した。既存の狭い画面用の高さ指定は維持した。判定閾値は変更していない。

この修正を含む production build で、失敗した CLS 2件と size 2件だけを再実行し、**4 pass / 0 fail**。CLS は **1440×900、1280×800 とも0**だった。32件の全再実行はしていない。

| route | 初期 JS gzip | CSS gzip | 判定 |
|---|---:|---:|---|
| S1 地図 | **89,515 B（87.4 KB）** | 19.8 KB | JS 150 KB / CSS 25 KB cap 内 |
| S2 Reader | **93,533 B（91.3 KB）** | 16.4 KB | JS 150 KB / CSS 25 KB cap 内 |

KB は1,024 B。first useful paint までの実転送量で、web fonts と初回 CM6 読み込みは0。**初期 JS の60 KB target は未達**で、S1 は約27.4 KB、S2 は約31.3 KB gz の削減が残る。

32件の実行では、10,000 block の first paint 114ms、最大 DOM 2,441、Reader heap 27MB、全文索引込み32.4MB、全文検索の初回 hit 232msを記録した。far anchor の最初の range、後続の `outline=false` 補充、補充中の SSE stale と、Settings の Muse CLI 設定・privacy consent を含む試験は成功した。これは mock daemon の機能検証であり、未登録の real-daemon ベンチ7件の代用にはしない。

既存ログは `/tmp/mitori-browser-check.log`（全経過）と `/tmp/mitori-browser-cls-fixed.log`（修正前後の4件）。最終 snapshot は `/tmp/mitori-browser-cls-fixed.UkKlHa`。この確認後の `check:web` は0 errors / 0 warnings、関連5ファイルの Biome check と `git diff --check` は成功した。
