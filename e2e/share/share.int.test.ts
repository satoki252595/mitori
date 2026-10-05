import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { base64, decrypt, encrypt, sha256, signatureInput, VIEWER_SCRIPT, viewerHtml } from "../../apps/share/src/index.ts";

let runtime: Miniflare;
const id = "a".repeat(32);
const secret = crypto.getRandomValues(new Uint8Array(32));
const capability = base64(crypto.getRandomValues(new Uint8Array(32)));
let owner: CryptoKeyPair;
let publicKey: string;
const exportScript =
  'document.querySelector("h1").textContent="private source + viewer";try{parent.document.body.innerHTML="escape"}catch{document.body.dataset.isolated="yes"}';
const exportHash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exportScript)))));
const exportHtml = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${exportHash}'"><h1>private source</h1><script>${exportScript}</script>`;
// Bun's undici shim does not forward Miniflare's dispatch override. Use its actual HTTP socket.
async function workerFetch(url: string, init?: RequestInit) {
  return fetch(new URL(new URL(url).pathname, await runtime.ready), init);
}

beforeAll(async () => {
  const build = await Bun.build({ entrypoints: ["apps/share/src/worker.ts"], outdir: "node_modules/.cache/mitori-share-test", target: "browser" });
  if (!build.success) throw new Error(String(build.logs));
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: resolve("node_modules/.cache/mitori-share-test/worker.js"),
      compatibilityDate: "2026-10-05",
      d1Databases: ["META"],
      r2Buckets: ["SNAPSHOTS"],
      unsafeTriggerHandlers: true,
    }),
  );
  const database = await runtime.getD1Database("META");
  const sql = readFileSync("apps/share/migrations/0001_snapshots.sql", "utf8");
  // D1.exec expects each statement on one line; keep complete trigger bodies together.
  const statements = sql.match(/\s*CREATE TRIGGER[\s\S]*?\nEND;|\s*[^;]+;/g) ?? [];
  for (const statement of statements) await database.prepare(statement.trim().replace(/\s+/g, " ")).run();
  owner = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = base64(new Uint8Array(await crypto.subtle.exportKey("raw", owner.publicKey)));
  const signature = base64(
    new Uint8Array(await crypto.subtle.sign("Ed25519", owner.privateKey, new TextEncoder().encode(`mitori.snapshot/1:register:${publicKey}`))),
  );
  expect((await workerFetch("https://share.test/api/keys", { method: "POST", body: JSON.stringify({ key: publicKey, signature }) })).status).toBe(200);
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});

async function upload(snapshot: string, expires = Math.floor(Date.now() / 1000) + 86_400, valid = true) {
  const bytes = await encrypt(exportHtml, secret, snapshot);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await sha256(bytes);
  const auth = await sha256(new TextEncoder().encode(capability));
  const signature = base64(
    new Uint8Array(await crypto.subtle.sign("Ed25519", owner.privateKey, signatureInput(snapshot, digest, expires, auth, timestamp, exportHash))),
  );
  return workerFetch(`https://share.test/api/snapshots/${snapshot}`, {
    method: "PUT",
    body: bytes,
    headers: {
      "x-mitori-key": publicKey,
      "x-mitori-expires": String(expires),
      "x-mitori-timestamp": String(timestamp),
      "x-mitori-comments-auth": auth,
      "x-mitori-viewer-hash": exportHash,
      "x-mitori-signature": valid ? signature : signature.replace(/^./, signature[0] === "a" ? "b" : "a"),
    },
  });
}

