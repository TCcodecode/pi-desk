# Provider Usage（会话用量 + 可插拔账户额度）

**Date:** 2026-08-08  
**Status:** Implemented (v1)  
**Scope (v1):** 本会话 token/花费明细（全模型）+ DeepSeek 账户余额 + 可插拔 adapter 框架  
**Non-goals (v1):** Claude 订阅窗口、OpenAI/Anthropic 余额、用户本地月预算、跨 session 累计账本

---

## 1. Problem

Inspector 顶部 context 行今天显示：

- **% ctx** — 当前会话上下文窗口占用（`getContextUsage`）
- **$cost** — 本会话累计花费估算（`getSessionStats().cost`，token × 本地定价表）

用户真正想问的往往是：

1. 这个会话烧了多少 token / 钱？（已有数据，未展示）
2. 账户还剩多少额度？（provider 相关；API 预付 vs 订阅窗口完全不同）

Pi SDK **没有**统一的「剩余额度」API。各家能力差异大，必须做成 **按 provider 可插拔适配**，而不是在 UI 里写死 if/else。

---

## 2. Goals

1. **Context 条下方**展示本会话 usage 明细（全模型、本地数据，无网络）。
2. **v1 只实现 DeepSeek** 账户余额（官方 `GET /user/balance`）。
3. **Adapter 接口 + Registry**：后续每个 provider 只实现接口并注册，不改 UI 主路径。
4. **密钥永不进 renderer**：余额请求在 main 进程完成。
5. **拿不到就降级**：不显示假数字；`unsupported` 时默认隐藏账户行。

---

## 3. Billing modes（概念）

| Mode | 含义 | v1 |
|------|------|----|
| `session_only` | 只有本会话 token/$ | 所有 provider 的底线 |
| `prepaid_balance` | 预付余额（还剩多少钱） | DeepSeek |
| `quota_window` | 滚动窗口用量 %（订阅） | 预留类型，不实现 |
| `unsupported` | 无适配器 / 未配置 / 拉取失败 | 隐藏或短失败文案 |

**判定顺序（host）：**

```
session.provider
  → credential type (api_key | oauth | none)
  → Registry.find(providerId)
  → adapter.supports(ctx) ? adapter.fetch(ctx) : unsupported
```

不是「按模型名猜」，而是 **providerId + 凭证类型 + adapter 声明**。

---

## 4. Architecture

```
Renderer (ResourceInspector)
    │  getProviderUsage() / cached store field
    ▼
PiHost.getProviderUsage()
    │  build SessionUsageDetail from session stats (always)
    │  resolve CredentialContext (providerId, auth type, getApiKey)
    ▼
ProviderUsageRegistry
    │  pick adapter by providerId
    ▼
ProviderUsageAdapter (e.g. DeepSeekBalanceAdapter)
    │  network / parse
    ▼
AccountUsage (prepaid_balance | unsupported | …)
```

### 4.1 Pluggable adapter interface

放在 main 侧独立模块（建议 `electron/providerUsage/`），**不依赖 React**：

```ts
/** Context passed to adapters. Secrets stay in main. */
export interface ProviderUsageContext {
  providerId: string;
  /** From listCredentials / auth resolution. */
  credentialType?: "api_key" | "oauth";
  /** Resolved API key or bearer; undefined if not available. */
  getApiKey: () => Promise<string | undefined>;
  /** Optional abort for in-flight fetches. */
  signal?: AbortSignal;
}

export type AccountUsage =
  | {
      mode: "prepaid_balance";
      providerId: string;
      currency: string; // "CNY" | "USD" | …
      total: number;
      granted?: number;
      toppedUp?: number;
      isAvailable: boolean;
      fetchedAt: string; // ISO
      /** Short label for UI, e.g. "DeepSeek" */
      label?: string;
    }
  | {
      mode: "quota_window";
      providerId: string;
      label?: string;
      windows: Array<{
        id: string;
        label: string; // "5h" | "week"
        used: number;  // 0..1 or absolute — adapter documents unit
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

/**
 * One adapter per provider (or family). Implement only what the provider can do.
 * Return unsupported instead of throwing for expected "can't help" cases.
 */
export interface ProviderUsageAdapter {
  /** Stable id, usually equals Pi provider id (e.g. "deepseek"). */
  readonly id: string;
  /** Human label for UI. */
  readonly label: string;
  /** Whether this adapter should run for the current context. */
  supports(ctx: ProviderUsageContext): boolean;
  /** Fetch account-level usage. Must not log secrets. */
  fetchAccountUsage(ctx: ProviderUsageContext): Promise<AccountUsage>;
}
```

