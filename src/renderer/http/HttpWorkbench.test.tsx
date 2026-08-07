import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HttpRequestRunResult, HttpRunRecord, HttpWorkspaceSnapshot } from "../../shared/protocol";
import { HttpWorkbench } from "./HttpWorkbench";

const workspace: HttpWorkspaceSnapshot = {
  projectUid: "uid-1",
  projectId: "/tmp/demo",
  projectName: "demo",
  projectPath: "/tmp/demo",
  tree: [
    {
      id: "folder:auth",
      name: "auth-regression",
      kind: "folder",
      relativePath: "auth-regression",
      children: [{ id: "file:auth/login.http", name: "login.http", kind: "file", relativePath: "auth-regression/login.http" }],
    },
    { id: "folder:environments", name: "Environments", kind: "folder", relativePath: "environments", children: [{ id: "environment:staging.json", name: "staging", kind: "environment", relativePath: "environments/staging.json" }] },
  ],
  environments: [{ name: "staging", relativePath: "environments/staging.json", variables: { baseUrl: "https://staging.example.test" }, updatedAt: new Date().toISOString() }],
};

const httpApi = {
  workspace: vi.fn(async () => workspace),
  readFile: vi.fn(async () => ({ path: "auth-regression/login.http", content: "GET {{baseUrl}}/login" })),
  readEnvironment: vi.fn(async () => ({ name: "staging", relativePath: "environments/staging.json", content: '{"baseUrl":"https://staging.example.test"}' })),
  saveFile: vi.fn(async () => undefined),
  saveEnvironment: vi.fn(async () => undefined),
  createFolder: vi.fn(async () => workspace),
  createFile: vi.fn(async () => ({ path: "request.http", content: "### New request\nGET https://example.com\n\n", workspace })),
  createEnvironment: vi.fn(async () => workspace),
  listRuns: vi.fn(async (_projectId: string, _scopePath: string): Promise<HttpRunRecord[]> => []),
  readRun: vi.fn(async (): Promise<HttpRunRecord> => { throw new Error("No run configured"); }),
  readResponse: vi.fn(async (): Promise<HttpRequestRunResult> => { throw new Error("No response configured"); }),
  deleteRun: vi.fn(async () => workspace),
  deleteResponse: vi.fn(async () => workspace),
  deleteRunHistory: vi.fn(async () => workspace),
  run: vi.fn(async (_projectId: string, scopePath: string) => ({
    id: "run-1",
    scopePath,
    scopeName: scopePath || "demo",
    projectId: "/tmp/demo",
    environment: "staging",
    startedAt: new Date().toISOString(),
    durationMs: 1,
    status: "passed" as const,
    requestCount: 1,
    passedCount: 1,
    failedCount: 0,
    requests: [],
  })),
};

vi.mock("../app/piApi", () => ({
  getPiApi: () => ({ http: httpApi }),
}));