test("real workerd: signed opaque upload, tamper/AAD rejection, comments capability and expiry", async () => {
  expect((await upload(id, undefined, false)).status).toBe(401);
  expect((await upload(id)).status).toBe(201);
  expect((await upload(id)).status).toBe(409);
  const res = await workerFetch(`https://share.test/api/snapshots/${id}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(await decrypt(bytes, secret, id)).toBe(exportHtml);
  expect(new TextDecoder().decode(bytes)).not.toContain("private source");
  await expect(decrypt(bytes, secret, "b".repeat(32))).rejects.toThrow();
  const bad = bytes.slice();
  bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
  await expect(decrypt(bad, secret, id)).rejects.toThrow();
  const comment = { ciphertext: base64(await encrypt("secret comment <img>", secret, id, true)) };
  expect((await workerFetch(`https://share.test/api/snapshots/${id}/comments`, { method: "POST", body: JSON.stringify(comment) })).status).toBe(401);
  expect(
    (
      await workerFetch(`https://share.test/api/snapshots/${id}/comments`, {
        method: "POST",
        body: JSON.stringify(comment),
        headers: { authorization: `Bearer ${capability}` },
      })
    ).status,
  ).toBe(201);
  const comments = (await (await workerFetch(`https://share.test/api/snapshots/${id}/comments`)).json()) as { ciphertext: string }[];
  expect(JSON.stringify(comments)).not.toContain("secret comment");
  for (const engine of process.env.MITORI_BROWSER_SHARE === "1" ? [chromium, firefox, webkit] : []) {
    const browser = await engine.launch();
    const pinnedDir = mkdtempSync(join(tmpdir(), "mitori-pinned-viewer-"));
    try {
      const page = await browser.newPage();
      await page.goto(new URL(`/s/${id}#key=${base64(secret)}&comments=${capability}`, await runtime.ready).href);
      await page.locator("#status").filter({ hasText: "復号しました" }).waitFor();
      const frame = page.frameLocator("iframe");
      await frame.locator("h1").filter({ hasText: "private source + viewer" }).waitFor();
      expect(await frame.locator("body").getAttribute("data-isolated")).toBe("yes");
      expect(await page.locator("#comments li").filter({ hasText: "secret comment <img>" }).textContent()).toBe("secret comment <img>");
      expect(await page.locator("#comments img").count()).toBe(0);
      const text = `browser comment <script> ${engine.name()}`;
      await page.locator("textarea").fill(text);
      await page.locator("button").click();
      await page.locator("#comments li").filter({ hasText: text }).waitFor();
      const viewerHash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VIEWER_SCRIPT)))));
      const pinnedPath = join(pinnedDir, "viewer.html");
      const pinned = viewerHtml(id, (await runtime.ready).origin, exportHash).replace("__VIEWER_HASH__", viewerHash);
      expect(pinned).not.toContain(base64(secret));
      writeFileSync(pinnedPath, pinned);
      await page.goto(`${pathToFileURL(pinnedPath).href}#key=${base64(secret)}&comments=${capability}`);
      await page.locator("#status").filter({ hasText: "復号しました" }).waitFor();
      await page.frameLocator("iframe").locator("h1").filter({ hasText: "private source + viewer" }).waitFor();
      expect(await page.frameLocator("iframe").locator("body").getAttribute("data-isolated")).toBe("yes");
    } finally {
      await browser.close();
      rmSync(pinnedDir, { recursive: true, force: true });
    }
  }
  const db = await runtime.getD1Database("META");
  await db.prepare("UPDATE snapshots SET expires=0 WHERE id=?").bind(id).run();
  expect((await workerFetch(`https://share.test/api/snapshots/${id}`)).status).toBe(404);
  expect((await workerFetch(`https://share.test/s/${id}`)).status).toBe(404);
}, 30_000);

test("real D1: concurrent uploads cannot exceed per-install count or total quota", async () => {
  const responses = await Promise.all(Array.from({ length: 21 }, (_, i) => upload((i + 1).toString(16).padStart(32, "0"))));
  // The first test already reserved 1 slot (expired data remains reserved until cleanup).
  expect(responses.filter((r) => r.status === 201)).toHaveLength(19);
  expect(responses.filter((r) => r.status === 507)).toHaveLength(2);
  const db = await runtime.getD1Database("META");
  await db.prepare("DELETE FROM snapshots").run();
  expect((await db.prepare("SELECT bytes FROM usage").first<{ bytes: number }>())?.bytes).toBe(0);
  await db.prepare("UPDATE usage SET bytes=8000000000").run();
  expect((await upload("c".repeat(32))).status).toBe(507);
  await db.prepare("UPDATE usage SET bytes=0,write_month=strftime('%Y-%m','now'),writes=10000").run();
  expect((await upload("c".repeat(32))).status).toBe(507);
  await db.prepare("UPDATE usage SET write_month='2000-01'").run();
  expect((await upload("c".repeat(32))).status).toBe(201);
  await db.prepare("UPDATE usage SET read_month=strftime('%Y-%m','now'),reads=1000000").run();
  expect((await workerFetch(`https://share.test/api/snapshots/${"c".repeat(32)}`)).status).toBe(507);
  await db.prepare("UPDATE snapshots SET expires=0").run();
  expect((await workerFetch("https://share.test/cdn-cgi/local/scheduled")).status).toBe(200);
  expect((await db.prepare("SELECT count(*) AS n FROM snapshots").first<{ n: number }>())?.n).toBe(0);
  expect(await db.prepare("SELECT bytes,comment_bytes FROM usage").first()).toEqual({ bytes: 0, comment_bytes: 0 });
}, 30_000);
