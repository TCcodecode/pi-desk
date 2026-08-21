import { randomBytes, timingSafeEqual } from "node:crypto";

export function mintCompanionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tokenFromRequestUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, "http://companion.local");
    return parsed.searchParams.get("t") ?? parsed.searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}
