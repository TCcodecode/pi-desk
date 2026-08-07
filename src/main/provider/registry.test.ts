import { describe, expect, test } from "vitest";
import { createDefaultUsageRegistry, ProviderUsageRegistry } from "./index.js";
import type { AccountUsage, ProviderUsageAdapter, ProviderUsageContext } from "./types.js";

describe("ProviderUsageRegistry", () => {
  test("register and get by id", () => {
    const registry = new ProviderUsageRegistry();
    const adapter: ProviderUsageAdapter = {
      id: "demo",
      label: "Demo",
      supports: () => true,
      fetchAccountUsage: async (): Promise<AccountUsage> => ({
        mode: "unsupported",
        providerId: "demo",
        reason: "skipped",
      }),
    };
    registry.register(adapter);
    expect(registry.get("demo")).toBe(adapter);
    expect(registry.list()).toEqual(["demo"]);
    expect(registry.get("missing")).toBeUndefined();
  });

  test("default registry includes deepseek", () => {
    const registry = createDefaultUsageRegistry();
    expect(registry.list()).toContain("deepseek");
    const adapter = registry.get("deepseek")!;
    const ctx: ProviderUsageContext = {
      providerId: "deepseek",
      credentialType: "api_key",
      getApiKey: async () => undefined,
    };
    expect(adapter.supports(ctx)).toBe(true);
  });
});
