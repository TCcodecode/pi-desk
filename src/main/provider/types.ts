/**
 * Pluggable provider account-usage adapters (main process only).
 * Session token/cost is assembled by PiHost; adapters only fetch account-level data.
 */

export interface ProviderUsageContext {
  providerId: string;
  credentialType?: "api_key" | "oauth";
  /** Resolve API key / bearer without exposing it to the renderer. */
  getApiKey: () => Promise<string | undefined>;
  signal?: AbortSignal;
}

export type AccountUsage =
  | {
      mode: "prepaid_balance";
      providerId: string;
      currency: string;
      total: number;
      granted?: number;
      toppedUp?: number;
      isAvailable: boolean;
      fetchedAt: string;
      label?: string;
    }
  | {
      mode: "quota_window";
      providerId: string;
      label?: string;
      windows: Array<{
        id: string;
        label: string;
        used: number;
        limit: number;
        unit: "ratio" | "tokens" | "requests";
        resetsAt?: string;
      }>;
      fetchedAt: string;
    }
  | {
      mode: "unsupported";
      providerId: string;
      reason: "no_adapter" | "not_configured" | "oauth" | "fetch_failed" | "skipped";
      message?: string;
    };

export interface ProviderUsageAdapter {
  readonly id: string;
  readonly label: string;
  supports(ctx: ProviderUsageContext): boolean;
  fetchAccountUsage(ctx: ProviderUsageContext): Promise<AccountUsage>;
}

export interface SessionUsageDetail {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  contextTokens: number;
  contextWindow: number;
}

export interface ProviderUsageSnapshot {
  providerId: string;
  session: SessionUsageDetail;
  account: AccountUsage;
}
