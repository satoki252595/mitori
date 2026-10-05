# 8. 外部インターフェース <!-- b_dyempk50 -->

| メソッド | パス | ハンドラ | 定義 |
|---|---|---|---|
| GET | `/` | `app/page.tsx#Page` | `app/page.tsx:37` |
<!-- b_hqns6fyj -->

- （検出されませんでした）
<!-- b_pxk28spb -->

**外とのやり取り（HTTP・RPC・SDK・DB・子プロセス・書き込み）**
| 種類 | 相手 | 経由 | 場所 |
|---|---|---|---|
| HTTP | — | `fetch` | `app/Editor.tsx:2613` `components/IconPicker.tsx:67` `lib/ai.ts:85` ほか 1 件 |
<!-- b_e0m2mrex -->

| 名前 | 既定値 | 読む場所 |
|---|---|---|
| `NEXT_PUBLIC_BASE_PATH` | あり | `app/Editor.tsx:141` `app/layout.tsx:4` `components/AiPanel.tsx:63` `components/IconPicker.tsx:67` `components/ShareMenu.tsx:10` |
| `NEXT_PUBLIC_SITE_ORIGIN` | あり | `app/layout.tsx:7` |
<!-- b_p1377ye2 -->
