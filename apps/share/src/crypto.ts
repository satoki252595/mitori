/** Browser/CLI shared cryptography, ADR-0016. Only opaque ciphertext crosses the API. */
export const SNAPSHOT_FORMAT = "mitori.snapshot/1";
export const MAX_SNAPSHOT_BYTES = 5_000_000;
export const MAX_TTL_SECONDS = 30 * 86_400;
const encoder = new TextEncoder();

export function base64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function unbase64(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error("invalid base64url");
  const raw = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function sha256(bytes: BufferSource): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function encrypt(text: string, key: Uint8Array<ArrayBuffer>, id: string, comment = false): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(`${SNAPSHOT_FORMAT}:${id}${comment ? ":comment" : ""}`) },
      aes,
      encoder.encode(text),
    ),
  );
  const result = new Uint8Array(nonce.length + encrypted.length);
  result.set(nonce);
  result.set(encrypted, nonce.length);
  return result;
}

export async function decrypt(bytes: Uint8Array<ArrayBuffer>, key: Uint8Array<ArrayBuffer>, id: string, comment = false): Promise<string> {
  if (bytes.length < 28) throw new Error("truncated ciphertext");
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(`${SNAPSHOT_FORMAT}:${id}${comment ? ":comment" : ""}`) },
    aes,
    bytes.slice(12),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

export function signatureInput(id: string, digest: string, expires: number, commentsAuth: string, timestamp: number, viewerHash = ""): Uint8Array<ArrayBuffer> {
  return encoder.encode([SNAPSHOT_FORMAT, id, digest, expires, commentsAuth, timestamp, viewerHash].join("\n"));
}
