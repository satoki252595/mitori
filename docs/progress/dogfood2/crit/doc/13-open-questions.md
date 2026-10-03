# 13. 未解決の問い <!-- b_fgkcwta0 -->

- 環境変数 `CRIT_AUTH_TOKEN` は共有サービスへの認証用か、ローカル HTTP サーバーへのアクセス制御用か。Docker 向けの説明では「ローカルサーバーに認証はない」とされており、両者の関係はどうなっているか。 `internal/auth/auth.go:368-368` `integrations/docker/README.md:9-9` <!-- b_hytgfy0k -->

- 環境変数 `CRIT_HOST` を設定するとサーバーの bind 先は `127.0.0.1` 以外に変わるのか。変わる場合、ループバック限定という前提とどう両立させる意図なのか。 `internal/config/cli_resolve.go:64-64` `integrations/docker/README.md:9-9` <!-- b_k8fn7we7 -->

- `checkInstalledIntegrations` と `detectInstalledIntegrations` が同じ走査を別実装にしているのは意図した設計か。 <!-- b_6jm9x2hm -->

- Sapling と jj は git と並ぶ正式サポート対象という方針か。 <!-- b_mba8vy19 -->

- `CRIT_DEBUG` は具体的に何を有効にするのか。 `internal/session/session.go:2510-2510` <!-- b_be6nwj4q -->

- /live と /preview を withReady で包まないのは、ページ読み込みがセッション確立より先に起きるためという理解でよいか。 `internal/server/server.go:140-148` <!-- b_d4a7yac4 -->

- internal/session の atomic_write.go と daemon 側の config.AtomicWriteFile が併存するのはなぜか。 <!-- b_2aq05kyc -->

- GitHub 側が `Provider` を介さず `gh` 用 CLI 実装を直接持ち、GitLab 側が `Provider` に集約しているのは移行途中だからか。 <!-- b_9eah5cw8 -->

- `ASSETS-PROVENANCE.txt` の更新と検証は record-vendored-assets.mjs と verify-vendored-assets.mjs をどの順で実行する運用で、`copy-deps.js` の検証との対応はどの段階で強制されるのか。 <!-- b_251rscjy -->

- live-mode*.js を server.go で個別ルート登録している理由は何か。 `internal/server/server.go:156-168` <!-- b_4nh8dt4a -->

- `prMetadataCache` の上限 64 件や `DaemonHasBrowser` の `browserClient` のタイムアウト値は、どのような根拠で決めたのか。 <!-- b_tkfm4v01 -->

- web 配下の `embed.FS` による単一バイナリ埋め込みと、markdown-it や mermaid などのベンダリングを選んだ理由は何か。 <!-- b_7yf2dsw7 -->

- app.js を 9000 行超の単一ファイルに保つ理由と、`crit-*` へ分割する基準は何か。また app.js、共通部品、live mode 間の相互 import に読み込み順や循環の扱いの決まりはあるか。 <!-- b_6p58wznr -->

- web/style.css と style-live.css、theme.css などの CSS の役割分担はどう決めているか。また style.css はどこから読み込まれ、ビルド時に加工されるのか。 <!-- b_32s33r6h -->

- internal 配下の子モジュール間に相互 import があるが、依存の向きに方針はあるか。特に `internal/comment` と `internal/review` の分割意図は何か。 <!-- b_araqqm9j -->
