import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type {
  HttpRequestRunResult,
  HttpRunRecord,
  HttpTreeNode,
  HttpWorkspaceSnapshot,
  ProjectSummary,
} from "../../shared/protocol";
import { getPiApi } from "../app/piApi";
import { AppIcon } from "../ui/icons";
import { WorkspaceModeSwitcher } from "../workspace/WorkspaceModeSwitcher";
import { HttpCodeEditor, type HttpResponseInlay } from "./HttpCodeEditor";
import { useDragResize } from "../ui/useDragResize";
import { useLocalStorageState } from "../ui/useLocalStorageState";

type HttpWorkbenchProps = {
  projects: ProjectSummary[];
  activeProjectId?: string;
  onSelectProject: (projectId: string) => void;
  onOpenProject: () => void;
  onModeChange: (mode: "pi" | "http") => void;
  onNewChat?: () => void;
  sidebarWidth?: number;
  agentChat?: ReactNode;
};

type HttpCreateKind = "folder" | "file" | "environment";
type HttpCreateDialog = { kind: HttpCreateKind; value: string };

const HTTP_CHAT_WIDTH_KEY = "pi.httpWorkbench.chatWidth";
const HTTP_CHAT_OPEN_KEY = "pi.httpWorkbench.chatOpen";
const HTTP_NAVIGATOR_DEFAULT_WIDTH = 240;
const HTTP_CHAT_DEFAULT_WIDTH = 420;
const HTTP_CHAT_MAX_WIDTH = 620;

function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function findNode(nodes: HttpTreeNode[], relativePath: string): HttpTreeNode | undefined {
  for (const node of nodes) {
    if (node.relativePath === relativePath) return node;
    const child = node.children ? findNode(node.children, relativePath) : undefined;
    if (child) return child;
  }
  return undefined;
}

function isManagedPath(path: string): boolean {
  return path.split("/").some((part) => part === "environments" || part === "run-history" || part === ".run-history");
}

function nodeIcon(node: HttpTreeNode) {
  if (node.kind === "file") return "fileCode2" as const;
  if (node.kind === "response") return "fileCode2" as const;
  if (node.kind === "environment") return "globe" as const;
  if (node.kind === "history") return "history" as const;
  return "folder" as const;
}



