export interface Account {
  id: string;
  name: string | null;
  email: string;
}

/** The name shown next to a payment; an account may be missing or may have no name. */
export function displayName(account: Account | null | undefined): string {
  if (!account) return "(unknown)";
  return account.name?.trim() || account.email;
}
