import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccountUsage,
  McpServerRuntimeStatus,
  PackageResourceCounts,
  ResourceSnapshot,
  SessionState,
  SessionTodoItem,
  ToolOption,
} from "../../shared/protocol";
import { useAppStore } from "./store";
import { getPiApi } from "../app/piApi";
import { AppIcon, type AppIconName } from "../ui/icons";
import { IndexPanel } from "./IndexPanel";
import { CollapsibleSection } from "../ui/CollapsibleSection";
export type InspectorTab = "context" | "tools" | "extensions" | "index";

export interface ResourceInspectorProps {
  session: SessionState;
  resources: ResourceSnapshot;
  tools?: ToolOption[];
  /** Tool names temporarily locked by the current session mode. */
  lockedToolNames?: string[];
  onToggleTools?: (names: string[]) => void;
  onToggleSkills?: (patterns: string[]) => void;
  onOpenChanges?: () => void;
  onOpenPlan?: () => void;
  changeCount?: number;
  onClose?: () => void;
  tab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
}

/** Compact token count for usage rows. */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
}

export function formatBalanceAmount(currency: string, total: number): string {
  const code = currency.toUpperCase();
  const amount = total.toFixed(2);
  if (code === "CNY") return `¥${amount}`;
  if (code === "USD") return `$${amount}`;
  return `${code} ${amount}`;
}

export function formatSessionUsageLine(session: Pick<SessionState, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">): string {
  const cache = session.cacheReadTokens + session.cacheWriteTokens;
  return `in ${formatTokenCount(session.inputTokens)} · out ${formatTokenCount(session.outputTokens)} · cache ${formatTokenCount(cache)}`;
}

/** Readable package title from source ids like `npm:foo`, `npm:@scope/pkg`, or a path. */
export function packageDisplayName(source: string, name?: string): string {
  if (name && name !== source) return name;
  if (source.startsWith("npm:")) return source.slice(4);
  if (source.startsWith("git:")) {
    const rest = source.slice(4).replace(/\.git$/, "");
    return rest.split("/").filter(Boolean).pop() ?? rest;
  }
  const base = source.split(/[/\\]/).filter(Boolean).pop();
  return base ?? source;
}

/** Compact non-zero resource summary, e.g. "2e · 3s · 1p". Paths/locations are never shown. */
export function packageResourceSummary(r: PackageResourceCounts): string {
  const parts: string[] = [];
  if (r.extensions > 0) parts.push(`${r.extensions}e`);
  if (r.skills > 0) parts.push(`${r.skills}s`);
  if (r.prompts > 0) parts.push(`${r.prompts}p`);
  if (r.themes > 0) parts.push(`${r.themes}t`);
  return parts.join(" · ");
}

/** Progress label: completed / total (cancelled counts toward total, not completed). */
export function todoProgressLabel(todos: SessionTodoItem[]): string {
  const total = todos.length;
  const completed = todos.filter((t) => t.status === "completed").length;
  return `${completed}/${total}`;
}

export function todoActiveLabel(todos: SessionTodoItem[]): string | undefined {
  return todos.find((todo) => todo.status === "in_progress")?.content;
}

export function todoStatusIcon(status: SessionTodoItem["status"]): AppIconName {
  switch (status) {
    case "completed":
      return "circleCheck";
    case "in_progress":
      return "circleDot";
    case "cancelled":
      return "minus";
    default:
      return "circle";
  }
}

/** Compact icon for an MCP server row. */
export function mcpStatusIcon(status: McpServerRuntimeStatus): AppIconName {
  switch (status) {
    case "connected":
      return "circleCheck";
    case "cached":
      return "circleDot";
    case "failed":
      return "circleAlert";
    case "needs-auth":
      return "shieldAlert";
    case "not-connected":
      return "circle";
    case "disabled":
      return "circle";
  }
}

