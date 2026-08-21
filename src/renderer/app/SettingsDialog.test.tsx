import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { McpConfigView, ProviderAuthStatus } from "../../shared/protocol";
import { useAppStore } from "../session/store";
import { SettingsDialog } from "./SettingsDialog";

const sampleProviders: ProviderAuthStatus[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    configured: true,
    source: "environment",
    sourceLabel: "DEEPSEEK_API_KEY",
    hasApiKeyLogin: true,
    hasOAuthLogin: false,
    canLogout: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    configured: false,
    source: "none",
    hasApiKeyLogin: true,
    hasOAuthLogin: false,
    canLogout: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    configured: false,
    source: "none",
    hasApiKeyLogin: true,
    hasOAuthLogin: true,
    canLogout: false,
  },
];

describe("SettingsDialog", () => {
  afterEach(() => {
    useAppStore.setState({ providerLogins: {}, resources: { contextFiles: [], extensions: [], skills: [], promptTemplates: [], themes: [], packages: [] } });
  });

  test("lets the user change the default model", () => {
    const onModelSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <SettingsDialog
        open
        models={[{ id: "anthropic/claude-sonnet", provider: "anthropic", label: "Claude Sonnet", available: true, thinkingLevels: ["high"] }]}
        model="auto"
        thinkingLevel="medium"
        onModelSelect={onModelSelect}
        onThinkingLevel={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /model/i }), {
      target: { value: "anthropic/claude-sonnet" },
    });
    fireEvent.click(screen.getByRole("button", { name: /back to app/i }));

    expect(onModelSelect).toHaveBeenCalledWith("anthropic/claude-sonnet");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("syncs the model when the selected provider changes", async () => {
    const onModelSelect = vi.fn();
    const providerRows: ProviderAuthStatus[] = [
      { ...sampleProviders[0] },
      { ...sampleProviders[1], configured: true, source: "stored", canLogout: true },
    ];

    render(
      <SettingsDialog
        open
        models={[
          { id: "deepseek/chat", provider: "deepseek", label: "DeepSeek Chat", available: true, thinkingLevels: ["medium"] },
          { id: "openai/gpt-5", provider: "openai", label: "GPT-5", available: true, thinkingLevels: ["medium"] },
        ]}
        model="deepseek/chat"
        thinkingLevel="medium"
        onModelSelect={onModelSelect}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        listProviders={vi.fn(async () => providerRows)}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /providers/i }));
    const select = await screen.findByRole("combobox", { name: /select provider/i });
    fireEvent.change(select, { target: { value: "openai" } });

    await waitFor(() => {
      expect(onModelSelect).toHaveBeenCalledWith("openai/gpt-5");
    });
  });

  test("repairs an invalid current model when available models refresh", async () => {
    const onModelSelect = vi.fn();

    render(
      <SettingsDialog
        open
        models={[
          { id: "deepseek/chat", provider: "deepseek", label: "DeepSeek Chat", available: true, thinkingLevels: ["medium"] },
        ]}
        model="amazon/nova-pro"
        thinkingLevel="medium"
        onModelSelect={onModelSelect}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(onModelSelect).toHaveBeenCalledWith("deepseek/chat");
    });
  });

  test("toggles interface motion", () => {
    const onMotionEnabledChange = vi.fn();
    render(
      <SettingsDialog
        open
        models={[]}
        model="auto"
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onMotionEnabledChange={onMotionEnabledChange}
        onClose={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Interface motion" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onMotionEnabledChange).toHaveBeenCalledWith(false);
  });

  test("renders nothing when closed", () => {
    render(
      <SettingsDialog
        open={false}
        models={[]}
        model="auto"
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog", { name: /pi settings/i })).not.toBeInTheDocument();
  });

  test("Providers tab uses a dropdown and can connect with an API key", async () => {
    const listProviders = vi.fn(async () => sampleProviders);
    const loginWithApiKey = vi.fn(async () => ({ name: "OpenAI" }));
    const onProvidersChanged = vi.fn(async () => undefined);

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        listProviders={listProviders}
        loginWithApiKey={loginWithApiKey}
        logoutProvider={vi.fn(async () => undefined)}
        onProvidersChanged={onProvidersChanged}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /providers/i }));

    const select = await screen.findByRole("combobox", { name: /select provider/i });
    expect(listProviders).toHaveBeenCalled();
    expect(select).toBeInTheDocument();

    // Default prefers configured provider (DeepSeek).
    expect((select as HTMLSelectElement).value).toBe("deepseek");
    expect(screen.getAllByText("Env").length).toBeGreaterThan(0);

    fireEvent.change(select, { target: { value: "openai" } });
    expect((select as HTMLSelectElement).value).toBe("openai");
    expect(screen.getByText("Not connected")).toBeInTheDocument();

    const keyInput = screen.getByPlaceholderText(/paste openai api key/i);
    fireEvent.change(keyInput, { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(loginWithApiKey).toHaveBeenCalledWith("openai", "sk-test-key");
      expect(onProvidersChanged).toHaveBeenCalled();
    });
  });

  test("Account login starts for OAuth-capable providers", async () => {
    const loginWithOAuth = vi.fn(async () => ({ name: "Anthropic" }));

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        listProviders={vi.fn(async () => sampleProviders)}
        loginWithOAuth={loginWithOAuth}
        answerAuthPrompt={vi.fn(async () => undefined)}
        cancelProviderLogin={vi.fn(async () => undefined)}
        openExternal={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /providers/i }));
    const select = await screen.findByRole("combobox", { name: /select provider/i });
    fireEvent.change(select, { target: { value: "anthropic" } });

    const button = await screen.findByRole("button", { name: /sign in with an account/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(loginWithOAuth).toHaveBeenCalledWith("anthropic");
    });
  });

  test("Running account login shows progress and answers interactive prompts", async () => {
    const answerAuthPrompt = vi.fn(async () => undefined);
    const cancelProviderLogin = vi.fn(async () => undefined);
    const openExternal = vi.fn(async () => undefined);
    useAppStore.setState({
      providerLogins: {
        anthropic: {
          status: "running",
          events: [
            { type: "auth_url", url: "https://auth.example.com/start", instructions: "Authorize in your browser" },
            {
              type: "prompt",
              prompt: {
                promptId: "login-1",
                type: "select",
                message: "How do you want to log in?",
                options: [
                  { id: "browser", label: "Browser login (default)" },
                  { id: "device", label: "Device code login (headless)" },
                ],
              },
            },
          ],
        },
      },
    });

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        listProviders={vi.fn(async () => sampleProviders)}
        loginWithOAuth={vi.fn(async () => ({ name: "Anthropic" }))}
        answerAuthPrompt={answerAuthPrompt}
        cancelProviderLogin={cancelProviderLogin}
        openExternal={openExternal}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /providers/i }));
    const select = await screen.findByRole("combobox", { name: /select provider/i });
    fireEvent.change(select, { target: { value: "anthropic" } });

    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    expect(screen.getByText(/authorize in your browser/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open authorization page/i }));
    expect(openExternal).toHaveBeenCalledWith("https://auth.example.com/start");

    fireEvent.click(screen.getByRole("radio", { name: /device code login/i }));
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    await waitFor(() => {
      expect(answerAuthPrompt).toHaveBeenCalledWith("login-1", "device");
    });
  });

  test("Cancel login aborts the running flow", async () => {
    const cancelProviderLogin = vi.fn(async () => undefined);
    useAppStore.setState({
      providerLogins: {
        anthropic: {
          status: "running",
          events: [{ type: "progress", message: "Waiting for authentication…" }],
        },
      },
    });

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        listProviders={vi.fn(async () => sampleProviders)}
        loginWithOAuth={vi.fn(async () => ({ name: "Anthropic" }))}
        answerAuthPrompt={vi.fn(async () => undefined)}
        cancelProviderLogin={cancelProviderLogin}
        openExternal={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /providers/i }));
    const select = await screen.findByRole("combobox", { name: /select provider/i });
    fireEvent.change(select, { target: { value: "anthropic" } });

    fireEvent.click(screen.getByRole("button", { name: /cancel login/i }));
    expect(cancelProviderLogin).toHaveBeenCalledWith("anthropic");
  });

  test("MCP tab lists servers with live status and toggles one", async () => {
    const getMcpConfig = vi.fn(async (): Promise<McpConfigView> => ({
      cwd: "/tmp/project",
      sources: [
        { path: "/tmp/project/.pi/mcp.json", exists: true, serverCount: 1 },
        { path: "/Users/me/.config/mcp/mcp.json", exists: true, serverCount: 1 },
      ],
      servers: [
        { name: "github", disabled: false, source: "/tmp/project/.pi/mcp.json" },
        { name: "legacy", disabled: true, source: "/Users/me/.config/mcp/mcp.json" },
      ],
    }));
    const setMcpServerEnabled = vi.fn(async () => ({ changed: true, path: "/tmp/project/.pi/mcp.json" }));
    useAppStore.setState({
      resources: {
        contextFiles: [],
        extensions: [],
        skills: [],
        promptTemplates: [],
        themes: [],
        packages: [],
        mcp: {
          version: 1,
          servers: [{ name: "github", status: "connected", toolCount: 12, disabled: false }],
          totalTools: 12,
          connectedCount: 1,
          disabledCount: 0,
        },
      },
    });

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        getMcpConfig={getMcpConfig}
        setMcpServerEnabled={setMcpServerEnabled}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /mcp/i }));

    await waitFor(() => expect(getMcpConfig).toHaveBeenCalled());
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText(/connected · 12 tools/)).toBeInTheDocument();
    // Shortened source path is shown under the server row.
    expect(screen.getByText(/…\/\.pi\/mcp\.json/)).toBeInTheDocument();

    // Toggling the enabled server disables it.
    fireEvent.click(screen.getByLabelText(/github/i));
    await waitFor(() => expect(setMcpServerEnabled).toHaveBeenCalledWith("github", false));
    expect(screen.getByText(/disabled github/i)).toBeInTheDocument();
  });

  test("MCP tab imports servers from Cursor and refreshes", async () => {
    const getMcpConfig = vi.fn(async (): Promise<McpConfigView> => ({
      cwd: "/tmp/project",
      sources: [],
      servers: [],
    }));
    const importCursorMcp = vi.fn(async () => ({ imported: ["cursor-db"], skipped: [] }));

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        getMcpConfig={getMcpConfig}
        importCursorMcp={importCursorMcp}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /mcp/i }));
    await waitFor(() => expect(getMcpConfig).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /import from cursor/i }));
    await waitFor(() => expect(importCursorMcp).toHaveBeenCalled());
    expect(screen.getByText(/imported from cursor: cursor-db/i)).toBeInTheDocument();
    expect(getMcpConfig).toHaveBeenCalledTimes(2);
  });

  test("MCP tab shows an empty state when no servers are configured", async () => {
    const getMcpConfig = vi.fn(async (): Promise<McpConfigView> => ({
      cwd: "/tmp/project",
      sources: [],
      servers: [],
    }));

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        getMcpConfig={getMcpConfig}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /mcp/i }));

    await waitFor(() => expect(getMcpConfig).toHaveBeenCalled());
    expect(screen.getByText(/no mcp servers configured for this project/i)).toBeInTheDocument();
  });

  test("Phone tab can enable the companion gateway", async () => {
    const getCompanionState = vi.fn(async () => ({
      enabled: false,
      listening: false,
      port: 17890,
      token: "tok",
      urls: [],
    }));
    const setCompanionEnabled = vi.fn(async () => ({
      enabled: true,
      listening: true,
      port: 17890,
      token: "tok",
      urls: [{ kind: "lan" as const, origin: "http://192.168.1.23:17890", label: "Local network" }],
      qrDataUrl: "data:image/png;base64,qq",
    }));

    render(
      <SettingsDialog
        open
        models={[]}
        model=""
        thinkingLevel="medium"
        onModelSelect={vi.fn()}
        onThinkingLevel={vi.fn()}
        onClose={vi.fn()}
        getCompanionState={getCompanionState}
        setCompanionEnabled={setCompanionEnabled}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /phone/i }));
    const toggle = await screen.findByRole("switch", { name: /allow phone/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(setCompanionEnabled).toHaveBeenCalledWith(true));
    expect(await screen.findByText(/192\.168\.1\.23:17890/)).toBeInTheDocument();
  });
});
