# gen track — change requests (generation quality with the real engine, 2026-10-04)

Found while reading the real standard generations of m3e-canvas and crit (`docs/progress/gen-quality.md`). The gen side
has a working workaround for each; the root cause sits in another package's contract or implementation.

## 1. The static floor plan keeps the directory labels after the modules are named
- contract: `packages/doc/src/contract.ts` — `StaticDocInput.diagrams` / `applyStatic` (`s2:floorplan`)
- change: when the server passes a floor-plan IR (`input.diagrams`, kind `floorplan`/`container`), rename its module
  nodes with the module's generated name (`moduleName(c, m)`, as the fallback IR already does), and re-apply the slot
  when module lines arrive (`setModuleLabels`).
- why: §2's caption (gen.overview final) names the parts by their generated names ("設計トークンと整列"), the drawing
  under it says `lib (tokens, tidy)`: a newcomer cannot map one onto the other. gen spec §4.1 s2: "node label は module
  行の name".
- workaround in place: none in gen (the caption cannot know the drawn labels). Visible in
  `docs/progress/dogfood2/m3e-canvas/doc/02-floor-plan.md`.
- urgency: before the next public screenshot of §2.

## 2. Markers in a diagram block's caption are exported raw
- contract: `packages/doc` export of `kind: "diagram"` blocks (`.mitori/doc/*.md` writer)
- change: run the caption md of a diagram block through the same marker → cite-link rendering as prose blocks.
- why: every m3e §3 sequence diagram showed a literal `[[1]]` under the drawing.
- workaround in place: the gen validator drops markers and claims of diagram captions (W10, `packages/gen/src/line/validator.ts`)
  and gen.flows@3 asks for a caption without a marker. The steps carry the claims.
- urgency: nice to have (gen no longer produces them).

## 3. moduleContext().tests has no test locations
- contract: `packages/indexer/src/contract.ts` — `ModuleContext.tests`
- change: one line per test case with its line, `T <path>:<line> <name>` (the facts have them), or expose the attached
  test files so callers build their own list.
- why: the per-file form `T <path>: <case>; <case>; …` (cut at the line limit) gives the tests aspect nothing citable;
  on m3e-canvas 2 of the 5 retries of the first real run were test claims citing a bare test file.
- workaround in place: `testsWithLocations` (`packages/gen/src/prompts/inputs.ts`, `CR-PENDING(dogfood)`) rebuilds the
  list from the test facts of each listed file.
- urgency: nice to have.

## 4. No flow seed for a frontend app; seeds that walk into assets
- contract: `packages/indexer/src/contract.ts` — `Indexer.flowSeeds`
- change: (a) treat framework entries as `entry` facts (Next.js `app/**/page.tsx` / `layout.tsx`, `pages/**`, Vite
  `index.html` → `src/main.*`), so a UI app has seeds; (b) do not continue a flow walk into embed / asset / script files
  (crit: `… > web/embed.go > scripts/bench-compare.py`).
- why: m3e-canvas had no seed at all, so §3 "主要な流れ" was never generated — the section a newcomer needs most.
- workaround in place: `genFlowSeeds` (`packages/gen/src/prompts/seeds.ts`) derives seeds from the file graph when the
  index has none (root module's most outgoing file → the core file of each important module).
- urgency: before the public benchmark (frontend repos: excalidraw, react).

## 5. An s4 aspect for the five-minute start
- contract: `packages/doc/src/contract.ts` — `SECTION_ASPECTS.s4`, `ASPECT_DEFAULTS`, `ASPECT_HEADINGS`
- change: `s4: ["start"]`, `start: { kinds: ["list"], depth: "L0", audience: ["newcomer", "dev"] }`, heading
  「最初の 5 分 / First five minutes»; gen.overview (final) would write it above the static scripts table.
- why: §4 is only static tables (scripts, env, entries); "how do I try it" is the newcomer's first question.
- workaround in place: gen.overview@3 ends s1 `users` with a "try it in five minutes" item (install / run / what to open,
  cited from S facts or docs). It works (m3e: `npm install` → `npm run dev` → localhost:3000 → drag a part → copy the
  prompt) but sits under 利用者.
- urgency: nice to have.

## 6. The floor plan draws every edge
- contract: `packages/doc` floor-plan IR from `Indexer.graph("module")`
- change: draw the strongest edges per node (e.g. top 2 out-edges, plus edges above a weight share) and say "+n more".
- why: m3e's five modules have 15 of the 20 possible directed edges: the drawing says "everything uses everything".
- workaround in place: none.
- urgency: nice to have.
