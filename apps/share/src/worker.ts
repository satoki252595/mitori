import { base64, MAX_SNAPSHOT_BYTES, MAX_TTL_SECONDS, sha256, signatureInput, unbase64 } from "./crypto.ts";
import { VIEWER_SCRIPT, viewerHtml } from "./viewer.ts";

// Documented workerd extension, not emitted by Wrangler 4.147's runtime types.
// https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal
declare global {
  interface SubtleCrypto {
    timingSafeEqual(a: BufferSource, b: BufferSource): boolean;
  }
}

const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const failure = (status: number, message: string) => Response.json({ error: message }, { status });
const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

/** Stop reading before allocation can exceed the boundary, including chunked requests. */
async function limitedBody(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new Error("body limit");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maximum) throw new Error("body limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

async function signatureOk(key: string, signature: string, data: Uint8Array<ArrayBuffer>): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey("raw", unbase64(key), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", publicKey, unbase64(signature), data);
  } catch {
    return false;
  }
}

async function active(env: Env, id: string) {
  return env.META.prepare("SELECT comments_auth FROM snapshots WHERE id=? AND expires>? AND ready=1")
    .bind(id, Math.floor(Date.now() / 1000))
    .first<{ comments_auth: string }>();
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET" && url.pathname === "/health") return Response.json({ format: "mitori.snapshot/1" });
  const view = /^\/s\/([a-f0-9]{32})$/.exec(url.pathname);
  if (request.method === "GET" && view) {
    const snapshot = await env.META.prepare("SELECT viewer_hash FROM snapshots WHERE id=? AND ready=1 AND expires>?")
      .bind(view[1], Math.floor(Date.now() / 1000))
      .first<{ viewer_hash: string }>();
    if (!snapshot) return failure(404, "snapshot absent");
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(VIEWER_SCRIPT));
    const cspHash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return new Response(viewerHtml(view[1] as string, "", snapshot.viewer_hash).replace("__VIEWER_HASH__", cspHash), {
      headers: { "content-type": "text/html; charset=utf-8", ...noStore },
    });
  }
  if (request.method === "POST" && url.pathname === "/api/keys") {
    const body = JSON.parse(new TextDecoder().decode(await limitedBody(request, 1024))) as { key?: unknown; signature?: unknown };
    if (
      typeof body.key !== "string" ||
      !KEY.test(body.key) ||
      typeof body.signature !== "string" ||
      !(await signatureOk(body.key, body.signature, encoder.encode(`mitori.snapshot/1:register:${body.key}`)))
    )
      return failure(401, "invalid registration signature");
    await env.META.prepare("INSERT OR IGNORE INTO installs(key,created) SELECT ?,? WHERE (SELECT count(*) FROM installs)<10000")
      .bind(body.key, Math.floor(Date.now() / 1000))
      .run();
    return (await env.META.prepare("SELECT key FROM installs WHERE key=?").bind(body.key).first())
      ? Response.json({ registered: true })
      : failure(507, "install limit");
  }
  const match = /^\/api\/snapshots\/([a-f0-9]{32})(\/comments)?$/.exec(url.pathname);
  if (!match) return failure(404, "not found");
  const id = match[1] as string;
  if (!ID.test(id)) return failure(400, "invalid id");
  if (request.method === "PUT" && !match[2]) {
    const owner = request.headers.get("x-mitori-key") ?? "";
    const expires = Number(request.headers.get("x-mitori-expires"));
    const timestamp = Number(request.headers.get("x-mitori-timestamp"));
    const commentsAuth = request.headers.get("x-mitori-comments-auth") ?? "";
    const viewerHash = request.headers.get("x-mitori-viewer-hash") ?? "";
    if (!/^[A-Za-z0-9+/]{43}=$/.test(viewerHash)) return failure(400, "invalid viewer hash");
    const now = Math.floor(Date.now() / 1000);
    if (
      !KEY.test(owner) ||
      !HASH.test(commentsAuth) ||
      !Number.isSafeInteger(expires) ||
      expires <= now ||
      expires > now + MAX_TTL_SECONDS ||
      !Number.isSafeInteger(timestamp) ||
      Math.abs(timestamp - now) > 300
    )
      return failure(400, "invalid metadata");
    if (!(await env.META.prepare("SELECT key FROM installs WHERE key=?").bind(owner).first())) return failure(401, "unknown install");
    const bytes = await limitedBody(request, MAX_SNAPSHOT_BYTES);
    if (bytes.length < 28) return failure(400, "truncated ciphertext");
    const digest = await sha256(bytes);
    if (!(await signatureOk(owner, request.headers.get("x-mitori-signature") ?? "", signatureInput(id, digest, expires, commentsAuth, timestamp, viewerHash))))
      return failure(401, "invalid upload signature");
    try {
      await env.META.prepare("INSERT INTO snapshots(id,owner,bytes,expires,digest,comments_auth,viewer_hash) VALUES(?,?,?,?,?,?,?)")
        .bind(id, owner, bytes.length, expires, digest, commentsAuth, viewerHash)
        .run();
    } catch (error) {
      const text = String(error);
      if (text.includes("quota")) return failure(507, "snapshot quota");
      if (text.includes("UNIQUE")) return failure(409, "snapshot exists");
      throw error;
    }
    try {
      await env.SNAPSHOTS.put(`snapshots/${id}`, bytes, { customMetadata: { expires: String(expires), digest } });
      await env.META.prepare("UPDATE snapshots SET ready=1 WHERE id=?").bind(id).run();
    } catch (error) {
      await env.SNAPSHOTS.delete(`snapshots/${id}`);
      await env.META.prepare("DELETE FROM snapshots WHERE id=?").bind(id).run();
      throw error;
    }
    return Response.json({ id, expires, digest }, { status: 201 });
  }
  const snapshot = await active(env, id);
  if (!snapshot) return failure(404, "snapshot expired or absent");
  if (request.method === "GET" && !match[2]) {
    // Reserve each R2 read in D1 atomically; counters include failed reads and stay below R2's free allowance.
    const reservation = await env.META.prepare(
      "UPDATE usage SET reads=CASE WHEN read_month=strftime('%Y-%m','now') THEN reads+1 ELSE 1 END,read_month=strftime('%Y-%m','now') WHERE id=1 AND (read_month<>strftime('%Y-%m','now') OR reads<1000000)",
    ).run();
    if (reservation.meta.changes === 0) return failure(507, "monthly read quota");
    const object = await env.SNAPSHOTS.get(`snapshots/${id}`);
    return object ? new Response(object.body, { headers: { "content-type": "application/octet-stream", ...noStore } }) : failure(404, "snapshot absent");
  }
  if (request.method === "GET" && match[2]) {
    const result = await env.META.prepare("SELECT ciphertext,created FROM comments WHERE snapshot=? ORDER BY created,id LIMIT 100").bind(id).all();
    return Response.json(result.results, { headers: noStore });
  }
  if (request.method === "POST" && match[2]) {
    const capability = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    // Hashes have fixed length; Workers' constant-time primitive avoids comparing the capability itself.
    const supplied = await crypto.subtle.digest("SHA-256", encoder.encode(capability));
    const expected = Uint8Array.from(snapshot.comments_auth.match(/../g) ?? [], (s) => Number.parseInt(s, 16));
    if (!crypto.subtle.timingSafeEqual(supplied, expected)) return failure(401, "invalid comment capability");
    const body = JSON.parse(new TextDecoder().decode(await limitedBody(request, 23_000))) as { ciphertext?: unknown };
    if (typeof body.ciphertext !== "string") return failure(400, "invalid comment");
    const ciphertext = unbase64(body.ciphertext);
    if (ciphertext.length < 28 || ciphertext.length > 16_384) return failure(400, "comment limit");
    try {
      await env.META.prepare("INSERT INTO comments(id,snapshot,ciphertext,bytes,created) VALUES(?,?,?,?,?)")
        .bind(base64(crypto.getRandomValues(new Uint8Array(16))), id, body.ciphertext, ciphertext.length, Math.floor(Date.now() / 1000))
        .run();
    } catch (error) {
      if (String(error).includes("quota")) return failure(507, "comment quota");
      throw error;
    }
    return Response.json({ saved: true }, { status: 201 });
  }
  return failure(405, "method not allowed");
}

