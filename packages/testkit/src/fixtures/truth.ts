import { existsSync, readFileSync } from "node:fs";
import { MitoriError } from "@mitori/core";
import { type FixtureName, type FixtureTruth, TEST_FORMATS } from "../contract.ts";
import { truthFile } from "./spec.ts";

/** Read `fixtures/truth/<name>.json` (CR m0-8: truth lives beside, not inside, the fixture tree). */
export function readTruth(name: FixtureName): FixtureTruth {
  const file = truthFile(name);
  if (!existsSync(file)) throw new MitoriError("E_NOT_FOUND", `no truth for fixture "${name}" (${file})`);
  const truth = JSON.parse(readFileSync(file, "utf8")) as FixtureTruth;
  if (truth.v !== TEST_FORMATS.fixtureTruth || truth.fixture !== name) {
    throw new MitoriError("E_FORMAT_INVALID", `${file}: expected {"v":"${TEST_FORMATS.fixtureTruth}","fixture":"${name}"}`);
  }
  return truth;
}