function TodoListSection({ todos }: { todos: SessionTodoItem[] }) {
  return (
    <CollapsibleSection title="Todos" count={todos.length > 0 ? todos.length : undefined} defaultOpen>
      {todos.length === 0 ? (
        <div className="inspector-muted">No todos yet</div>
      ) : (
        <div className="todo-list">
          <div className="todo-progress-row">
            <div
              className="todo-progress"
              role="progressbar"
              aria-label={`${todos.filter((todo) => todo.status === "completed").length} of ${todos.length} todos completed`}
              aria-valuemin={0}
              aria-valuemax={todos.length}
              aria-valuenow={todos.filter((todo) => todo.status === "completed").length}
            >
              {todoProgressLabel(todos)} completed
            </div>
            {todoActiveLabel(todos) && (
              <div className="todo-active" title={todoActiveLabel(todos)}>
                Now: {todoActiveLabel(todos)}
              </div>
            )}
          </div>
          {todos.map((todo) => (
            <div className={`todo-row status-${todo.status}`} key={todo.id} title={`${todo.status} · ${todo.priority}`}>
              <span className="todo-mark" aria-hidden>
                <AppIcon name={todoStatusIcon(todo.status)} size="xs" />
              </span>
              <span className="todo-priority">{todo.priority}</span>
              <span className="todo-content">{todo.content}</span>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

function StatusDot({ status }: { status: SessionState["status"] }) {
  return <span className={`status-dot ${status}`} aria-label={`status: ${status}`} />;
}

function ContextBar({ used, total, cost }: { used: number; total: number; cost: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  // Pi session cost is always USD (model pricing tables). Format with the same helper as balance.
  return (
    <div className="context-bar">
      <div className="context-bar-track">
        <div className={`context-bar-fill ${pct >= 80 ? "danger" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="context-bar-label">{used > 0 ? `${pct}% ctx` : "no session"}</span>
      <span className="context-bar-cost" title="session cost (USD estimate)">
        {formatBalanceAmount("USD", cost)}
      </span>
    </div>
  );
}

function SessionUsageLines({
  session,
  account,
  onRefreshBalance,
}: {
  session: SessionState;
  account: AccountUsage | null;
  onRefreshBalance?: () => void;
}) {
  const cache = session.cacheReadTokens + session.cacheWriteTokens;
  const usageTitle = `input ${session.inputTokens} · output ${session.outputTokens} · cache read ${session.cacheReadTokens} · cache write ${session.cacheWriteTokens}`;
  const hasUsage =
    session.inputTokens > 0 ||
    session.outputTokens > 0 ||
    cache > 0 ||
    session.cost > 0;

  return (
    <div className="session-usage-block">
      <div className="session-usage-line" title={usageTitle}>
        {hasUsage ? formatSessionUsageLine(session) : "no usage yet"}
      </div>
      {account?.mode === "prepaid_balance" && (
        <button
          type="button"
          className="session-balance-line"
          title={[
            account.label ?? account.providerId,
            account.granted != null ? `granted ${formatBalanceAmount(account.currency, account.granted)}` : null,
            account.toppedUp != null ? `topped up ${formatBalanceAmount(account.currency, account.toppedUp)}` : null,
            "click to refresh",
          ]
            .filter(Boolean)
            .join(" · ")}
          onClick={onRefreshBalance}
        >
          <span>{account.label ?? account.providerId}</span>
          <span>
            {formatBalanceAmount(account.currency, account.total)} left
            {!account.isAvailable ? " · low" : ""}
          </span>
        </button>
      )}
      {account?.mode === "unsupported" && account.reason === "fetch_failed" && (
        <button type="button" className="session-balance-line is-muted" onClick={onRefreshBalance} title={account.message}>
          balance unavailable
        </button>
      )}
    </div>
  );
}

/** Compact extension row: status + name only. Paths omitted; errors only when failed. */
function ExtensionRow({ ok, label, error }: { ok: boolean; label: string; error?: string }) {
  const tip = error ? `${label}: ${error}` : label;
  return (
    <div className={`ext-row ${ok ? "" : "is-failed"}`} title={tip}>
      <span className={`ext-dot ${ok ? "ok" : "fail"}`} aria-hidden />
      <span className="ext-name">{label}</span>
      {!ok && <span className="ext-fail-label">fail</span>}
    </div>
  );
}

function PackageGroup({
  name,
  source,
  enabled,
  resources: counts,
  extensions,
}: {
  name: string;
  source: string;
  enabled: boolean;
  resources?: PackageResourceCounts;
  extensions: Array<{ name: string; source: string; loaded: boolean; error?: string }>;
}) {
  const title = packageDisplayName(source, name);
  const summary = counts ? packageResourceSummary(counts) : "";
  // Prefer listing nested extensions over a redundant "Ne" count in the summary.
  const meta = (() => {
    if (!counts) return "";
    if (extensions.length > 0) {
      const rest = packageResourceSummary({ ...counts, extensions: 0 });
      return rest;
    }
    return summary;
  })();

  return (
    <div className={`package-group ${enabled ? "" : "is-disabled"}`}>
      <div className="package-row" title={source}>
        <strong className="package-name">{title}</strong>
        <span className="package-meta">
          {meta ? <span className="package-summary">{meta}</span> : null}
          <em className={enabled ? "status-enabled" : "status-disabled"}>{enabled ? "on" : "off"}</em>
        </span>
      </div>
      {extensions.length > 0 && (
        <div className="package-extensions">
          {extensions.map((ext) => (
            <ExtensionRow
              key={ext.name}
              ok={ext.loaded}
              label={ext.name}
              error={ext.loaded ? undefined : ext.error}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ResourceInspector({
  session,
  resources,
  tools = [],
  lockedToolNames = [],
  onToggleTools,
  onToggleSkills,
  onOpenChanges,
  onOpenPlan,
  changeCount = 0,
  onClose,
  tab: controlledTab,
  onTabChange,
}: ResourceInspectorProps) {
  const [internalTab, setInternalTab] = useState<InspectorTab>("context");
  const tab = controlledTab ?? internalTab;
  const setTab = (next: InspectorTab) => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);
  };
  const indexStatus = useAppStore((s) => s.indexStatus);
  const [localTools, setLocalTools] = useState(tools);
  const lastSyncedTools = useRef("");
  const [accountUsage, setAccountUsage] = useState<AccountUsage | null>(null);

  useEffect(() => {
    const key = tools.map((tool) => `${tool.name}:${tool.active}`).join("|");
    if (key !== lastSyncedTools.current) {
      lastSyncedTools.current = key;
      setLocalTools(tools);
    }
  }, [tools]);

  const refreshAccountUsage = useCallback(async (force = false) => {
    const api = getPiApi();
    if (!api?.getProviderUsage) {
      setAccountUsage(null);
      return;
    }
    try {
      const snap = await api.getProviderUsage(force ? { force: true } : undefined);
      setAccountUsage(snap.account);
    } catch {
      setAccountUsage({
        mode: "unsupported",
        providerId: session.provider,
        reason: "fetch_failed",
        message: "request failed",
      });
    }
  }, [session.provider]);

  useEffect(() => {
    // Reload account usage when provider/session changes (session tokens come from props).
    void refreshAccountUsage(false);
  }, [session.provider, session.sessionId, refreshAccountUsage]);

  // After each agent turn finishes, force-refresh account balance (e.g. DeepSeek).
  const prevStatusRef = useRef(session.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = session.status;
    if (prev === "running" && session.status !== "running") {
      void refreshAccountUsage(true);
    }
  }, [session.status, refreshAccountUsage]);

  const activeTools = localTools.filter((tool) => tool.active).length;
  const lockedTools = new Set(lockedToolNames);
  const extensionErrors = resources.extensions.filter((ext) => !ext.loaded).length;
  const skillErrors = resources.skills.filter((skill) => !skill.loaded).length;
  const mcpFailures = resources.mcp?.servers.filter((server) => server.status === "failed" || server.status === "needs-auth").length ?? 0;

  const toggleTool = (name: string) => {
    if (!onToggleTools || lockedTools.has(name)) return;
    const next = localTools.map((tool) => (tool.name === name ? { ...tool, active: !tool.active } : tool));
    setLocalTools(next);
    onToggleTools(next.filter((tool) => tool.active).map((tool) => tool.name));
  };

  const [localSkills, setLocalSkills] = useState(resources.skills);
  const lastSyncedSkills = useRef("");
  useEffect(() => {
    const key = resources.skills.map((skill) => `${skill.path}:${skill.enabled !== false}`).join("|");
    if (key !== lastSyncedSkills.current) {
      lastSyncedSkills.current = key;
      setLocalSkills(resources.skills);
    }
  }, [resources.skills]);

  const skillGroups = new Map<string, Array<typeof localSkills[number]>>();
  for (const skill of localSkills) {
    const group = skill.group ?? "other";
    if (!skillGroups.has(group)) skillGroups.set(group, []);
    skillGroups.get(group)!.push(skill);
  }
  const skillsPattern = (skill: typeof localSkills[number]): string => {
    const group = skill.group ?? "other";
    const name = skill.name;
    // Nested skills live at skills/<group>/<name>; a top-level skill's parent is skills/<group>.
    return name === group ? `!skills/${group}` : `!skills/${group}/${name}`;
  };
  const toggleSkill = (skill: typeof localSkills[number]) => {
    if (!onToggleSkills) return;
    const next = localSkills.map((other) => (other.path === skill.path ? { ...other, enabled: other.enabled === false } : other));
    setLocalSkills(next);
    onToggleSkills(next.filter((other) => other.enabled === false).map(skillsPattern));
  };
  const toggleSkillGroup = (group: string, enable: boolean) => {
    if (!onToggleSkills) return;
    const next = localSkills.map((skill) => (skill.group === group ? { ...skill, enabled: enable } : skill));
    const members = skillGroups.get(group) ?? [];
    const hasNested = members.some((skill) => skill.name !== group);
    setLocalSkills(next);
    const kept = next.filter((skill) => skill.enabled === false && skill.group !== group).map(skillsPattern);
    const added = hasNested ? [`!skills/${group}/**`] : [`!skills/${group}`];
    onToggleSkills(enable ? kept : [...kept, ...added]);
  };

  return (
    <aside className="inspector" aria-label="Pi inspector">
      <div className="inspector-header">
        <div className="right-pane-mode-tabs" role="tablist" aria-label="Right panel mode">
          <button type="button" role="tab" aria-selected="true" className="selected">Inspector</button>
          {onOpenPlan && <button type="button" role="tab" aria-selected="false" onClick={onOpenPlan}>Plan</button>}
          <button type="button" role="tab" aria-selected="false" onClick={onOpenChanges}>
            Changes{changeCount > 0 && <span className="tab-badge">{changeCount}</span>}
          </button>
        </div>
        <div className="inspector-header-actions">
          {onClose && (
            <button className="icon-button" onClick={onClose} aria-label="Close inspector">
              <AppIcon name="x" size="sm" />
            </button>
          )}
        </div>
      </div>

      <div className="session-summary">
        <StatusDot status={session.status} />
        <div className="session-summary-text">
          <strong>{session.name}</strong>
          <small>{session.provider ? `${session.model} · ${session.thinkingLevel}` : session.thinkingLevel}</small>
        </div>
      </div>
      <div className="session-context-row">
        <ContextBar used={session.contextTokens} total={session.contextWindow} cost={session.cost} />
        <SessionUsageLines
          session={session}
          account={accountUsage}
          onRefreshBalance={() => void refreshAccountUsage(true)}
        />
      </div>

      <div className="inspector-tabs">
        <button className={tab === "context" ? "selected" : ""} onClick={() => setTab("context")}>
          Context
        </button>
        <button className={tab === "tools" ? "selected" : ""} onClick={() => setTab("tools")}>
          Tools{activeTools > 0 ? ` · ${activeTools}` : ""}
        </button>
        <button className={tab === "extensions" ? "selected" : ""} onClick={() => setTab("extensions")}>
          Extensions{extensionErrors + skillErrors + mcpFailures > 0 ? <span className="tab-badge error">{extensionErrors + skillErrors + mcpFailures}</span> : null}
        </button>
        <button className={tab === "index" ? "selected" : ""} onClick={() => setTab("index")}>
          Index
        </button>
      </div>

      {tab === "context" && (
        <div className="inspector-content">
          <CollapsibleSection title="Runtime" defaultOpen>
            <div className="inspector-row">
              <span>Model</span>
              <strong>{session.model}</strong>
            </div>
            <div className="inspector-row">
              <span>Thinking</span>
              <strong>{session.thinkingLevel}</strong>
            </div>
            <div className="inspector-row">
              <span>Tools</span>
              <strong>{activeTools} active</strong>
            </div>
          </CollapsibleSection>

          <TodoListSection todos={session.todos ?? []} />

          <CollapsibleSection title="Context Files" count={resources.contextFiles.length}>
            {resources.contextFiles.length === 0 ? (
              <div className="inspector-muted">No context files loaded</div>
            ) : (
              resources.contextFiles.map((resource) => (
                <div className="resource-row" key={resource.path}>
                  <span className="resource-icon">
                    <AppIcon name={resource.loaded ? "circleCheck" : "circle"} size="sm" />
                  </span>
                  <span>
                    <strong>{resource.path.split("/").pop()}</strong>
                    <small>{resource.source}</small>
                  </span>
                  <em>{resource.loaded ? "loaded" : resource.error ?? "skipped"}</em>
                </div>
              ))
            )}
          </CollapsibleSection>
        </div>
      )}

      {tab === "tools" && (
        <div className="inspector-content">
          {localTools.length === 0 ? (
            <div className="inspector-muted">No tools available</div>
          ) : (
            <div className="tool-list">
              {localTools.map((tool) => (
                <label className="tool-toggle-row" key={tool.name}>
                  <input
                    className="inspector-switch-input"
                    type="checkbox"
                    checked={tool.active}
                    onChange={() => toggleTool(tool.name)}
                    disabled={!onToggleTools || lockedTools.has(tool.name)}
                  />
                  <span className="tool-toggle-text">
                    <strong>{tool.name}</strong>
                    <small>{tool.description || tool.source}</small>
                  </span>
                  <span className="inspector-switch" aria-hidden="true" />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "extensions" && (
        <div className="inspector-content">
          <CollapsibleSection title="MCP Servers" count={resources.mcp ? resources.mcp.servers.length : undefined} defaultOpen>
            {!resources.mcp ? (
              <div className="inspector-muted">No MCP status reported yet</div>
            ) : resources.mcp.servers.length === 0 ? (
              <div className="inspector-muted">No MCP servers configured</div>
            ) : (
              <div className="mcp-server-list">
                {resources.mcp.servers.map((server) => (
                  <div className={`mcp-server-row ${server.disabled ? "is-disabled" : ""}`} key={server.name}>
                    <span className={`mcp-status-icon ${server.disabled ? "disabled" : server.status}`} aria-hidden>
                      <AppIcon name={mcpStatusIcon(server.status)} size="sm" />
                    </span>
                    <span className="mcp-server-text">
                      <strong>{server.name}</strong>
                      <small>
                        {server.toolCount} tool{server.toolCount === 1 ? "" : "s"}
                        {server.failedAgoSeconds !== undefined ? ` · failed ${server.failedAgoSeconds}s ago` : ""}
                      </small>
                    </span>
                    <em className={`mcp-status-label ${server.disabled ? "disabled" : server.status}`}>
                      {server.disabled ? "disabled" : server.status}
                    </em>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Skills" count={localSkills.length} defaultOpen>
            {localSkills.length === 0 ? (
              <div className="inspector-muted">No skills discovered</div>
            ) : (
              Array.from(skillGroups.entries())
                .sort(([, a], [, b]) => {
                  const aOff = a.every((skill) => skill.enabled === false);
                  const bOff = b.every((skill) => skill.enabled === false);
                  return Number(aOff) - Number(bOff);
                })
                .map(([group, members]) => {
                const allEnabled = members.every((skill) => skill.enabled !== false);
                return (
                  <div className="skill-group" key={group}>
                    <label className="skill-group-heading">
                      <input
                        className="inspector-switch-input"
                        type="checkbox"
                        checked={allEnabled}
                        disabled={!onToggleSkills}
                        onChange={() => toggleSkillGroup(group, !allEnabled)}
                      />
                      <span className="skill-group-name">{group}</span>
                      <small>{members.length}</small>
                      <span className="inspector-switch" aria-hidden="true" />
                    </label>
                    {members.length > 1 && (
                      <div className="skill-group-members">
                        {[...members]
                          .sort((a, b) => (a.enabled === false ? 1 : 0) - (b.enabled === false ? 1 : 0))
                          .map((skill) => (
                          <label className="skill-toggle-row" key={skill.path}>
                            <input
                              className="inspector-switch-input"
                              type="checkbox"
                              checked={skill.enabled !== false}
                              disabled={!onToggleSkills}
                              onChange={() => toggleSkill(skill)}
                            />
                            <span className="skill-toggle-name">{skill.name}</span>
                            <em className={skill.enabled === false ? "disabled" : ""}>{skill.enabled === false ? "off" : "on"}</em>
                            <span className="inspector-switch" aria-hidden="true" />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Extensions & Packages" count={resources.extensions.length + resources.packages.length} defaultOpen>
            {resources.packages.length === 0 && resources.extensions.length === 0 ? (
              <div className="inspector-muted">No extensions or packages</div>
            ) : (
              <>
                {resources.packages.map((pkg) => (
                  <PackageGroup
                    key={pkg.source}
                    name={pkg.name}
                    source={pkg.source}
                    enabled={pkg.enabled}
                    resources={pkg.resources}
                    extensions={resources.extensions.filter((ext) => ext.pkgSource === pkg.source)}
                  />
                ))}
                {resources.extensions.filter((ext) => !ext.pkgSource).map((ext) => (
                  <ExtensionRow
                    key={ext.name}
                    ok={ext.loaded}
                    label={ext.name}
                    error={ext.loaded ? undefined : ext.error}
                  />
                ))}
              </>
            )}
          </CollapsibleSection>
        </div>
      )}

      {tab === "index" && <IndexPanel cwd={session.cwd} indexStatus={indexStatus} />}
    </aside>
  );
}
