/** 認証 のトークン。識別子が ASCII ではない。 */
export const 認証 = "token";

export function 検証(value: string): boolean {
  return value === 認証;
}
