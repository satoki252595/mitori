# 2. 見取り図 <!-- b_r6an5jvk -->

フロアプランの入口は `cmd/crit` の CLI 本体である。ここではサブコマンドを振り分け、実処理は `internal` 側のパッケージに任せる（[cli\_dispatch.go:3-15](../../cmd/crit/cli_dispatch.go#L3-L15)、[cli\_handlers.go:15-30](../../cmd/crit/cli_handlers.go#L15-L30)）。中核グループ `internal` の中で、`internal/server` がレビュー UI 向けの API と埋め込み静的資産を配信する（[server.go:127-228](../../internal/server/server.go#L127-L228)）。サーバーが公開する状態は `internal/session` の `Session` が保持し、変更ファイルや diff は `internal/vcs` の `VCS` インターフェース越しに取得する（[session.go:416-431](../../internal/session/session.go#L416-L431)、[vcs.go:14-137](../../internal/vcs/vcs.go#L14-L137)）。ブラウザ側のグループ `web` は画面本体、live mode、iframe 注入スクリプトからなり、その資産は `webassets.FS` としてサーバーに渡る。forge 同期は別のノードとして GitHub・GitLab とコメントをやり取りする（[embed.go:1-6](../../web/embed.go#L1-L6)、[forge.go:126-136](../../internal/forge/forge.go#L126-L136)）。 <!-- b_p3cmqmrd -->

```mermaid
flowchart LR
  md_542cnad9["web (crit*)"]
  md_45844dgv["web (live-mode*)"]
  md_81hf7jm0["web/app.js"]
  md_e1v0hgx2["scripts"]
  md_7z89xx50["web (style-live, crit-agent)"]
  md_hd12merg["internal/vcs"]
  md_ecsfkz72["internal/session (session, watch)"]
  md_mr6t12q3["internal/session (plan_cli, plans)"]
  md_em5fyh7k["internal/server"]
  md_y2y67yyw["internal/share · config · live"]
  md_8zxhv5eg["cmd/crit"]
  md_adekddkx["internal/github · gitlab"]
  md_yp81jwbp["internal/comment"]
  md_jeb8n6j5["web/style.css"]
  subgraph g_md_gvw2kgjt ["web"]
    md_542cnad9
    md_45844dgv
    md_81hf7jm0
    md_7z89xx50
    md_jeb8n6j5
  end
  subgraph g_md_b6twrg7f ["internal"]
    md_hd12merg
    md_ecsfkz72
    md_mr6t12q3
    md_em5fyh7k
    md_y2y67yyw
    md_adekddkx
    md_yp81jwbp
  end
  md_adekddkx --> md_mr6t12q3
  md_em5fyh7k --> md_y2y67yyw
  md_mr6t12q3 --> md_ecsfkz72
  md_8zxhv5eg --> md_mr6t12q3
  md_yp81jwbp --> md_ecsfkz72
  md_yp81jwbp --> md_mr6t12q3
  md_8zxhv5eg --> md_adekddkx
  md_8zxhv5eg --> md_em5fyh7k
  md_y2y67yyw --> md_mr6t12q3
  md_adekddkx --> md_ecsfkz72
  md_ecsfkz72 --> md_hd12merg
  md_em5fyh7k --> md_ecsfkz72
  md_mr6t12q3 --> md_y2y67yyw
  md_8zxhv5eg --> md_y2y67yyw
  md_em5fyh7k --> md_hd12merg
  md_ecsfkz72 --> md_mr6t12q3
  md_y2y67yyw --> md_ecsfkz72
  md_adekddkx --> md_y2y67yyw
  md_8zxhv5eg --> md_ecsfkz72
  md_8zxhv5eg --> md_hd12merg
  md_81hf7jm0 --> md_542cnad9
  md_adekddkx --> md_yp81jwbp
  md_em5fyh7k --> md_mr6t12q3
  md_8zxhv5eg --> md_yp81jwbp
  md_adekddkx --> md_hd12merg
  md_mr6t12q3 --> md_hd12merg
  md_45844dgv --> md_542cnad9
  md_y2y67yyw --> md_adekddkx
  md_y2y67yyw --> md_em5fyh7k
  md_y2y67yyw --> md_hd12merg
  md_y2y67yyw --> md_yp81jwbp
  md_81hf7jm0 --> md_45844dgv
  md_ecsfkz72 --> md_y2y67yyw
  md_em5fyh7k --> md_adekddkx
  md_hd12merg --> md_ecsfkz72
  md_mr6t12q3 --> md_adekddkx
  md_yp81jwbp --> md_adekddkx
  md_yp81jwbp --> md_hd12merg
  md_yp81jwbp --> md_y2y67yyw
  md_em5fyh7k --> md_yp81jwbp
  md_542cnad9 --> md_81hf7jm0
  md_45844dgv --> md_81hf7jm0
```
<!-- b_a4bjr3h7 -->
