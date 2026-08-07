import { describe, expect, test, vi } from "vitest";
import { PiHost } from "../session/host.js";
import { createDefaultUsageRegistry, ProviderUsageRegistry } from "./index.js";
import type { AccountUsage, ProviderUsageAdapter } from "./types.js";

function makeFakeRuntime(provider = "deepseek") {
  return {
    cwd: "/tmp",
    session: {
      sessionId: "s1",
      cwd: "/tmp",
      thinkingLevel: "medium",
      isStreaming: false,
      messages: [],
      model: { provider, id: "model-1" },
      subscribe: () => () => undefined,
      getSessionStats: () => ({
        sessionFile: "/tmp/s.jsonl",
        sessionId: "s1",
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 1000, output: 200, cacheRead: 50, cacheWrite: 10, total: 1260 },
        cost: 0.42,
      }),
      getContextUsage: () => ({ tokens: 4000, contextWindow: 10000 }),
    },
    dispose: async () => undefined,
  };
}

describe("PiHost.getProviderUsage", () => {
  test("returns session stats without adapter as no_adapter", async () => {
    const registry = new ProviderUsageRegistry();
    const host = new PiHost({
      workspaceId: "w1",
      runtime: makeFakeRuntime("openai") as never,
      usageRegistry: registry,
    });
    const snap = await host.getProviderUsage();
    expect(snap.providerId).toBe("openai");
    expect(snap.session.inputTokens).toBe(1000);
    expect(snap.session.cost).toBe(0.42);
    expect(snap.account).toEqual({ mode: "unsupported", providerId: "openai", reason: "no_adapter" });
  });

  test("uses registered adapter and caches result", async () => {
    const fetchAccountUsage = vi.fn(async (): Promise<AccountUsage> => ({
      mode: "prepaid_balance",
      providerId: "deepseek",
      label: "DeepSeek",
      currency: "CNY",
      total: 12.5,
      isAvailable: true,
      fetchedAt: "2026-08-08T00:00:00.000Z",
    }));
    const adapter: ProviderUsageAdapter = {
      id: "deepseek",
      label: "DeepSeek",
      supports: () => true,
      fetchAccountUsage,
    };
    const registry = new ProviderUsageRegistry();
    registry.register(adapter);

    const host = new PiHost({
      workspaceId: "w1",
      runtime: makeFakeRuntime("deepseek") as never,
      usageRegistry: registry,
      usageCacheTtlMs: 60_000,
      authRuntimeFactory: async () =>
        ({
          listCredentials: async () => [{ providerId: "deepseek", type: "api_key" as const }],
          getProviderAuthStatus: () => ({ configured: true, source: "environment" }),
          getAuth: async () => ({ auth: { apiKey: "sk-x" } }),
        }) as never,
    });

    const first = await host.getProviderUsage();
    const second = await host.getProviderUsage();
    expect(first.account.mode).toBe("prepaid_balance");
    expect(second.account).toEqual(first.account);
    expect(fetchAccountUsage).toHaveBeenCalledTimes(1);

    await host.getProviderUsage({ force: true });
    expect(fetchAccountUsage).toHaveBeenCalledTimes(2);
  });

  test("default registry includes deepseek adapter", () => {
    expect(createDefaultUsageRegistry().list()).toContain("deepseek");
  });

  test("invalidateAccountUsageCache forces next fetch", async () => {
    const fetchAccountUsage = vi.fn(async (): Promise<AccountUsage> => ({
      mode: "prepaid_balance",
      providerId: "deepseek",
      label: "DeepSeek",
      currency: "CNY",
      total: 1,
      isAvailable: true,
      fetchedAt: "2026-08-08T00:00:00.000Z",
    }));
    const registry = new ProviderUsageRegistry();
    registry.register({
      id: "deepseek",
      label: "DeepSeek",
      supports: () => true,
      fetchAccountUsage,
    });
    const host = new PiHost({
      workspaceId: "w1",
      runtime: makeFakeRuntime("deepseek") as never,
      usageRegistry: registry,
      authRuntimeFactory: async () =>
        ({
          listCredentials: async () => [{ providerId: "deepseek", type: "api_key" as const }],
          getProviderAuthStatus: () => ({ configured: true }),
          getAuth: async () => ({ auth: { apiKey: "sk-x" } }),
        }) as never,
    });

    await host.getProviderUsage();
    await host.getProviderUsage();
    expect(fetchAccountUsage).toHaveBeenCalledTimes(1);

    host.invalidateAccountUsageCache("deepseek");
    await host.getProviderUsage();
    expect(fetchAccountUsage).toHaveBeenCalledTimes(2);
  });
});
