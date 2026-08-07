import type { ProviderUsageAdapter } from "./types.js";

export class ProviderUsageRegistry {
  private readonly adapters = new Map<string, ProviderUsageAdapter>();

  register(adapter: ProviderUsageAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): ProviderUsageAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }
}
