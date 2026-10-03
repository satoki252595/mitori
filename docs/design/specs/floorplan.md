# floorplan spec — S1 床面図（WP-18、stretch）

- 版: 0.1（2026-10-03、レビュー R1 で新設: CONS-10 / SC-03） / 所有: `@mitori/doc`（`packages/doc/src/layout/floorplan.ts`）
- 位置づけ: **MVP の S1 は ELK の container / dependency 図**（`MapView.fallback = "container"`）。床面図は本書を満たしたうえで WP-18 として実装し、feature flag `ui.map.floorplan`（既定 off）で有効にする。型（`DiagramKind "floorplan"`、`FloorZone`、`DiagramLayout.doors/groups[].zone/polygon`、`MapView.quality`、`DiagramLayouter.layoutFloorplan`）は R1 で契約に入っている。
- 出典: `prototypes/JUDGEMENT.md` §6.3.3〜6.3.4（描画規則・算法・品質ゲートの初版）。本書はそれを**データの出所と所有者まで**決めて実装可能にする。

---

## 1. 入力（すべて 0 token・決定的）

| 入力 | 出所 |
|---|---|
| leaf module（部屋） | `Indexer.modules()`（alive、leaf）。部屋数 > 40 なら親 module で畳む（§4-7） |
| 部屋の LOC・主なファイル | `ModuleInfo.loc`、`MapView.modules[].topFiles`（上位 5 ファイル、LOC 降順） |
| 部屋間の重み | `Indexer.graph("module")` の import 辺（`kind:"import"`、weight）。directory prior 辺は使わない |
| 区画（zone）の材料 | facts（`EntryFact`・`RouteFact`・`CliFact`・`ConfigFact`・`DependencyFact`）、path 規則、言語 |
| 外部アクター | §3 の検出器（indexer の facts tier 2 で追加） |

## 2. 区画の分類器（`FloorZone`）

各 leaf module を次の規則で**最初に当たった**区画に入れる（上から順に評価、同点なし）。

| 順 | zone | 条件 |
|---|---|---|
| 1 | `entry` | module 内に `EntryFact`（main / bin / script / worker / lambda）か、`RouteFact` の handler が 3 件以上、または `CliFact` がある |
| 2 | `ui` | module の LOC の 60% 以上が tsx / jsx / svelte / vue / css、または dominant dir が `^(?:web\|ui\|frontend\|app\|components\|pages\|views)(/\|$)` |
| 3 | `infra` | DB・HTTP client・queue・cloud SDK への外部依存（`DependencyFact` の名前が `INFRA_DEPS` 表 [仮: pg, mysql, sqlite, redis, prisma, drizzle, gorm, sqlalchemy, axios, node-fetch, reqwest, aws-sdk, @aws-sdk/*, google-cloud, boto3, kafka, amqp, nats]）を import するファイルが LOC の 40% 以上、または dominant dir が `^(?:db\|store\|storage\|infra\|adapters?\|clients?\|repo(?:sitory)?\|persistence\|migrations?)(/\|$)` |
| 4 | `resident` | 常駐プロセス: worker / daemon / server / scheduler / queue consumer の名前（`^(?:worker\|daemon\|server\|scheduler\|jobs?\|cron\|consumer)s?(/\|$)`）、または goroutine / thread / event loop 起動（`go func`、`tokio::spawn`、`setInterval`、`asyncio.create_task`）が module 内に 2 件以上 |
| 5 | `core` | それ以外 |

- 区画数は最大 5。空の区画は作らない。1 区画しか無い repo（小さな CLI など）は品質ゲート（§5）で container 図に退避されやすい。それでよい。

## 3. 外部アクター検出器（facts tier 2、indexer が実装）

| actor | 検出（言語ごとの tree-sitter query、`detector` id に版） |
|---|---|
| `http_client` | `fetch(`・axios・`http.Get`・`reqwest::`・`requests.`・`httpx.` の呼び出しで URL literal の host を取る（値は host だけ、query は捨てる） |
| `exec` | `child_process.*`・`exec.Command`・`std::process::Command`・`subprocess.*` |
| `write_sink` | 書き込み先: `fs.writeFile`・`os.WriteFile`・`open(…, "w")`・DB の INSERT/UPDATE 文字列 |
| `env` | 既存の `EnvFact`（値は持たない） |

各 actor は `DiagramNode {shape:"external"}` として建物の外（右端）に置き、根拠の facts へ `ref.path` で飛べる。

## 4. 算法（`layoutFloorplan(ir, prev)`、ELK Worker 内で実行、決定的）

1. 建物 = 16:10 の長方形（幅 1600 単位）。
2. 区画を squarified treemap で分割。区画の面積 = 区画内の部屋面積の和。並び順: `entry` 左上 → `core` → `resident` → `infra` 右 → `ui` 左下（固定順）。
3. 部屋の面積 `a = clamp(a0·√LOC, Amin, Amax)`、`a0 = 建物面積 × 0.85 / Σ√LOC`、`Amin = 1.2%`、`Amax = 22%` [仮]。
4. 区画内の部屋の順序 = 部屋隣接行列（import weight、対称化）の Laplacian の Fiedler vector の昇順。固有値計算は power iteration（最大 200 回、収束 1e-6）、同点・未収束は module id 順。
5. 扉 = 共有壁 ≥ 34 単位かつ import がある組の共有区間の中点（`doors[]`、`b:null` は建物外の actor への扉）。
6. 安定化: `prev` があり、全部屋の LOC 変化が 20% 未満なら、前回の順序を保つ [仮]。
7. 部屋数 > 40: 親 module で畳み、それでも > 40 なら §5 で退避。
8. 出力: `DiagramLayout`（`engine: "mitori-floorplan@1"`、`nodes`、`doors`、`groups`（`kind:"zone"`、`zone`、必要なら `polygon`））。同じ入力 ⇒ byte 一致（canonical JSON）。

## 5. 品質ゲート（どれか 1 つでも外れたら container 図に退避）

| 指標 | 閾値 [仮] | 定義 |
|---|---|---|
| `labelFit` | ≥ 0.70 | fit ズームで部屋名が `md` クラス（JUDGEMENT §6.3.3）以上で入る部屋の割合 |
| `doorRatio` | ≥ 0.45 | import 辺のうち扉になったものの割合 |
| `rooms` | ≤ 40 | 畳んだ後の部屋数 |
| `layoutMs` | ≤ 30 | 40 部屋での計算時間（ELK Worker、M1 の機材） |

- 退避時は `MapView.fallback = "container"`、`MapView.quality` に実測値、strip に「間取り図にできない構成のため依存図で表示」。
- 計測計画: fixture 8 repo（flask・ripgrep・hono・excalidraw・fastapi・react・crit・m3e）で 4 指標を記録。**25% を超える repo が退避するなら面積式と区画の選び方を見直す**（JUDGEMENT §11-1）。

## 6. 受け入れ試験（WP-18）

| ID | 内容 |
|---|---|
| FP-AT-01 | 8 fixture で決定性（2 回の layout が byte 一致）、`prev` ありで順序保持 |
| FP-AT-02 | 4 指標を記録し、退避率 ≤ 25% |
| FP-AT-03 | 40 部屋で ≤ 30 ms、SVG ノード ≤ 1,500（AC-J61） |
| FP-AT-04 | 区画分類器の golden（fixture ごとに module → zone の期待表） |
| FP-AT-05 | flag off で S1 は常に container 図（MVP の挙動が変わらない） |
| FP-AT-06 | JUDGEMENT AC-J03・J04・J05（Z3）・J08・J09 を WP-18 の e2e として復活 |
