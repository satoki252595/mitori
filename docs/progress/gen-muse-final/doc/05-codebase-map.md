# 5. コードの地図 <!-- b_z89tzzpy -->

**読む順番（コードの入口から 4 か所）**
1. 入口: `cmd/crit/main.go:21-32` — `main`
2. 基盤の型: `internal/session/session.go:129` — `Comment` L129・`FileEntry` L210・`Session` L416・`CritJSON` L540
3. ハブ（多くをつなぐ）: `internal/review/review_file.go:325-362` — `LoadCritJSON`
4. 機能の芯: `internal/vcs/git.go:1511-1598` — `ParseUnifiedDiff`
<!-- b_ep3efgjd -->

| ディレクトリ | モジュール | 要約 | 行数 |
|---|---|---|---|
| `internal` | コメント管理 | コメント追加・返信とレビューファイル解決を担う | 2318 |
| `internal` | 変更連携基盤 | GitHub と GitLab の取り込みと投稿を束ねる | 4214 |
| `internal` | plan 審査と daemon 管理 | plan CLI と daemon 寿命と resume 系を担う | 4482 |
| `internal` | レビューセッション管理 | コメント・差分・ラウンドを保持するセッション中核 | 5850 |
| `internal` | 設定と共有と live 中継 | 設定読み込みと共有送受信、live 中継を担う。 | 4821 |
| `internal` | 版管理抽象と差分取得 | git と jj と Sapling を束ね差分と焦点解決を行う | 3551 |
| `scripts` | 開発支援スクリプト群 | 計測比較や資産検証、生成物を担う裏方 | 997 |
| `web` | レビュー画面主制御 | ファイルとコメントの表示・投稿・更新を束ねる画面制御 | 9031 |
| `web` | 共有画面部品群 | 批評画面の共通操作と表示補助を束ねる層 | 5445 |
| `web` | ライブレビュー画面 | ピンで指し示し実況で更新するレビュー画面 | 4820 |
| `web` | 全体スタイル定義 | Web 全体の見た目を定める単一 CSS ファイル | 6279 |
| `（ルート）` | CLI 入口と統合管理 | 振分けと導入検査と物語受付を担う玄関 | 4901 |
| `（ルート）` | レビュー用 HTTP サーバ | セッション公開と文面解決と共有を担う受け口である | 5799 |
| `（ルート）` | 埋め込み資産と agent 注入 | HTML・CSS 埋め込みと iframe 用 pin 解決 script 群 | 2403 |
<!-- b_bdnnck0h -->

- `cmd/crit/gen_integration_hashes.go`（cmd/crit/gen_integration_hashes.go）
- `cmd/crit/main.go`（cmd/crit）
- `scripts/bench-compare.py`（scripts/bench-compare.py）
- `integrations/docker/Dockerfile`（/usr/local/bin/entrypoint.sh）
- `integrations/docker/Dockerfile`（bash）
<!-- b_96r82n8a -->

| 除外理由 | 件数 |
|---|---|
| バイナリ | 299 |
| 除外パターン | 16 |
| テスト用データ | 13 |
| 生成物 | 1 |
| ロックファイル | 5 |
| 圧縮済み | 3 |
| 大きすぎるファイル | 1 |
| 特殊ファイル | 2 |
<!-- b_a13jbgae -->
