/** prompts.lock.json computation (AC-40): version → sha256 of the template bytes. */
import type { Hasher } from "@mitori/core";
import { GEN_PROMPTS, GEN_SYSTEM_VERSIONS, type GenPromptId, type PromptAddendumId, type SystemPromptId } from "../contract.ts";
import {
  ADDENDUM_TEMPLATES,
  LANG_TEXT,
  MAX_QUESTIONS,
  OVERVIEW_MODE_SENTENCES,
  RETRY_PREVIOUS_CLAUSE,
  SIMPLIFY_SENTENCE_MAX,
  SYSTEM_TEMPLATES,
  UNIT_TEMPLATES,
} from "./templates.ts";

/** Current lock content (sorted keys). Shared fragments are hashed into every template that uses them. */
export function computePromptLock(hasher: Hasher): Record<string, string> {
  const shared = JSON.stringify({ LANG_TEXT, OVERVIEW_MODE_SENTENCES, RETRY_PREVIOUS_CLAUSE });
  // fragments only the M4 prompts use are hashed into those prompts alone (the M2 lock entries stay valid)
  const m4 = JSON.stringify({ SIMPLIFY_SENTENCE_MAX, MAX_QUESTIONS });
  const out: Record<string, string> = {};
  for (const id of Object.keys(SYSTEM_TEMPLATES) as SystemPromptId[]) out[GEN_SYSTEM_VERSIONS[id]] = hasher.sha256(`${SYSTEM_TEMPLATES[id]}\n${shared}`);
  for (const id of Object.keys(ADDENDUM_TEMPLATES) as PromptAddendumId[]) out[GEN_SYSTEM_VERSIONS[id]] = hasher.sha256(`${ADDENDUM_TEMPLATES[id]}\n${shared}`);
  for (const id of Object.keys(UNIT_TEMPLATES) as GenPromptId[]) {
    const extra = id === "doc.simplify" || id === "gen.questions" ? `\n${m4}` : "";
    out[GEN_PROMPTS[id].version] = hasher.sha256(`${UNIT_TEMPLATES[id] ?? ""}\n${shared}${extra}`);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
