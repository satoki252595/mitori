# 1. これは何か・誰のためか・なぜあるか <!-- b_ytrv8nf6 -->

## 解決する課題 <!-- b_fw1tc6xx -->

作りたいアプリの画面を AI コーディングツールに頼むとき、配置や部品を文章だけで正確に伝えるのは難しい。このツールでは画面を Material 3 Expressive の部品で描き、その設計をプロンプトとしてコピーする。プロンプトはどのツールにも貼り付けて使える（[README.md:8](../../README.md#L8)、[README.md:35](../../README.md#L35)）。プロンプトの文面は Material 3 Expressive の語彙に合わせて調整されている（[CONTRIBUTING.md:11-12](../../CONTRIBUTING.md#L11-L12)）。 <!-- b_csrmky3j -->

## 利用者 <!-- b_95qbs59y -->

- Claude Code、Codex、Gemini CLI、Cursor などのプロンプト入力型ツールでアプリを作る開発者が、画面を下書きし、生成されたプロンプトをツールに渡すために使う（[README.md:35](../../README.md#L35)）。
- AI エージェントも利用者になる。エージェントは設計を 1 つの JSON 文書として書き、共有リンクにして渡す。受け取った人はそれをキャンバスで開いて仕上げる（[agent.md:3](../../public/agent.md#L3)、[agent.md:9](../../public/agent.md#L9)）。
- 5 分で試すには、`npm install` のあと `npm run dev` を実行し、http://localhost:3000 を開く。左のパレットから部品をキャンバスへドラッグして画面を作り、プロンプトをコピーすればよい（[CONTRIBUTING.md:17-19](../../CONTRIBUTING.md#L17-L19)）。公開デモをそのまま開いてもよい（[README.md:12](../../README.md#L12)）。 <!-- b_1jyzx91m -->

## 範囲 <!-- b_vk0ps0q0 -->

- ボタン、チップ、アプリバー、ナビゲーションバー、ダイアログ、テキストフィールドなど多数の部品を Material 3 Expressive の見た目で描画し、ドラッグ＆ドロップで配置できる（[README.md:39](../../README.md#L39)）。
- 近づけたボタンやリスト項目は 1 つのグループに結合し、接した角が丸く変わる（[README.md:40](../../README.md#L40)）。
- `buildPrompt` は文書（`Doc`）を AI 向けのプロンプトに変換する（[prompt.ts:1745-1761](../../lib/prompt.ts#L1745-L1761)）。
- 文書はプロジェクトファイルとして保存・読み込みでき、URL の共有リンクにもできる（[project.ts:81-98](../../lib/project.ts#L81-L98)、[share.ts:46-53](../../lib/share.ts#L46-L53)）。
- サーバーやアカウントの機能は持たない。描いた内容はブラウザの外へ送られない（[SECURITY.md:3-4](../../SECURITY.md#L3-L4)）。 <!-- b_p0zjsg26 -->

## 制約 <!-- b_qnwezfs4 -->

- 静的サイトとして動作し、`next build` の出力を `npx serve out` で配信する（[package.json:10-11](../../package.json#L10-L11)）。
- Next.js は破壊的変更を含むバージョンであり、コードを書く前に `node_modules/next/dist/docs/` のガイドを読むよう求められている（[AGENTS.md:3-5](../../AGENTS.md#L3-L5)）。
- 外部への通信はフォントの読み込みと任意の AI ヘルパーだけである。AI ヘルパーは利用者自身の API キーで OpenAI、Anthropic、Google、DeepSeek のいずれかを直接呼ぶ。キーは localStorage の `m3e:ai` に置かれる（[SECURITY.md:4-9](../../SECURITY.md#L4-L9)）。
- UI 文言とプロンプト文は日本語、英語、中国語、韓国語の 4 言語でそろえる決まりである（[PULL\_REQUEST\_TEMPLATE.md:12](../../.github/PULL_REQUEST_TEMPLATE.md#L12)、[i18n.ts:5-6](../../lib/i18n.ts#L5-L6)）。 <!-- b_q4hpe223 -->
