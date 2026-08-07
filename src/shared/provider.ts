/** Provider credential status for Settings → Providers (Pi /login /logout). */
export type ProviderAuthSource = "stored" | "environment" | "runtime" | "none";

export interface ProviderAuthStatus {
  id: string;
  name: string;
  configured: boolean;
  /** Where auth is coming from when configured. */
  source: ProviderAuthSource;
  /** Human label e.g. DEEPSEEK_API_KEY or "stored credential". */
  sourceLabel?: string;
  hasApiKeyLogin: boolean;
  hasOAuthLogin: boolean;
  /** True when a credential is stored in auth.json (logout can remove it). */
  canLogout: boolean;
  credentialType?: "api_key" | "oauth";
}

/** Local session token/cost breakdown (from Pi session stats). */
export interface SessionUsageDetail {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  contextTokens: number;
  contextWindow: number;
}

/**
 * Account-level usage from a provider adapter (balance, quota windows, …).
 * Secrets never appear in this payload.
 */
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

export interface ProviderUsageSnapshot {
  providerId: string;
  session: SessionUsageDetail;
  account: AccountUsage;
}

/**
 * Interactive prompt surfaced during an account (OAuth) login, mirroring Pi's
 * AuthPrompt. `promptId` lets the renderer answer via answerAuthPrompt.
 */
export interface ProviderLoginPrompt {
  promptId: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: Array<{ id: string; label: string; description?: string }>;
}

/**
 * Progress event emitted during an account login. Mirrors Pi's AuthEvent plus
 * terminal `done`/`error` states and the prompt event the renderer must answer.
 */
export type ProviderLoginEvent =
  | { type: "prompt"; prompt: ProviderLoginPrompt }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: "info"; message: string; links?: Array<{ url: string; label?: string }> }
  | { type: "progress"; message: string }
  | { type: "done"; name: string }
  | { type: "error"; message: string };

/** Renderer-side view of an in-flight (or just-finished) account login. */
export interface ProviderLoginState {
  status: "running" | "done" | "error";
  events: ProviderLoginEvent[];
}
