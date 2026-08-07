# Pi Capability Completion 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 pi-desktop GUI 从"架构完整但完成度低"提升到"UI 全部接线 + 命令补齐 + 事件补齐 + Project Trust + diagnostics 透传"，对齐差距文档 `specs/2026-08-06-pi-capability-gap.md`。

**Architecture:** 不改动 PiHost 的 SDK 对接方式（runtime API 是最强项）。本计划聚焦三层：(1) renderer 把 22 个 PiApi 全部接上真实数据；(2) PiHost.executeCommand 补齐 throw 的命令；(3) PiHost 订阅缺失的 SDK 事件并透传 diagnostics。Project Trust 作为独立 task。

**Tech Stack:** Electron, React, TypeScript, Zustand, Vitest, `@earendil-works/pi-coding-agent`。

---

## 现状基线（执行前确认）

```bash
npm test -- --run   # 全量测试
npm run typecheck
```

预期：当前全部通过（基线绿）。

---

### Task 1: Renderer 接入真实 Session 数据（App.tsx 用 SessionSidebar + 状态）

当前 `App.tsx` 内联了硬编码 `sessions` 数组（第 8-12 行），完全没用 `state.sessions`。修复：删除硬编码，用 `SessionSidebar` 组件渲染真实数据。

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `src/renderer/smoke.test.tsx`（改）

- [ ] **Step 1: 写失败测试——App 渲染 SessionSidebar 并显示 store 中的真实 sessions**

在 `src/renderer/smoke.test.tsx` 增加：

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { useAppStore } from "./state/appStore";
import { vi } from "vitest";

vi.mock("./state/piApi", () => ({
  getPiApi: () => undefined,
}));

