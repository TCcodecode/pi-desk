import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CompanionState,
  McpConfigView,
  ModelOption,
  ProviderAuthStatus,
  ThinkingLevel,
} from "../../shared/protocol";
import { useAppStore } from "../session/store";
import { ModelSelector } from "../session/ModelSelector";
import { AppIcon } from "../ui/icons";
import { Dialog } from "../ui/Dialog";
import { OAuthProgressPanel } from "./OAuthPanel";

type SettingsTab = "general" | "providers" | "mcp" | "phone";

export function SettingsDialog({
  open,
  models,
  model,
  thinkingLevel,
  onModelSelect,
  onThinkingLevel,
  motionEnabled = true,
  onMotionEnabledChange,
  onClose,
  listProviders,
  loginWithApiKey,
  logoutProvider,
  loginWithOAuth,
  answerAuthPrompt,
  cancelProviderLogin,
  openExternal,
  onProvidersChanged,
  getMcpConfig,
  setMcpServerEnabled,
  importCursorMcp,
  openMcpConfigFile,
  getCompanionState,
  setCompanionEnabled,
  rotateCompanionToken,
}: {
  open: boolean;
  models: ModelOption[];
  model: string;
  thinkingLevel: ThinkingLevel;
  onModelSelect: (model: string) => void;
  onThinkingLevel: (level: ThinkingLevel) => void;
  motionEnabled?: boolean;
  onMotionEnabledChange?: (enabled: boolean) => void;
  onClose: () => void;
  listProviders?: () => Promise<ProviderAuthStatus[]>;
  loginWithApiKey?: (providerId: string, apiKey: string) => Promise<{ name: string }>;
  logoutProvider?: (providerId: string) => Promise<void>;
  /** Start an account (OAuth) login. Progress/prompts stream via providerLogins. */
  loginWithOAuth?: (providerId: string) => Promise<{ name: string }>;
  /** Answer an interactive prompt surfaced during an account login. */
  answerAuthPrompt?: (promptId: string, answer: string) => Promise<void>;
  /** Cancel an in-flight account login. */
  cancelProviderLogin?: (providerId: string) => Promise<void>;
  /** Open an OAuth authorization link in the default browser. */
  openExternal?: (url: string) => Promise<void>;
  /** Called after login/logout so the parent can refresh model lists. */
  onProvidersChanged?: () => void | Promise<void>;
  /** Read the merged MCP config for the current workspace. */
  getMcpConfig?: () => Promise<McpConfigView>;
  /** Enable/disable an MCP server (writes .pi/mcp.json and reloads the runtime). */
  setMcpServerEnabled?: (name: string, enabled: boolean) => Promise<{ changed: boolean; path: string }>;
  /** Copy servers from Cursor's config into the project override. */
  importCursorMcp?: () => Promise<{ imported: string[]; skipped: string[] }>;
  /** Open the project MCP override file in the default editor. */
  openMcpConfigFile?: () => Promise<void>;
  getCompanionState?: () => Promise<CompanionState>;
  setCompanionEnabled?: (enabled: boolean) => Promise<CompanionState>;
  rotateCompanionToken?: () => Promise<CompanionState>;
}) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [providers, setProviders] = useState<ProviderAuthStatus[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [mcpConfig, setMcpConfig] = useState<McpConfigView | undefined>();
  const [mcpError, setMcpError] = useState<string | undefined>();
  const [companion, setCompanion] = useState<CompanionState | undefined>();
  const [companionBusy, setCompanionBusy] = useState(false);

  const providerLogins = useAppStore((state) => state.providerLogins);
  const clearProviderLogin = useAppStore((state) => state.clearProviderLogin);
  /** Live adapter status for the current workspace (drives status dots). */
  const mcpStatus = useAppStore((state) => state.resources.mcp);

  // Keep props for App wiring; thinking is primarily controlled from the chatbox.
  void thinkingLevel;
  void onThinkingLevel;

  const refreshProviders = useCallback(async () => {
    if (!listProviders) {
      setProviders([]);
      setProvidersError("Provider API is unavailable. Fully quit and restart Pi Desktop.");
      return;
    }
    setProvidersLoading(true);
    setProvidersError(undefined);
    try {
      const next = await listProviders();
      const list = Array.isArray(next) ? next : [];
      setProviders(list);
      if (list.length === 0) {
        setProvidersError("No providers were returned by Pi. Restart the app and try again.");
      }
      setSelectedId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        const preferred = list.find((item) => item.configured) ?? list[0];
        return preferred?.id ?? "";
      });
    } catch (error) {
      setProviders([]);
      setProvidersError(error instanceof Error ? error.message : String(error));
    } finally {
      setProvidersLoading(false);
    }
  }, [listProviders]);

  const refreshMcpConfig = useCallback(async () => {
    if (!getMcpConfig) {
      setMcpConfig(undefined);
      setMcpError("MCP API is unavailable. Fully quit and restart Pi Desktop.");
      return;
    }
    try {
      const next = await getMcpConfig();
      setMcpConfig(next);
      setMcpError(undefined);
    } catch (error) {
      setMcpConfig(undefined);
      setMcpError(error instanceof Error ? error.message : String(error));
    }
  }, [getMcpConfig]);

  const toggleMcpServer = async (name: string, enabled: boolean) => {
    if (!setMcpServerEnabled) return;
    setBusy(true);
    setActionMessage(undefined);
    try {
      await setMcpServerEnabled(name, enabled);
      setActionMessage(enabled ? `Enabled ${name}` : `Disabled ${name}`);
      await refreshMcpConfig();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const importFromCursor = async () => {
    if (!importCursorMcp) return;
    setBusy(true);
    setActionMessage(undefined);
    try {
      const result = await importCursorMcp();
      if (result.imported.length > 0) {
        setActionMessage(
          `Imported from Cursor: ${result.imported.join(", ")}${result.skipped.length > 0 ? ` · skipped ${result.skipped.join(", ")}` : ""}`,
        );
      } else if (result.skipped.length > 0) {
        setActionMessage("Nothing new to import — Cursor servers already exist here");
      } else {
        setActionMessage("No Cursor MCP config found at ~/.cursor/mcp.json");
      }
      await refreshMcpConfig();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openMcpFile = async () => {
    if (!openMcpConfigFile) return;
    setActionMessage(undefined);
    try {
      await openMcpConfigFile();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshCompanion = useCallback(async () => {
    if (!getCompanionState) {
      setCompanion(undefined);
      return;
    }
    try {
      setCompanion(await getCompanionState());
    } catch (error) {
      setCompanion({
        enabled: false,
        listening: false,
        port: 17890,
        token: "",
        urls: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [getCompanionState]);

  const toggleCompanion = async (enabled: boolean) => {
    if (!setCompanionEnabled) return;
    setCompanionBusy(true);
    try {
      setCompanion(await setCompanionEnabled(enabled));
    } catch (error) {
      setCompanion((current) => ({
        enabled: false,
        listening: false,
        port: current?.port ?? 17890,
        token: current?.token ?? "",
        urls: current?.urls ?? [],
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setCompanionBusy(false);
    }
  };

  const rotateCompanion = async () => {
    if (!rotateCompanionToken) return;
    setCompanionBusy(true);
    try {
      setCompanion(await rotateCompanionToken());
    } finally {
      setCompanionBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setTab("general");
      setSelectedId("");
      setApiKeyDraft("");
      setActionMessage(undefined);
      setProvidersError(undefined);
      setMcpConfig(undefined);
      setMcpError(undefined);
      setBusy(false);
      // Reset the login UI. In-flight logins continue in the background:
      // the next provider_login_event recreates the entry automatically.
      const logins = useAppStore.getState().providerLogins;
      for (const providerId of Object.keys(logins)) {
        clearProviderLogin(providerId);
      }
      return;
    }
    if (tab === "providers") {
      // Drop finished logins from an earlier session so the panel shows a fresh button.
      const logins = useAppStore.getState().providerLogins;
      for (const [providerId, login] of Object.entries(logins)) {
        if (login.status !== "running") clearProviderLogin(providerId);
      }
      void refreshProviders();
    }
    if (tab === "mcp") {
      void refreshMcpConfig();
    }
    if (tab === "phone") {
      void refreshCompanion();
    }
  }, [open, tab, refreshProviders, refreshMcpConfig, refreshCompanion, clearProviderLogin]);

  const selected = useMemo(
    () => providers.find((provider) => provider.id === selectedId),
    [providers, selectedId],
  );

  const oauthLogin = selected ? providerLogins[selected.id] : undefined;

  const connectedProviders = useMemo(
    () => providers.filter((provider) => provider.configured),
    [providers],
  );
  const availableModels = useMemo(
    () => models.filter((item) => item.available),
    [models],
  );

  useEffect(() => {
    if (!open || availableModels.length === 0) return;
    const currentModelAvailable = availableModels.some((item) => item.id === model);
    const currentProviderId = model.includes("/") ? model.split("/", 1)[0] : "";
    const preferredFromSelectedProvider = selectedId
      ? availableModels.find((item) => item.provider === selectedId)?.id
      : undefined;
    const nextModel =
      preferredFromSelectedProvider && (currentProviderId !== selectedId || !currentModelAvailable)
        ? preferredFromSelectedProvider
        : !currentModelAvailable
          ? availableModels[0]?.id
          : undefined;

    if (nextModel && nextModel !== model) onModelSelect(nextModel);
  }, [availableModels, model, onModelSelect, open, selectedId]);

  const connectProvider = async () => {
    if (!loginWithApiKey || !selected) return;
    const key = apiKeyDraft.trim();
    if (!key) {
      setActionMessage("Enter an API key first.");
      return;
    }
    setBusy(true);
    setActionMessage(undefined);
    try {
      const result = await loginWithApiKey(selected.id, key);
      setActionMessage(`Saved API key for ${result.name}. Stored in ~/.pi/agent/auth.json`);
      setApiKeyDraft("");
      await refreshProviders();
      await onProvidersChanged?.();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnectProvider = async () => {
    if (!logoutProvider || !selected) return;
    setBusy(true);
    setActionMessage(undefined);
    try {
      await logoutProvider(selected.id);
      setActionMessage(`Removed stored credential for ${selected.name}. Environment variables are unchanged.`);
      setApiKeyDraft("");
      await refreshProviders();
      await onProvidersChanged?.();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const startOAuthLogin = async () => {
    if (!loginWithOAuth || !selected) return;
    setBusy(true);
    setActionMessage(undefined);
    try {
      const result = await loginWithOAuth(selected.id);
      clearProviderLogin(selected.id);
      setActionMessage(`Signed in to ${result.name}. Credential stored in ~/.pi/agent/auth.json`);
      await refreshProviders();
      await onProvidersChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Cancellation surfaces an error event; treat it as a quiet reset.
      clearProviderLogin(selected.id);
      if (message !== "Login cancelled") {
        setActionMessage(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const tabMeta: Record<SettingsTab, { title: string; subtitle: string }> = {
    general: {
      title: "General",
      subtitle: "Choose your default model and interface behavior.",
    },
    providers: {
      title: "Providers",
      subtitle: "Connect the services that power your workspace.",
    },
    mcp: {
      title: "MCP",
      subtitle: "Manage project tools and Model Context Protocol servers.",
    },
    phone: {
      title: "Phone",
      subtitle: "Pair a phone on this Wi-Fi. Tailscale uses the same gateway later.",
    },
  };

  return (
    <Dialog open={open} onClose={onClose} label="Pi settings" panelClassName="settings-dialog settings-dialog-wide">
      <div className="settings-heading">
          <div>
            <span className="settings-heading-kicker">PI DESK / SETTINGS</span>
            <span className="settings-heading-title">
              <strong>{tabMeta[tab].title}</strong>
              {tab === "providers" && (
                <button
                  type="button"
                  className="settings-info-button settings-heading-info-button"
                  aria-label="Provider credential details"
                  title="Same as Pi /login and /logout. Credentials are saved to ~/.pi/agent/auth.json. Environment variables still work but cannot be removed here."
                >
                  <AppIcon name="circleHelp" size="sm" />
                </button>
              )}
            </span>
            <p className="settings-subtitle">{tabMeta[tab].subtitle}</p>
          </div>
        </div>

        <div className="settings-tabs">
          <button type="button" className="settings-back-button" onClick={onClose}>
            <AppIcon name="chevronRight" size="sm" />
            <span>Back to app</span>
          </button>
          <label className="settings-search">
            <AppIcon name="search" size="sm" />
            <input type="search" aria-label="Search settings" placeholder="Search settings…" />
          </label>
          <div className="settings-nav-label">SETTINGS</div>
          <div className="settings-tab-list" role="tablist" aria-label="Settings sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "general"}
              className={`settings-tab ${tab === "general" ? "active" : ""}`}
              onClick={() => setTab("general")}
            >
              <AppIcon name="settings" size="sm" />
              <span className="settings-tab-copy">
                <span>General</span>
                <small>Defaults</small>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "providers"}
              className={`settings-tab ${tab === "providers" ? "active" : ""}`}
              onClick={() => setTab("providers")}
            >
              <AppIcon name="user" size="sm" />
              <span className="settings-tab-copy">
                <span>Providers</span>
                <small>Credentials</small>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mcp"}
              className={`settings-tab ${tab === "mcp" ? "active" : ""}`}
              onClick={() => setTab("mcp")}
            >
              <AppIcon name="braces" size="sm" />
              <span className="settings-tab-copy">
                <span>MCP</span>
                <small>Project tools</small>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "phone"}
              className={`settings-tab ${tab === "phone" ? "active" : ""}`}
              onClick={() => setTab("phone")}
            >
              <AppIcon name="globe" size="sm" />
              <span className="settings-tab-copy">
                <span>Phone</span>
                <small>Android companion</small>
              </span>
            </button>
          </div>
        </div>

        <div className="settings-body">
          {tab === "general" && (
            <>
              <section className="settings-section">
                <div className="settings-section-label">Available Models</div>
                <div className="settings-field">
                  <div className="settings-field-meta">
                    <label>Default model</label>
                    <span>Models listed here come from connected providers</span>
                  </div>
                  <ModelSelector
                    className="settings-control"
                    models={models.filter((item) => item.available)}
                    current={model}
                    onSelect={onModelSelect}
                  />
                </div>
              </section>
              <section className="settings-section">
                <div className="settings-section-label">Interface</div>
                <div className="settings-field">
                  <div className="settings-field-meta">
                    <label>Interface motion</label>
                    <span>Enable panel transitions, hover feedback, and other subtle animations</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-motion-toggle ${motionEnabled ? "is-on" : ""}`}
                    role="switch"
                    aria-label="Interface motion"
                    aria-checked={motionEnabled}
                    onClick={() => onMotionEnabledChange?.(!motionEnabled)}
                  >
                    <span className="settings-motion-track" aria-hidden="true">
                      <span className="settings-motion-thumb" />
                    </span>
                    <span className="settings-motion-state">{motionEnabled ? "On" : "Off"}</span>
                  </button>
                </div>
              </section>
            </>
          )}

          {tab === "providers" && (
            <section className="settings-section">
              {providersLoading && <p className="settings-providers-status">Loading providers…</p>}
              {providersError && <p className="settings-providers-error">{providersError}</p>}
              {actionMessage && <p className="settings-providers-status">{actionMessage}</p>}

              {!providersLoading && !providersError && providers.length === 0 && (
                <p className="settings-providers-status">No providers available.</p>
              )}

              {providers.length > 0 && (
                <>
                  <div className="settings-field settings-provider-picker">
                    <div className="settings-field-meta">
                      <label htmlFor="settings-provider-select">Provider</label>
                      <span>Pick a provider to connect or manage</span>
                    </div>
                    <div className="settings-select-wrap">
                      <select
                        id="settings-provider-select"
                        className="settings-control settings-provider-select"
                        aria-label="Select provider"
                        value={selectedId}
                        onChange={(event) => {
                          setSelectedId(event.target.value);
                          setApiKeyDraft("");
                          setActionMessage(undefined);
                        }}
                      >
                        {providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {providerStatusPrefix(provider)} {provider.name} ({provider.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selected && (
                    <div className="settings-provider-detail">
                      <div className="settings-provider-main">
                        <div className="settings-provider-title">
                          <strong>{selected.name}</strong>
                          <span className="settings-provider-id">{selected.id}</span>
                        </div>
                        <div className="settings-provider-meta">
                          <StatusBadge provider={selected} />
                          {selected.sourceLabel && selected.configured && (
                            <span className="settings-provider-source">{selected.sourceLabel}</span>
                          )}
                        </div>
                      </div>

                      {selected.hasApiKeyLogin && (
                        <div className="settings-provider-connect-stack">
                          <label className="settings-provider-key-field">
                            <span>API key</span>
                            <input
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={`Paste ${selected.name} API key`}
                              value={apiKeyDraft}
                              onChange={(event) => setApiKeyDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void connectProvider();
                                }
                              }}
                            />
                          </label>
                          <div className="settings-provider-actions">
                            <button
                              type="button"
                              className="settings-provider-btn primary"
                              disabled={busy || !apiKeyDraft.trim()}
                              onClick={() => void connectProvider()}
                            >
                              {busy
                                ? "Saving…"
                                : selected.canLogout || selected.configured
                                  ? "Save / update key"
                                  : "Connect"}
                            </button>
                            {selected.canLogout && (
                              <button
                                type="button"
                                className="settings-provider-btn danger"
                                disabled={busy}
                                onClick={() => void disconnectProvider()}
                              >
                                {busy ? "…" : "Logout"}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {selected.hasOAuthLogin && (
                        <div className="settings-provider-connect-stack settings-provider-oauth-stack">
                          <div className="settings-provider-oauth-heading">
                            <span>Account</span>
                            {oauthLogin?.status === "running" && <span className="settings-provider-oauth-state">Signing in…</span>}
                          </div>
                          {oauthLogin?.status === "running" ? (
                            <OAuthProgressPanel
                              provider={selected}
                              state={oauthLogin}
                              answerAuthPrompt={answerAuthPrompt}
                              cancelProviderLogin={cancelProviderLogin}
                              openExternal={openExternal}
                            />
                          ) : (
                            <div className="settings-provider-actions">
                              <button
                                type="button"
                                className="settings-provider-btn primary"
                                disabled={busy || !loginWithOAuth}
                                onClick={() => void startOAuthLogin()}
                              >
                                {busy ? "Starting…" : "Sign in with an account"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {!selected.hasApiKeyLogin && !selected.hasOAuthLogin && (
                        <p className="settings-provider-note">
                          No interactive login for this provider (ambient / local only).
                        </p>
                      )}
                    </div>
                  )}

                  {connectedProviders.length > 0 && (
                    <div className="settings-connected-block">
                      <div className="settings-section-label">Currently Available</div>
                      <ul className="settings-connected-list">
                          {connectedProviders.map((provider) => (
                            <li className="settings-connected-row" key={provider.id}>
                            <button
                              type="button"
                              className={`settings-connected-item ${provider.id === selectedId ? "active" : ""}`}
                              onClick={() => {
                                setSelectedId(provider.id);
                                setApiKeyDraft("");
                                setActionMessage(undefined);
                              }}
                            >
                              <span className="settings-connected-name">{provider.name}</span>
                              <StatusBadge provider={provider} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === "mcp" && (
            <section className="settings-section settings-mcp-section">
              <div className="settings-mcp-header">
                <div className="settings-mcp-header-copy">
                  <div className="settings-section-label">Servers</div>
                  <p className="settings-mcp-description">
                    Toggle a server to reload its tools in the current workspace.
                  </p>
                </div>
                <div className="settings-mcp-actions">
                  <button
                    type="button"
                    className="settings-provider-btn primary"
                    disabled={busy || !importCursorMcp}
                    onClick={() => void importFromCursor()}
                  >
                    {busy ? "Working…" : "Import from Cursor"}
                  </button>
                  <button
                    type="button"
                    className="settings-provider-btn"
                    disabled={!openMcpConfigFile}
                    onClick={() => void openMcpFile()}
                  >
                    Edit mcp.json
                  </button>
                </div>
              </div>

              {mcpError && <p className="settings-providers-error">{mcpError}</p>}
              {actionMessage && <p className="settings-providers-status">{actionMessage}</p>}

              {!mcpConfig ? (
                <p className="settings-providers-status">Loading MCP config…</p>
              ) : mcpConfig.servers.length === 0 ? (
                <div className="settings-empty-state">
                  <strong>No MCP servers configured for this project</strong>
                  <span>Import from Cursor or edit mcp.json to add project tools.</span>
                </div>
              ) : (
                <ul className="settings-mcp-list">
                  {mcpConfig.servers.map((server) => {
                    const live = mcpStatus?.servers.find((item) => item.name === server.name);
                    return (
                      <li className="settings-mcp-row" key={server.name}>
                        <div className="settings-mcp-identity">
                          <span className="settings-mcp-name">{server.name}</span>
                          <small className="settings-mcp-source" title={server.source}>
                            {shortenMcpPath(server.source)}
                          </small>
                        </div>
                        <span className={`settings-mcp-state ${live?.status === "failed" ? "failed" : ""}`}>
                          {live
                            ? `${live.status}${live.toolCount > 0 ? ` · ${live.toolCount} tools` : ""}`
                            : server.disabled
                              ? "disabled"
                              : "not running"}
                        </span>
                        <label className="settings-mcp-toggle" aria-label={`Enable ${server.name}`}>
                          <input
                            className="settings-mcp-switch-input"
                            type="checkbox"
                            checked={!server.disabled}
                            disabled={busy || !setMcpServerEnabled}
                            onChange={() => void toggleMcpServer(server.name, server.disabled)}
                          />
                          <span className="settings-mcp-switch" aria-hidden="true" />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {tab === "phone" && (
            <section className="settings-section">
              <div className="settings-section-label">Companion</div>
              <div className="settings-field">
                <div className="settings-field-meta">
                  <label>Allow phone connection</label>
                  <span>Opens a local gateway on port {companion?.port ?? 17890}. Same Wi-Fi first; Tailscale is the same URL later.</span>
                </div>
                <button
                  type="button"
                  className={`settings-motion-toggle ${companion?.enabled ? "is-on" : ""}`}
                  role="switch"
                  aria-label="Allow phone connection"
                  aria-checked={companion?.enabled === true}
                  disabled={companionBusy || !setCompanionEnabled}
                  onClick={() => void toggleCompanion(!(companion?.enabled ?? false))}
                >
                  <span className="settings-motion-track" aria-hidden="true">
                    <span className="settings-motion-thumb" />
                  </span>
                  <span className="settings-motion-state">{companion?.enabled ? "On" : "Off"}</span>
                </button>
              </div>
              {companion?.error && <p className="settings-providers-error">{companion.error}</p>}
              {companion?.enabled && (
                <>
                  {companion.qrDataUrl && (
                    <div className="settings-companion-qr">
                      <img src={companion.qrDataUrl} alt="Pairing QR code" width={220} height={220} />
                      <p>Scan with the phone camera, or open a URL below.</p>
                    </div>
                  )}
                  <ul className="settings-companion-urls">
                    {companion.urls.map((url) => (
                      <li key={url.origin}>
                        <span>
                          <small>{url.label}</small>
                          <code>{url.origin}</code>
                        </span>
                        <button
                          type="button"
                          className="settings-provider-btn"
                          onClick={() => void navigator.clipboard.writeText(`${url.origin}/?t=${companion.token}`)}
                        >
                          Copy
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="settings-provider-btn"
                    disabled={companionBusy || !rotateCompanionToken}
                    onClick={() => void rotateCompanion()}
                  >
                    Rotate pairing token
                  </button>
                </>
              )}
            </section>
          )}
        </div>

        <div className="settings-footer">
          {tab === "general"
            ? "Switch model and effort from the chatbox right before you send."
            : tab === "providers"
              ? "Choose a provider from the dropdown, then connect with an API key or an account."
              : tab === "phone"
                ? "The computer must stay awake. Do not expose this port on the public internet."
                : "Servers come from standard mcp.json files; the desktop writes per-project overrides."}
        </div>
    </Dialog>
  );
}

/** Shorten an mcp.json source path to its last two segments (e.g. …/.pi/mcp.json). */
function shortenMcpPath(path: string): string {
  if (!path) return "project";
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}

function providerStatusPrefix(provider: ProviderAuthStatus): string {
  if (!provider.configured) return "○";
  if (provider.source === "stored") return "●";
  if (provider.source === "environment" || provider.source === "runtime") return "◐";
  return "●";
}

function StatusBadge({ provider }: { provider: ProviderAuthStatus }) {
  if (!provider.configured) {
    return <span className="provider-badge off">Not connected</span>;
  }
  if (provider.source === "stored") {
    return <span className="provider-badge on">Connected</span>;
  }
  if (provider.source === "environment") {
    return <span className="provider-badge env">Env</span>;
  }
  if (provider.source === "runtime") {
    return <span className="provider-badge env">Runtime</span>;
  }
  return <span className="provider-badge on">Connected</span>;
}

