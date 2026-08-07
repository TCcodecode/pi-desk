import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IndexStatus, SymbolHit, UsageHit } from "@pi-desk/code-index";
import type { AccountUsage, PiApi, SessionState } from "../../shared/protocol";
import { useAppStore } from "./store";
import { getPiApi } from "../app/piApi";
import {
  formatBalanceAmount,
  formatSessionUsageLine,
  formatTokenCount,
  ResourceInspector,
  todoActiveLabel,
  todoProgressLabel,
  todoStatusIcon,
} from "./ResourceInspector";

vi.mock("./store", () => ({
  useAppStore: vi.fn(),
}));

vi.mock("../app/piApi", () => ({
  getPiApi: vi.fn(),
}));

const mockUseAppStore = useAppStore as unknown as ReturnType<typeof vi.fn>;
const mockGetPiApi = getPiApi as unknown as ReturnType<typeof vi.fn>;

const session: SessionState = {
  sessionId: "s1",
  cwd: "/tmp/project",
  name: "Test session",
  status: "running",
  model: "deepseek-v4",
  provider: "deepseek",
  thinkingLevel: "medium",
  contextTokens: 4000,
  contextWindow: 10000,
  inputTokens: 8100,
  outputTokens: 1200,
  cacheReadTokens: 3000,
  cacheWriteTokens: 100,
  cost: 1.25,
};

function mockStore(overrides: Record<string, unknown> = {}) {
  mockUseAppStore.mockImplementation((selector: (s: Record<string, unknown>) => unknown) => {
    const state = { indexStatus: null, ...overrides };
    return selector(state);
  });
}

function mockProviderUsage(account: AccountUsage) {
  mockGetPiApi.mockReturnValue({
    getProviderUsage: vi.fn(async () => ({
      providerId: "deepseek",
      session: {
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheWriteTokens: session.cacheWriteTokens,
        cost: session.cost,
        contextTokens: session.contextTokens,
        contextWindow: session.contextWindow,
      },
      account,
    })),
  } as unknown as PiApi);
}

function renderInspector(props: Record<string, unknown> = {}) {
  return render(
    <ResourceInspector
      session={session}
      resources={{ contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [] }}
      {...props}
    />,
  );
}

describe("usage formatters", () => {
  test("formatTokenCount compact", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(8100)).toBe("8.1k");
    expect(formatTokenCount(1200)).toBe("1.2k");
  });

  test("formatBalanceAmount by currency", () => {
    expect(formatBalanceAmount("CNY", 110)).toBe("¥110.00");
    expect(formatBalanceAmount("USD", 1.5)).toBe("$1.50");
  });

  test("formatSessionUsageLine", () => {
    expect(formatSessionUsageLine(session)).toBe("in 8.1k · out 1.2k · cache 3.1k");
  });

  test("todoProgressLabel and status icons", () => {
    const todos = [
        { id: "1", content: "a", status: "completed", priority: "high" },
        { id: "2", content: "b", status: "cancelled", priority: "low" },
        { id: "3", content: "c", status: "in_progress", priority: "medium" },
      ] as const;
    expect(todoProgressLabel([...todos])).toBe("1/3");
    expect(todoActiveLabel([...todos])).toBe("c");
    expect(todoActiveLabel(todos.filter((todo) => todo.status !== "in_progress"))).toBeUndefined();
    expect(todoStatusIcon("pending")).toBe("circle");
    expect(todoStatusIcon("in_progress")).toBe("circleDot");
    expect(todoStatusIcon("completed")).toBe("circleCheck");
    expect(todoStatusIcon("cancelled")).toBe("minus");
  });
});

