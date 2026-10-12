# Contributing

短い手順だけ書く。作業規約は [AGENTS.md](AGENTS.md)・[CLAUDE.md](CLAUDE.md) が正本。

## 開発コマンド

すべて `scripts/nd` 経由（[CLAUDE.md の表](CLAUDE.md#開発コマンドすべて-scriptsnd-経由)）。

```sh
scripts/nd bun install --frozen-lockfile
scripts/nd bun run check
scripts/nd bun test
```

## PR の関門

`bun run ci:pr`（= check + test + `fixtures:build --verify` + golden + size）が通ること。
依存を足し引きしたら `bun run notices` で `THIRD_PARTY_NOTICES.md` を作り直す
（`bun scripts/third-party-notices.ts --check` が通ること）。

## fork PR の扱い

外部の fork からの PR のワークフローは承認制である。`browsers` ジョブは保守者の基準 Mac
（self-hosted runner `mitori-reference`）でのみ動き、fork では動かない。

保守者は承認の前に、`.github/`・`scripts/`・`package.json` の scripts の変更を必ず読む。
fork PR は workflow ファイル自体を書き換えられるためである。

`browsers` ジョブの校正が約2倍で止まるときは runner が macOS のバックグラウンド優先度（`ps -o pri=` が `4`）になっていないか疑い、`scripts/nd bun scripts/install-runner-service.ts` で LaunchAgent を登録し直す（`launchctl kickstart -k` では直らない）。
