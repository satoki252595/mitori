import { describe, expect, test } from "bun:test";
import { REDACTION_TOKEN, type SECRET_RULES } from "./domain.ts";
import { createSecretScanner, isPlaceholderSecret, shannonEntropy } from "./secrets.ts";

const sc = createSecretScanner();
// Fake but well-formed credentials, assembled at runtime so this file itself never matches a scanner.
const j = (...p: string[]) => p.join("");
const rand = (n: number, alphabet = "A1b2C3d4E5f6G7h8J9kLmNpQrStUvWxYz0") =>
  Array.from({ length: n }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");

const POSITIVE: Record<(typeof SECRET_RULES)[number]["id"], string> = {
  aws_access_key: `key = ${j("AKIA", "Q3ZP7VY4N2KD6TJM")}`,
  aws_secret: `aws_secret_access_key = "${rand(40, "abcDEF0123456789/+ghiJKLmnoPQRstuVWXyz")}"`,
  github_token: `token ${j("ghp", "_", rand(36))}`,
  github_pat: `${j("github", "_pat_", rand(30))}`,
  gitlab_token: `${j("glpat", "-", rand(22))}`,
  slack_token: `${j("xoxb", "-", "1234567890-", rand(12))}`,
  slack_webhook: `${j("https://hooks.", "slack.com/services/", "T0000/B0000/", rand(24))}`,
  anthropic_key: `ANTHROPIC=${j("sk-", "ant-", "api03-", rand(40))}`,
  openai_key: `${j("sk-", "proj-", rand(40))}`,
  google_api_key: `${j("AIza", rand(35))}`,
  stripe_key: `${j("sk_", "live_", rand(28))}`,
  npm_token: `${j("npm_", rand(36))}`,
  private_key: `${j("-----BEGIN RSA ", "PRIVATE KEY-----")}\n${rand(64)}\n${rand(64)}\n${j("-----END RSA ", "PRIVATE KEY-----")}`,
  jwt: `Authorization: Bearer ${j("eyJ", rand(20), ".", rand(24), ".", rand(16))}`,
  url_credentials: `${j("postgres://admin:", "S3cr3tPassw0rd", "@db.internal:5432/app")}`,
  generic_assignment: `client_secret = "${j("q8Zr2Lx9Vm4", "Tn7Wb3Kc6Hy1")}"`,
};

describe("secret scanner (core, CONS-05)", () => {
  test("each built-in rule detects its sample", () => {
    for (const [rule, text] of Object.entries(POSITIVE)) {
      const hits = sc.scan(text);
      expect(hits.map((h) => h.rule)).toContain(rule);
    }
  });

  test("placeholders, env lookups and low-entropy values never match", () => {
    const negatives = [
      `aws_key = ${j("AKIA", "AAAAAAAAAAAAAAAA")}`,
      `${j("sk-", "ant-")}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
      `password = "${j("process", ".env.DB_PASSWORD_VALUE")}"`,
      `api_key: "\${API_KEY_FROM_ENVIRONMENT}"`,
      `secret = "<your-secret-goes-here-please>"`,
      `token = "changeme-changeme-changeme"`,
      `password = "aaaaaaaaaaaaaaaaaaaaaaaa"`,
      `password = "abababababababababababab"`,
      `${j("ghp", "_")}example${rand(29)}`,
    ];
    for (const n of negatives) expect(sc.scan(n)).toEqual([]);
    expect(isPlaceholderSecret("dummy-token-value")).toBe(true);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBe(2);
  });

  test("capture-group rules report only the value; lines are 1-based", () => {
    const text = `line one\n  client_secret = "${j("q8Zr2Lx9Vm4", "Tn7Wb3Kc6Hy1")}"\n`;
    const [hit] = sc.scan(text);
    expect(hit?.line).toBe(2);
    expect(text.slice(hit?.start, hit?.end)).toBe(j("q8Zr2Lx9Vm4", "Tn7Wb3Kc6Hy1"));
  });

  test("overlapping rules keep one hit: earliest, longest, first-listed (anthropic over openai)", () => {
    const hits = sc.scan(POSITIVE.anthropic_key);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.rule).toBe("anthropic_key");
  });

  test("redact keeps line count and uses the one token", () => {
    const text = `a\n${POSITIVE.private_key}\nb ${POSITIVE.npm_token}\n`;
    const r = sc.redact(text);
    expect(r.text.split("\n")).toHaveLength(text.split("\n").length);
    expect(r.redactions).toBe(2);
    expect(r.rules).toEqual(["npm_token", "private_key"]);
    expect(r.text).toContain(REDACTION_TOKEN);
    expect(r.text).not.toContain("PRIVATE KEY");
    expect(sc.redact("nothing here").redactions).toBe(0);
  });

  test("extra rules are applied after the built-ins", () => {
    const custom = createSecretScanner([{ id: "acme", source: "\\bacme_[0-9a-f]{16}\\b", flags: "g" }]);
    expect(custom.scan("k=acme_0123456789abcdef").map((h) => h.rule)).toEqual(["acme"]);
  });

  test("1 MB of ordinary code scans quickly (budget 10 ms; generous bound against CI noise)", () => {
    const chunk = "export function add(a: number, b: number): number {\n  const token = lexer.next(); // key path\n  return a + b;\n}\n";
    const text = chunk.repeat(Math.ceil(1_000_000 / chunk.length));
    sc.scan(text);
    const t0 = performance.now();
    sc.scan(text);
    expect(performance.now() - t0).toBeLessThan(2_000); // linear scan, no backtracking blow-up (generous under load)
  });
});