test("renders real sessions from the store", () => {
  useAppStore.setState({ sessions: [{ sessionId: "s1", cwd: "/tmp/x", name: "Real session", status: "idle", model: "auto", thinkingLevel: "medium", messageCount: 3, updatedAt: new Date().toISOString() }] });
  render(<App />);
  expect(screen.getByText("Real session")).toBeInTheDocument();
  expect(screen.queryByText("Release audit")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/renderer/smoke.test.tsx`
Expected: FAIL（App 渲染硬编码 sessions，"Release audit" 存在、store 的 "Real session" 不存在）

- [ ] **Step 3: 实现——App.tsx 用 SessionSidebar 替换硬编码 sidebar**

修改 `src/renderer/App.tsx`：

```tsx
import { useEffect } from "react";
import { Composer, type ComposerMode } from "./components/Composer";
import { Timeline } from "./components/Timeline";
import { ResourceInspector } from "./components/ResourceInspector";
import { SessionSidebar } from "./components/SessionSidebar";
import { getPiApi } from "./state/piApi";
import { useAppStore } from "./state/appStore";

export function App() {
  const state = useAppStore();
  const api = getPiApi();

  useEffect(() => {
    if (!api) return;
    let active = true;
    const unsubscribe = api.onEvent((event) => useAppStore.getState().applyEvent(event));
    void api.getSnapshot().then((snapshot) => {
      if (active) useAppStore.getState().replaceSnapshot(snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const chooseWorkspace = async () => {
    const cwd = await api?.chooseWorkspace();
    if (cwd) await api?.startSession({ cwd });
  };

  const submit = async (text: string, mode: ComposerMode) => {
    if (!api) return;
    if (mode === "steer") await api.steer(text);
    else if (mode === "followUp") await api.followUp(text);
    else await api.prompt(text);
  };

  return (
    <main className="app-shell">
      <SessionSidebar
        cwd={state.session.cwd}
        sessions={state.sessions}
        activeSessionId={state.session.sessionId}
        onChooseWorkspace={() => void chooseWorkspace()}
        onNewSession={() => void api?.newSession()}
        onSelectSession={(sessionPath) => void api?.resumeSession(sessionPath)}
      />

      <section className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>{state.session.cwd ? state.session.cwd.split("/").pop() : "pi-parity-gui"}</span><span className="muted-separator">/</span><span className="muted">{state.session.name}</span></div>
          <div className="topbar-actions">
            <button className="topbar-button">⌘</button>
            <button className="topbar-button">?</button>
            <div className="avatar">TC</div>
          </div>
        </header>

        <div className="timeline-wrap">
          {state.timeline.length > 0 ? <Timeline items={state.timeline} /> : <><div className="welcome-block">
            <div className="welcome-orb">π</div>
            <p className="eyebrow">PI INTERACTIVE</p>
            <h1>What are we building today?</h1>
            <p className="welcome-copy">A clear window into Pi&apos;s real session, tools, context, and decisions.</p>
          </div>

          <div className="quick-actions">
            <button><span>⌁</span><strong>Explore a codebase</strong><small>Understand the architecture</small></button>
            <button><span>✣</span><strong>Make a change</strong><small>Edit, test, and review</small></button>
            <button><span>⌘</span><strong>Run a command</strong><small>Inspect output safely</small></button>
          </div></>}
        </div>

        <Composer onSubmit={submit} onAbort={() => void api?.abort()} isRunning={state.session.status === "running"} queue={state.queue} />
      </section>

      <ResourceInspector
        session={state.session}
        resources={state.resources}
        diagnostics={state.diagnostics}
        models={state.models ?? []}
        tools={state.tools ?? []}
        diffFiles={Object.values(state.diffFiles)}
        approvals={Object.values(state.approvals)}
        onModelSelect={(model) => void api?.setModel(model)}
        onThinkingLevel={(level) => void api?.setThinkingLevel(level)}
        onResolveApproval={(id, decision) => void api?.resolveApproval(id, decision)}
        onOpenSettings={() => undefined}
        onOpenTree={() => undefined}
      />
    </main>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run src/renderer/smoke.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx src/renderer/smoke.test.tsx
git commit -m "feat: wire real session data into app shell"
```

---

### Task 2: PiSnapshot 增加 models/tools 字段，PiHost.snapshot 填充

当前 `PiSnapshot` 没有 `models`/`tools` 字段，但 ResourceInspector 需要。同时 `PiApi` 需要 `resolveApproval`（diffService/审批接线的一部分，当前审批 UI 无操作）。

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `electron/piHost.ts`
- Modify: `src/renderer/state/appStore.ts`
- Test: `electron/piHost.test.ts`（改）
- Test: `src/renderer/state/appStore.test.ts`（改）

- [ ] **Step 1: 写失败测试——PiHost.snapshot 返回 models/tools**

在 `electron/piHost.test.ts` 中已有的 fake-session 测试里增加断言（找到现有 `piHost` 构造处）：

```ts
test("snapshot includes models and tools from the runtime", async () => {
  const host = new PiHost({ runtime: fakeRuntime });
  const snapshot = await host.start({ cwd: "/tmp/x" });
  expect(snapshot.models).toBeDefined();
  expect(snapshot.tools).toBeDefined();
});
```

如果现有测试文件结构不同，改为在 `start()` 后断言 `snapshot.models.length >= 0`。运行确认 FAIL（`models` 不在类型上）。

- [ ] **Step 2: protocol.ts 增加字段**

`src/shared/protocol.ts` 修改：

```ts
export interface PiSnapshot {
  workspaceId: string;
  session: SessionState;
  sessions: SessionSummary[];
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallState>;
  queue: { steering: string[]; followUp: string[] };
  approvals: Record<string, ApprovalRequest>;
  diffFiles: Record<string, DiffFile>;
  resources: ResourceSnapshot;
  diagnostics: RuntimeDiagnostics;
  models?: ModelOption[];
  tools?: ToolOption[];
  lastError?: string;
}
```

`PiApi` 增加：

```ts
  resolveApproval(id: string, decision: "allowed" | "rejected" | "stopped"): Promise<void>;
```

- [ ] **Step 3: PiHost.snapshot 填充 models/tools；PiHost 增加 resolveApproval**

`electron/piHost.ts` 修改 `snapshot()` 返回对象：

```ts
      models: this.getModels(),
      tools: this.getTools(),
```

`PiHost` 增加方法（放在 `getTools()` 后）：

```ts
  resolveApproval(_id: string, _decision: "allowed" | "rejected" | "stopped"): void {
    // Approval is not part of the pi core runtime (pi has no built-in permission popups).
    // This hook exists for future extension-based approval flows (see capability gap spec 2.6).
  }
```

- [ ] **Step 4: main.ts + preload.ts 增加 resolveApproval IPC**

`electron/main.ts` 增加：

```ts
  ipcMain.handle("pi:resolveApproval", (_event, id: string, decision: "allowed" | "rejected" | "stopped") => piHost.resolveApproval(id, decision));
```

`electron/preload.ts` 增加：

```ts
  resolveApproval: (id, decision) => ipcRenderer.invoke("pi:resolveApproval", id, decision),
```

- [ ] **Step 5: appStore 增加 models/tools 初始值**

`src/renderer/state/appStore.ts` 的 `createInitialState()` 增加：

```ts
    models: [],
    tools: [],
```

并 `PiSnapshot` 类型导入已含。运行类型检查通过。

- [ ] **Step 6: 运行测试 + typecheck 确认通过**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/shared/protocol.ts electron/piHost.ts electron/main.ts electron/preload.ts src/renderer/state/appStore.ts electron/piHost.test.ts src/renderer/state/appStore.test.ts
git commit -m "feat: expose models, tools, and approval hook in snapshot"
```

---

### Task 3: CommandPalette + SettingsDialog 接线（getCommands / executeCommand / setThinkingLevel）

当前 CommandPalette 组件存在但 App 从未打开它；SettingsDialog 存在但从未渲染。接线：⌘K 打开命令面板（加载 getCommands），Settings 打开 SettingsDialog。

**Files:**
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/CommandPalette.test.tsx`
- Create: `src/renderer/components/SettingsDialog.test.tsx`

- [ ] **Step 1: 写失败测试**

`src/renderer/components/CommandPalette.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./CommandPalette";

test("runs a command on select", () => {
  const onSelect = vi.fn();
  const commands: PaletteCommand[] = [{ id: "model", name: "/model", description: "Switch the current model" }];
  render(<CommandPalette open commands={commands} onSelect={onSelect} onClose={() => {}} />);
  screen.getByRole("button", { name: /\/model/ }).click();
  expect(onSelect).toHaveBeenCalledWith(commands[0]);
});
```

（`vi` 从 vitest 导入。此测试验证 CommandPalette 的 onSelect 契约。）

`src/renderer/components/SettingsDialog.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";

test("reports thinking level changes", () => {
  const onThinkingLevel = vi.fn();
  render(<SettingsDialog open thinkingLevel="medium" onThinkingLevel={onThinkingLevel} onClose={() => {}} />);
  const select = screen.getByLabelText("Thinking level");
  select.value = "high";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onThinkingLevel).toHaveBeenCalledWith("high");
});
```

- [ ] **Step 2: 运行测试确认失败/通过（组件本身应已通过——这步验证基线）**

Run: `npm test -- --run src/renderer/components/CommandPalette.test.tsx src/renderer/components/SettingsDialog.test.tsx`
Expected: PASS（组件已实现）

- [ ] **Step 3: App.tsx 接线 CommandPalette 和 SettingsDialog**

修改 `src/renderer/App.tsx`：

```tsx
import { useEffect, useState } from "react";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
// ... 其他 import

export function App() {
  const state = useAppStore();
  const api = getPiApi();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commands, setCommands] = useState<PaletteCommand[]>([]);

  useEffect(() => {
    void api?.getCommands().then((commands) => setCommands(commands.map((command) => ({ id: command.id, name: command.name, description: command.description, source: command.source }))));
  }, [api, state.session.sessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  // ... chooseWorkspace / submit 保持不变

  return (
    <main className="app-shell">
      <SessionSidebar ... />
      {/* ... */}
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        onSelect={(command) => {
          setPaletteOpen(false);
          void api?.executeCommand(command.name);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        thinkingLevel={state.session.thinkingLevel}
        onThinkingLevel={(level) => void api?.setThinkingLevel(level)}
        onClose={() => setSettingsOpen(false)}
      />
    </main>
  );
}
```

同时把 `ResourceInspector` 的 `onOpenSettings={() => setSettingsOpen(true)}` 从 `undefined` 改为实际打开，sidebar 的 Settings 按钮也接线。

- [ ] **Step 4: 运行测试 + typecheck**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.tsx src/renderer/components/CommandPalette.test.tsx src/renderer/components/SettingsDialog.test.tsx
git commit -m "feat: wire command palette and settings dialog"
```

---

### Task 4: PiHost 补齐 executeCommand 命令（/copy /session /export JSONL /tree）

当前 `executeCommand` 只实现 new/compact/reload/name/model/import/export(HTML)，其余 throw。补齐可立即实现的命令；需要桌面流程的（login/logout/llama/scoped-models/share/trust/changelog）移到 Task 5+。

**Files:**
- Modify: `electron/piHost.ts`
- Modify: `src/shared/protocol.ts`（PiCommand 增加 args 字段）
- Test: `electron/piHost.test.ts`（改）

- [ ] **Step 1: 写失败测试**

在 `electron/piHost.test.ts` 增加（沿用现有 fake runtime 模式，`exportToJsonl` 返回 string、`getLastAssistantText` 返回文本）：

```ts
test("executeCommand /copy returns last assistant text", async () => {
  const host = new PiHost({ runtime: fakeRuntimeWithCopy });
  await host.start({ cwd: "/tmp/x" });
  await expect(host.executeCommand("copy")).resolves.toBe("last reply");
});

test("executeCommand /export writes jsonl when asked", async () => {
  const host = new PiHost({ runtime: fakeRuntimeWithExport });
  await host.start({ cwd: "/tmp/x" });
  await host.executeCommand("export", "session.jsonl");
  expect(fakeRuntimeWithExport.session.exportToJsonl).toHaveBeenCalled();
});
```

如现有 fake 结构不同，用最小改动适配：给 fake session 加 `getLastAssistantText?: () => string` 和 `exportToJsonl?: (path?: string) => string`。运行确认 FAIL（copy 命令 throw）。

- [ ] **Step 2: piHost.executeCommand 增加分支**

`electron/piHost.ts` 的 `executeCommand` switch 增加：

```ts
      case "copy": {
        const session = this.requireSession() as PiSessionLike & { getLastAssistantText?: () => string };
        const text = session.getLastAssistantText?.() ?? "";
        if (text) await this.copyToClipboard(text);
        return;
      }
      case "session": {
        const session = this.requireSession();
        const stats = session.getSessionStats();
        this.emit("notification_created", { message: `Session ${session.sessionId} — tokens: ${stats.tokens.total}, cost: $${stats.cost.toFixed(4)}` });
        return;
      }
      case "export": {
        const session = this.requireSession();
        const out = args.trim();
        const jsonlSession = session as PiSessionLike & { exportToJsonl?: (outputPath?: string) => string };
        if (out.endsWith(".jsonl") && jsonlSession.exportToJsonl) {
          jsonlSession.exportToJsonl(out);
        } else {
          await session.exportToHtml?.(out || undefined);
        }
        return;
      }
      case "tree": {
        const session = this.requireSession() as PiSessionLike & { navigateTree?: (targetId: string, options?: unknown) => Promise<unknown> };
        if (!args.trim() || !session.navigateTree) throw new Error("/tree requires a session tree entry id");
        await session.navigateTree(args.trim());
        return;
      }
```

- [ ] **Step 3: 增加 copyToClipboard 私有方法**

`electron/piHost.ts` 增加：

```ts
  private async copyToClipboard(text: string): Promise<void> {
    try {
      const { clipboard } = await import("electron");
      clipboard.writeText(text);
    } catch {
      // Non-Electron test environment: no-op
    }
  }
```

- [ ] **Step 4: protocol.ts PiCommand 增加 args 提示**

`src/shared/protocol.ts` 的 `PiCommand` 增加可选字段：

```ts
export interface PiCommand {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "extension" | "prompt" | "skill";
  args?: string;
}
```

- [ ] **Step 5: 运行测试 + typecheck**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add electron/piHost.ts src/shared/protocol.ts electron/piHost.test.ts
git commit -m "feat: implement copy, session, tree, and jsonl export commands"
```

---

### Task 5: PiHost 订阅缺失事件（compaction/retry/model_select/agent_start/turn）

当前 `handleSessionEvent` 只处理 10 种事件。补齐 `protocol.ts` 事件类型并映射 SDK 事件。

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `electron/piHost.ts`
- Modify: `src/renderer/state/appStore.ts`
- Test: `src/renderer/state/appStore.test.ts`（改）

- [ ] **Step 1: protocol.ts 增加事件类型**

`PiEvent` union 增加：

```ts
  | PiEventBase<"agent_started", {}>
  | PiEventBase<"turn_started", {}>
  | PiEventBase<"turn_completed", {}>
  | PiEventBase<"compaction_started", {}>
  | PiEventBase<"compaction_completed", { summary?: string }>
  | PiEventBase<"auto_retry_started", {}>
  | PiEventBase<"auto_retry_completed", {}>
  | PiEventBase<"model_select", { model?: string; provider?: string }>
```

- [ ] **Step 2: 写 reducer 测试**

`src/renderer/state/appStore.test.ts` 增加：

```ts
test("project compaction lifecycle", () => {
  let state = reducePiEvent(createInitialState(), { eventId: "e1", workspaceId: "local", timestamp: "t", sequence: 1, type: "compaction_started", payload: {} });
  expect(state.session.status).toBe("running");
  state = reducePiEvent(state, { eventId: "e2", workspaceId: "local", timestamp: "t", sequence: 2, type: "compaction_completed", payload: { summary: "done" } });
  expect(state.session.status).toBe("completed");
});
```

- [ ] **Step 3: piHost.handleSessionEvent 增加 case**

`electron/piHost.ts` 的 switch 增加：

```ts
      case "agent_start":
        this.emit("agent_started", {}, raw);
        break;
      case "turn_start":
        this.emit("turn_started", {}, raw);
        break;
      case "turn_end":
        this.emit("turn_completed", {}, raw);
        break;
      case "compaction_start":
        this.emit("compaction_started", {}, raw);
        break;
      case "compaction_end":
        this.emit("compaction_completed", { summary: event.summary ? String(event.summary) : undefined }, raw);
        break;
      case "auto_retry_start":
        this.emit("auto_retry_started", {}, raw);
        break;
      case "auto_retry_end":
        this.emit("auto_retry_completed", {}, raw);
        break;
      case "model_select":
        if (event.name) this.emit("model_select", { model: event.name, provider: event.provider ? String(event.provider) : undefined }, raw);
        break;
```

同时把 `handleSessionEvent` 的 `event` 类型断言增加 `provider?: unknown; summary?: unknown` 字段。

- [ ] **Step 4: appStore reducer 增加 case**

`src/renderer/state/appStore.ts` 的 switch 增加：

```ts
    case "agent_started":
    case "turn_started":
    case "compaction_started":
    case "auto_retry_started":
      return { ...state, session: { ...state.session, status: "running" } };
    case "turn_completed":
    case "compaction_completed":
    case "auto_retry_completed":
      return { ...state, session: { ...state.session, status: "completed" } };
    case "model_select":
      return { ...state, session: { ...state.session, model: event.payload.model ?? state.session.model, provider: event.payload.provider ?? state.session.provider } };
```

- [ ] **Step 5: 运行测试 + typecheck**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/shared/protocol.ts electron/piHost.ts src/renderer/state/appStore.ts src/renderer/state/appStore.test.ts
git commit -m "feat: subscribe compaction, retry, and turn lifecycle events"
```

---

### Task 6: Project Trust 流程

Pi SDK 的 trust 决策由 `ProjectTrustStore` 管理。GUI 需要在启动时检测未决 trust 并展示确认。

**Files:**
- Modify: `electron/piHost.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/components/TrustDialog.tsx`
- Test: `src/renderer/components/TrustDialog.test.tsx`

- [ ] **Step 1: protocol.ts 增加 trust 相关类型**

`PiEvent` union 增加：

```ts
  | PiEventBase<"project_trust_requested", { cwd: string; hasProjectResources: boolean }>
  | PiEventBase<"project_trust_resolved", { cwd: string; trusted: boolean }>
```

`PiApi` 增加：

```ts
  resolveTrust(trusted: boolean): Promise<void>;
```

- [ ] **Step 2: 写 TrustDialog 测试**

`src/renderer/components/TrustDialog.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { TrustDialog } from "./TrustDialog";

test("calls onResolve with the user's decision", () => {
  const onResolve = vi.fn();
  render(<TrustDialog open cwd="/tmp/project" hasProjectResources onResolve={onResolve} />);
  screen.getByRole("button", { name: /trust/i }).click();
  expect(onResolve).toHaveBeenCalledWith(true);
});
```

- [ ] **Step 3: 创建 TrustDialog 组件**

`src/renderer/components/TrustDialog.tsx`：

```tsx
export function TrustDialog({ open, cwd, hasProjectResources, onResolve }: { open: boolean; cwd: string; hasProjectResources: boolean; onResolve: (trusted: boolean) => void }) {
  if (!open) return null;
  return (
    <div className="palette-backdrop" role="dialog" aria-label="Project trust">
      <div className="settings-dialog">
        <div className="settings-heading"><strong>Trust this project?</strong></div>
        <p>Loading project-local resources from <code>{cwd}</code> allows Pi to run extensions, skills, and settings from this folder.</p>
        {hasProjectResources && <p>This project contains local resources (extensions, skills, or settings).</p>}
        <p className="trust-note">Trust controls resource loading only — it is not a security sandbox.</p>
        <div className="trust-actions">
          <button onClick={() => onResolve(true)}>Trust</button>
          <button onClick={() => onResolve(false)}>Don&apos;t trust</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: PiHost 暴露 trust 决策**

`electron/piHost.ts` 增加字段和方法：

```ts
  private pendingTrust?: { cwd: string; hasProjectResources: boolean };

  resolveTrust(trusted: boolean): void {
    if (!this.pendingTrust) return;
    this.emit("project_trust_resolved", { cwd: this.pendingTrust.cwd, trusted });
    this.pendingTrust = undefined;
  }
```

在 `start()` 的 `session_started` 后增加（启动时若有项目资源则请求信任；若 SDK 事件提供更精确数据则优先用事件）：

```ts
    this.pendingTrust = { cwd: options.cwd, hasProjectResources: true };
    this.emit("project_trust_requested", { cwd: options.cwd, hasProjectResources: true });
```

- [ ] **Step 5: main.ts + preload.ts 增加 resolveTrust IPC**

`electron/main.ts`：

```ts
  ipcMain.handle("pi:resolveTrust", (_event, trusted: boolean) => piHost.resolveTrust(trusted));
```

`electron/preload.ts`：

```ts
  resolveTrust: (trusted) => ipcRenderer.invoke("pi:resolveTrust", trusted),
```

- [ ] **Step 6: App.tsx 渲染 TrustDialog**

`App.tsx` 增加：

```tsx
  const [trustRequest, setTrustRequest] = useState<{ cwd: string; hasProjectResources: boolean } | null>(null);

  useEffect(() => {
    const unsubscribe = api?.onEvent((event) => {
      if (event.type === "project_trust_requested") setTrustRequest(event.payload);
      if (event.type === "project_trust_resolved") setTrustRequest(null);
    });
    return unsubscribe;
  }, [api]);
```

注意：App 已有 `onEvent` 订阅（applyEvent），把 trust 分支合并进现有 effect 即可（避免双重订阅）。渲染：

```tsx
      <TrustDialog
        open={trustRequest !== null}
        cwd={trustRequest?.cwd ?? ""}
        hasProjectResources={trustRequest?.hasProjectResources ?? false}
        onResolve={(trusted) => { setTrustRequest(null); void api?.resolveTrust(trusted); }}
      />
```

- [ ] **Step 7: 运行测试 + typecheck**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add electron/piHost.ts electron/main.ts electron/preload.ts src/shared/protocol.ts src/renderer/App.tsx src/renderer/components/TrustDialog.tsx src/renderer/components/TrustDialog.test.tsx
git commit -m "feat: add project trust confirmation flow"
```

---

### Task 7: Diagnostics 透传修复

当前 `createSdkRuntime` 收集了 `services.diagnostics` 但被 `as unknown as PiRuntimeLike` 丢弃。修复：`PiRuntimeLike` 增加 `diagnostics` 字段，`snapshot()` 使用真实值。

**Files:**
- Modify: `electron/piHost.ts`
- Modify: `src/shared/protocol.ts`

- [ ] **Step 1: PiRuntimeLike 增加 diagnostics**

`electron/piHost.ts` 的 `PiRuntimeLike` interface 增加：

```ts
  diagnostics?: { messages: Array<{ message?: string; source?: string }>; errors: Array<{ message?: string; path?: string }> };
```

- [ ] **Step 2: 移除类型断言，透传 diagnostics**

`createSdkRuntime` 返回值改为：

```ts
    return createAgentSessionRuntime(createRuntime, {
      cwd: options.cwd,
      agentDir: this.agentDir,
      sessionManager,
    }) as Promise<PiRuntimeLike>;
```

（`createRuntime` 已返回 `{ ...result, services, diagnostics: services.diagnostics }`，若 SDK 的运行时结果类型与 PiRuntimeLike 不兼容则保留 `as Promise<PiRuntimeLike>` 但确保 diagnostics 在结构中。）

`snapshot()` 的 diagnostics 改为：

```ts
      diagnostics: {
        piVersion: "0.83.0",
        sdkSessionId: session?.sessionId,
        sessionFile: session?.sessionFile,
        sequence: this.sequence,
        messages: this.runtime?.diagnostics?.messages.map((m) => m.message ?? "") ?? [],
        errors: this.runtime?.diagnostics?.errors.map((e) => e.message ?? e.path ?? "") ?? [],
      },
```

- [ ] **Step 3: 运行测试 + typecheck**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add electron/piHost.ts src/shared/protocol.ts
git commit -m "fix: surface real runtime diagnostics in snapshot"
```

---

### Task 8: 全量验证

- [ ] **Step 1: 全量测试 + typecheck + build**

```bash
npm test -- --run
npm run typecheck
npm run build
```

Expected: 全部通过。

- [ ] **Step 2: 对照差距文档核对**

检查 `specs/2026-08-06-pi-capability-gap.md` 3.5 清单：
- [x] A. UI 层 22 个 PiApi 全部调用（Task 1-3）
- [x] B. executeCommand 补齐 copy/session/tree/export JSONL（Task 4）
- [x] C. exportToJsonl 接入（Task 4）
- [x] D. Project Trust 流程（Task 6）
- [x] G. 事件补齐 compaction/retry/turn（Task 5）
- [x] H. diagnostics 透传（Task 7）
- [ ] E/F/I/J（扩展深度、包管理、终端/Git、SettingsManager）→ 记录为下一阶段 backlog，不阻塞本次交付

- [ ] **Step 3: 最终提交（如有验证修复）**

```bash
git status   # 确认干净
```

---

## Backlog（下一阶段，不入本次范围）

- Extension 深度集成：执行扩展命令、ctx.ui 映射、扩展 UI 承载
- Pi Packages：install/remove/update/list 真实逻辑（PackagePanel 只有展示）
- 内置终端（xterm.js PTY）、Git 面板、代码编辑器
- `/login` `/logout` `/llama` `/scoped-models` `/share` 的桌面流程
- SettingsManager 接入（设置持久化）
- approval 扩展流程（基于 pi 无内建权限弹窗的事实，通过 extension 实现）
