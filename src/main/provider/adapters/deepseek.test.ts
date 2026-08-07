import { describe, expect, test, vi } from "vitest";
import { DeepSeekBalanceAdapter, pickBalanceInfo } from "./deepseek.js";
import type { ProviderUsageContext } from "../types.js";

function ctx(overrides: Partial<ProviderUsageContext> = {}): ProviderUsageContext {
  return {
    providerId: "deepseek",
    credentialType: "api_key",
    getApiKey: async () => "sk-test",
    ...overrides,
  };
}

describe("pickBalanceInfo", () => {
  test("prefers USD when present (matches session cost currency)", () => {
    const picked = pickBalanceInfo([
      { currency: "CNY", total_balance: "110.00" },
      { currency: "USD", total_balance: "10.00" },
    ]);
    expect(picked?.currency).toBe("USD");
    expect(picked?.total_balance).toBe("10.00");
  });

  test("falls back to CNY when USD missing", () => {
    const picked = pickBalanceInfo([{ currency: "CNY", total_balance: "5.5" }]);
    expect(picked?.currency).toBe("CNY");
  });
});

describe("DeepSeekBalanceAdapter", () => {
  test("supports only deepseek non-oauth", () => {
    const adapter = new DeepSeekBalanceAdapter();
    expect(adapter.supports(ctx())).toBe(true);
    expect(adapter.supports(ctx({ providerId: "openai" }))).toBe(false);
    expect(adapter.supports(ctx({ credentialType: "oauth" }))).toBe(false);
  });

  test("returns not_configured without api key", async () => {
    const adapter = new DeepSeekBalanceAdapter({ fetchFn: vi.fn() as unknown as typeof fetch });
    const result = await adapter.fetchAccountUsage(ctx({ getApiKey: async () => undefined }));
    expect(result).toEqual({ mode: "unsupported", providerId: "deepseek", reason: "not_configured" });
  });

  test("parses successful balance response", async () => {
    const fetchFn = vi.fn(async (_input: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [
            { currency: "USD", total_balance: "1.00", granted_balance: "0", topped_up_balance: "1.00" },
            { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const adapter = new DeepSeekBalanceAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.fetchAccountUsage(ctx());
    expect(result.mode).toBe("prepaid_balance");
    if (result.mode !== "prepaid_balance") return;
    // USD preferred over CNY so unit matches session $ estimate
    expect(result.currency).toBe("USD");
    expect(result.total).toBe(1);
    expect(result.granted).toBe(0);
    expect(result.toppedUp).toBe(1);
    expect(result.isAvailable).toBe(true);
    expect(result.label).toBe("DeepSeek");
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/user/balance");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  test("maps HTTP errors to fetch_failed", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 }));
    const adapter = new DeepSeekBalanceAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.fetchAccountUsage(ctx());
    expect(result).toMatchObject({ mode: "unsupported", reason: "fetch_failed", message: "HTTP 401" });
  });

  test("maps network errors to fetch_failed without leaking secrets", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED sk-test-secret");
    });
    const adapter = new DeepSeekBalanceAdapter({ fetchFn: fetchFn as unknown as typeof fetch });
    const result = await adapter.fetchAccountUsage(ctx());
    expect(result.mode).toBe("unsupported");
    if (result.mode !== "unsupported") return;
    expect(result.reason).toBe("fetch_failed");
    expect(result.message).toBe("request failed");
    expect(JSON.stringify(result)).not.toContain("sk-test");
  });
});
