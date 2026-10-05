# 暗号化共有の公開準備

2026-10-06の利用者確認により、Cloudflare公開は必須タスクから除外した。本体はcloneしてローカルで利用できる。以下は任意のURL共有機能が必要になった場合の手順で、Worker/R2/D1作成・deployはその時点の承認後に行う。現在は未公開。

`apps/share`のWorkerと `mitori share --server ... -o viewer.html` を実装。閲覧文書は既存HTML export、AES-256-GCM、鍵はfragmentのみ。Ed25519署名、暗号化コメント、期限確認、日次削除、D1 transaction内quota。詳細はADR-0016。

検証済み:

- 実workerd/R2/D1: 署名拒否、暗号文だけの保存、改変/AAD拒否、コメントcapability、期限切れ、競合21 uploadの20件制限、quotaの削除返還、月次読み書き上限とリセット、scheduled cleanup。
- Chromium/Firefox/WebKit: 復号、署名済みhashでexport script実行、iframeの親DOMアクセス拒否、コメント文字列のHTML不実行、ブラウザからの暗号化コメント。
- CLI: agent/nonTTY拒否、確認拒否時に非公開、デフォルト抜粋/decisions非公開、署名内容とexport CSP、復号、0600秘密鍵、鍵を含まないpinned viewer。
- `scripts/nd bun test e2e/share/share.int.test.ts apps/cli/src/commands/share.test.ts`: 4成功、43assert。3 browserの実行は `MITORI_BROWSER_SHARE=1 scripts/nd bun test e2e/share/share.int.test.ts`。
- `scripts/nd bunx tsc -b apps/share --pretty false`成功。Wrangler dry-run成功（現時点15.41KiB raw /5.30KiB gzip、未公開）。

対象は既存の主Cloudflareアカウント `5880d85c320ca5fee8baf9efddd005ed`。R2利用可能、同名bucket/D1なしをread-onlyで確認。別サービスのresourceは変更しない。

公開手順（承認後のみ）:

```sh
export CLOUDFLARE_ACCOUNT_ID=5880d85c320ca5fee8baf9efddd005ed
scripts/nd bunx wrangler r2 bucket create mitori-snapshots --location apac
scripts/nd bunx wrangler r2 bucket lifecycle add mitori-snapshots mitori-expire-30d snapshots/ --expire-days 30 --force
scripts/nd bunx wrangler d1 create mitori-meta --location apac
# 返されたUUIDをapps/share/wrangler.jsoncのdatabase_idへ設定し、typesを再生成
scripts/nd bunx wrangler types --config apps/share/wrangler.jsonc apps/share/worker-configuration.d.ts
scripts/nd bunx wrangler d1 migrations apply mitori-meta --remote --config apps/share/wrangler.jsonc
scripts/nd bunx wrangler deploy --config apps/share/wrangler.jsonc
# /healthと公開OSS文書の暗号化upload/復号/commentを実URLで確認
```

保管8GB、install20件/50MB、snapshot5MB/最大30日、全snapshot/comment各100,000件、comment暗号文200MB、R2月put10,000/get1,000,000のアプリ制限。無料枠はアカウント共有。典型的な初期利用（1,000 upload/月、1MB/件、10,000閲覧/月）は枠内なら追加0。無料枠を他サービスが使い切った場合は従量課金。R2の料金単位切り上げもあるため、無料とは断定しない。新規Paid化はしない。

容量/操作制限はaccount全体の請求hard capではない。公開後にこのserviceのstorage/operations/Worker analyticsを記録し、月1,000円以上の増加見込みがある変更やPaid化はAGENTSに従って再承認。削除は `wrangler delete --config apps/share/wrangler.jsonc`、bucket/D1削除は内容確認後に行う。

出典と確認日2026-10-05: [R2 pricing](https://developers.cloudflare.com/r2/pricing/)、[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)、[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)。
