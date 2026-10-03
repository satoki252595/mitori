# エディタ本体と共有 <!-- b_q9mv09q4 -->

- ファイル 13 · 5875 行 · 重要度 0.33
<!-- b_ev9gy6e9 -->

> [!NOTE]
> **この章で分かること**
> - エディタ本体と起動ページがどう組み合わされるか
> - 文書の保存・読み込み・共有リンクの仕組み
> - 周辺のUI部品の役割 <!-- b_ewdh3p0t -->

## 責務 <!-- b_tnhkz6k8 -->

このモジュールはアプリの入口である。`app/page.tsx` が静的な起動画面を出し、`Editor` を動的に読み込む（[page.tsx:8-17](../../../app/page.tsx#L8-L17)）。文書のファイル入出力と URL 共有は `lib/project.ts` と `lib/share.ts` が担う（[project.ts:81-98](../../../lib/project.ts#L81-L98)、[share.ts:46-53](../../../lib/share.ts#L46-L53)）。M3 部品の描画やテーマ計算は他モジュールに任せている。 <!-- b_d4mfkacz -->

## 公開インターフェース <!-- b_z7xc21m5 -->

- `Editor`: キャンバス編集画面の本体（[Editor.tsx:453](../../../app/Editor.tsx#L453)）。
- `saveProject` / `readProject`: JSON のダウンロードと読み戻し（[project.ts:81](../../../lib/project.ts#L81)、[project.ts:91](../../../lib/project.ts#L91)）。
- `isProject`: 解析済み値が開ける文書かを判定する（[project.ts:67](../../../lib/project.ts#L67)）。
- `shareLink` / `readShareHash` / `hasShareHash`: 共有リンクの生成と復元（[share.ts:46](../../../lib/share.ts#L46)、[share.ts:56](../../../lib/share.ts#L56)、[share.ts:76](../../../lib/share.ts#L76)）。
- `Toolbar`、`PartsPalette`、`Popover`、`ShareDialog`: 周辺UI（[Toolbar.tsx:62](../../../components/Toolbar.tsx#L62)、[Menus.tsx:13](../../../components/Menus.tsx#L13)、[ShareMenu.tsx:54](../../../components/ShareMenu.tsx#L54)）。 <!-- b_x678kkwk -->

## 処理の流れ <!-- b_dahjejv8 -->

1. `shareLink` が `shareable` で画像と履歴を除いた文書を JSON にする（[share.ts:12-21](../../../lib/share.ts#L12-L21)、[share.ts:46-47](../../../lib/share.ts#L46-L47)）。
2. `CompressionStream` があれば deflate-raw で圧縮し `docz` として、なければ `doc` として URL ハッシュに載せる（[share.ts:48-52](../../../lib/share.ts#L48-L52)）。
3. `readShareHash` は逆の順で復元し、`isProject` を通った場合だけ文書を返す（[share.ts:56-69](../../../lib/share.ts#L56-L69)）。 <!-- b_7fxwmw7j -->

## 設定 <!-- b_4vqd01f8 -->

- `NEXT_PUBLIC_BASE_PATH` は `Editor` が読む（[Editor.tsx:140](../../../app/Editor.tsx#L140)）。
- `NEXT_PUBLIC_SITE_ORIGIN` は `layout.tsx` が読む（[layout.tsx:7](../../../app/layout.tsx#L7)）。 <!-- b_s9rf11dz -->

## テスト <!-- b_ztveqvby -->

`isProject` は現行文書と旧式の最小文書を受け入れ、全項目を検査する（[project.test.ts:18](../../../lib/project.test.ts#L18)、[project.test.ts:25](../../../lib/project.test.ts#L25)、[project.test.ts:68](../../../lib/project.test.ts#L68)）。共有側は履歴とローカル画像の除去、および URL パラメータ名の安定性を確かめる（[share.test.ts:20](../../../lib/share.test.ts#L20)、[share.test.ts:91](../../../lib/share.test.ts#L91)）。 <!-- b_s67zaz9q -->

## エラー処理 <!-- b_qs109jc4 -->

`readProject` と `readShareHash` は解析失敗や形式不正を例外にせず `null` を返す（[project.ts:91-98](../../../lib/project.ts#L91-L98)、[share.ts:56-73](../../../lib/share.ts#L56-L73)）。 <!-- b_6nn26ay5 -->

> [!TIP]
> **まとめ**
> このモジュールは `Editor` を起動し、文書の保存と共有リンクを扱う。 <!-- b_skdn8x6r -->