export default {
  async fetch(request, env) {
    try {
      const response = await handle(request, env);
      // Enables the CLI-pinned file:// viewer; content is ciphertext and comments are capability-protected.
      response.headers.set("access-control-allow-origin", "*");
      response.headers.set("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
      response.headers.set(
        "access-control-allow-headers",
        "authorization, content-type, x-mitori-key, x-mitori-expires, x-mitori-timestamp, x-mitori-comments-auth, x-mitori-signature, x-mitori-viewer-hash",
      );
      return response;
    } catch (error) {
      if (String(error).includes("body limit")) return failure(413, "body limit");
      if (error instanceof SyntaxError || String(error).includes("base64url")) return failure(400, "invalid body");
      console.error(JSON.stringify({ message: "share request failed", error: String(error).slice(0, 160) }));
      return failure(500, "share unavailable");
    }
  },
  async scheduled(_event, env) {
    const expired = await env.META.prepare("SELECT id FROM snapshots WHERE expires<=? LIMIT 1000")
      .bind(Math.floor(Date.now() / 1000))
      .all<{ id: string }>();
    for (const { id } of expired.results) {
      await env.SNAPSHOTS.delete(`snapshots/${id}`);
      await env.META.prepare("DELETE FROM snapshots WHERE id=?").bind(id).run();
    }
  },
} satisfies ExportedHandler<Env>;
