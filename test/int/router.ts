/**
 * Scenario router for the fake engines of INT-04 / INT-05: answers a rendered gen prompt (the user message) with a
 * valid compact NDJSON reply, keyed on the TASK line (a text port of `@mitori/gen/testing` `validRouter`, which keys
 * on the call object the fake spawner does not see). Cites point at the first numbered line the prompt shows.
 */

/** First `N|` line under a `=== <path>` header (to build valid cites). */
export function firstShown(message: string, pathPrefix = ""): { path: string; line: number } | null {
  let file: string | null = null;
  for (const l of message.split("\n")) {
    const h = /^=== (\S+)/.exec(l);
    if (h) {
      file = h[1] as string;
      continue;
    }
    const n = /^(\d+)\|/.exec(l);
    if (n && file?.startsWith(pathPrefix)) return { path: file, line: Number(n[1]) };
  }
  return null;
}

const j = (o: unknown) => JSON.stringify(o);
const end = (n: number) => j({ t: "end", blocks: n });

/** NDJSON lines for one gen prompt (unit message). Retries and unknown prompts end with zero blocks. */
export function routeGen(message: string): string[] {
  if (/^TASK: Fix your previous reply/m.test(message)) return [end(0)];
  const shown = firstShown(message);
  const behavior = shown ? `behavior ${shown.path}:${shown.line}-${shown.line}` : "behavior";
  let m = /^TASK: Write the page for module (md_\w{8})/m.exec(message);
  if (m) {
    const mod = m[1] as string;
    return [
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "このモジュールの責務を説明する[[1]]。", claims: { "1": behavior } }),
      j({ t: "block", id: "new:2", aspect: "interface", md: "- 公開関数を提供する[[1]]。", claims: { "1": behavior } }),
      j({ t: "module", module: mod, name: `部品${mod.slice(-2)}`, summary: "要約" }),
      end(2),
    ];
  }
  m = /^TASK: Write the page for parent module (md_\w{8})/m.exec(message);
  if (m)
    return [
      j({ t: "block", id: "new:1", aspect: "responsibility", md: "子モジュールをまとめる[[1]]。", claims: { "1": "architecture" } }),
      j({ t: "block", id: "new:2", aspect: "structure", md: "- 子がある[[1]]。", claims: { "1": "architecture" } }),
      j({ t: "module", module: m[1], name: "中核", summary: "中核の部品" }),
      end(2),
    ];
  if (/^TASK: Write the opening of the design document/m.test(message)) {
    const readme = firstShown(message, "README");
    const existing = (aspect: string) => new RegExp(`^> (b_\\w{8}) aspect=${aspect} `, "m").exec(message)?.[1];
    return [
      j({
        t: "block",
        id: existing("tldr") ?? "new:1",
        aspect: "tldr",
        md: "このリポジトリは本の一覧を管理する[[1]]。",
        claims: { "1": readme ? `fact ${readme.path}:${readme.line}` : "fact" },
      }),
      j({ t: "block", id: existing("problem") ?? "new:2", aspect: "problem", md: "読みたい本を忘れないようにする[[1]]。", claims: { "1": "architecture" } }),
      end(2),
    ];
  }
  m = /^TASK: Describe the (\d+) to \d+ most important flows/m.exec(message);
  if (m) {
    const out = [j({ t: "block", id: "new:1", aspect: "intro", md: "入口から処理が流れる。", claims: {} })];
    let n = 1;
    for (let k = 0; k < Math.max(1, Number(m[1])); k++) {
      out.push(j({ t: "flow", key: `flow${k + 1}`, title: `流れ${k + 1}` }));
      out.push(j({ t: "block", id: `new:${++n}`, aspect: "summary", md: `流れ${k + 1}の概要だ。`, claims: {} }));
      out.push(j({ t: "block", id: `new:${++n}`, aspect: "steps", md: "1. 受け付ける[[1]]", claims: { "1": behavior } }));
    }
    return [...out, end(n)];
  }
  if (/^TASK: Build the glossary/m.test(message))
    return [j({ t: "term", term: "ハンドラ", yomi: "はんどら", en: "handler", def: "リクエストを処理する関数。" }), end(0)];
  if (/^TASK: Name the modules/m.test(message)) {
    const ids = [...message.matchAll(/^> (md_\w{8}) paths=/gm)].map((x) => x[1] as string);
    return [...ids.map((id) => j({ t: "module", module: id, name: `ラベル${id.slice(-2)}` })), end(0)];
  }
  return [end(0)];
}
