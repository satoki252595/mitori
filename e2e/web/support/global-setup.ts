/** Build apps/web once before the suite (skipped with MITORI_E2E_SKIP_BUILD=1 when dist is fresh). */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function globalSetup(): void {
  const web = resolve(import.meta.dirname, "../../../apps/web");
  if (process.env.MITORI_E2E_SKIP_BUILD !== "1") {
    execFileSync("bunx", ["--bun", "vite", "build", "--logLevel", "warn"], { cwd: web, stdio: "inherit" });
    execFileSync(
      "bun",
      [
        "-e",
        `import { buildInitialUi } from ${JSON.stringify(resolve(web, "../../scripts/gen-assets.ts"))}; await buildInitialUi(${JSON.stringify(resolve(web, "../../dist/.build/e2e-initial"))});`,
      ],
      { cwd: web, stdio: "inherit" },
    );
  }
  if (process.env.GITHUB_ACTIONS === "true" && process.platform === "darwin") {
    // Reuse the reference harness after building: a busy Mac must not produce a supposedly valid timing gate.
    execFileSync(
      "bun",
      [
        "-e",
        `
      const root = ${JSON.stringify(resolve(web, "../.."))};
      const m = await import(${JSON.stringify(resolve(web, "../../bench/runner/machine.ts"))});
      const { isReferenceMachine } = await import(${JSON.stringify(resolve(web, "../../bench/runner/verdict.ts"))});
      const quiet = await m.waitForQuiet();
      const machine = m.machineInfo(root, quiet);
      const bg = m.backgroundPriority();
      console.log('web CI machine:', JSON.stringify({ ...machine, backgroundPriority: bg }));
      if (bg === true) throw new Error('web CI runner runs at macOS background priority (efficiency cores only, calibration ~2x); re-register the LaunchAgent: scripts/nd bun scripts/install-runner-service.ts (launchctl kickstart -k does not fix it)');
      if (quiet.noisy || machine.power !== 'ac') throw new Error('web CI requires a quiet reference Mac on AC power; timing verification is pending');
      const factor = m.measureFactor(root);
      console.log('web CI calibration:', JSON.stringify(factor));
      if (factor.source !== 'measured' || !Number.isFinite(factor.factor) || !isReferenceMachine(factor.factor)) throw new Error('web CI requires measured reference calibration within 10%; timing verification is pending');
    `,
      ],
      { cwd: resolve(web, "../.."), stdio: "inherit" },
    );
  }
}
