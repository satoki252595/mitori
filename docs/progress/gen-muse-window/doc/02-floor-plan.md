# 2. 間取り図 <!-- b_z37q7swr -->

Floor plan は import の重みで結ばれた module 群を示し、中心に `Session` と `Server` と共有設定系を置く内部基盤がある（[session.go:416-430](../../internal/session/session.go#L416-L430)、[server.go:127-136](../../internal/server/server.go#L127-L136)、[config.go:462](../../internal/config/config.go#L462)）。入口の `dispatchCLI` から plan 系と `Session` を経て `VCS` 差分取得へ至り、forge 連携と `RunComment` 系が周辺を支える（[cli\_dispatch.go:216](../../cmd/crit/cli_dispatch.go#L216)、[session.go:456-460](../../internal/session/session.go#L456-L460)、[vcs.go:14-16](../../internal/vcs/vcs.go#L14-L16)、[run.go:19](../../internal/comment/run.go#L19)）。browser 側は `fetchJSON` 系の共有部品と live 系と主制御が分担し、開発支援 script 群は実行時から外れて置かれる（[crit-shared.js:23-32](../../web/crit-shared.js#L23-L32)、[live-mode.js:153](../../web/live-mode.js#L153)、[app.js:851](../../web/app.js#L851)、[bench-compare.py:41-52](../../scripts/bench-compare.py#L41-L52)）。 <!-- b_qhmcck66 -->

```mermaid
flowchart LR
  md_542cnad9["共有画面部品群"]
  md_45844dgv["ライブレビュー画面"]
  md_81hf7jm0["レビュー画面主制御"]
  md_e1v0hgx2["開発支援スクリプト群"]
  md_7z89xx50["埋め込み資産と agent 注入"]
  md_hd12merg["版管理抽象と差分取得"]
  md_ecsfkz72["レビューセッション管理"]
  md_mr6t12q3["plan 審査と daemon 管理"]
  md_em5fyh7k["レビュー用 HTTP サーバ"]
  md_y2y67yyw["設定と共有と live 中継"]
  md_8zxhv5eg["CLI 入口と統合管理"]
  md_adekddkx["変更連携基盤"]
  md_yp81jwbp["コメント管理"]
  md_jeb8n6j5["全体スタイル定義"]
  subgraph g_md_gvw2kgjt ["ブラウザ批評画面群"]
    md_542cnad9
    md_45844dgv
    md_81hf7jm0
    md_7z89xx50
    md_jeb8n6j5
  end
  subgraph g_md_b6twrg7f ["レビュー内部基盤"]
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
  md_45844dgv --> md_542cnad9
```
<!-- b_n6m2ajkf -->
