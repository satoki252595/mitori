import { describe, expect, test } from "bun:test";
import type { ResolvedImport } from "../contract.ts";
import { expandUseTree } from "./rust.ts";
import { resolveImports } from "./stage.ts";
import { imp, input, sf } from "./test/stage-files.ts";

const pick = (r: ResolvedImport) => ({
  to: r.to,
  ...(r.external !== undefined ? { external: r.external } : {}),
  ...(r.stdlib ? { stdlib: true } : {}),
  kind: r.kind,
});

function resolved(files: Parameters<typeof input>[0], texts: Record<string, string>, from: string) {
  const res = resolveImports(input(files, texts));
  return Object.fromEntries((res.imports.get(from) ?? []).map((r) => [r.spec, pick(r)]));
}

describe("IDX-AT-20 TS resolution", () => {
  const texts = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "tsconfig.base.json": `{ // shared\n "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["libs/*"], "@cfg": ["libs/config/index.ts"], }, },\n}`,
    "apps/web/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.base.json" }),
    "packages/ui/package.json": JSON.stringify({
      name: "@acme/ui",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./button": "./dist/button.js", "./icons/*": "./dist/icons/*.js" },
    }),
    "packages/core/package.json": JSON.stringify({ name: "@acme/core", main: "src/main.ts", imports: { "#internal/*": "./src/internal/*.ts" } }),
  };
  const files = [
    sf("apps/web/src/a.ts", {
      imports: [
        imp("./b.js"),
        imp("./dir"),
        imp("@lib/x"),
        imp("@cfg"),
        imp("libs/lone"),
        imp("fs"),
        imp("node:path"),
        imp("react"),
        imp("@scope/pkg/sub"),
        imp("@acme/ui"),
        imp("@acme/ui/button"),
        imp("@acme/ui/icons/star"),
        imp("@acme/core", ["x"], "type"),
        imp("./style.css?inline"),
        imp("./missing"),
        imp("https://esm.sh/lodash@4"),
      ],
    }),
    sf("apps/web/src/b.ts"),
    sf("apps/web/src/b.js"),
    sf("apps/web/src/dir/index.ts"),
    sf("apps/web/src/style.css", { class: "source", lang: "generic" }),
    sf("libs/x.ts"),
    sf("libs/lone.ts"),
    sf("libs/config/index.ts"),
    sf("packages/ui/src/index.ts"),
    sf("packages/ui/src/button.ts"),
    sf("packages/ui/src/icons/star.tsx"),
    sf("packages/core/src/main.ts", { imports: [imp("#internal/util")] }),
    sf("packages/core/src/internal/util.ts"),
  ];

  test("every spec resolves to the expected to / external / stdlib", () => {
    const r = resolved(files, texts, "apps/web/src/a.ts");
    expect(r["./b.js"]).toEqual({ to: ["apps/web/src/b.ts"], kind: "static" });
    expect(r["./dir"]).toEqual({ to: ["apps/web/src/dir/index.ts"], kind: "static" });
    expect(r["@lib/x"]).toEqual({ to: ["libs/x.ts"], kind: "static" });
    expect(r["@cfg"]).toEqual({ to: ["libs/config/index.ts"], kind: "static" });
    expect(r["libs/lone"]).toEqual({ to: ["libs/lone.ts"], kind: "static" }); // baseUrl-relative bare spec
    expect(r.fs).toEqual({ to: [], stdlib: true, kind: "static" });
    expect(r["node:path"]).toEqual({ to: [], stdlib: true, kind: "static" });
    expect(r.react).toEqual({ to: [], external: "react", kind: "static" });
    expect(r["@scope/pkg/sub"]).toEqual({ to: [], external: "@scope/pkg", kind: "static" });
    expect(r["@acme/ui"]).toEqual({ to: ["packages/ui/src/index.ts"], kind: "static" }); // exports types → dist→src
    expect(r["@acme/ui/button"]).toEqual({ to: ["packages/ui/src/button.ts"], kind: "static" });
    expect(r["@acme/ui/icons/star"]).toEqual({ to: ["packages/ui/src/icons/star.tsx"], kind: "static" });
    expect(r["@acme/core"]).toEqual({ to: ["packages/core/src/main.ts"], kind: "type" });
    expect(r["./style.css?inline"]).toEqual({ to: ["apps/web/src/style.css"], kind: "asset" });
    expect(r["./missing"]).toEqual({ to: [], kind: "static" });
    expect(r["https://esm.sh/lodash@4"]?.external).toBe("https://esm.sh/lodash");
  });

  test("package.json #imports and unresolved bookkeeping", () => {
    const res = resolveImports(input(files, texts));
    expect(res.imports.get("packages/core/src/main.ts")?.[0]?.to).toEqual(["packages/core/src/internal/util.ts"]);
    expect(res.unresolved).toEqual([{ path: "apps/web/src/a.ts", spec: "./missing" }]);
  });

  test("JS files prefer the .js twin; TS files prefer the .ts twin", () => {
    const r = resolved([sf("src/a.js", { imports: [imp("./b.js")] }), sf("src/b.js"), sf("src/b.ts")], {}, "src/a.js");
    expect(r["./b.js"]?.to).toEqual(["src/b.js"]);
  });
});

describe("IDX-AT-21 Python resolution", () => {
  const texts = { "pyproject.toml": `[project]\nname = "app"\n[tool.pytest.ini_options]\npythonpath = ["tools"]\n` };
  const files = [
    sf("src/app/__init__.py"),
    sf("src/app/core/__init__.py"),
    sf("src/app/core/models.py"),
    sf("src/app/core/deep/x/leaf.py", {
      imports: [imp("...models", ["User"]), imp("..", ["helpers"]), imp(".", ["sibling"]), imp("....util", ["fmt"])],
    }),
    sf("src/app/core/deep/__init__.py"),
    sf("src/app/core/deep/helpers.py"),
    sf("src/app/core/deep/x/sibling.py"),
    sf("src/app/util.py"),
    sf("src/app/svc.py", {
      imports: [imp("app.core.models", ["User"]), imp("app.core", ["models", "Thing"]), imp("os.path"), imp("PIL", ["Image"]), imp("nsp.mod"), imp("tool_a")],
    }),
    sf("src/app/typing_only.py", { imports: [imp("app.util", ["fmt"], "type")] }),
    sf("nsp/mod.py"),
    sf("tools/tool_a.py"),
  ];
  test("src layout, relative levels, namespace packages, stdlib, external", () => {
    const leaf = resolved(files, texts, "src/app/core/deep/x/leaf.py");
    expect(leaf["...models"]?.to).toEqual(["src/app/core/models.py"]);
    expect(leaf[".."]?.to).toEqual(["src/app/core/deep/helpers.py"]);
    expect(leaf["."]?.to).toEqual(["src/app/core/deep/x/sibling.py"]);
    expect(leaf["....util"]?.to).toEqual(["src/app/util.py"]);
    const svc = resolved(files, texts, "src/app/svc.py");
    expect(svc["app.core.models"]?.to).toEqual(["src/app/core/models.py"]);
    expect(svc["app.core"]?.to).toEqual(["src/app/core/models.py", "src/app/core/__init__.py"]);
    expect(svc["os.path"]).toEqual({ to: [], stdlib: true, kind: "static" });
    expect(svc.PIL).toEqual({ to: [], external: "PIL", kind: "static" });
    expect(svc["nsp.mod"]?.to).toEqual(["nsp/mod.py"]);
    expect(svc.tool_a?.to).toEqual(["tools/tool_a.py"]);
    expect(resolved(files, texts, "src/app/typing_only.py")["app.util"]).toEqual({ to: ["src/app/util.py"], kind: "type" });
  });
  test("a namespace package import resolves without a file edge", () => {
    const r = resolved([sf("a.py", { imports: [imp("ns")] }), sf("ns/inner/m.py")], {}, "a.py");
    expect(r.ns).toEqual({ to: [], kind: "static" });
  });
});

describe("IDX-AT-22 Go resolution", () => {
  const texts = {
    "go.mod": "module example.com/app\n\ngo 1.22\n\nrequire github.com/x/y v1.0.0\nreplace example.com/lib => ./third/lib\n",
    "tools/go.mod": "module example.com/app/tools\n",
    "third/lib/go.mod": "module example.com/lib\n",
  };
  const files = [
    sf("cmd/app/main.go", {
      imports: [imp("example.com/app/internal/store"), imp("example.com/app/tools/gen", ["g"]), imp("example.com/lib/sub"), imp("fmt"), imp("github.com/x/y")],
    }),
    sf("internal/store/a.go"),
    sf("internal/store/b.go"),
    sf("internal/store/a_test.go"),
    sf("tools/gen/gen.go"),
    sf("third/lib/sub/s.go"),
  ];
  test("multiple go.mod, replace, stdlib, external", () => {
    const r = resolved(files, texts, "cmd/app/main.go");
    expect(r["example.com/app/internal/store"]?.to).toEqual(["internal/store/a.go", "internal/store/b.go"]);
    expect(r["example.com/app/tools/gen"]?.to).toEqual(["tools/gen/gen.go"]);
    expect(r["example.com/lib/sub"]?.to).toEqual(["third/lib/sub/s.go"]);
    expect(r.fmt).toEqual({ to: [], stdlib: true, kind: "static" });
    expect(r["github.com/x/y"]).toEqual({ to: [], external: "github.com/x/y", kind: "static" });
  });
});

describe("IDX-AT-23 Rust resolution", () => {
  const texts = {
    "Cargo.toml": `[workspace]\nmembers = ["crates/*"]\n`,
    "crates/core/Cargo.toml": `[package]\nname = "my-core"\nversion = "0.1.0"\n`,
    "crates/cli/Cargo.toml": `[package]\nname = "cli"\n\n[[bin]]\nname = "tool"\npath = "src/main.rs"\n`,
  };
  const files = [
    sf("crates/core/src/lib.rs", { imports: [imp("a", [], "mod"), imp("b", [], "mod"), imp("c", ["path=weird/place.rs"], "mod")] }),
    sf("crates/core/src/a.rs", { imports: [imp("inner", [], "mod"), imp("crate::b::{Thing, util::helper as h}"), imp("std::io")] }),
    sf("crates/core/src/a/inner.rs", { imports: [imp("super::super::c::X"), imp("self::deeper::Y"), imp("serde::Serialize")] }),
    sf("crates/core/src/b/mod.rs", { imports: [imp("util", [], "mod")] }),
    sf("crates/core/src/b/util.rs"),
    sf("crates/core/src/weird/place.rs"),
    sf("crates/cli/src/main.rs", { imports: [imp("my_core::a::inner"), imp("my_core::{b, c}")] }),
  ];
  test("mod forms, #[path], crate/super/self, other crates, external, stdlib", () => {
    const res = resolveImports(input(files, texts));
    const by = (from: string) => Object.fromEntries((res.imports.get(from) ?? []).map((r) => [r.spec, pick(r)]));
    const lib = by("crates/core/src/lib.rs");
    expect(lib.a?.to).toEqual(["crates/core/src/a.rs"]);
    expect(lib.b?.to).toEqual(["crates/core/src/b/mod.rs"]);
    expect(lib.c?.to).toEqual(["crates/core/src/weird/place.rs"]);
    const a = by("crates/core/src/a.rs");
    expect(a.inner?.to).toEqual(["crates/core/src/a/inner.rs"]);
    expect(a["crate::b::{Thing, util::helper as h}"]?.to).toEqual(["crates/core/src/b/mod.rs", "crates/core/src/b/util.rs"]);
    expect(a["std::io"]).toEqual({ to: [], stdlib: true, kind: "static" });
    const inner = by("crates/core/src/a/inner.rs");
    expect(inner["super::super::c::X"]?.to).toEqual(["crates/core/src/weird/place.rs"]);
    expect(inner["self::deeper::Y"]).toEqual({ to: [], kind: "static" });
    expect(inner["serde::Serialize"]).toEqual({ to: [], external: "serde", kind: "static" });
    const cli = by("crates/cli/src/main.rs");
    expect(cli["my_core::a::inner"]?.to).toEqual(["crates/core/src/a/inner.rs"]);
    expect(cli["my_core::{b, c}"]?.to).toEqual(["crates/core/src/b/mod.rs", "crates/core/src/weird/place.rs"]);
    expect(res.index.rustModule("crates/core/src/b/util.rs")).toBe("crate::b::util");
  });
  test("use trees expand to leaf paths", () => {
    expect(expandUseTree("a::{b, c::{d, e as f}, self, *}")).toEqual([["a", "b"], ["a", "c", "d"], ["a", "c", "e"], ["a"], ["a", "*"]]);
    expect(expandUseTree("::std::fmt")).toEqual([["std", "fmt"]]);
  });
});