### 4.2 Registry

```ts
export class ProviderUsageRegistry {
  private adapters = new Map<string, ProviderUsageAdapter>();

  register(adapter: ProviderUsageAdapter): void;
  get(providerId: string): ProviderUsageAdapter | undefined;
  /** All registered ids (debug / settings later). */
  list(): string[];
}

// bootstrap
const registry = new ProviderUsageRegistry();
registry.register(new DeepSeekBalanceAdapter());
// later: registry.register(new AnthropicQuotaAdapter());
```

**扩展一个新 provider 的步骤：**

1. 新建 `electron/providerUsage/adapters/<id>.ts` 实现 `ProviderUsageAdapter`
2. 在 bootstrap `register(...)`
3. 加单元测试（mock fetch）
4. UI 无需改（已按 `AccountUsage.mode` 分支）

### 4.3 DeepSeek adapter (v1 only implementation)

- **Endpoint:** `GET https://api.deepseek.com/user/balance`
- **Auth:** `Authorization: Bearer <api_key>`
- **supports:** `providerId === "deepseek"` 且 `credentialType !== "oauth"`（DeepSeek 实际为 api_key / env）
- **Parse:** `balance_infos[]`；**优先 CNY**，否则第一条；字符串金额 `parseFloat`
- **Response fields:** `total_balance`, `granted_balance`, `topped_up_balance`, `is_available`
- **Errors:** 401/网络 → `unsupported` + `fetch_failed`；无 key → `not_configured`
- **Timeout:** 8s
- **Cache:** host 层按 `providerId` 缓存成功结果 **60s**（失败不长期缓存，可 10s 防抖）

### 4.4 Session usage（非 adapter，本地）

始终由 `PiHost` 从现有 session 字段组装，**不走 adapter**：

```ts
export interface SessionUsageDetail {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number; // USD estimate from Pi pricing tables
  contextTokens: number;
  contextWindow: number;
}

export interface ProviderUsageSnapshot {
  providerId: string;
  session: SessionUsageDetail;
  account: AccountUsage;
}
```

Session 行与账户行解耦：即使 balance 拉取失败，session 明细仍显示。

---

## 5. IPC / Protocol

在 `src/shared/protocol.ts` 增加类型与 API：

```ts
getProviderUsage(options?: { force?: boolean }): Promise<ProviderUsageSnapshot>;
```

- `force: true` 跳过 balance 缓存（手动刷新）
- **不**把 balance 塞进每次 `snapshot()`，避免 stream 事件打爆远端 API
- Preload / main IPC：`pi:getProviderUsage`

密钥解析路径（main only）：

1. 优先 `ModelRuntime.getApiKeyForProvider(providerId)`（若可用）
2. 否则 `readStoredCredential` / env（与 Settings 登录路径一致）
3. 解析失败 → `not_configured`

---

## 6. UI

### 6.1 Placement

Inspector 顶部，现有 context bar **正下方**：

```
[████░░░░] 40% ctx                    $1.25
in 8.1k · out 1.2k · cache 3.1k
DeepSeek · ¥110.00 left
```

| 行 | 内容 | 条件 |
|----|------|------|
| 1 | context % + session $ | 始终（现状） |
| 2 | `in · out · cache` | 始终（有 token 或 cost 时；全 0 可显示 `no usage yet`） |
| 3 | 账户余额 | 仅 `mode === "prepaid_balance"` |

