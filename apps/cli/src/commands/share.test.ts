import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decrypt, sha256, signatureInput, unbase64 } from "@mitori/share";
import { runCommand } from "./index.ts";
import { type FakeDaemon, startFakeDaemon, testIo } from "./test/fake-daemon.ts";

let daemon: FakeDaemon;
const hash = `${"A".repeat(43)}=`;
const html = `<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;sha256-${hash}&#39;"><h1>redacted doc</h1>`;
beforeEach(async () => {
  daemon = await startFakeDaemon();
  daemon.route("POST /ws/:ws/export", () => ({ html, bytes: html.length, sha256: "", redactions: 2, codeExcerpts: { count: 0, files: 0 } }));
});
afterEach(async () => {
  await daemon.cleanup();
});

test("sharing requires a human and explicit confirmation; invalid destination never exports", async () => {
  for (const options of [{ tty: false }, { tty: true, env: { CODEX_THREAD_ID: "agent" } }]) {
    const io = testIo({ argv: ["--server", "https://share.test"], home: daemon.home, cwd: daemon.repo, ...options });
    expect(await runCommand("share", io)).toBe(2);
    expect(io.stderr).toContain("E_TTY_REQUIRED");
  }
  const invalid = testIo({ argv: ["--server", "http://share.test"], home: daemon.home, cwd: daemon.repo, tty: true });
  expect(await runCommand("share", invalid)).toBe(2);
  expect(daemon.calls("POST /ws/:ws/export")).toHaveLength(0);
  const declined = testIo({ argv: ["--server", "https://share.test"], home: daemon.home, cwd: daemon.repo, tty: true, answer: false });
  expect(await runCommand("share", declined)).toBe(0);
  expect(existsSync(join(daemon.home, "share-key.json"))).toBe(false);
  expect(declined.stdout).toBe("");
});

test("signed encrypted upload binds the export CSP and saves a pinned viewer without embedding its key", async () => {
  const io = testIo({
    argv: ["--server", "https://share.test", "--ttl-days", "1", "-o", "viewer.html"],
    home: daemon.home,
    cwd: daemon.repo,
    tty: true,
    answer: true,
  });
  let publicKey: CryptoKey;
  let snapshot = "";
  let ciphertext = new Uint8Array(new ArrayBuffer(0));
  io.fetch = (async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://share.test") return fetch(input, init);
    if (url.pathname === "/api/keys") {
      const body = JSON.parse(String(init?.body)) as { key: string; signature: string };
      publicKey = await crypto.subtle.importKey("raw", unbase64(body.key), "Ed25519", false, ["verify"]);
      expect(
        await crypto.subtle.verify("Ed25519", publicKey, unbase64(body.signature), new TextEncoder().encode(`mitori.snapshot/1:register:${body.key}`)),
      ).toBe(true);
    } else {
      snapshot = url.pathname.split("/").at(-1) ?? "";
      ciphertext = init?.body as Uint8Array<ArrayBuffer>;
      const headers = new Headers(init?.headers);
      expect(headers.get("x-mitori-viewer-hash")).toBe(hash);
      expect(
        await crypto.subtle.verify(
          "Ed25519",
          publicKey,
          unbase64(headers.get("x-mitori-signature") ?? ""),
          signatureInput(
            snapshot,
            await sha256(ciphertext),
            Number(headers.get("x-mitori-expires")),
            headers.get("x-mitori-comments-auth") ?? "",
            Number(headers.get("x-mitori-timestamp")),
            hash,
          ),
        ),
      ).toBe(true);
    }
    return Response.json({}, { status: 201 });
  }) as typeof fetch;
  expect(await runCommand("share", io)).toBe(0);
  const link = new URL(io.stdout.trim());
  const key = new URLSearchParams(link.hash.slice(1)).get("key") ?? "";
  expect(await decrypt(ciphertext, unbase64(key), snapshot)).toBe(html);
  expect(new TextDecoder().decode(ciphertext)).not.toContain("redacted doc");
  const viewer = readFileSync(join(daemon.repo, "viewer.html"), "utf8");
  expect(viewer).toContain("https://share.test");
  expect(viewer).not.toContain(key);
  expect(viewer).not.toContain("__VIEWER_HASH__");
  if (process.platform !== "win32") expect(statSync(join(daemon.home, "share-key.json")).mode & 0o777).toBe(0o600);
  expect(io.stdout).not.toContain("privatePkcs8");
  expect(daemon.calls("POST /ws/:ws/export")[0]?.body).toMatchObject({ excerpts: false, includeDecisions: false });
});
