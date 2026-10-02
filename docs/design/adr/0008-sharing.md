# ADR-0008: 共有 — MVP は自己完結 HTML、次に E2E 暗号化 snapshot（Cloudflare Free 枠）

- 状態: 採用（2026-10-03。Cloudflare 部分は設計のみ、実装は最後・任意） / 関連: D11、05 §9、補遺 B

## Context
同僚や非エンジニアに設計書を見せたい。commit すれば GitHub で読めるが、commit しないチームや社外共有もある。月 1,000 円を超える継続コストは事前承認、ホストした平文 wiki は誤情報の拡散と漏洩のリスクがある。

## Decision
- **MVP（P3 の先行項目）**: `mitori export --html` で **自己完結 1 ファイル**（viewer ビルドの JS/CSS と設計書 JSON を inline、外部通信なし）。secret scan 必須、件数を表示。
- **v1（任意・最後）**: E2E 暗号化 snapshot。鍵は URL fragment（サーバに届かない）。リソースは `mitori-share`（Worker + Static Assets）、`mitori-snapshots`（R2、暗号文のみ）、`mitori-meta`（D1、id・期限・閲覧数などメタのみ）。Free 枠（Workers 100k req/日、R2 10GB、D1 5M read/日）に収め、超過時は課金ではなくエラーで止まる設定を使う。Paid（$5/月）化・Durable Objects（`mitori-room`）の導入は事前承認。
- Cloudflare では agent を動かさない（credential の中継になる）。共有ビューは閲覧とコメントのみ。

## Consequences
- export は viewer 専用ビルド（API なし、読み取り専用）を `apps/web` から作る。初期 JS 予算は通常ビルドと同じ。
- snapshot 形式 `mitori.snapshot/1`（暗号化方式・鍵導出・コメントの暗号化）は着手時に追加 ADR で確定する。

## Alternatives
- Phoenix + Postgres + Fly（crit-web）: 常時コスト。
- 平文ホスト + Access 認証: 漏洩時の影響が大きい。費用試算と承認の後に再検討。
