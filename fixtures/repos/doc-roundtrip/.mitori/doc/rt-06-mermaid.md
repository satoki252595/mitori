# 6. 図 <!-- b_5ajkkshb -->

読み込みの流れ

```mermaid
flowchart LR
  csv["CSV"] -->|parse| repo["Repo"]
  repo -->|list| api["HTTP API"]
  subgraph store ["保存"]
    repo
  end
```
<!-- b_hz7br1y0 -->
