// Legacy export endpoint kept for the 2023 desktop client; new code goes through routes.ts.
import { readFileSync } from "node:fs";
import express from "express";

const SAMPLE = new URL("../../data/isbn-sample.json", import.meta.url);

/** Express router with the single legacy route. */
export function legacyRouter() {
  const router = express.Router();

  router.get("/legacy/export", (_req, res) => {
    res.type("application/json").send(readFileSync(SAMPLE, "utf8"));
  });

  return router;
}
