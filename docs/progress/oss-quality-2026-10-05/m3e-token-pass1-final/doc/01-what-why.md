# 1. これは何か・誰のためか・なぜあるか <!-- b_7emsv06s -->

## 解決する課題 <!-- b_4k4dmp8m -->

アプリ案を AI コーディングツールに渡すには画面と振る舞いを言葉で説明する必要があるが、文章だけでは見た目や遷移の意図が伝わりにくい（[README.md:35](../../README.md#L35)、[README.md:8](../../README.md#L8)）。画面をつないでタップ操作を試すことで、遷移の意図をプロンプトに含められる（[README.md:8](../../README.md#L8)）。 <!-- b_nnwb3bnm -->

## 利用者 <!-- b_xxyesaez -->

- アプリ発案者が画面モックを描き、AI コーディングツールに渡すプロンプトを得る（[README.md:8](../../README.md#L8)、[README.md:35](../../README.md#L35)）。
- デザイナーや開発者が Material 3 Expressive の部品を並べて見た目や遷移を確認する（[README.md:39-40](../../README.md#L39-L40)）。
- 5 分で試すには `npm install` の後に `npm run dev` を実行し、ブラウザで http://localhost:3000 を開いて部品を置く（[CONTRIBUTING.md:18-19](../../CONTRIBUTING.md#L18-L19)、[README.md:39](../../README.md#L39)）。 <!-- b_2mfz7mvs -->

## 範囲 <!-- b_a48d83hn -->

- Material 3 Expressive の部品をドラッグアンドドロップで置き、近づけると結合する（[README.md:39-40](../../README.md#L39-L40)）。
- 画面をつないでタップ操作を試し、AI コーディングツール向けのプロンプトをコピーする（[README.md:8](../../README.md#L8)、[README.md:35](../../README.md#L35)）。
- サーバーやアカウントを持たず、描画内容をブラウザに保つ（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)）。
- アプリのコード自体は作らず、AI への送信は利用者がキーを入れた場合の任意操作に限る（[README.md:35](../../README.md#L35)、[SECURITY.md:5-9](../../SECURITY.md#L5-L9)）。 <!-- b_541nk9kq -->

## 制約 <!-- b_v627m3nd -->

- ブラウザで動く静的サイトで、公開経路 / を持つ（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)、[page.tsx:37](../../app/page.tsx#L37)）。
- 開発時は `npm run dev` で起動し、ビルドは `next build` で行う（[CONTRIBUTING.md:19](../../CONTRIBUTING.md#L19)、[package.json:10](../../package.json#L10)）。
- 外部通信はフォントの読み込みと、利用者がキーを入れた場合の AI プロバイダーへの直接送信に限る（[SECURITY.md:4-8](../../SECURITY.md#L4-L8)）。
- API キーはブラウザの local storage に置く `m3e:ai` 項目に保ち、プロンプトや保存データに含めない（[SECURITY.md:8-9](../../SECURITY.md#L8-L9)）。 <!-- b_8mpk3wx5 -->
