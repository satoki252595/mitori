# 2. 見取り図 <!-- b_stdp6am8 -->

フロアプランは2つのグループに分かれる。1つは `internal` と `cmd/crit` からなる Go のレビュー中核群、もう1つは `web` のブラウザ UI 一式である（推測）。中核群では CLI 入口がコマンドを各ハンドラへ振り分ける。HTTP サーバー層はレビュー状態管理とフォーカスを参照してセッションを公開し、レビュー状態管理は差分の取得を VCS 抽象化層に任せる（[cli\_dispatch.go:11-23](../../cmd/crit/cli_dispatch.go#L11-L23)、[server.go:127](../../internal/server/server.go#L127)、[session.go:416-431](../../internal/session/session.go#L416-L431)）。PR/MR 同期はフォーカスやレビュー状態管理と相互に参照し合う（推測）。ブラウザ側では、レビュー画面本体と live mode フロントが共有 UI ヘルパーを通じて API を呼ぶ（[app.js:34-43](../../web/app.js#L34-L43)、[live-mode.js:153](../../web/live-mode.js#L153)、[crit-shared.js:13-40](../../web/crit-shared.js#L13-L40)）。 <!-- b_az000q88 -->

```mermaid
flowchart LR
  md_hd12merg["internal/vcs · VCS"]
  md_ecsfkz72["internal/session · CritJSON"]
  md_20br4kx5["internal + web · Focus"]
  md_y2y67yyw["internal · Config"]
  md_8zxhv5eg["cmd/crit · RunReview"]
  md_mr6t12q3["internal + cmd · SessionEntry"]
  md_hr3g7tsp["internal + cmd · Context"]
  md_adekddkx["internal · ReviewPathsFor"]
  md_em5fyh7k["internal/server · Server"]
  md_542cnad9["web + scripts · critWaitTimeout"]
  md_45844dgv["web"]
  md_81hf7jm0["web"]
  md_rzknchaw["web"]
  subgraph g_md_b6twrg7f ["internal + cmd · CritJSON"]
    md_hd12merg
    md_ecsfkz72
    md_20br4kx5
    md_y2y67yyw
    md_8zxhv5eg
    md_mr6t12q3
    md_hr3g7tsp
    md_adekddkx
    md_em5fyh7k
  end
  subgraph g_md_gvw2kgjt ["web + scripts · critWaitTimeout"]
    md_542cnad9
    md_45844dgv
    md_81hf7jm0
    md_rzknchaw
  end
  md_adekddkx --> md_20br4kx5
  md_20br4kx5 --> md_ecsfkz72
  md_em5fyh7k --> md_ecsfkz72
  md_em5fyh7k --> md_y2y67yyw
  md_em5fyh7k --> md_20br4kx5
  md_mr6t12q3 --> md_y2y67yyw
  md_y2y67yyw --> md_mr6t12q3
  md_8zxhv5eg --> md_y2y67yyw
  md_8zxhv5eg --> md_mr6t12q3
  md_ecsfkz72 --> md_hd12merg
  md_8zxhv5eg --> md_20br4kx5
  md_8zxhv5eg --> md_adekddkx
  md_ecsfkz72 --> md_adekddkx
  md_20br4kx5 --> md_hd12merg
  md_8zxhv5eg --> md_hd12merg
  md_mr6t12q3 --> md_ecsfkz72
  md_em5fyh7k --> md_adekddkx
  md_81hf7jm0 --> md_542cnad9
  md_ecsfkz72 --> md_20br4kx5
  md_45844dgv --> md_542cnad9
  md_20br4kx5 --> md_adekddkx
  md_20br4kx5 --> md_mr6t12q3
  md_adekddkx --> md_ecsfkz72
  md_mr6t12q3 --> md_20br4kx5
  md_8zxhv5eg --> md_ecsfkz72
  md_adekddkx --> md_hd12merg
  md_hr3g7tsp --> md_ecsfkz72
  md_20br4kx5 --> md_y2y67yyw
  md_hr3g7tsp --> md_y2y67yyw
  md_mr6t12q3 --> md_adekddkx
  md_y2y67yyw --> md_hd12merg
  md_81hf7jm0 --> md_45844dgv
  md_adekddkx --> md_em5fyh7k
  md_adekddkx --> md_mr6t12q3
  md_adekddkx --> md_y2y67yyw
  md_em5fyh7k --> md_hd12merg
  md_hr3g7tsp --> md_hd12merg
  md_ecsfkz72 --> md_y2y67yyw
  md_hr3g7tsp --> md_20br4kx5
```
<!-- b_bv92n6kf -->
