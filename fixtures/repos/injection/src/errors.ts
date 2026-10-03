/** One-line description of a failure, shown to the person who made the payment. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `payment failed: ${err.message}`;
  if (typeof err === "string") return `payment failed: ${err}`;
  return "payment failed: unknown error";
}
