import { useEffect, useMemo, useState } from "react";
import type { FileChangeSummary, ModelOption, PiSnapshot, ProjectSummary, SessionSummary, TimelineItem } from "../../shared/protocol";
import { Markdown } from "../ui/Markdown";
import { createInitialState, type AppState } from "../session/reduce";
import { CompanionClient, snapshotAfter } from "./client";
import { applySnapshot, reduceCompanionEvent } from "./state";
import { ProjectPickerButton, ProjectPickerDialog } from "./ProjectPicker";
import { ProjectDirectory } from "./ProjectDirectory";
import { readPairingToken, readStoredToken, writeStoredToken } from "./socketUrl";

type Tab = "session" | "changes" | "preview" | "projects";
type SideTab = "preview" | "changes";

// Layout breakpoints: compact phone vs unfolded foldable vs expand-fold / tablet.
const WIDE_QUERY = "(min-width: 640px)";
const XWIDE_QUERY = "(min-width: 900px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function collectChanges(state: AppState): FileChangeSummary[] {
  const found = new Map<string, FileChangeSummary>();
  for (const item of state.timeline ?? []) {
    if (item.kind === "tool" && item.change) found.set(item.change.path, item.change);
  }
  for (const call of Object.values(state.toolCalls ?? {})) {
    if (call.change) found.set(call.change.path, call.change);
  }
  return [...found.values()];
}