### 6.2 Formatting

- Token：`formatTokens(n)` → `<1000` 原样，否则一位小数 `k`（如 `8.1k`）
- Cache：合计 `cacheRead + cacheWrite`；`title` 悬停 `r/w` 分拆
- Session $：沿用 `$x.xx`，`title="session cost (estimate)"`
- 余额：CNY → `¥`，USD → `$`，其他 → `CODE amount`；后缀 `left`
- `fetch_failed`：一行 muted `balance unavailable`（可点刷新）；`no_adapter` / `oauth` / `not_configured`：**不渲染第 3 行**

### 6.3 Refresh triggers

| 事件 | Session 行 | Account 行 |
|------|------------|------------|
| snapshot / stream 更新 | 用 store 内 session 字段即时更新 | 不请求 |
| session / provider / model 切换 | 更新 | `getProviderUsage()`（走缓存） |
| Inspector 首次可见 | — | 拉取（若 provider 有 adapter） |
| 对话结束（`running` → 非 running / turn_end） | 更新 | `force: true` + host 清缓存 |
| 用户点击余额行 | — | `force: true` |

---

## 7. File layout

```
electron/providerUsage/
  types.ts              # ProviderUsageContext, AccountUsage, adapter iface
  registry.ts           # ProviderUsageRegistry
  format.ts             # optional shared formatters if used by main tests
  adapters/
    deepseek.ts         # DeepSeekBalanceAdapter
  index.ts              # createDefaultUsageRegistry()
electron/piHost.ts      # getProviderUsage wires session + registry
src/shared/protocol.ts  # snapshot types + PiApi method
src/renderer/components/ResourceInspector.tsx  # Usage under context bar
src/renderer/state/…    # optional providerUsage in store
```

---

## 8. Testing

| Layer | Cases |
|-------|--------|
| DeepSeek adapter | 成功 CNY、仅 USD、空数组、401、timeout、无 key → supports false / not_configured |
| Registry | register / get / unknown provider |
| PiHost.getProviderUsage | session 字段映射；cache hit/miss；force refresh |
| UI | session 行格式；有余额 / 无 adapter / fail 三种；密钥不出现在 DOM |

---

## 9. Security

- Adapter 与 `getProviderUsage` 仅 main 进程
- 禁止在 log / event / snapshot 中写入 API key
- Renderer 只收 `AccountUsage` 数字与 reason 枚举
- 余额请求使用系统/electron net，超时与 abort

---

## 10. Rollout

### v1 (this spec)

- [x] Adapter 接口 + Registry
- [x] DeepSeekBalanceAdapter
- [x] `getProviderUsage` IPC
- [x] Inspector session 明细 + DeepSeek 余额行
- [x] 测试

### Later (out of scope but designed for)

- Anthropic/OpenAI/OpenRouter adapters（实现同一接口）
- `quota_window` UI（多 window 进度条）
- Settings 里「Usage providers」调试列表
- 用户本地 monthly budget soft-cap

---

## 11. Open decisions (resolved for v1)

| Topic | Decision |
|-------|----------|
| 余额货币 | 优先 **USD**（与 Pi 会话 cost 同为 USD），否则 CNY，否则第一条；session cost 始终按 USD 显示 |
| unsupported | 默认 **隐藏** 账户行 |
| 先做谁 | **DeepSeek only**；框架一次铺好 |
| Session $ vs 余额 | 顶栏 $ = session；余额单独一行 `left` |

---

## 12. Success criteria

1. 任意 provider：context 下可见 `in/out/cache` 本会话明细。
2. DeepSeek 已配置 API key：显示 `DeepSeek · ¥xx.xx left`（或 USD）。
3. 非 DeepSeek：无账户行，无报错噪音。
4. 新增 provider 只需新 adapter 文件 + `register` + 测试，不改 Inspector 分支逻辑。
5. 全套单测通过；DOM/日志无密钥。
