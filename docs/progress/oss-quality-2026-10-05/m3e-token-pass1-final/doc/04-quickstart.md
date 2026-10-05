# 4. 動かしてみる <!-- b_jtakqc45 -->

**手順（コードから読み取った 0 tok の手順）**
1. 必要なもの: Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`（`package.json:6`）
2. 依存を入れる: `npm install`（`package-lock.json` から判断）
3. 起動する: `npm run dev`（`package.json:9` · 中身は `next dev`）
4. 開く: http://localhost:3000（`README.md:83`）
<!-- b_thr3zhrt -->

**スクリプト**
| 用途 | 名前 | コマンド | 定義 |
|---|---|---|---|
| run | `dev` | `next dev` | `package.json:9` |
| run | `start` | `npx serve out` | `package.json:11` |
| test | `test` | `vitest run` | `package.json:13` |
| build | `build` | `next build` | `package.json:10` |
| typecheck | `typecheck` | `tsc --noEmit -p .` | `package.json:12` |
<!-- b_7a8z6n5j -->

**環境変数**
| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | あり | `app/Editor.tsx:141` `app/layout.tsx:4` `components/AiPanel.tsx:63` `components/IconPicker.tsx:67` `components/ShareMenu.tsx:10` |
| `NEXT_PUBLIC_SITE_ORIGIN` | あり | `app/layout.tsx:7` |
<!-- b_ha8mt6n0 -->

**入口**
| 入口 | 種類 | 場所 |
|---|---|---|
| Next.js（App Router）のトップページ | page | `app/page.tsx` |
<!-- b_xe8cv99m -->
