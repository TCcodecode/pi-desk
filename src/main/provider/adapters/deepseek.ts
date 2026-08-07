import type { AccountUsage, ProviderUsageAdapter, ProviderUsageContext } from "../types.js";

export interface DeepSeekBalanceAdapterOptions {
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Request timeout in ms. */
  timeoutMs?: number;
  baseUrl?: string;
}

interface DeepSeekBalanceInfo {
  currency?: string;
  total_balance?: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: DeepSeekBalanceInfo[];
}

function parseAmount(value: string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Prefer USD when present so account balance matches Pi session cost (always USD).
 * Fall back to CNY, then first usable entry.
 */
export function pickBalanceInfo(infos: DeepSeekBalanceInfo[]): DeepSeekBalanceInfo | undefined {
  if (!infos.length) return undefined;
  const usable = (code: string) =>
    infos.find((info) => (info.currency ?? "").toUpperCase() === code && parseAmount(info.total_balance) != null);
  return usable("USD") ?? usable("CNY") ?? infos.find((info) => parseAmount(info.total_balance) != null) ?? infos[0];
}

export class DeepSeekBalanceAdapter implements ProviderUsageAdapter {
  readonly id = "deepseek";
  readonly label = "DeepSeek";

  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: DeepSeekBalanceAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.baseUrl = options.baseUrl ?? "https://api.deepseek.com";
  }

  supports(ctx: ProviderUsageContext): boolean {
    if (ctx.providerId !== "deepseek") return false;
    if (ctx.credentialType === "oauth") return false;
    return true;
  }

  async fetchAccountUsage(ctx: ProviderUsageContext): Promise<AccountUsage> {
    if (!this.supports(ctx)) {
      return {
        mode: "unsupported",
        providerId: ctx.providerId,
        reason: ctx.credentialType === "oauth" ? "oauth" : "skipped",
      };
    }

    let apiKey: string | undefined;
    try {
      apiKey = await ctx.getApiKey();
    } catch {
      return { mode: "unsupported", providerId: this.id, reason: "fetch_failed", message: "auth resolve failed" };
    }
    if (!apiKey?.trim()) {
      return { mode: "unsupported", providerId: this.id, reason: "not_configured" };
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(`${this.baseUrl}/user/balance`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          mode: "unsupported",
          providerId: this.id,
          reason: "fetch_failed",
          message: `HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as DeepSeekBalanceResponse;
      const info = pickBalanceInfo(body.balance_infos ?? []);
      const total = parseAmount(info?.total_balance);
      if (!info || total == null) {
        return {
          mode: "unsupported",
          providerId: this.id,
          reason: "fetch_failed",
          message: "empty balance",
        };
      }

      return {
        mode: "prepaid_balance",
        providerId: this.id,
        label: this.label,
        currency: (info.currency ?? "CNY").toUpperCase(),
        total,
        granted: parseAmount(info.granted_balance),
        toppedUp: parseAmount(info.topped_up_balance),
        isAvailable: body.is_available !== false,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      return {
        mode: "unsupported",
        providerId: this.id,
        reason: "fetch_failed",
        message: message.includes("abort") ? "timeout" : "request failed",
      };
    } finally {
      clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  }
}
