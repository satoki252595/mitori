import { expect, test } from "bun:test";
import { CatFileBatch } from "./catfile.ts";

test("Git 2.43 promisor exit marks only the named object missing and restarts on demand", async () => {
  const oid = "a".repeat(40);
  const other = "b".repeat(40);
  const script = `await Bun.stdin.stream().getReader().read(); console.error("fatal: could not fetch ${oid} from promisor remote"); process.exit(128);`;
  const batch = new CatFileBatch([process.execPath, "-e", script], process.cwd(), { PATH: process.env.PATH ?? "/usr/bin:/bin" });
  try {
    const requests = await Promise.allSettled([batch.get(oid), batch.get(other)]);
    expect(requests[0]).toEqual({ status: "fulfilled", value: null });
    expect(requests[1]?.status).toBe("rejected");
    if (requests[1]?.status === "rejected") expect(requests[1].reason.code).toBe("E_GIT_FAILED");
    expect(await batch.get(oid)).toBeNull();
  } finally {
    batch.close();
  }
});
