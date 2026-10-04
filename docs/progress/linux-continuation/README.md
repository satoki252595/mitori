# Linux arm64 継続検証 — 2026-10-04

既存 `scripts/linux-ci.sh` をユーザーが許可した Docker 検証の範囲で実行した。ホストへの依存追加・有料 LLM 呼び出しはない。基準値と安全性の assertion は変更していない。

## 結果

| 項目 | 初回 (`arm64/`) | 修正後 (`arm64-rerun/`) |
| --- | --- | --- |
| frozen install | exit 1、3秒。`tree-sitter-typescript` native fallback が `node-gyp ENOENT` | **exit 0、5秒**。通常 install が成功し `--ignore-scripts` 不要 |
| cold check | exit 1、58.23秒。adapter テストの整形漏れ + 30秒上限超過 | 全項目成功、57.25秒、時間上限で **exit 1** |
| warm check | 未実行 | **exit 0、15.68秒**。15秒目標超過の警告あり |
| 全体 unit | 2844 pass / 141 skip / 4 todo / **1 fail**、2990 tests / 318 files、208.82秒 | 全体再実行なし。失敗した F1 のみ **2 pass / 4 macOS skip / 0 fail**、29 assertions、14.83秒 |
| watch benchmark | exit 0、161秒。small / large × A / B の4ケース完了 | 再実行なし |
| watch integration | **14 pass / 0 fail**、6.17秒。write → batch p50 6.4ms / p95 6.9ms、40 samples | 再実行なし |
| sandbox | **exit 0、10 checks 全成功**、8秒、`bwrap` | 再実行なし |
| sandbox: Docker default | 未実行 | `arm64-default/`: install **exit 0、6秒**、sandbox **exit 0**、検出 `none` |
| sandbox: masked /proc | 未実行 | `arm64-masked-proc/`: install **exit 0、6秒**、sandbox **exit 0**、検出 `none` |

初回ハーネス全体と修正後の cold ハーネスはどちらも exit 1 であり、全体成功とは扱わない。Linux の cold `tsc -b` は約57秒を要し、30秒上限は未達のまま。warm check は同じ scratch と TypeScript のビルド情報を再利用した別条件の測定である。warm check と F1 は別コンテナで並行実行した。コーパスは mount していないため corpus ケースは skip。

## 修正した原因

- `tree-sitter-typescript@0.23.2` の `prebuilds/linux-arm64/tree-sitter-typescript.node` は ELF machine=62（x86_64）。arm64 ではロードできず native rebuild に進む。従来の image は同梱 npm の `node-gyp.js` と Node headers を持つが、`node-gyp` が PATH に無く、`make` と `g++` も無かった。`scripts/linux/Dockerfile` にコンパイラと make、同梱ツールへの symlink、`npm_config_nodedir=/opt/node` を追加し、固定 Node の headers を使用した。依存 manifest・lockfile・trustedDependencies は変更していない。
- F1 は直前の macOS 専用 describe が共有 daemon を `sandbox-exec` に置換することと、直前テストが `node_modules` を gitignore することに依存していた。Linux では初回 ready で人の consent を待ち、2ターン assertion に到達しなかった。F1 用の独立 fixture、依存の明示 exclude、trust と初回・修復後それぞれの人の `gates/run` を追加した。初回と修復の両方で secret・依存リンク・外へ出る symlink の保護を確認し、ゲート成功と未変更のユーザー tree を引き続き検証する。core の安全実装は変更していない。Mac 側も scoped F1 は 2 pass / 0 fail、29 assertions。

## 環境と証拠

Ubuntu 24.04.5 LTS、Linux 7.0.14 OrbStack、aarch64、18 CPU、Bun 1.4.2、Node 22.23.3、Go 1.26.8、Git 2.43.0、bubblewrap 0.9.0。seccomp は `unconfined`。初回は loadavg 0.00、修正後 cold は 2.82 / 1.35 / 0.87 から開始した。

元の checkout は HEAD `84fa9c79721b9aabd09b5fe14a42373a1fc14f6d` + 未コミット変更。修正後 scratch の一回限りの snapshot commit は `64939b3186774699f76c2ab4c3e6ac03878f5cf8`、tree は `61f6896192ea0b6b4b6ffc64ffe7acc5f4f7be37`。以降の scoped 再検証はその scratch を使用した。

初回の証拠: [summary](arm64/summary.txt)、[install](arm64/install.log)、[install diagnostics](arm64/install-diag.log)、[check](arm64/check.log)、[unit](arm64/unit.log)、[unit failures](arm64/unit-failures.txt)、[watch](arm64/o3-linux-arm64.json)、[sandbox](arm64/sandbox-unconfined.json)。

修正後の証拠: [summary](arm64-rerun/summary.txt)、[frozen install](arm64-rerun/install.log)、[cold check](arm64-rerun/check.log)、[warm check](arm64-rerun/check-warm.log)、[scoped F1](arm64-rerun/unit-f1.log)。

追加した短い sandbox ケースはそれぞれ実行時の working tree を export し、既存 image の `install,sandbox` のみを実行した。Docker default と seccomp / AppArmor のみ解除して `/proc` の制限を残す masked-proc は、どちらも `bwrap` バイナリがあってもサンドボックス検出を `none` として正常終了した。`checks: []` は検出不能時の期待結果であり、隔離の10項目を通過したという意味ではない。全体 unit / check は追加実行していない。

証拠: [default summary](arm64-default/summary.txt)、[default sandbox](arm64-default/sandbox-default.json)、[masked-proc summary](arm64-masked-proc/summary.txt)、[masked-proc sandbox](arm64-masked-proc/sandbox-masked-proc.json)。

## 実行コマンド

`--out` は Docker bind mount のため絶対パスが必要。

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 \
  --steps install,check,unit,watch,sandbox --seccomp unconfined \
  --out "$PWD/docs/progress/linux-continuation/arm64"

scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,check \
  --seccomp unconfined --keep \
  --out "$PWD/docs/progress/linux-continuation/arm64-rerun"
```

修正後ハーネスの実行中に `/src` の bind source を `docker inspect` で記録し、保持した scratch のみを以下で再使用した（`MITORI_LINUX_SRC` にそのパスを指定）。

```sh
docker run --rm --platform linux/arm64 \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined -e MITORI_LIVE=0 \
  -v "$MITORI_LINUX_SRC:/src" -w /src mitori-linux:arm64 bun run check

docker run --rm --platform linux/arm64 \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined -e MITORI_LIVE=0 \
  -v "$MITORI_LINUX_SRC:/src" -w /src mitori-linux:arm64 \
  bun test test/int/int08.test.ts -t 'F1 \(nonfunc audit\)'
```

追加 sandbox のコマンド:

```sh
scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,sandbox \
  --seccomp default --out "$PWD/docs/progress/linux-continuation/arm64-default"

scripts/nd bash scripts/linux-ci.sh --arch arm64 --steps install,sandbox \
  --seccomp masked-proc --out "$PWD/docs/progress/linux-continuation/arm64-masked-proc"
```

amd64 の compiled binary、Windows はこの継続検証では未実行。
