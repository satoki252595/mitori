/** Reactive registry over the same DOM-free keyboard controller used by the initial native UI. */
import { KeysController } from "../shell/keys-controller.ts";

export type { KeyContext } from "../shell/keys-controller.ts";
export { isEditable } from "../shell/keys-controller.ts";
export class KeysStore extends KeysController {
  override pendingPrefix = $state<string | null>(null);
  protected override revision = $state(0);
}
