import { DeepSeekBalanceAdapter } from "./adapters/deepseek.js";
import { ProviderUsageRegistry } from "./registry.js";

export type {
  AccountUsage,
  ProviderUsageAdapter,
  ProviderUsageContext,
  ProviderUsageSnapshot,
  SessionUsageDetail,
} from "./types.js";
export { ProviderUsageRegistry } from "./registry.js";
export { DeepSeekBalanceAdapter, pickBalanceInfo } from "./adapters/deepseek.js";

/** Default registry with built-in adapters. Add new providers via register(). */
export function createDefaultUsageRegistry(options?: { fetchFn?: typeof fetch }): ProviderUsageRegistry {
  const registry = new ProviderUsageRegistry();
  registry.register(new DeepSeekBalanceAdapter({ fetchFn: options?.fetchFn }));
  return registry;
}
