import { ID_ALPHABET, type Random } from "@mitori/core";

/** 8 characters of `ID_ALPHABET` (32 symbols, so a byte maps without bias) for the DATA fence. */
export function drawNonce(random: Random): string {
  let out = "";
  for (const b of random.bytes(8)) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}