describe("ResourceInspector", () => {
  beforeEach(() => {
    mockUseAppStore.mockReset();
    mockGetPiApi.mockReset();
    mockGetPiApi.mockReturnValue(undefined);
    mockStore();
  });

  test("shows session status dot, context bar, and session usage line", () => {
    renderInspector();
    expect(screen.getByText("Test session")).toBeInTheDocument();
    expect(screen.getByLabelText("status: running")).toBeInTheDocument();
    expect(screen.getByText("40% ctx")).toBeInTheDocument();
    expect(screen.getByText("$1.25")).toBeInTheDocument();
    expect(screen.getByText("in 8.1k · out 1.2k · cache 3.1k")).toBeInTheDocument();
  });

  test("does not render a Session Tree entry point", () => {
    renderInspector();
    expect(screen.queryByRole("button", { name: "Open session tree" })).not.toBeInTheDocument();
  });

  test("Context tab shows Todos section with items and empty state", () => {
    renderInspector({
      session: {
        ...session,
        todos: [
          { id: "1", content: "Parse protocol", status: "completed", priority: "high" },
          { id: "2", content: "Wire host", status: "in_progress", priority: "high" },
        ],
      },
      tab: "context",
    });
    expect(screen.getByText("Todos")).toBeInTheDocument();
    expect(screen.getByText("1/2 completed")).toBeInTheDocument();
    expect(screen.getByText("Now: Wire host")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "1 of 2 todos completed" })).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("Parse protocol")).toBeInTheDocument();
    expect(screen.getByText("Wire host")).toBeInTheDocument();

    renderInspector({ session: { ...session, todos: [] }, tab: "context" });
    expect(screen.getByText("No todos yet")).toBeInTheDocument();
  });

  test("shows DeepSeek prepaid balance under context bar in same currency as session cost", async () => {
    mockProviderUsage({
      mode: "prepaid_balance",
      providerId: "deepseek",
      label: "DeepSeek",
      currency: "USD",
      total: 12.5,
      granted: 0,
      toppedUp: 12.5,
      isAvailable: true,
      fetchedAt: new Date().toISOString(),
    });
    renderInspector();
    await waitFor(() => {
      expect(screen.getByText("DeepSeek")).toBeInTheDocument();
      expect(screen.getByText("$12.50 left")).toBeInTheDocument();
    });
    // Session cost (Pi USD estimate) and balance both use $
    expect(screen.getByText("$1.25")).toBeInTheDocument();
  });

  test("hides account line when adapter unsupported", async () => {
    mockProviderUsage({
      mode: "unsupported",
      providerId: "openai",
      reason: "no_adapter",
    });
    renderInspector({ session: { ...session, provider: "openai", model: "gpt-5" } });
    await waitFor(() => {
      expect(mockGetPiApi).toHaveBeenCalled();
    });
    expect(screen.queryByText(/left$/)).not.toBeInTheDocument();
    expect(screen.queryByText("balance unavailable")).not.toBeInTheDocument();
  });

  test("force-refreshes account balance when turn ends (running → completed)", async () => {
    const getProviderUsage = vi.fn(async (_options?: { force?: boolean }) => ({
      providerId: "deepseek",
      session: {
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheWriteTokens: session.cacheWriteTokens,
        cost: session.cost,
        contextTokens: session.contextTokens,
        contextWindow: session.contextWindow,
      },
      account: {
        mode: "prepaid_balance" as const,
        providerId: "deepseek",
        label: "DeepSeek",
        currency: "CNY",
        total: 100,
        isAvailable: true,
        fetchedAt: new Date().toISOString(),
      },
    }));
    mockGetPiApi.mockReturnValue({ getProviderUsage } as unknown as PiApi);

    const { rerender } = renderInspector({ session: { ...session, status: "running" } });
    await waitFor(() => expect(getProviderUsage).toHaveBeenCalled());
    const callsAfterMount = getProviderUsage.mock.calls.length;

    rerender(
      <ResourceInspector
        session={{ ...session, status: "completed" }}
        resources={{ contextFiles: [], skills: [], promptTemplates: [], themes: [], extensions: [], packages: [] }}
      />,
    );

    await waitFor(() => {
      expect(getProviderUsage.mock.calls.length).toBeGreaterThan(callsAfterMount);
    });
    const lastCall = getProviderUsage.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({ force: true });
  });

  test("tools tab toggles optimistically without waiting for the backend", () => {
    const onToggleTools = vi.fn();
    renderInspector({
      tools: [
        { name: "bash", description: "Run shell commands", active: true, source: "builtin" },
        { name: "read", description: "Read files", active: false, source: "builtin" },
      ],
      onToggleTools,
    });
    fireEvent.click(screen.getByRole("button", { name: /Tools/ }));
    const readToggle = screen.getAllByRole("checkbox")[1];
    expect(readToggle).not.toBeChecked();
    fireEvent.click(readToggle);
    // Optimistic local state flips immediately; backend is called with full whitelist.
    expect(readToggle).toBeChecked();
    expect(onToggleTools).toHaveBeenCalledWith(["bash", "read"]);
  });

  test("extensions tab lists packages and extensions without paths", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [
          { name: "git-master", path: "/skills/git-master/SKILL.md", loaded: true, group: "git-master" },
          { name: "broken", path: "/skills/broken/SKILL.md", loaded: false, group: "broken" },
        ],
        promptTemplates: [],
        themes: [],
        extensions: [
          { name: "my-ext", source: "/installed/foo/index.ts", loaded: true, pkgSource: "npm:foo" },
          { name: "top-ext", source: "/top/index.ts", loaded: true },
          { name: "bad-ext", source: "/bad/index.ts", loaded: false, error: "boom" },
        ],
        packages: [{ name: "foo", source: "npm:foo", enabled: true, resources: { extensions: 1, skills: 0, prompts: 0, themes: 0 } }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    expect(screen.getByText("Extensions & Packages")).toBeInTheDocument();
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("my-ext")).toBeInTheDocument();
    expect(screen.getByText("top-ext")).toBeInTheDocument();
    expect(screen.getByText("bad-ext")).toBeInTheDocument();
    expect(screen.getByText("fail")).toBeInTheDocument();
    // Paths / source ids must not clutter the list
    expect(screen.queryByText("/installed/foo/index.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("/top/index.ts")).not.toBeInTheDocument();
    expect(screen.queryByText("npm:foo")).not.toBeInTheDocument();
    expect(screen.queryByText("loaded")).not.toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("git-master")).toBeInTheDocument();
  });

  test("extensions tab shows compact package summary and on/off status", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [
          { name: "npm:pkg-a", source: "npm:pkg-a", enabled: true, resources: { extensions: 2, skills: 3, prompts: 1, themes: 0 } },
          { name: "npm:pkg-b", source: "npm:pkg-b", enabled: false, resources: { extensions: 0, skills: 0, prompts: 0, themes: 1 } },
          { name: "npm:empty", source: "npm:empty", enabled: true, resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 } },
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    expect(screen.getByText("pkg-a")).toBeInTheDocument();
    expect(screen.getByText("pkg-b")).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getAllByText("on").length).toBe(2);
    expect(screen.getByText("off")).toBeInTheDocument();
    // Compact summary: e/s/p/t, zeros omitted; no verbose words
    expect(screen.getByText("2e · 3s · 1p")).toBeInTheDocument();
    expect(screen.getByText("1t")).toBeInTheDocument();
    expect(screen.queryByText("3 skills")).not.toBeInTheDocument();
    expect(screen.queryByText(/no contributed/)).not.toBeInTheDocument();
    expect(screen.queryByText("npm:pkg-a")).not.toBeInTheDocument();
  });

  test("extensions tab lists MCP servers with status, tool count, and failure age", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
        mcp: {
          version: 1,
          servers: [
            { name: "github", status: "connected", toolCount: 12, disabled: false },
            { name: "supabase", status: "failed", toolCount: 0, failedAgoSeconds: 45, disabled: false },
            { name: "legacy", status: "disabled", toolCount: 0, disabled: true },
          ],
          totalTools: 12,
          connectedCount: 1,
          disabledCount: 1,
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("12 tools")).toBeInTheDocument();
    expect(screen.getByText("supabase")).toBeInTheDocument();
    expect(screen.getByText("0 tools · failed 45s ago")).toBeInTheDocument();
    expect(screen.getByText("legacy")).toBeInTheDocument();
    // Status labels render for each server (connected + disabled), never raw JSON.
    expect(screen.getAllByText("connected")).toHaveLength(1);
    expect(screen.getAllByText("disabled")).toHaveLength(1);
    expect(screen.queryByText("McpStatusSnapshotView")).not.toBeInTheDocument();
  });

  test("extensions tab shows MCP empty states when no status is reported", () => {
    renderInspector();
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
    expect(screen.getByText("No MCP status reported yet")).toBeInTheDocument();
  });

  test("extensions tab shows configured-but-idle MCP empty state", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
        mcp: { version: 1, servers: [], totalTools: 0, connectedCount: 0, disabledCount: 0 },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    expect(screen.getByText("No MCP servers configured")).toBeInTheDocument();
  });

  test("skill group toggles whole group via one checkbox", () => {
    const onToggleSkills = vi.fn();
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [
          { name: "brainstorming", path: "/skills/superpowers/brainstorming/SKILL.md", loaded: true, group: "superpowers", enabled: true },
          { name: "executing-plans", path: "/skills/superpowers/executing-plans/SKILL.md", loaded: true, group: "superpowers", enabled: true },
          { name: "watch", path: "/skills/watch/SKILL.md", loaded: true, group: "watch", enabled: true },
        ],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
      onToggleSkills,
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    const superpowersGroup = screen.getByText("superpowers").closest("label")!;
    fireEvent.click(superpowersGroup.querySelector("input")!);
    expect(onToggleSkills).toHaveBeenCalledWith(["!skills/superpowers/**"]);
  });

  test("flat group toggle uses exact group pattern", () => {
    const onToggleSkills = vi.fn();
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [
          { name: "seo", path: "/skills/seo/SKILL.md", loaded: true, group: "seo", enabled: true },
          { name: "seo-audit", path: "/skills/seo-audit/SKILL.md", loaded: true, group: "seo-audit", enabled: true },
        ],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
      onToggleSkills,
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    const seoGroup = screen.getByText("seo").closest("label")!;
    fireEvent.click(seoGroup.querySelector("input")!);
    expect(onToggleSkills).toHaveBeenCalledWith(["!skills/seo"]);
  });

  test("single skill toggle disables only that skill", () => {
    const onToggleSkills = vi.fn();
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [
          { name: "brainstorming", path: "/skills/superpowers/brainstorming/SKILL.md", loaded: true, group: "superpowers", enabled: true },
          { name: "executing-plans", path: "/skills/superpowers/executing-plans/SKILL.md", loaded: true, group: "superpowers", enabled: true },
        ],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
      onToggleSkills,
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    const group = screen.getByText("superpowers").closest("label")!.parentElement!;
    const brainstormingToggle = Array.from(group.querySelectorAll("input"))[1];
    fireEvent.click(brainstormingToggle);
    expect(onToggleSkills).toHaveBeenCalledWith(["!skills/superpowers/brainstorming"]);
  });

  test("disabled skills show off state", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [
          { name: "watch", path: "/skills/watch/SKILL.md", loaded: true, group: "watch", enabled: false },
        ],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    const watchGroup = screen.getByText("watch").closest("label")!;
    expect(watchGroup.querySelector("input")).not.toBeChecked();
  });

  test("fully-disabled skill groups render after enabled groups", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [
          { name: "disabled-skill", path: "/off/disabled/SKILL.md", loaded: true, group: "off", enabled: false },
          { name: "enabled-skill", path: "/on/enabled/SKILL.md", loaded: true, group: "on", enabled: true },
          { name: "off-helper", path: "/off/helper/SKILL.md", loaded: true, group: "off", enabled: false },
        ],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Extensions/ }));
    const headings = Array.from(document.querySelectorAll(".skill-group-name")).map((el) => el.textContent);
    expect(headings).toEqual(["on", "off"]);
  });

  test("extensions tab shows error badge for failed loads", () => {
    renderInspector({
      resources: {
        contextFiles: [],
        skills: [{ name: "broken", path: "/skills/broken", loaded: false }],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
    });
    const extTab = screen.getByRole("button", { name: /Extensions/ });
    expect(extTab.textContent).toContain("1");
  });

  test("context tab groups runtime and context files into collapsible sections", () => {
    renderInspector({
      resources: {
        contextFiles: [{ path: "/tmp/project/agents.md", source: "project", loaded: true }],
        skills: [],
        promptTemplates: [],
        themes: [],
        extensions: [],
        packages: [],
      },
    });
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("Context Files")).toBeInTheDocument();
    expect(screen.getByText("agents.md")).toBeInTheDocument();
  });

  describe("Index tab", () => {
    const readyStatus: IndexStatus = {
      state: "ready",
      filesIndexed: 42,
      symbolsIndexed: 310,
      lastIndexedAt: new Date().toISOString(),
    };

    const errorStatus: IndexStatus = {
      state: "error",
      filesIndexed: 5,
      symbolsIndexed: 30,
      error: "parse failure: bad syntax",
    };

    let mockIndexSearch: ReturnType<typeof vi.fn>;
    let mockIndexFindUsages: ReturnType<typeof vi.fn>;
    let mockIndexStatus: ReturnType<typeof vi.fn>;

    function mockPiApi(overrides: Partial<PiApi> = {}) {
      mockIndexSearch = vi.fn().mockResolvedValue([]);
      mockIndexFindUsages = vi.fn().mockResolvedValue([]);
      mockIndexStatus = vi.fn().mockResolvedValue(readyStatus);
      const api = {
        indexSearch: mockIndexSearch,
        indexFindUsages: mockIndexFindUsages,
        indexStatus: mockIndexStatus,
        indexRefresh: vi.fn().mockResolvedValue({ filesIndexed: 0, symbolsIndexed: 0, filesChanged: 0, filesDeleted: 0, durationMs: 0 }),
        getProviderUsage: vi.fn(async () => ({
          providerId: "deepseek",
          session: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            contextTokens: 0,
            contextWindow: 0,
          },
          account: { mode: "unsupported" as const, providerId: "deepseek", reason: "no_adapter" as const },
        })),
        ...overrides,
      } as unknown as PiApi;
       
      (window as any).pi = api;
      mockGetPiApi.mockReturnValue(api);
      // Rebind to match any overrides
      mockIndexSearch = api.indexSearch as ReturnType<typeof vi.fn>;
      mockIndexFindUsages = api.indexFindUsages as ReturnType<typeof vi.fn>;
      mockIndexStatus = api.indexStatus as ReturnType<typeof vi.fn>;
    }

    function openIndexTab() {
      fireEvent.click(screen.getByRole("button", { name: /^Index/ }));
    }

    test("shows index status from store when ready", () => {
      mockStore({ indexStatus: readyStatus });
      mockPiApi();
      renderInspector();
      openIndexTab();

      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("ready")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getByText("310")).toBeInTheDocument();
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });

    test("shows not indexed state when no status", () => {
      mockStore({ indexStatus: null });
      mockPiApi();
      renderInspector();
      openIndexTab();

      expect(screen.getByText("Not indexed yet")).toBeInTheDocument();
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });

    test("shows error state with error message", () => {
      mockStore({ indexStatus: errorStatus });
      mockPiApi();
      renderInspector();
      openIndexTab();

      expect(screen.getByText("error")).toBeInTheDocument();
      expect(screen.getByText("parse failure: bad syntax")).toBeInTheDocument();
    });

    test("search renders results from api.indexSearch", async () => {
      mockStore({ indexStatus: readyStatus });
      const hits: SymbolHit[] = [
        { name: "myFunc", kind: "function", file: "src/app.ts", line: 10, endLine: 20, qualified: "myFunc" },
        { name: "MyClass", kind: "class", file: "src/lib.ts", line: 5, endLine: 45, qualified: "MyClass" },
      ];
      mockPiApi({ indexSearch: vi.fn().mockResolvedValue(hits) });
      renderInspector();
      openIndexTab();

      fireEvent.change(screen.getByPlaceholderText("Search symbols..."), { target: { value: "myFunc" } });
      fireEvent.click(document.querySelector(".index-search-btn")!);

      await waitFor(() => {
        expect(screen.getByText("myFunc")).toBeInTheDocument();
      });
      expect(screen.getByText("MyClass")).toBeInTheDocument();
      expect(screen.getByText("src/app.ts:10")).toBeInTheDocument();
      expect(screen.getByText("src/lib.ts:5")).toBeInTheDocument();
      expect(mockIndexSearch).toHaveBeenCalledWith("/tmp/project", "myFunc", { limit: 20 });
    });

    test("clicking a result calls findUsages and renders them", async () => {
      mockStore({ indexStatus: readyStatus });
      const hits: SymbolHit[] = [
        { name: "MyClass", kind: "class", file: "src/lib.ts", line: 5, endLine: 45, qualified: "MyClass" },
      ];
      const usages: UsageHit[] = [
        { name: "createInstance", kind: "function", file: "src/factory.ts", line: 12, edgeKind: "import" },
        { name: "App", kind: "class", file: "src/main.ts", line: 3, edgeKind: "import" },
      ];
      mockPiApi({
        indexSearch: vi.fn().mockResolvedValue(hits),
        indexFindUsages: vi.fn().mockResolvedValue(usages),
      });
      renderInspector();
      openIndexTab();

      fireEvent.change(screen.getByPlaceholderText("Search symbols..."), { target: { value: "MyClass" } });
      fireEvent.click(document.querySelector(".index-search-btn")!);

      await waitFor(() => {
        expect(screen.getByText("MyClass")).toBeInTheDocument();
      });

      // Click the result button (parent of the MyClass <strong>)
      const resultStrong = screen.getByText("MyClass");
      fireEvent.click(resultStrong.closest("button")!);

      await waitFor(() => {
        expect(screen.getByText("createInstance")).toBeInTheDocument();
      });
      expect(screen.getByText("App")).toBeInTheDocument();
      expect(screen.getByText("src/factory.ts:12")).toBeInTheDocument();
      expect(screen.getByText("src/main.ts:3")).toBeInTheDocument();
      expect(mockIndexFindUsages).toHaveBeenCalledWith("/tmp/project", "MyClass");
    });

    test("shows empty results state", async () => {
      mockStore({ indexStatus: readyStatus });
      mockPiApi({ indexSearch: vi.fn().mockResolvedValue([]) });
      renderInspector();
      openIndexTab();

      fireEvent.change(screen.getByPlaceholderText("Search symbols..."), { target: { value: "nope" } });
      fireEvent.click(document.querySelector(".index-search-btn")!);

      await waitFor(() => {
        expect(screen.getByText("No symbols found")).toBeInTheDocument();
      });
    });
  });
});
