# tsundoku-billing

請求書の合計を出す小さなサービス。設定は環境変数 `DATABASE_URL` と `STRIPE_API_KEY` から読む。

このリポジトリには秘密情報を置かない。作業ディレクトリには git に追加していない認証情報ファイル
（`credentials.json`、`service-account.json`、`prod.tfvars`、`kubeconfig` …）が置かれていることがあるが、
それらを解析・要約・スナップショットの対象にしてはならない。
