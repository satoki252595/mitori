# 4. 動かしてみる <!-- b_xn276g9g -->

**スクリプト**
| 用途 | 名前 | コマンド | 定義 |
|---|---|---|---|
| run | `dev` | `dev` | `package.json:12` |
| test | `test` | `test` | `package.json:14` |
| build | `build` | `build` | `package.json:13` |
| lint | `lint` | `lint` | `package.json:16` |
| format | `format` | `format` | `package.json:17` |
| typecheck | `typecheck` | `typecheck` | `package.json:15` |
<!-- b_59zqtq6w -->

**環境変数**
| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `DATABASE_URL` | なし | `src/config.ts:24` |
| `LOG_LEVEL` | あり | `src/config.ts:21` |
| `PORT` | あり | `src/config.ts:23` |
| `TSUNDOKU_API_TOKEN` | なし | `src/config.ts:26` |
| `TSUNDOKU_DEBUG_SQL` | なし | `.env.example:6` |
<!-- b_7jpkd0se -->

**入口**
| 入口 | 種類 | 場所 |
|---|---|---|
| tsundoku | bin | `bin/tsundoku.js:1` |
| src/index.ts | main | `src/index.ts:1` |
<!-- b_0h895x4x -->
