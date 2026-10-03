// Child used by the Spawner tests: writes tricky byte sequences in separate chunks.
const enc = new TextEncoder();
const out = Bun.stdout.writer();
const chunks: Uint8Array[] = [
  enc.encode("crlf\r\nplain\n"),
  // "日本" split inside the first character's 3-byte sequence
  enc.encode("日本").subarray(0, 2),
  enc.encode("日本").subarray(2),
  enc.encode("\n"),
  enc.encode(`${"x".repeat(1024 * 1024)}\n`),
  enc.encode("no-newline-at-end"),
];
for (const c of chunks) {
  out.write(c);
  await out.flush();
  await Bun.sleep(5);
}
await out.end();
