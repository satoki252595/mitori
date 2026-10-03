// S0 inventory prototype (rule table of specs/indexer.md §2). usage: bun s0proto.mjs <repo>...
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const KiB = 1024, MiB = 1024 * 1024
const pm = (g) => new Bun.Glob(g)
const DENY = ['.git/**', '.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/id_ed25519*', '**/.npmrc', '**/.netrc', '.dev.vars', '.github/workflows/**', '.claude/**', '.codex/**', '.agents/**', '.cursor/**', '.mitori/**'].map(pm)
const SECRET_NAMES = /(^|\/)(\.env(\..*)?|\.dev\.vars|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|credentials\.json|service[-_]account.*\.json)$|\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i
const LOCK = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json', 'Cargo.lock', 'go.sum', 'go.work.sum', 'poetry.lock', 'Pipfile.lock', 'uv.lock', 'pdm.lock', 'composer.lock', 'Gemfile.lock', 'flake.lock', 'mix.lock', 'Podfile.lock', 'packages.lock.json', 'gradle.lockfile', 'deno.lock', 'pubspec.lock'])
const BIN_EXT = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|psd|svg|woff2?|ttf|otf|eot|zip|gz|tgz|bz2|xz|7z|rar|zst|tar|mp3|mp4|m4a|mov|webm|wav|ogg|flac|pdf|docx?|xlsx?|pptx?|exe|dll|so|dylib|a|o|obj|class|jar|war|wasm|pyc|pyo|sqlite3?|db|bin|dat|pkl|npy|npz|parquet|onnx|pt|ckpt)$/i
const VENDOR_SEG = /(^|\/)(node_modules|vendor|third_party|third-party|thirdparty|bower_components|jspm_packages|\.yarn|Pods|Carthage|__vendor__)\//
const GEN_SEG = /(^|\/)(dist|\.next|\.nuxt|\.svelte-kit|\.output|coverage|__generated__|generated)\//
const GEN_NAME = /(\.pb\.go|_pb2(_grpc)?\.py|\.pb\.(ts|js)|_pb\.(js|ts|d\.ts)|\.generated\.[a-z]+|_generated\.[a-z]+|\.gen\.(go|ts|js)|\.g\.dart|\.designer\.cs|\.map)$/i
const MIN_NAME = /(\.min\.(js|css|mjs)|-min\.js|\.bundle\.js|\.chunk\.js)$/i
const DATA_EXT = /\.(json|jsonl|ndjson|csv|tsv|xml|ya?ml|geojson|txt|log|har|ipynb)$/i
const FIXTURE_SEG = /(^|\/)(testdata|fixtures?|__fixtures__|__snapshots__|snapshots)\//
const TEST_SEG = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright|benches|benchmarks?)\//
const TEST_NAME = /(_test\.go|(^|\/)test_[^/]*\.py|_test\.py|(^|\/)conftest\.py|\.(test|spec)\.[cm]?[jt]sx?|\.snap)$/
const DOC_EXT = /\.(md|mdx|markdown|rst|adoc|asciidoc)$/i
const DOC_NAME = /(^|\/)(README|CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|LICENSE|LICENCE|NOTICE|AUTHORS|SECURITY|CODE_OF_CONDUCT|CLAUDE|AGENTS)(\.[a-z]+)?$/i
const CONFIG_NAME = /(^|\/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|deno\.jsonc?|bunfig\.toml|biome\.jsonc?|\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|\.prettierrc[^/]*|wrangler\.(toml|jsonc?)|vercel\.json|netlify\.toml|Dockerfile[^/]*|[^/]*\.dockerfile|docker-compose[^/]*\.ya?ml|compose\.ya?ml|Procfile|Makefile|makefile|GNUmakefile|[^/]*\.mk|[Jj]ustfile|Taskfile\.ya?ml|flake\.nix|default\.nix|shell\.nix|pyproject\.toml|setup\.cfg|tox\.ini|pytest\.ini|mypy\.ini|ruff\.toml|\.flake8|requirements[^/]*\.txt|Pipfile|environment\.ya?ml|go\.mod|go\.work|Cargo\.toml|rust-toolchain(\.toml)?|Gemfile|[^/]*\.gemspec|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|\.gitattributes|\.gitignore|\.editorconfig|\.nvmrc|\.node-version|\.tool-versions|\.python-version|\.gitlab-ci\.yml|[^/]*\.config\.[cm]?[jt]s)$/
const CONFIG_EXT = /\.(toml|ini|cfg|conf|ya?ml|json|jsonc|json5|nix|properties)$/i
const LANG = [[/\.d\.[cm]?ts$/, 'typescript'], [/\.[cm]?ts$/, 'typescript'], [/\.tsx$/, 'tsx'], [/\.jsx$/, 'jsx'], [/\.[cm]?js$/, 'javascript'], [/\.pyi?$|\.pyw$/, 'python'], [/\.go$/, 'go'], [/\.rs$/, 'rust']]
const CODE_EXT = /\.(java|kt|kts|swift|c|cc|cpp|cxx|h|hh|hpp|cs|php|rb|scala|lua|sh|bash|zsh|fish|ps1|sql|css|scss|sass|less|html?|vue|svelte|astro|ex|exs|erl|hs|ml|mli|clj|cljs|dart|r|jl|m|mm|zig|nim|sol|tf|hcl|proto|graphql|gql|prisma|nix|el|vim|groovy|pl|pm)$/i
const GEN_HDR = /(code generated .* do not edit|@generated\b|auto-?generated|this file (is|was) (automatically |auto-)?generated|do not edit (this file|manually|by hand))/i
function langOf(p, head) {
  for (const [re, l] of LANG) if (re.test(p)) return l
  const first = head.slice(0, 200).toString().split('\n')[0]
  if (first.startsWith('#!')) { if (/\b(node|bun)\b/.test(first)) return 'javascript'; if (/\b(deno|tsx|ts-node)\b/.test(first)) return 'typescript'; if (/python/.test(first)) return 'python' }
  return 'generic'
}
function classify(p, size, readContent, attrs) {
  if (DENY.some(g => g.match(p))) return SECRET_NAMES.test(p) ? ['secret', 'secret'] : ['ignored', 'deny_glob']
  if (SECRET_NAMES.test(p)) return ['secret', 'secret']
  const base = p.split('/').pop()
  if (LOCK.has(base)) return ['lockfile', 'lockfile']
  if (BIN_EXT.test(p)) return ['binary', 'binary']
  if (size > 2 * MiB) return ['oversize', 'oversize']
  if (attrs.vendored === true || (attrs.vendored !== false && VENDOR_SEG.test(p))) return ['vendored', 'vendored']
  if (attrs.generated === true || GEN_SEG.test(p) || GEN_NAME.test(p)) return ['generated', 'generated']
  if (MIN_NAME.test(p)) return ['minified', 'minified']
  const buf = readContent()
  const head = buf.subarray(0, 8000)
  if (head.includes(0)) return ['binary', 'binary']
  const isDoc = DOC_EXT.test(p) || DOC_NAME.test(p)
  let nl = 0; for (let i = 0; i < buf.length; i++) if (buf[i] === 10) nl++
  const avg = buf.length / Math.max(1, nl)
  if (!isDoc && buf.length > 1024 && (avg > 300 || (nl <= 3 && buf.length > 5 * KiB))) return ['minified', 'minified']
  if (GEN_HDR.test(buf.subarray(0, 1024).toString())) return ['generated', 'generated']
  if (FIXTURE_SEG.test(p)) return ['test', 'fixture']
  if (DATA_EXT.test(p) && !CONFIG_NAME.test(p) && !isDoc && size > 50 * KiB) return ['data_large', 'data_large']
  const lang = langOf(p, head)
  if (TEST_NAME.test(p) || (TEST_SEG.test(p) && (lang !== 'generic' || CODE_EXT.test(p)))) return ['test', null, lang]
  if (isDoc) return ['docs', null]
  if (CONFIG_NAME.test(p)) return ['config', null, lang]
  if (lang !== 'generic' || CODE_EXT.test(p)) return ['source', null, lang]
  if (CONFIG_EXT.test(p)) return ['config', null]
  return size <= 50 * KiB ? ['source', null, 'generic'] : ['data_large', 'data_large']
}
const CPT = { code: 2.3, markdown_en: 2.87, json: 2.0, minified: 1.69, lock: 1.27 }
for (const repo of process.argv.slice(2)) {
  const t0 = performance.now()
  const ls = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString().split('\0').filter(Boolean).map(l => { const [meta, p] = l.split('\t'); return [p, meta.split(' ')[1], meta.split(' ')[0]] })
  const tLs = performance.now() - t0
  // linguist attrs in one call
  const ga = execFileSync('git', ['check-attr', '-z', 'linguist-vendored', 'linguist-generated', '--stdin'], { cwd: repo, input: ls.map(x => x[0]).join('\0'), maxBuffer: 1 << 28 }).toString().split('\0')
  const attrs = new Map(); for (let i = 0; i + 2 < ga.length; i += 3) { const [p, a, v] = [ga[i], ga[i + 1], ga[i + 2]]; if (v === 'unspecified') continue; const o = attrs.get(p) ?? {}; o[a === 'linguist-vendored' ? 'vendored' : 'generated'] = v === 'set' || v === 'true'; if (v === 'false' || v === 'unset') o[a === 'linguist-vendored' ? 'vendored' : 'generated'] = false; attrs.set(p, o) }
  const tAttr = performance.now() - t0 - tLs
  const C = {}, X = {}; let bytesAll = 0, tokNaive = 0, tokFiltered = 0, readBytes = 0, dupes = 0; const seenBlob = new Map(); const ex = {}
  for (const [p, blob, mode] of ls) {
    if (mode === '160000' || mode === '120000') { const k = mode === '160000' ? 'submodule' : 'symlink'; C[k] = (C[k] ?? 0) + 1; continue }
    let size = 0; try { size = fs.statSync(path.join(repo, p)).size } catch { continue }
    let buf = null; const read = () => (buf ??= (readBytes += size, fs.readFileSync(path.join(repo, p))))
    const [cls, why, lang] = classify(p, size, read, attrs.get(p) ?? {})
    C[cls] = (C[cls] ?? 0) + 1; if (why) { X[why] = (X[why] ?? 0) + 1; (ex[why] ??= []).length < 3 && ex[why].push(p) }
    bytesAll += size
    const k = cls === 'minified' ? CPT.minified : cls === 'lockfile' ? CPT.lock : cls === 'docs' ? CPT.markdown_en : /json$/.test(p) ? CPT.json : CPT.code
    if (cls !== 'binary' && cls !== 'secret' && cls !== 'ignored') tokNaive += size / k
    if (!why && (cls === 'source' || cls === 'config')) { tokFiltered += size / CPT.code; if (seenBlob.has(blob)) dupes++; seenBlob.set(blob, p) }
  }
  const ms = performance.now() - t0
  console.log(JSON.stringify({ repo: path.basename(repo), files: ls.length, MB: +(bytesAll / MiB).toFixed(1), readMB: +(readBytes / MiB).toFixed(1), ms: Math.round(ms), lsMs: Math.round(tLs), attrMs: Math.round(tAttr), classes: C, excluded: X, dupSourceBlobs: dupes, tokNaiveM: +(tokNaive / 1e6).toFixed(2), tokSrcCfgM: +(tokFiltered / 1e6).toFixed(2), ratio: +(tokFiltered / tokNaive).toFixed(3), examples: ex }))
}