function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: HttpTreeNode;
  selectedPath: string;
  onSelect: (node: HttpTreeNode) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState((node.kind === "folder" && node.name === "Environments") || node.kind === "history" ? true : depth === 0);
  const selected = selectedPath === node.relativePath;
  const selectedInBranch = selectedPath === node.relativePath || selectedPath.startsWith(`${node.relativePath}/`);
  useEffect(() => {
    if (selectedInBranch && (node.kind === "folder" || node.kind === "history")) setOpen(true);
  }, [node.kind, selectedInBranch]);
  return (
    <div className="http-tree-branch">
      <div
        className={`http-tree-row ${selected ? "is-selected" : ""}`}
        style={{ paddingLeft: `calc(10px + ${depth} * var(--tree-indent-step))` }}
      >
        {node.children ? (
          <button
            type="button"
            className="http-tree-disclosure"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            onClick={() => setOpen((value) => !value)}
          >
            <AppIcon name="chevronRight" size="xs" className={open ? "is-open" : ""} />
          </button>
        ) : (
          <span className="http-tree-disclosure-spacer" />
        )}
        <button type="button" className="http-tree-item" onClick={() => onSelect(node)} title={node.relativePath}>
          <AppIcon name={nodeIcon(node)} size="sm" />
          <span className="http-tree-name">{node.name}</span>
          {node.kind === "history" && node.runCount ? <span className="http-tree-count">{node.runCount}</span> : null}
        </button>
      </div>
      {open && node.children?.map((child) => (
        <TreeNode key={child.id} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

function WorkspaceBrandBar({ onModeChange }: { onModeChange: (mode: "pi" | "http") => void }) {
  return (
    <div className="http-workbench-brandbar">
      <span className="http-workbench-brand-name">PI Desk</span>
      <WorkspaceModeSwitcher mode="http" onModeChange={onModeChange} />
    </div>
  );
}

export function HttpWorkbench({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenProject,
  onModeChange,
  onNewChat,
  sidebarWidth,
  agentChat,
}: HttpWorkbenchProps) {
  const api = getPiApi();
  const [workspace, setWorkspace] = useState<HttpWorkspaceSnapshot | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedKind, setSelectedKind] = useState<HttpTreeNode["kind"]>("folder");
  const [content, setContent] = useState("");
  const [environmentContent, setEnvironmentContent] = useState("");
  const [runs, setRuns] = useState<HttpRunRecord[]>([]);
  const [selectedResponse, setSelectedResponse] = useState<{ run: HttpRunRecord; request: HttpRequestRunResult } | null>(null);
  const [environment, setEnvironment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createDialog, setCreateDialog] = useState<HttpCreateDialog | null>(null);
  const [chatWidth, setChatWidth] = useLocalStorageState(HTTP_CHAT_WIDTH_KEY, HTTP_CHAT_DEFAULT_WIDTH, (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return HTTP_CHAT_DEFAULT_WIDTH;
    const migratedValue = value === 370 ? HTTP_CHAT_DEFAULT_WIDTH : value;
    return Math.min(HTTP_CHAT_MAX_WIDTH, Math.max(320, migratedValue));
  });
  const [chatOpen, setChatOpen] = useLocalStorageState(HTTP_CHAT_OPEN_KEY, true, (raw) => raw !== "false");

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0];
  const navigatorWidth = typeof sidebarWidth === "number" && Number.isFinite(sidebarWidth) && sidebarWidth > 0
    ? sidebarWidth
    : HTTP_NAVIGATOR_DEFAULT_WIDTH;
  const loadRuns = async (scopePath = selectedPath) => {
    if (!api?.http || !activeProject) {
      setRuns([]);
      return;
    }
    try {
      const next = await api.http.listRuns(activeProject.id, scopePath);
      setRuns(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const loadWorkspace = async () => {
    if (!api?.http || !activeProject) {
      setWorkspace(null);
      setSelectedPath("");
      setContent("");
      setRuns([]);
      setSelectedResponse(null);
      return;
    }
    try {
      const next = await api.http.workspace(activeProject.id);
      setWorkspace(next);
      setEnvironment((current) => current && next.environments.some((item) => item.name === current) ? current : next.environments[0]?.name ?? "");
      const nextSelection = selectedPath ? findNode(next.tree, selectedPath) : undefined;
      setSelectedPath(nextSelection?.relativePath ?? "");
      setSelectedKind(nextSelection?.kind ?? "folder");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    setSelectedResponse(null);
    void loadWorkspace();
    // The selected project is the Workbench context, not a second project store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id]);

  useEffect(() => {
    if (!activeProject || !api?.http) return;
    if (!selectedPath) {
      setContent("");
      setEnvironmentContent("");
    } else if (selectedKind === "file") {
      void api.http.readFile(activeProject.id, selectedPath).then((file) => setContent(file.content)).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    } else if (selectedKind === "environment") {
      void api.http.readEnvironment(activeProject.id, selectedPath).then((file) => setEnvironmentContent(file.content)).catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
    }
    if (selectedKind === "file") void loadRuns(selectedPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, selectedPath, selectedKind]);

  const selectNode = (node: HttpTreeNode) => {
    setMessage("");
    if (node.kind === "response" && node.historyScopePath && node.runId && node.requestId) {
      void openResponse(node.historyScopePath, node.runId, node.requestId);
      return;
    }
    setSelectedKind(node.kind);
    setSelectedPath(node.relativePath);
    if (node.kind === "environment") setEnvironment(node.name);
    if (node.kind !== "file") {
      setContent("");
      setEnvironmentContent("");
    }
  };

  const selectedFolder = selectedKind === "file" || selectedKind === "environment" || selectedKind === "response"
    ? parentPath(selectedPath)
    : selectedPath;
  const creationFolder = (() => {
    let folder = selectedFolder;
    while (folder && isManagedPath(folder)) folder = parentPath(folder);
    return folder;
  })();

  const selectProjectRoot = () => {
    setMessage("");
    setSelectedPath("");
    setSelectedKind("folder");
    setContent("");
    setEnvironmentContent("");
  };

  const openCreateDialog = (kind: HttpCreateKind) => {
    setMessage("");
    setCreateDialog({
      kind,
      value: kind === "folder" ? "debug-login" : kind === "file" ? "request" : "local",
    });
  };

  const createAsset = async () => {
    if (!activeProject || !api?.http || !createDialog) return;
    const kind = createDialog.kind;
    const name = createDialog.value.trim();
    if (!name) {
      setMessage("Enter a name first");
      return;
    }
    setBusy(true);
    try {
      if (kind === "folder") {
        const next = await api.http.createFolder(activeProject.id, creationFolder, name);
        setWorkspace(next);
        setSelectedPath(creationFolder ? `${creationFolder}/${name}` : name);
        setSelectedKind("folder");
      } else if (kind === "file") {
        const result = await api.http.createFile(activeProject.id, creationFolder, name);
        setWorkspace(result.workspace);
        setSelectedPath(result.path);
        setSelectedKind("file");
        setContent(result.content);
      } else {
        const next = await api.http.createEnvironment(activeProject.id, name);
        setWorkspace(next);
        const environmentName = name.replace(/\.json$/i, "");
        setEnvironment(environmentName);
        setSelectedPath(`environments/${environmentName}.json`);
        setSelectedKind("environment");
      }
      setCreateDialog(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!activeProject || !api?.http || (selectedKind !== "file" && selectedKind !== "environment")) return;
    setBusy(true);
    try {
      if (selectedKind === "file") await api.http.saveFile(activeProject.id, selectedPath, content);
      else {
        await api.http.saveEnvironment(activeProject.id, selectedPath, environmentContent);
        setWorkspace(await api.http.workspace(activeProject.id));
      }
      setMessage("Saved in the PI Desk app data space");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const copyResponse = async (value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard access is unavailable");
      }
      setMessage("Response copied");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const run = async () => {
    if (!activeProject || !api?.http || !["file", "folder"].includes(selectedKind)) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.http.run(activeProject.id, selectedPath, environment || undefined);
      await loadRuns(selectedPath);
      if (selectedKind === "file") setContent((await api.http.readFile(activeProject.id, selectedPath)).content);
      const first = result.requests[0];
      if (first) await openResponse(selectedPath, result.id, first.id, result);
      setWorkspace(await api.http.workspace(activeProject.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const runRequest = async (lineNumber: number) => {
    if (!activeProject || !api?.http || selectedKind !== "file") return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.http.run(activeProject.id, selectedPath, environment || undefined, lineNumber);
      await loadRuns(selectedPath);
      setContent((await api.http.readFile(activeProject.id, selectedPath)).content);
      const first = result.requests[0];
      if (first) await openResponse(selectedPath, result.id, first.id, result);
      setWorkspace(await api.http.workspace(activeProject.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  async function openResponse(scopePath: string, runId: string, requestId: string, knownRun?: HttpRunRecord) {
    if (!activeProject || !api?.http) return;
    try {
      const run = knownRun ?? await api.http.readRun(activeProject.id, scopePath, runId);
      const request = await api.http.readResponse(activeProject.id, scopePath, runId, requestId);
      setSelectedResponse({ run, request });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const deleteResponse = async (scopePath: string, runId: string, requestId: string) => {
    if (!activeProject || !api?.http) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await api.http.deleteResponse(activeProject.id, scopePath, runId, requestId);
      setWorkspace(next);
      if (scopePath === selectedPath) await loadRuns(scopePath);
      if (scopePath === selectedPath && selectedKind === "file") setContent((await api.http.readFile(activeProject.id, selectedPath)).content);
      if (selectedResponse?.request.id === requestId) setSelectedResponse(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const setClampedChatWidth = (value: number) => {
    const minWidth = 320;
    const maxWidth = Math.max(minWidth, Math.min(HTTP_CHAT_MAX_WIDTH, window.innerWidth - navigatorWidth - 5 - 420));
    setChatWidth(Math.min(maxWidth, Math.max(minWidth, value)));
  };

  const startDragResize = useDragResize();
  const resizeChatPanel = (event: ReactMouseEvent<HTMLDivElement>) => {
    const startWidth = chatWidth;
    startDragResize(event, (dx) => {
      setClampedChatWidth(startWidth - dx);
    });
  };

  const handleChatResizerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setClampedChatWidth(chatWidth + 24);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setClampedChatWidth(chatWidth - 24);
    } else if (event.key === "Home") {
      event.preventDefault();
      setClampedChatWidth(320);
    } else if (event.key === "End") {
      event.preventDefault();
      setClampedChatWidth(HTTP_CHAT_MAX_WIDTH);
    }
  };

  const emptyProject = !activeProject;
  const responseInlays: HttpResponseInlay[] = selectedKind === "file"
    ? runs.flatMap((run) => run.requests
      .filter((request) => request.filePath === selectedPath && request.responseFileName)
      .map((request) => {
        const lineNumber = content.split("\n").findIndex((line) => line.trim() === `<> ${request.responseFileName}`) + 1;
        return lineNumber > 0 ? ({
        id: `${run.id}:${request.id}`,
        lineNumber,
        label: request.responseFileName ?? `${request.status ?? "ERR"}.response`,
        ok: request.ok,
        onOpen: () => { void openResponse(run.scopePath, run.id, request.id, run); },
        onDelete: () => { void deleteResponse(run.scopePath, run.id, request.id); },
        }) : null;
      }).filter((inlay): inlay is HttpResponseInlay => inlay !== null))
    : [];
  const brandBar = <WorkspaceBrandBar onModeChange={onModeChange} />;
  return (
    <main className="http-workbench-shell">
      {emptyProject ? (
        <div className="http-empty-project-layout" style={{ gridTemplateColumns: `${navigatorWidth}px minmax(0, 1fr)` }}>
          <aside className="http-empty-project-rail">{brandBar}</aside>
          <section className="http-empty-state">
            <AppIcon name="folder" size="xl" />
            <h1>Open a project first</h1>
            <p>HTTP tests and environments always belong to a PI Desk project.</p>
            <button type="button" className="welcome-primary" onClick={onOpenProject}>Open project</button>
          </section>
        </div>
      ) : (
        <div
          className={`http-workbench-columns ${chatOpen ? "is-chat-open" : "is-chat-collapsed"}`}
          style={{
            gridTemplateColumns: chatOpen
              ? `${navigatorWidth}px minmax(0, 1fr) 5px ${chatWidth}px`
              : `${navigatorWidth}px minmax(0, 1fr) 36px`,
          }}
        >
          <aside className="http-navigator">
            {brandBar}
            <div className="http-navigator-heading">
              <span>Projects</span>
            </div>
            <div className="http-project-picker">
              {projects.map((project) => (
                <button type="button" key={project.id} className={project.id === activeProject.id ? "is-active" : ""} onClick={() => { setCreateDialog(null); setMessage(""); onSelectProject(project.id); }}>
                <AppIcon name="folder" size="sm" /> <span>{project.name}</span>
              </button>
              ))}
            </div>
            <div className="http-navigator-actions" aria-label="Create HTTP assets">
                <button type="button" onClick={() => openCreateDialog("folder")} disabled={busy}>
                <AppIcon name="folderPlus" size="sm" /> <span>New folder</span>
              </button>
                <button type="button" onClick={() => openCreateDialog("file")} disabled={busy}>
                <AppIcon name="fileCode2" size="sm" /> <span>New .http</span>
              </button>
                <button type="button" onClick={() => openCreateDialog("environment")} disabled={busy}>
                <AppIcon name="globe" size="sm" /> <span>Environment</span>
              </button>
            </div>
            <div className="http-tree-scroll">
              <button
                type="button"
                className={`http-tree-root-row ${selectedKind === "folder" && !selectedPath ? "is-selected" : ""}`}
                onClick={selectProjectRoot}
                title={activeProject.path}
              >
                <AppIcon name="folder" size="sm" />
                <span>Project root</span>
              </button>
              {workspace?.tree.map((node) => <TreeNode key={node.id} node={node} selectedPath={selectedPath} onSelect={selectNode} depth={1} />)}
              {!workspace?.tree.length ? <div className="http-tree-empty">Create a folder or HTTP test to start.</div> : null}
            </div>
          </aside>

          <section className="http-editor-column">
            <div className="http-editor-header">
              <div className="http-breadcrumb"><AppIcon name={selectedKind === "file" ? "fileCode2" : selectedKind === "environment" ? "globe" : selectedKind === "history" ? "history" : "folder"} size="sm" /><span>{selectedPath || activeProject.name}</span></div>
              <div className="http-editor-actions">
                <label className="http-environment-select">
                  <AppIcon name="globe" size="xs" />
                  <select aria-label="HTTP environment" value={environment} onChange={(event) => setEnvironment(event.target.value)} disabled={!workspace || workspace.environments.length === 0}>
                    {workspace?.environments.length ? workspace.environments.map((item) => <option key={item.name} value={item.name}>{item.name}</option>) : <option value="">No environment</option>}
                  </select>
                </label>
                {selectedKind === "file" || selectedKind === "environment" ? <button type="button" title="Save (⌘S / Ctrl+S)" onClick={() => void save()} disabled={busy}><AppIcon name="save" size="xs" /> Save</button> : null}
                <button type="button" className="http-run-button" onClick={() => void run()} disabled={busy || !["file", "folder"].includes(selectedKind)}>
                  <AppIcon name="play" size="xs" /> Run
                </button>
              </div>
            </div>
            {selectedKind === "file" ? (
              <HttpCodeEditor value={content} onChange={setContent} ariaLabel="HTTP test editor" language="http" disabled={busy} onRunRequest={runRequest} onSave={() => void save()} responseInlays={responseInlays} />
            ) : selectedKind === "environment" ? (
              <HttpCodeEditor value={environmentContent} onChange={setEnvironmentContent} ariaLabel="Environment editor" language="json" disabled={busy} onSave={() => void save()} />
            ) : (
              <div className="http-folder-overview">
                <AppIcon name="folder" size="xl" />
                <h2>{selectedPath || activeProject.name}</h2>
                <p>{selectedKind === "history" ? "Choose a response file from the Run History folder." : "Tests in this folder run in order. Each response is linked below its request."}</p>
                <div className="http-overview-actions"><button type="button" onClick={() => openCreateDialog("file")} disabled={busy}><AppIcon name="fileCode2" size="sm" /> New HTTP test</button><button type="button" onClick={() => void run()} disabled={busy}><AppIcon name="play" size="sm" /> Run folder</button></div>
              </div>
            )}
            {selectedResponse ? <aside className="http-response-drawer" aria-label="HTTP response">
              <div className="http-response-drawer-header">
                <div><span className={selectedResponse.request.ok ? "is-passed" : "is-failed"}>{selectedResponse.request.ok ? "✓" : "!"}</span><strong>{selectedResponse.request.requestName}</strong><small>{selectedResponse.request.status ?? "ERR"} · {selectedResponse.request.durationMs} ms · {selectedResponse.run.environment}</small></div>
                <div><button type="button" aria-label="Copy response" title="Copy response" onClick={() => void copyResponse(selectedResponse.request.response ?? selectedResponse.request.error ?? "")}><AppIcon name="copy" size="xs" /></button><button type="button" aria-label="Close response" title="Close response" onClick={() => setSelectedResponse(null)}>×</button></div>
              </div>
              <pre className={selectedResponse.request.error ? "is-error" : ""}>{selectedResponse.request.response ?? selectedResponse.request.error ?? "No response body"}</pre>
            </aside> : null}
            {message ? <div className="http-workbench-message">{message}</div> : null}
          </section>

          {createDialog ? (
            <div
              className="http-create-dialog-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setCreateDialog(null);
              }}
            >
              <form
                className="http-create-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="http-create-dialog-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createAsset();
                }}
              >
                <div className="http-create-dialog-heading">
                  <div>
                    <span className="http-chat-eyebrow">HTTP WORKBENCH</span>
                    <h2 id="http-create-dialog-title">
                      {createDialog.kind === "folder" ? "New folder" : createDialog.kind === "file" ? "New .http test" : "New environment"}
                    </h2>
                  </div>
                  <button type="button" className="http-create-dialog-close" aria-label="Close" onClick={() => setCreateDialog(null)}>×</button>
                </div>
                <label className="http-create-dialog-field">
                  <span>Name</span>
                  <input
                    autoFocus
                    aria-label="Name"
                    value={createDialog.value}
                    onChange={(event) => setCreateDialog((current) => current ? { ...current, value: event.target.value } : current)}
                    placeholder={createDialog.kind === "folder" ? "debug-login" : createDialog.kind === "file" ? "request" : "local"}
                  />
                </label>
                <div className="http-create-dialog-actions">
                  <button type="button" onClick={() => setCreateDialog(null)}>Cancel</button>
                  <button type="submit" className="http-run-button">Create</button>
                </div>
              </form>
            </div>
          ) : null}

          {chatOpen ? (
            <>
              <div
                className="http-chat-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize Agent sidebar"
                aria-valuemin={320}
                aria-valuemax={HTTP_CHAT_MAX_WIDTH}
                aria-valuenow={chatWidth}
                tabIndex={0}
                onMouseDown={resizeChatPanel}
                onKeyDown={handleChatResizerKeyDown}
              />
              <aside className="http-chat-column" aria-label="HTTP Chat">
                <div className="http-chat-header">
                  <div>
                    <span className="http-chat-eyebrow">AGENT</span>
                    <h2>HTTP Chat</h2>
                </div>
                <div className="http-chat-header-actions">
                  {onNewChat ? (
                    <button type="button" className="http-chat-new-button" aria-label="New chat" title="New chat" onClick={onNewChat}>
                      <AppIcon name="plus" size="xs" /> <span>New chat</span>
                    </button>
                  ) : null}
                  <button type="button" className="http-chat-collapse-button" aria-label="Collapse Agent sidebar" title="Collapse Agent sidebar" onClick={() => setChatOpen(false)}>
                      <AppIcon name="panelRight" size="sm" />
                    </button>
                  </div>
                </div>
                <div className="http-chat-context"><span>{activeProject.name}</span><span>{selectedPath || "Select a test folder"}</span><span>{environment || "No environment"}</span></div>
                <div className="http-chat-content">{agentChat ?? <div className="http-chat-empty"><AppIcon name="messageSquare" size="lg" /><p>Ask the Agent to create, review, or explain a test in this Project.</p></div>}</div>
              </aside>
            </>
          ) : (
            <aside className="http-chat-collapsed" aria-label="Agent sidebar collapsed">
              <button type="button" aria-label="Expand Agent sidebar" title="Expand Agent sidebar" onClick={() => setChatOpen(true)}>
                <AppIcon name="panelRight" size="sm" />
              </button>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}