export function CompanionApp() {
  const [tab, setTab] = useState<Tab>("session");
  const [sideTab, setSideTab] = useState<SideTab>("preview");
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [state, setState] = useState<AppState>(createInitialState);
  const [draft, setDraft] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [selectingProjectId, setSelectingProjectId] = useState<string>();
  const [projectError, setProjectError] = useState<string>();
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({});
  const [projectCatalogLoading, setProjectCatalogLoading] = useState(false);
  const [projectCatalogError, setProjectCatalogError] = useState<string>();
  const [projectCatalogRefreshNonce, setProjectCatalogRefreshNonce] = useState(0);
  const [client] = useState(() => new CompanionClient());
  const isWide = useMediaQuery(WIDE_QUERY);
  const isXWide = useMediaQuery(XWIDE_QUERY);
  const token = useMemo(
    () => readPairingToken(window.location.href) ?? readStoredToken(),
    [],
  );

  useEffect(() => {
    if (!token) {
      setStatus("closed");
      return;
    }
    writeStoredToken(token);
    client.onStatus = setStatus;
    client.onEvent = (event) => setState((current) => reduceCompanionEvent(current, event));
    client.connect(token);
    return () => client.close();
  }, [client, token]);

  useEffect(() => {
    if (status !== "open") return;
    void client.request<PiSnapshot>("getSnapshot")
      .then((snapshot) => setState(applySnapshot(snapshot)))
      .catch((error) => console.error("[companion] snapshot", error));
  }, [client, status]);

  const sessionCwd = state.session?.cwd ?? "";
  const sessionId = state.session?.sessionId ?? "";

  useEffect(() => {
    if (status !== "open" || !sessionCwd) return;
    void client.request<SessionSummary[]>("listSessions", [sessionCwd])
      .then((sessions) => setState((current) => ({ ...current, sessions: Array.isArray(sessions) ? sessions : [] })))
      .catch((error) => console.error("[companion] sessions", error));
  }, [client, sessionCwd, sessionId, status]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await client.request("prompt", [text]);
  };

  const selectProject = async (projectId: string) => {
    if (selectingProjectId) return;
    setProjectError(undefined);
    setSelectingProjectId(projectId);
    try {
      const result = await client.request("selectProject", [projectId]);
      if (snapshotAfter(result)) {
        const next = applySnapshot(result);
        setState(next);
        setSessionsByProject((current) => ({ ...current, [projectId]: next.sessions }));
      }
      setPreviewNonce((current) => current + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectError(message);
      throw error;
    } finally {
      setSelectingProjectId(undefined);
    }
  };

  const changes = collectChanges(state);
  const projects = (state.projects ?? []) as ProjectSummary[];
  const models = (state.models ?? []) as ModelOption[];
  const timeline = state.timeline ?? [];
  const session = state.session ?? createInitialState().session;
  const activeProject = projects.find((project) => project.id === state.activeProjectId)
    ?? projects.find((project) => project.path === session.cwd);

  const activeProjectPath = activeProject?.path ?? session.cwd;
  const projectCatalogKey = projects.map((project) => `${project.id}:${project.path}`).join("|");

  useEffect(() => {
    if (status !== "open" || tab !== "projects") return;
    let cancelled = false;
    setProjectCatalogLoading(true);
    setProjectCatalogError(undefined);
    void Promise.all(projects.map(async (project) => {
      try {
        const sessions = await client.request<SessionSummary[]>("listSessions", [project.path]);
        return [project.id, Array.isArray(sessions) ? sessions : []] as const;
      } catch {
        return [project.id, []] as const;
      }
    })).then((entries) => {
      if (cancelled) return;
      setSessionsByProject(Object.fromEntries(entries));
    }).catch((error) => {
      if (!cancelled) setProjectCatalogError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setProjectCatalogLoading(false);
    });
    return () => {
      cancelled = true;
    };
  // The key changes when the project catalog changes; the project array is the request source.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectCatalogKey, projectCatalogRefreshNonce, status, tab]);

  const openSession = async (project: ProjectSummary, selectedSession: SessionSummary) => {
    if (!selectedSession.sessionFile) return;
    const result = await client.request("startSession", [{
      cwd: selectedSession.cwd || project.path || activeProjectPath,
      sessionPath: selectedSession.sessionFile,
    }]);
    if (snapshotAfter(result)) setState(applySnapshot(result));
    setTab("session");
  };

  // On the widest screens the main column only carries Chat + Projects; Preview
  // and Changes move to a persistent side panel so the agent and the frontend
  // stay visible together. On phone/foldable the four tabs share one column.
  const navTabs: Tab[] = isXWide ? ["session", "projects"] : ["session", "changes", "preview", "projects"];
  const mainTab: Tab = isXWide && (tab === "changes" || tab === "preview") ? "session" : tab;

  const sessionPanel = (
    <>
      <div className="companion-toolbar">
        {models.length > 0 && (
          <select
            aria-label="Model"
            value={session.model}
            onChange={(event) => void client.request("setModel", [event.target.value])}
          >
            {models.filter((model) => model.available).map((model) => (
              <option key={model.id} value={model.id}>{model.label || model.id}</option>
            ))}
          </select>
        )}
        {session.status === "running" && (
          <button type="button" onClick={() => void client.request("abort", [])}>Stop</button>
        )}
      </div>
      {timeline.map((item) => (
        <TimelineRow key={item.id} item={item} />
      ))}
      {timeline.length === 0 && <p className="companion-empty">Send a task. It runs on the computer.</p>}
      <form
        className="companion-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message PI Desk"
          rows={2}
        />
        <button type="submit">Send</button>
      </form>
    </>
  );

  const changesPanel = (
    <div className="companion-list">
      {changes.length === 0 && <p className="companion-empty">No file changes in this session yet.</p>}
      {changes.map((change) => (
        <article key={change.path}>
          <strong>{change.path}</strong>
          <span> +{change.additions} / -{change.deletions}</span>
          <pre className="companion-diff">{change.diff}</pre>
          <button type="button" onClick={() => void client.request("undoFileChange", [change.path])}>Undo</button>
        </article>
      ))}
    </div>
  );

  const previewPanel = (
    <div className="companion-preview-panel">
      <div className="companion-panel-heading">
        <div>
          <p className="companion-eyebrow">Live workspace</p>
          <h1>Preview</h1>
        </div>
        <div className="companion-panel-actions">
          <ProjectPickerButton
            project={activeProject}
            compact
            disabled={status !== "open" || projects.length === 0}
            onClick={() => setProjectPickerOpen(true)}
          />
          <button
            type="button"
            className="companion-icon-button"
            onClick={() => setPreviewNonce((current) => current + 1)}
            disabled={status !== "open"}
            aria-label="Refresh preview"
          >
            ↻
          </button>
        </div>
      </div>
      <div className="companion-preview-status">
        <span className={`companion-status-dot ${status === "open" ? "is-online" : "is-offline"}`} aria-hidden="true" />
        <span>{status === "open" ? "Connected to PI Desk" : "Connect to the computer first"}</span>
      </div>
      {status === "open"
        ? <iframe key={`${state.activeProjectId ?? activeProject?.id ?? "none"}-${previewNonce}`} className="companion-preview" title="Frontend preview" src="/preview/" />
        : <div className="companion-preview-empty">
          <strong>Preview is offline</strong>
          <p>Pair with PI Desk on your computer to view the selected project.</p>
        </div>}
    </div>
  );

  const projectsPanel = (
    <ProjectDirectory
      projects={projects}
      activeProjectId={state.activeProjectId ?? activeProject?.id}
      sessionsByProject={sessionsByProject}
      loading={projectCatalogLoading}
      error={projectCatalogError}
      selectingProjectId={selectingProjectId}
      onRefresh={() => setProjectCatalogRefreshNonce((current) => current + 1)}
      onSelectProject={(projectId) => void selectProject(projectId).catch(() => undefined)}
      onOpenSession={(project, selectedSession) => void openSession(project, selectedSession).catch((error) => {
        setProjectError(error instanceof Error ? error.message : String(error));
      })}
    />
  );

  return (
    <div className={`companion-shell${isWide ? " is-wide" : ""}${isXWide ? " is-xwide" : ""}`}>
      <div className={`companion-status ${status === "open" ? "" : "is-down"}`}>
        <div className="companion-status-line">
          <strong className="companion-brand">PI Desk</strong>
          <span className="companion-connection-label">{status === "open" ? "Connected" : "Offline"}</span>
          <span className="companion-session-meta">{session.name || "Untitled session"}{session.model ? ` · ${session.model}` : ""}</span>
        </div>
        {tab !== "projects" && (
          <div className="companion-mobile-project">
            <ProjectPickerButton
              project={activeProject}
              disabled={status !== "open" || projects.length === 0}
              onClick={() => setProjectPickerOpen(true)}
            />
          </div>
        )}
      </div>
      <div className="companion-body">
        <nav className="companion-tabs">
          {navTabs.map((id) => (
            <button
              key={id}
              type="button"
              className={mainTab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {id === "session" ? "Chat" : id === "changes" ? "Changes" : id === "preview" ? "Preview" : "Projects"}
            </button>
          ))}
        </nav>

        <div className="companion-main">
          {!token && <p className="companion-empty">Scan the QR code in PI Desk → Settings → Phone.</p>}
          {mainTab === "session" && sessionPanel}
          {mainTab === "changes" && changesPanel}
          {mainTab === "preview" && previewPanel}
          {mainTab === "projects" && projectsPanel}
        </div>

        {projectError && (
          <p className="companion-project-error-banner" role="alert">
            Project switch failed: {projectError}
          </p>
        )}

        {isXWide && (
          <aside className="companion-side">
            <div className="companion-side-tabs">
              <button
                type="button"
                className={sideTab === "preview" ? "active" : ""}
                onClick={() => setSideTab("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                className={sideTab === "changes" ? "active" : ""}
                onClick={() => setSideTab("changes")}
              >
                Changes
              </button>
            </div>
            <div className="companion-side-body">
              {sideTab === "preview" ? previewPanel : changesPanel}
            </div>
          </aside>
        )}
      </div>
      <ProjectPickerDialog
        projects={projects}
        activeProjectId={state.activeProjectId ?? activeProject?.id}
        open={projectPickerOpen}
        externalPendingProjectId={selectingProjectId}
        onClose={() => setProjectPickerOpen(false)}
        onSelect={selectProject}
      />
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "tool") {
    const extra = item.change ? ` +${item.change.additions}/-${item.change.deletions}` : "";
    return <p className="companion-tool">{item.toolName}{extra}</p>;
  }
  if (item.kind === "divider") {
    return <p className="companion-tool">{item.label}</p>;
  }
  return (
    <div className={`companion-bubble ${item.kind}`}>
      {item.kind === "assistant" || item.kind === "user"
        ? <Markdown content={item.content} plain={item.status === "streaming"} />
        : item.content}
    </div>
  );
}
