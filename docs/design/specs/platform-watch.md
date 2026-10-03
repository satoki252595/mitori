# platform-watch — O3（Linux の watcher）の計測と採用方式

- 版: 1.0（2026-10-03、WP-01） / 関連: indexer spec §10.1（O3 の測り方と採用規則）、server 契約 `FsWatcher`・`WATCH_BATCH`、ARCHITECTURE §12 O3
- **決定: 候補 A（Bun の recursive `fs.watch`）を Linux でも採用する。** macOS・Linux とも同じ実装（`packages/platform/src/watch/watcher.ts`）。polling（候補 B）は実装しない。

## 1. 採用規則（indexer spec §10.1）

A が **setup ≤ 500 ms・p95 ≤ 100 ms・捕捉率 100 %・idle CPU ≤ 1 %** を全部満たせば A、1 つでも外れたら B。

## 2. 計測方法

- bench: `packages/platform/bench/watch.bench.ts`（Bun + node builtin のみ。素の Linux コンテナに bun バイナリを置くだけで動く）。
  生データ: `packages/platform/bench/results/o3-{linux,darwin}-arm64.json`。
- 木: 合成 2 段の木（top 31 dir + 残りを leaf dir、file は leaf に round-robin）。small = 7,768 files / 923 dirs、large = 23,304 files / 2,800 dirs。
- 測るもの: (1) `watch()` の setup 時間、(2) 単一ファイル書込 200 回（各回 100 ms 間隔、別ファイル）の書込 → 生イベント p50/p95、(3) 2,000 新規ファイル一括書込の捕捉率（+ setup 後に作った dir 20 個 × 5 files の捕捉率）、(4) 10 s の idle CPU（B は子 git の CPU 込み）、(5) RSS 増分。
- B の手順は spec どおり: 間隔ごとに `git ls-files -z -m -o --exclude-standard` → 集合 S_t、`(S_t △ S_{t−1}) ∪ {stat が変わった p}`。B の遅延は 250 ms 間隔で 40 回。
- 環境: Apple M5 Max（18 core、128 GB）/ macOS 27.0、Bun 1.4.2。Linux は同じ機械の OrbStack VM（kernel 7.0.14、arm64、Ubuntu 22.04 userland、`--cpus 4`、`fs.inotify.max_user_watches = 1,048,576`）。木はコンテナ内の overlayfs（`/tmp`）。他の実装 agent が並走して load average ≈ 15–23 の状態で測った（遅延は保守側に出る）。
- 再実行: `scripts/nd bun packages/platform/bench/watch.bench.ts --trees small,large --cands A,B --json out.json`。Linux は `docker run … --entrypoint <script>`（bun-linux-aarch64 を `/usr/local/bin/bun` に置いて同じコマンド）。

## 3. 結果

| OS | 候補 | 木 | setup | p50 | p95 | 取りこぼし | 捕捉率（一括 / 新 dir） | idle CPU | RSS 増分 | 規則 |
|---|---|---|---|---|---|---|---|---|---|---|
| Linux arm64 | **A** inotify | small | 5.0 ms | 0.3 ms | 0.6 ms | 0 / 200 | 100 % / 100 % | 0.13 % | 1.7 MB | 満たす |
| Linux arm64 | **A** inotify | large | 14.6 ms | 0.5 ms | 0.8 ms | 0 / 200 | 100 % / 100 % | 0.16 % | 0.7 MB | 満たす |
| Linux arm64 | B poll 250 ms | small | 12.2 ms | 115.9 ms | 243.4 ms | 0 / 40 | 100 % / — | 10.2 %（1 s: 3.2 %、5 s: 0.5 %） | 9.7 MB | — |
| Linux arm64 | B poll 250 ms | large | 41.1 ms | 172.4 ms | 308.5 ms | 0 / 40 | 100 % / — | 20.5 %（1 s: 5.9 %、5 s: 1.4 %） | 5.2 MB | — |
| macOS arm64 | **A** FSEvents | small | 2.5 ms | 12.3 ms | 13.3 ms | 0 / 200 | 100 % / 100 % | 0.09 % | 8.3 MB | 満たす |
| macOS arm64 | **A** FSEvents | large | 0.1 ms | 11.3 ms | 12.6 ms | 0 / 200 | 100 % / 100 % | 0.07 % | 0.1 MB | 満たす |
| macOS arm64 | B poll 250 ms | small | 49.6 ms | 172.1 ms | 273.6 ms | 0 / 40 | 100 % / — | 17.7 %（1 s: 4.3 %、5 s: 0.9 %） | 9.1 MB | — |
| macOS arm64 | B poll 250 ms | large | 121.9 ms | 215.0 ms | 352.1 ms | 0 / 40 | 100 % / — | 28.0 %（1 s: 9.2 %、5 s: 2.2 %） | 1.4 MB | — |

