# 1. これは何か・誰のためか・なぜあるか <!-- b_fttnqkrq -->

## 解決する課題 <!-- b_8btrn15x -->

作りたいアプリの画面構成を、AI コーディングツールに正確に伝えるのは手間がかかる。M3E Canvas では、利用者が画面をスケッチしてプロンプトをコピーし、Claude Code、Codex、Gemini CLI、Cursor などのツールに貼り付けてアプリを作らせる（[README.md:33-35](../../README.md#L33-L35)）。 <!-- b_e1nfbs58 -->

## 利用者 <!-- b_f38psnch -->

- Material 3 Expressive の画面を素早く組み立てたい人は、ボタンやカードなどのパーツをドラッグ＆ドロップで配置する（[README.md:39](../../README.md#L39)）。
- AI コーディングツールでアプリを作る人は、スケッチから得たプロンプトをツールに渡す（[README.md:35](../../README.md#L35)）。
- AI エージェントは、デザインを 1 つの JSON 文書として書いて人に返し、人はそれをキャンバスで開いて仕上げる（[agent.md:3](../../public/agent.md#L3)）。
- コントリビューターは、小さな修正なら直接 pull request を送り、新しいパーツやプロンプト文言の変更では先に issue を立てる（[CONTRIBUTING.md:8-12](../../CONTRIBUTING.md#L8-L12)）。 <!-- b_vhhqsnkc -->

## 範囲 <!-- b_xqnqypmb -->

- ボタン、FAB、チップ、アプリバー、ナビゲーションバー、カード、リスト、ダイアログ、テキストフィールド、スライダーなど多数のパーツを Material 3 Expressive の形で描く（[README.md:39](../../README.md#L39)）。
- 近づけたボタンやリスト項目は、角が丸く溶け合う 1 つのグループにまとまる（[README.md:40](../../README.md#L40)）。
- 文書からプロンプト文を組み立てる処理は `lib/prompt.ts` が持つ（[prompt.ts:1745](../../lib/prompt.ts#L1745)）。
- AI エージェントからは共有リンクか JSON 文書で設計を受け取り、**Open project** で開ける（[agent.md:9](../../public/agent.md#L9)）。
- 任意の AI ヘルパーは、利用者自身の API キーで、選んだプロバイダ（OpenAI、Anthropic、Google、DeepSeek）に設計の説明を送る（[SECURITY.md:4-8](../../SECURITY.md#L4-L8)）。
- サーバーとアカウントは持たない（[SECURITY.md:3](../../SECURITY.md#L3)）。 <!-- b_32y9ka3t -->

## 制約 <!-- b_y1vqskjc -->

- 静的サイトとして動き、描いた内容はブラウザの local storage にだけ残る（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)）。
- 外部への通信はフォントの読み込みと、有効にした場合の AI ヘルパーだけである（[SECURITY.md:4-5](../../SECURITY.md#L4-L5)）。
- AI の API キーは local storage の `m3e:ai` に置かれ、プロンプト、書き出し画像、保存文書には含まれない（[SECURITY.md:8-9](../../SECURITY.md#L8-L9)）。
- 使っている Next.js は既存の知識と API や規約が異なる版であり、`node_modules/next/dist/docs/` の案内を読むよう求めている（[AGENTS.md:5](../../AGENTS.md#L5)）。
- 変更は `npm run typecheck`、`npm test`、`npm run build` が通ることと、UI とプロンプトの文言が日本語・英語・中国語・韓国語の 4 言語でそろうことを確認する（[PULL\_REQUEST\_TEMPLATE.md:9-12](../../.github/PULL_REQUEST_TEMPLATE.md#L9-L12)）。 <!-- b_bdgy8b2s -->
