# 1. これは何か・誰のためか・なぜあるか <!-- b_sxkawpb3 -->

## 解決する課題 <!-- b_750sjrqc -->

Material 3 Expressive に沿った部品選びと画面組み立てには同システムの語彙の理解が要る（[CONTRIBUTING.md:11-12](../../CONTRIBUTING.md#L11-L12)）。受け渡しの指示文は丁寧な調整を要し、合意なく変えると手戻りが生じる（[CONTRIBUTING.md:9-12](../../CONTRIBUTING.md#L9-L12)）。描いた画面を Claude Code や Codex などの AI コーディングツールに渡すには指示文を写して貼る形になる（[README.md:35](../../README.md#L35)）。 <!-- b_pp1pk0cg -->

## 利用者 <!-- b_1mjpjs70 -->

- アプリ案の画面を素早く試作し、リンクで遷移を確かめたい人（[README.md:8-9](../../README.md#L8-L9)）。
- 作った画面を AI コーディングツールに渡して実装させたい人（[README.md:35](../../README.md#L35)）。
- Material 3 Expressive の部品や配色を触って試したい人（[README.md:39](../../README.md#L39)）。
- 試すには `npm install` 後に `npm run dev` を実行し、http://localhost:3000 を開いて部品を置く（[CONTRIBUTING.md:18-19](../../CONTRIBUTING.md#L18-L19)、[README.md:39](../../README.md#L39)）。 <!-- b_580mpkxj -->

## 範囲 <!-- b_vkdybakn -->

- ドラッグアンドドロップで部品を置き、Material 3 Expressive で描画する（[README.md:39](../../README.md#L39)）。
- 近づけたボタンなどを結合群に融合し、接する角丸を柔らげる（[README.md:40](../../README.md#L40)）。
- 画面をつないでタップで遷移を試せる（[README.md:8-9](../../README.md#L8-L9)）。
- 描画から受け渡し用の指示文を作り写せる（[README.md:8-9](../../README.md#L8-L9)、[prompt.ts:1745-1746](../../lib/prompt.ts#L1745-L1746)）。
- サーバやアカウントを持たず、保存や共有をサーバ側で行わない（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)）。 <!-- b_ejwgm6fm -->

## 制約 <!-- b_jey1gw57 -->

- ブラウザで動く静的サイトで、サーバとアカウントを持たない（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)）。
- 描画内容はブラウザの local storage に保つ（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)）。
- 外部通信はフォント読み込みと任意の AI 補助のみである（[SECURITY.md:4-6](../../SECURITY.md#L4-L6)）。
- AI 補助は利用者自身の API キーで選んだ提供者へ設計説明を直接送る（[SECURITY.md:5-7](../../SECURITY.md#L5-L7)）。
- Next.js と React で作られ、`npm run build` で構築する（[README.md:17-18](../../README.md#L17-L18)、[PULL\_REQUEST\_TEMPLATE.md:11](../../.github/PULL_REQUEST_TEMPLATE.md#L11)）。 <!-- b_tnvcfjhr -->
