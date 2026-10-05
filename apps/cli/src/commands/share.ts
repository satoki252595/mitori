/** Encrypted export upload, explicitly confirmed by a human. */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MitoriError } from "@mitori/core";
import { createSafeWriter } from "@mitori/platform";
import { base64, encrypt, MAX_SNAPSHOT_BYTES, sha256, signatureInput, unbase64, VIEWER_SCRIPT, viewerHtml } from "@mitori/share";
import { intFlag, oneOf, parse } from "./args.ts";
import { type Io, usage } from "./io.ts";
import { connectWorkspace, requireTty } from "./session.ts";
import { whenReady } from "./workspace.ts";

interface OwnerKey {
  privatePkcs8: string;
  publicRaw: string;
}

async function ownerKey(home: string, io: Io): Promise<OwnerKey> {
  const path = join(home, "share-key.json");
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 4096 || (before.mode & 0o777) !== 0o600)
      throw new Error("share signing key must be a regular private file");
    const key = JSON.parse(readFileSync(path, "utf8")) as OwnerKey;
    const after = lstatSync(path);
    if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs || before.size !== after.size || !after.isFile())
      throw new Error("share signing key changed while reading");
    if (typeof key.privatePkcs8 !== "string" || typeof key.publicRaw !== "string" || unbase64(key.publicRaw).length !== 32)
      throw new Error("invalid share signing key");
    return key;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  // RFC 8410 PKCS#8 wraps a 32-byte Ed25519 seed from the existing Random port.
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(io.random.bytes(32))]);
  const publicDer = createPublicKey(createPrivateKey({ key: pkcs8, type: "pkcs8", format: "der" })).export({ type: "spki", format: "der" });
  const key = { privatePkcs8: base64(new Uint8Array(pkcs8)), publicRaw: base64(new Uint8Array(publicDer.subarray(-32))) };
  await createSafeWriter().write(home, "share-key.json", `${JSON.stringify(key)}\n`, "home");
  return key;
}

export async function run(io: Io): Promise<number> {
  const { values, positionals } = parse(
    io.argv,
    {
      server: { type: "string" },
      out: { type: "string", short: "o" },
      "ttl-days": { type: "string" },
      code: { type: "boolean" },
      decisions: { type: "boolean" },
      level: { type: "string" },
      lang: { type: "string" },
    },
    "share",
  );
  if (!values.server || positionals.length) throw usage("mitori share --server https://mitori-share.example [--ttl-days 30] [--code] [-o viewer.html]");
  const url = new URL(values.server);
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port !== "";
  if ((url.protocol !== "https:" && !local) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw usage("share server must be an HTTPS origin");
  requireTty(io, "sharing a design doc");
  const days = intFlag(values["ttl-days"], "ttl-days", "share", 1, 30) ?? 30;
  const level = oneOf(values.level, ["newcomer", "standard", "expert"] as const, "level", "share") ?? "standard";
  const lang = oneOf(values.lang, ["ja", "en"] as const, "lang", "share");
  const s = await connectWorkspace(io);
  const doc = await whenReady(io, () =>
    s.api.call("POST /ws/:ws/export", {
      params: { ws: s.ws.info.key },
      body: {
        format: "html",
        level,
        lang: lang ?? s.ws.doc.lang ?? "ja",
        excerpts: values.code === true,
        includeDecisions: values.decisions === true,
      },
    }),
  );
  if (doc.bytes + 28 > MAX_SNAPSHOT_BYTES)
    throw new MitoriError("E_PAYLOAD_TOO_LARGE", "encrypted snapshot exceeds 5 MB; omit code excerpts or export a smaller doc");
  const exportHash = /script-src (?:'|&#39;)sha256-([A-Za-z0-9+/]{43}=)/.exec(doc.html)?.[1];
  if (!exportHash) throw new MitoriError("E_INVALID_INPUT", "export lacks its pinned script CSP");
  if (
    !(await io.confirm(
      `Share to ${url.origin} for ${days} days? ${doc.redactions} redactions, ${doc.codeExcerpts.count} code excerpts. Anyone with the link can decrypt/comment; its key remains in browser history/sync.`,
    ))
  )
    return 0;
  const id = [...io.random.bytes(16)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const aes = new Uint8Array(io.random.bytes(32));
  const capability = base64(io.random.bytes(32));
  const bytes = await encrypt(doc.html, aes, id);
  const digest = await sha256(bytes);
  const commentsAuth = await sha256(new TextEncoder().encode(capability));
  const timestamp = Math.floor(io.clock.now() / 1000);
  const expires = timestamp + days * 86_400;
  const owner = await ownerKey(s.home, io);
  const signingKey = await crypto.subtle.importKey("pkcs8", unbase64(owner.privatePkcs8), "Ed25519", false, ["sign"]);
  const sign = async (body: Uint8Array<ArrayBuffer>) => base64(new Uint8Array(await crypto.subtle.sign("Ed25519", signingKey, body)));
  const call = async (path: string, init: RequestInit) => {
    const response = await io.fetch(`${url.origin}${path}`, init);
    if (!response.ok) throw new MitoriError("E_INVALID_INPUT", `share upload failed (${response.status})`);
    return response;
  };
  await call("/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: owner.publicRaw, signature: await sign(new TextEncoder().encode(`mitori.snapshot/1:register:${owner.publicRaw}`)) }),
  });
  await call(`/api/snapshots/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      "x-mitori-key": owner.publicRaw,
      "x-mitori-expires": String(expires),
      "x-mitori-timestamp": String(timestamp),
      "x-mitori-comments-auth": commentsAuth,
      "x-mitori-signature": await sign(signatureInput(id, digest, expires, commentsAuth, timestamp, exportHash)),
      "x-mitori-viewer-hash": exportHash,
    },
    body: bytes,
  });
  const fragment = `key=${base64(aes)}&comments=${capability}`;
  io.out(`${url.origin}/s/${id}#${fragment}\n`);
  const viewerHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VIEWER_SCRIPT));
  io.err(
    `viewer script sha256 ${await sha256(new TextEncoder().encode(VIEWER_SCRIPT))}; encrypted ${bytes.length} bytes; expires ${new Date(expires * 1000).toISOString()}\n`,
  );
  if (values.out) {
    const out = resolve(io.cwd, values.out);
    const dir = realpathSync(dirname(out));
    const html = viewerHtml(id, url.origin, exportHash).replace("__VIEWER_HASH__", btoa(String.fromCharCode(...new Uint8Array(viewerHash))));
    await createSafeWriter().write(dir, basename(out), html, "accept");
    io.err(`pinned viewer: ${join(dir, basename(out))} (open with #${fragment})\n`);
  }
  return 0;
}
