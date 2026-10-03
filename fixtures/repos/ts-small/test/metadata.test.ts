import { expect, test } from "bun:test";
import { fetchMetadata, MAX_RETRIES } from "../src/services/metadata.ts";

const ok = (isbn: string) =>
  new Response(JSON.stringify({ [`ISBN:${isbn}`]: { title: "Kokoro", authors: [{ name: "Natsume Soseki" }], number_of_pages: 248 } }));

test("fetchMetadata retries exactly once", async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls <= MAX_RETRIES) throw new Error("connection reset");
    return ok("9784101010137");
  };
  const meta = await fetchMetadata("978-4-10-101013-7", flaky);
  expect(meta.title).toBe("Kokoro");
  expect(calls).toBe(2);

  calls = 0;
  const down = async () => {
    calls++;
    throw new Error("down");
  };
  await expect(fetchMetadata("9784101010137", down)).rejects.toThrow("down");
  expect(calls).toBe(MAX_RETRIES + 1);
});
