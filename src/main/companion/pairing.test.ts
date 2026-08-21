import { describe, expect, test } from "vitest";
import { mintCompanionToken, tokenFromRequestUrl, tokensEqual } from "./pairing.js";

describe("companion pairing", () => {
  test("mints a URL-safe token long enough to not guess", () => {
    const token = mintCompanionToken();
    expect(token.length).toBeGreaterThanOrEqual(24);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(mintCompanionToken()).not.toBe(token);
  });

  test("compares tokens in a length-safe way", () => {
    const token = mintCompanionToken();
    expect(tokensEqual(token, token)).toBe(true);
    expect(tokensEqual(token, `${token}x`)).toBe(false);
    expect(tokensEqual(token, "nope")).toBe(false);
  });

  test("reads t or token from a request URL", () => {
    expect(tokenFromRequestUrl("/ws?token=abc")).toBe("abc");
    expect(tokenFromRequestUrl("http://192.168.1.9:17890/?t=xyz")).toBe("xyz");
    expect(tokenFromRequestUrl("/ws")).toBeUndefined();
  });
});