describe("HTTP Workbench", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    httpApi.readFile.mockImplementation(async () => ({ path: "auth-regression/login.http", content: "GET {{baseUrl}}/login" }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders a project-owned tree without a global Scratch node", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("auth-regression")).toBeInTheDocument());
    expect(screen.getAllByText("demo").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Project root" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New folder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New .http" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run History" })).not.toBeInTheDocument();
    expect(screen.getByText("Environments")).toBeInTheDocument();
    expect(screen.getAllByText("staging").length).toBeGreaterThan(0);
    expect(screen.queryByText("Scratch")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Run$/i })).toBeInTheDocument();
  });

  test("can collapse and reopen the Agent sidebar", async () => {
    const onNewChat = vi.fn();
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
        onNewChat={onNewChat}
      />,
    );

    await waitFor(() => expect(screen.getByRole("complementary", { name: "HTTP Chat" })).toBeInTheDocument());
    expect(screen.getByRole("separator", { name: "Resize Agent sidebar" })).toHaveAttribute("aria-valuenow", "420");
    expect(document.querySelector(".http-workbench-topbar")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Agent sidebar" }));
    expect(screen.getByRole("complementary", { name: "Agent sidebar collapsed" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand Agent sidebar" }));
    expect(screen.getByRole("complementary", { name: "HTTP Chat" })).toBeInTheDocument();
  });

  test("uses the shared Agent sidebar width to avoid a mode-switch layout jump", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        sidebarWidth={260}
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(document.querySelector(".http-workbench-columns")).toHaveStyle("grid-template-columns: 260px minmax(0, 1fr) 5px 420px"));
  });

  test("renders response links below a request and opens a single response drawer", async () => {
    const historyWorkspace: HttpWorkspaceSnapshot = {
      ...workspace,
      tree: workspace.tree.map((node) => node.name === "auth-regression"
        ? { ...node, children: [...(node.children ?? []), {
          id: "history:auth", name: "Run History", kind: "history" as const, relativePath: ".run-history/auth-regression", runCount: 1, historyScopePath: "auth-regression", children: [{
            id: "response:auth:run-1:request-1", name: "20260809T100000Z.200.json", kind: "response" as const, relativePath: ".run-history/auth-regression/run-1/request-1", historyScopePath: "auth-regression/login.http", runId: "run-1", requestId: "request-1", status: 200,
          }],
        }] }
        : node),
    };
    const runs: HttpRunRecord[] = [
      { id: "run-1", scopePath: "auth-regression/login.http", scopeName: "login.http", projectId: "/tmp/demo", environment: "staging", startedAt: "2026-08-09T10:00:00.000Z", durationMs: 12, status: "passed", requestCount: 1, passedCount: 1, failedCount: 0, requests: [{ id: "request-1", filePath: "auth-regression/login.http", requestName: "login.http · request 1", method: "GET", url: "https://example.com/health", requestLine: 1, responseFileName: "20260809T100000Z.200.json", status: 200, ok: true, durationMs: 4, response: '{"ok":true}' }] },
    ];
    httpApi.workspace.mockResolvedValueOnce(historyWorkspace);
    httpApi.readFile.mockResolvedValue({ path: "auth-regression/login.http", content: "GET {{baseUrl}}/login\n\n<> 20260809T100000Z.200.json\n" });
    httpApi.listRuns.mockImplementation(async (_projectId, scopePath) => scopePath === "auth-regression/login.http" ? runs : []);
    httpApi.readRun.mockResolvedValue(runs[0]);
    httpApi.readResponse.mockResolvedValue(runs[0]!.requests[0]);
    httpApi.deleteResponse.mockResolvedValue(historyWorkspace);
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Expand auth-regression" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand auth-regression" }));
    fireEvent.click(screen.getByRole("button", { name: "login.http" }));
    const responseLink = await screen.findByRole("button", { name: "Open response 20260809T100000Z.200.json" });
    expect(document.querySelector(".http-code-response-link")).not.toBeInTheDocument();
    expect(document.querySelector(".http-results-panel")).not.toBeInTheDocument();
    fireEvent.click(responseLink);
    await waitFor(() => expect(screen.getByRole("complementary", { name: "HTTP response" })).toBeInTheDocument());
    expect(screen.getByText("{\"ok\":true}")).toBeInTheDocument();
    const writeText = vi.fn(async () => undefined);
    const previousClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("{\"ok\":true}"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: previousClipboard });
    fireEvent.click(screen.getByRole("button", { name: "Delete response 20260809T100000Z.200.json" }));
    await waitFor(() => expect(httpApi.deleteResponse).toHaveBeenCalledWith("/tmp/demo", "auth-regression/login.http", "run-1", "request-1"));
  });

  test("creates a folder from the Project root by default", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Project root" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "smoke" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(httpApi.createFolder).toHaveBeenCalledWith("/tmp/demo", "", "smoke"));
  });

  test("creates a .http file inside the selected folder", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "auth-regression" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "auth-regression" }));
    fireEvent.click(screen.getByRole("button", { name: "New .http" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "health.http" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(httpApi.createFile).toHaveBeenCalledWith("/tmp/demo", "auth-regression", "health.http"));
  });

  test("save and run actions use the selected HTTP file", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Expand auth-regression" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand auth-regression" }));
    fireEvent.click(screen.getByRole("button", { name: "login.http" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "HTTP test editor" })).toHaveValue("GET {{baseUrl}}/login"));
    const editor = screen.getByRole("textbox", { name: "HTTP test editor" });
    expect(editor).not.toBeDisabled();
    fireEvent.change(editor, { target: { value: "GET https://example.test/health" } });
    fireEvent.keyDown(editor, { key: "s", metaKey: true });
    await waitFor(() => expect(httpApi.saveFile).toHaveBeenCalledWith("/tmp/demo", "auth-regression/login.http", "GET https://example.test/health"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(httpApi.saveFile).toHaveBeenCalledWith("/tmp/demo", "auth-regression/login.http", "GET https://example.test/health"));
    fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));
    await waitFor(() => expect(httpApi.run).toHaveBeenCalledWith("/tmp/demo", "auth-regression/login.http", "staging"));
  });

  test("creates tests at the project root when an environment is selected", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "staging" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "staging" }));
    fireEvent.click(screen.getByRole("button", { name: "New .http" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "root-check" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(httpApi.createFile).toHaveBeenCalledWith("/tmp/demo", "", "root-check"));
  });

  test("creates and saves an environment through the editor", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Environment" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Environment" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "dev.json" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(httpApi.createEnvironment).toHaveBeenCalledWith("/tmp/demo", "dev.json"));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Environment editor" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "Environment editor" }), { target: { value: '{"baseUrl":"https://dev.example.test"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(httpApi.saveEnvironment).toHaveBeenCalledWith("/tmp/demo", "environments/dev.json", '{"baseUrl":"https://dev.example.test"}'));
  });

  test("runs the project root when it is selected", async () => {
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Project root" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));
    await waitFor(() => expect(httpApi.run).toHaveBeenCalledWith("/tmp/demo", "", "staging"));
  });

  test("shows line numbers, highlights HTTP syntax, and runs one request from its gutter", async () => {
    httpApi.readFile.mockImplementation(async () => ({
      path: "auth-regression/login.http",
      content: "### Login\nGET {{baseUrl}}/login\n\n### Health\nPOST https://example.test/health\n",
    }));
    render(
      <HttpWorkbench
        projects={[{ id: "/tmp/demo", name: "demo", path: "/tmp/demo", updatedAt: new Date().toISOString(), projectUid: "uid-1" }]}
        activeProjectId="/tmp/demo"
        onSelectProject={vi.fn()}
        onOpenProject={vi.fn()}
        onModeChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Expand auth-regression" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand auth-regression" }));
    fireEvent.click(screen.getByRole("button", { name: "login.http" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Run request at line 2" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Run request at line 5" })).toBeInTheDocument();
    expect(document.querySelector(".http-code-method")).toHaveTextContent("GET");
    expect(document.querySelectorAll(".http-code-line-number").length).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Run request at line 5" }));
    await waitFor(() => expect(httpApi.run).toHaveBeenCalledWith("/tmp/demo", "auth-regression/login.http", "staging", 5));
  });
});