watcher 全体（`createFsWatcher`、leading 5 ms のバッチ込み、書込 → コールバック、40 回、`watch.int.test.ts`）:
macOS p50 **17.2–17.5 ms** / p95 18.7 ms（受け入れ試験 p50 ≤ 25 ms）、Linux p50 6.8 ms / p95 7.7 ms。保存 → stale バッジ 50 ms 予算に対して indexer の update（≤ 15 ms/file）を足しても収まる。

## 4. 観察

- **A は Linux でも 4 条件すべてを大差で満たした。** Bun 1.4.2 の recursive `fs.watch` は Linux で inotify watch を dir ごとに張り、setup 後に作られた dir も追跡する（新 dir 捕捉 100 %）。
- B は spec の想定どおり遅く（p95 は間隔 + git 実行時間）、250 ms 間隔の idle CPU が 10–28 % で採用規則の 1 % を大きく超える。5 s 間隔でも large では 1 % を超える。
- **FSEvents の間引き**: macOS では前のイベントから < 50 ms で次の書込が来ると配送が ≈ 35 ms に伸びる（間隔 15 ms で p50 35 ms、50 ms 以上で 11 ms。`watch.bench.ts` の単一書込は 100 ms 間隔にしてある）。連続保存の 2 回目以降は 35 ms 前後になるが、leading 5 ms と合わせても 50 ms 予算内。
- FSEvents はイベント種別をほぼすべて `rename` で返す。watcher は種別を信用せず、batch の各 path を lstat して add / change / delete を決める（初見の既存 path は `add`。rename は同じ batch の delete(旧) + add(新)、indexer §10.2 step 7 の rename 検出に合う）。

## 5. 実装上の帰結（`createFsWatcher`）

- batch: leading 5 ms、burst 中は先頭イベントから最大 30 ms（`WATCH_BATCH`）。同じ path は batch 内で 1 件。
- `.git/` は `index`・`HEAD`・`packed-refs`・`refs/**` の変化だけを `{kind:"git"}` 1 件に畳む。git dir が木の外（linked worktree・shadow repo）なら別に watch する。入れ子の `.git` 以下は捨てる。OS がファイル名を落とした通知（overflow）は `{kind:"git"}`（warm scan）にする。
- mitori 自身の書込（`SafeWriter` → `SelfWriteLog`）は内容 hash が一致する間は報告しない（PLAT-I-007）。temp 名 `.mitori-tmp-<16hex>` は常に無視。
- setup 後に作られた（または移動してきた）dir に event が来たら、その中を最大 20,000 entry 列挙して add を補う（OS の watch が付く前に書かれたファイルの取りこぼし対策。今回の計測では不要だったが保険として残す）。

## 6. 残るリスクと監視

- inotify の上限: `fs.inotify.max_user_watches` が小さい古い distro（8,192）で dir 数がそれを超えると `watch()` が失敗する → `E_IDX_WATCH`（起動時）または `onError`（実行中）。その場合の polling fallback は実装していない（kernel 5.11 以降は既定が RAM 比例で 100 万規模）。発生したら `mitori doctor` で上限を表示し、B を後付けする（spec の手順はそのまま使える）。
- GitHub Actions `ubuntu-24.04`（x64、ext4）では未計測。CI で `watch.int.test.ts` が走るので、遅延の退行はそこで見える。
