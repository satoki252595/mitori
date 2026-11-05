// Browser-launch gate check (owner: WP40g): every bun test or test/int/shots driver that starts a real
// browser must consult the testkit gate (`browsersAllowed()` / `MITORI_NO_BROWSERS`), so a runner that
// must not launch browsers skips before any launch is attempted (the sandbox aborts GUI registration and
// leaves a host crash report). Playwright-run `e2e/**.spec.ts` and manual scripts outside `test/int/shots`
// are CI/host-owned and out of scope here.
// Usage: bun scripts/check-browsers.ts   (exit 1 on a launch without the gate)
import { listFiles, read, report } from "./lib/repo.ts";

/** A real-browser start: a Playwright launch call or a pinned real-Chrome channel. */
export const BROWSER_LAUNCH_RE = /(chromium|webkit|firefox)\.launch\(|channel:\s*["']chrome["']/;
/** A reference to the WP40g gate (the function or the env var it reads). */
export const BROWSER_GATE_RE = /browsersAllowed|MITORI_NO_BROWSERS/;

/** Files this check scans: bun tests plus the browser drivers `test/int` tests spawn. */
export function browserScanned(path: string): boolean {
  if (path.endsWith(".d.ts")) return false;
  if (path.startsWith("test/int/shots/") && path.endsWith(".ts")) return true;
  return path.endsWith(".test.ts");
}

export interface BrowserGateFile {
  path: string;
  text: string;
}

/** One violation per file that launches a browser without referencing the gate. */
export function checkBrowserGates(files: readonly BrowserGateFile[]): { file: string; line: number; col: number; rule: string; message: string }[] {
  const out: { file: string; line: number; col: number; rule: string; message: string }[] = [];
  for (const { path, text } of files) {
    const launch = BROWSER_LAUNCH_RE.exec(text);
    if (!launch || BROWSER_GATE_RE.test(text)) continue;
    const before = text.slice(0, launch.index);
    out.push({
      file: path,
      line: before.split("\n").length,
      col: before.slice(before.lastIndexOf("\n") + 1).length + 1,
      rule: "browser-gate",
      message: "launches a real browser without the WP40g gate (browsersAllowed() / MITORI_NO_BROWSERS)",
    });
  }
  return out;
}

if (import.meta.main) {
  const files = listFiles("packages", "apps", "bench", "eval", "e2e", "test", "fixtures", "scripts").filter(browserScanned);
  const problems = checkBrowserGates(files.map((path) => ({ path, text: read(path) })));
  process.exit(report(`check-browsers (${files.length} files)`, problems));
}
