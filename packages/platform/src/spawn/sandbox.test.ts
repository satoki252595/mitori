/** F2 (nonfunc audit): the shipped daemon detects the gate sandbox instead of hard-coding "none". */
import { describe, expect, test } from "bun:test";
import { detectGateSandbox, probeGateSandbox, type SandboxProbe } from "./sandbox.ts";

const probe = (over: Partial<SandboxProbe>): SandboxProbe & { ran: string[][] } => {
  const ran: string[][] = [];
  return {
    platform: "darwin",
    exists: () => true,
    which: () => null,
    ...over,
    run: (argv) => {
      ran.push([...argv]);
      return over.run ? over.run(argv) : 0;
    },
    ran,
  };
};

describe("F2 gate sandbox detection", () => {
  test("macOS: sandbox-exec accepting a trivial profile ⇒ sandbox-exec; refused or missing ⇒ none", () => {
    const ok = probe({});
    expect(probeGateSandbox(ok)).toBe("sandbox-exec");
    expect(ok.ran[0]).toEqual(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"]);
    expect(probeGateSandbox(probe({ run: () => 71 }))).toBe("none");
    expect(probeGateSandbox(probe({ exists: () => false }))).toBe("none");
  });

  test("Linux: bwrap that can make a user namespace ⇒ bwrap; no bwrap, or namespaces disabled ⇒ none", () => {
    const which = (c: string) => (c === "bwrap" ? "/usr/bin/bwrap" : c === "true" ? "/usr/bin/true" : null);
    const ok = probe({ platform: "linux", which });
    expect(probeGateSandbox(ok)).toBe("bwrap");
    expect(ok.ran[0]?.slice(0, 2)).toEqual(["/usr/bin/bwrap", "--unshare-user"]);
    expect(probeGateSandbox(probe({ platform: "linux", which, run: () => 1 }))).toBe("none");
    expect(probeGateSandbox(probe({ platform: "linux" }))).toBe("none");
  });

  test("other platforms ⇒ none", () => {
    expect(probeGateSandbox(probe({ platform: "win32" }))).toBe("none");
  });

  test.if(process.platform === "darwin")("this Mac: the real probe finds sandbox-exec (≤ 200 ms), and the result is cached", () => {
    const t0 = performance.now();
    expect(detectGateSandbox()).toBe("sandbox-exec");
    expect(performance.now() - t0).toBeLessThan(200);
    const t1 = performance.now();
    expect(detectGateSandbox()).toBe("sandbox-exec");
    expect(performance.now() - t1).toBeLessThan(1);
  });
});
