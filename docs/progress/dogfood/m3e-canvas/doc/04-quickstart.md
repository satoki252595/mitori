# 4. 動かしてみる <!-- b_v24m1bgy -->

| 用途 | 名前 | コマンド | 定義 | 状態 |
|---|---|---|---|---|
| run | `dev` | `next dev` | `package.json:9` | 未実行 |
| run | `start` | `npx serve out` | `package.json:11` | 未実行 |
| test | `test` | `vitest run` | `package.json:13` | 未実行 |
| build | `build` | `next build` | `package.json:10` | 未実行 |
| typecheck | `typecheck` | `tsc --noEmit -p .` | `package.json:12` | 未実行 |
<!-- b_12mjrsxc -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | あり | `app/Editor.tsx:140` `app/layout.tsx:4` `components/AiPanel.tsx:63` `components/IconPicker.tsx:67` `components/ShareMenu.tsx:10` |
| `NEXT_PUBLIC_SITE_ORIGIN` | あり | `app/layout.tsx:7` |
<!-- b_fyf76n29 -->

| 入口 | 種類 | 場所 | 状態 |
|---|---|---|---|
| start | script | `package.json:11` | 未実行 |
<!-- b_765pfmmr -->
