import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type {
  AppUpdateState,
  LiveSessionSummary,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  ThinkingLevel,
} from "../../shared/protocol";
import { formatRelativeTime } from "../ui/formatRelativeTime";
import { hideSessionPath, loadHiddenSessionPaths, unhideSessionPath } from "./sessionHidePrefs";
import { loadExpandedMap, saveExpandedMap } from "./sidebarExpandPrefs";
import { MAX_VISIBLE_SESSIONS, splitSessionList } from "./sessionListDisplay";
import { AppIcon } from "../ui/icons";
import { ShortcutKeys } from "../app/ShortcutKeys";
import { WorkspaceModeSwitcher, type WorkspaceMode } from "./WorkspaceModeSwitcher";
import { IconButton } from "../ui/IconButton";
import {
  cloneWorkspaceSession,
  deleteWorkspaceSession,
  openWorkspaceSession,
  renameWorkspaceSession,
  requestNewSession,
  startNewSession,
} from "./workspaceActions";

export interface SessionSidebarProps {
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  projects: ProjectSummary[];
  activeProjectId?: string;
  /** Used as a refresh signal for the active project's session list (not the render source). */
  sessions: SessionSummary[];
  activeSessionId: string;
  /** Live status of the open session — overlays matching row. */
  activeSessionStatus?: SessionStatus;
  /**
   * Live agent slots from the host (including sessions not currently in the tab strip).
   * Overlay row status so running agents remain visible after tab close.
   */
  liveSessions?: LiveSessionSummary[];
  model?: string;
  thinkingLevel?: ThinkingLevel | string;
  onAddProject: () => void;
  /** Fallback when New task has no project (usually open a folder). */
  onRequestNewSession?: () => void;
  /** Mark project as active in the list (no session load). */
  onSelectProject: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onRevealInFolder: (path: string) => void;
  loadSessions: (projectPath: string) => Promise<SessionSummary[]>;
  onOpenSettings: () => void;
  updateState?: AppUpdateState;
  onUpdateAction?: () => void;
}

function updateLabel(state: AppUpdateState): string | undefined {
  if (state.status === "available") return `Update to ${state.version ?? "new version"}`;
  if (state.status === "downloading") return `Downloading update${state.progress === undefined ? "…" : ` ${state.progress}%`}`;
  if (state.status === "downloaded") return "Restart to update";
  return undefined;
}

function sessionStatusClass(status: SessionStatus | undefined): string {
  if (status === "running") return "is-running";
  if (status === "awaiting_approval") return "is-waiting";
  if (status === "completed") return "is-completed";
  if (status === "error") return "is-error";
  return "";
}

type PendingDelete = {
  session: SessionSummary;
  projectId: string;
};

export function SessionSidebar({
  workspaceMode,
  onWorkspaceModeChange,
  projects,
  activeProjectId,
  sessions,
  activeSessionId,
  activeSessionStatus,
  liveSessions = [],
  onAddProject,
  onRequestNewSession,
  onSelectProject,
  onRemoveProject,
  onRevealInFolder,
  loadSessions,
  onOpenSettings,
  updateState,
  onUpdateAction,
}: SessionSidebarProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => loadExpandedMap());

  const liveByFile = useMemo(() => {
    const map = new Map<string, LiveSessionSummary>();
    for (const live of liveSessions) {
      if (live.sessionFile) map.set(live.sessionFile, live);
    }
    return map;
  }, [liveSessions]);

  const liveBySessionId = useMemo(() => {
    const map = new Map<string, LiveSessionSummary>();
    for (const live of liveSessions) {
      if (live.sessionId) map.set(live.sessionId, live);
    }
    return map;
  }, [liveSessions]);
  const [sessionsByProject, setSessionsByProject] = useState<Record<string, SessionSummary[]>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(() => loadHiddenSessionPaths());
  const [showHidden, setShowHidden] = useState(false);
  const [expandedOlderProjects, setExpandedOlderProjects] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deleteConfirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Seed defaults for new projects; keep user/localStorage toggles.
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const project of projects) {
        if (next[project.id] === undefined) {
          next[project.id] = project.id === activeProjectId;
          changed = true;
        }
      }
      if (changed) saveExpandedMap(next);
      return changed ? next : prev;
    });
  }, [projects, activeProjectId]);

  const setProjectExpanded = (projectId: string, open: boolean) => {
    setExpanded((prev) => {
      const next = { ...prev, [projectId]: open };
      saveExpandedMap(next);
      return next;
    });
  };

  const refreshProjectSessions = useCallback(
    async (project: ProjectSummary) => {
      try {
        const list = await loadSessions(project.path);
        setSessionsByProject((prev) => ({ ...prev, [project.id]: list }));
      } catch {
        setSessionsByProject((prev) => ({ ...prev, [project.id]: prev[project.id] ?? [] }));
      }
    },
    [loadSessions],
  );

  useEffect(() => {
    for (const project of projects) {
      void refreshProjectSessions(project);
    }
  }, [projects, refreshProjectSessions]);

  useEffect(() => {
    const cwdSet = new Set(sessions.map((item) => item.cwd).filter(Boolean));
    if (activeProjectId) cwdSet.add(activeProjectId);
    for (const project of projects) {
      if (cwdSet.has(project.path) || cwdSet.has(project.id)) {
        void refreshProjectSessions(project);
      }
    }
  }, [sessions, activeProjectId, projects, refreshProjectSessions]);

  useEffect(() => {
    if (!renamingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  const patchSessionName = (sessionId: string, projectId: string, name: string) => {
    setSessionsByProject((prev) => {
      const list = prev[projectId] ?? [];
      return {
        ...prev,
        [projectId]: list.map((item) => (item.sessionId === sessionId ? { ...item, name } : item)),
      };
    });
  };

  const beginRename = (session: SessionSummary) => {
    setRenamingId(session.sessionId);
    setRenameValue(session.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const commitRename = async (session: SessionSummary, projectId: string) => {
    const next = renameValue.replace(/[\r\n]+/g, " ").trim();
    if (!next || !session.sessionFile) {
      cancelRename();
      return;
    }
    if (next === session.name) {
      cancelRename();
      return;
    }
    try {
      const resolved = await renameWorkspaceSession(session.sessionFile, next);
      patchSessionName(session.sessionId, projectId, resolved);
    } catch {
      // Keep previous name on failure; parent may surface error.
    } finally {
      cancelRename();
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    const sessionFile = target?.session.sessionFile;
    if (!target || !sessionFile) {
      setPendingDelete(null);
      return;
    }
    const { session, projectId } = target;
    setPendingDelete(null);
    try {
      await deleteWorkspaceSession(sessionFile, projectId);
      setSessionsByProject((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] ?? []).filter((item) => item.sessionId !== session.sessionId),
      }));
      setHiddenPaths(unhideSessionPath(sessionFile));
    } catch {
      // Parent surfaces error.
    }
  };

  const hideSession = (session: SessionSummary) => {
    if (!session.sessionFile) return;
    setHiddenPaths(hideSessionPath(session.sessionFile));
  };

  const unhideSession = (session: SessionSummary) => {
    if (!session.sessionFile) return;
    setHiddenPaths(unhideSessionPath(session.sessionFile));
  };

  const q = query.trim().toLowerCase();

  const hiddenCount = useMemo(() => {
    let count = 0;
    for (const list of Object.values(sessionsByProject)) {
      for (const session of list) {
        if (session.sessionFile && hiddenPaths.has(session.sessionFile)) count += 1;
      }
    }
    return count;
  }, [sessionsByProject, hiddenPaths]);

  const visibleProjects = useMemo(() => {
    if (!q) return projects;
    return projects.filter((project) => {
      if (project.name.toLowerCase().includes(q)) return true;
      return (sessionsByProject[project.id] ?? []).some((session) => {
        if (!showHidden && session.sessionFile && hiddenPaths.has(session.sessionFile)) return false;
        return session.name.toLowerCase().includes(q);
      });
    });
  }, [projects, q, sessionsByProject, hiddenPaths, showHidden]);

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-top">
        <div className="sidebar-brand" aria-label="PI Desk">
          <span className="brand-title">PI Desk</span>
        </div>
        <WorkspaceModeSwitcher mode={workspaceMode} onModeChange={onWorkspaceModeChange} />
      </div>

      <label className="sidebar-search">
        <AppIcon name="search" size="sm" />
        <input
          type="search"
          aria-label="Search sessions"
          placeholder="Search sessions…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="sidebar-search-clear"
            aria-label="Clear search"
            onClick={() => setQuery("")}
          >
            <AppIcon name="x" size="xs" />
          </button>
        ) : null}
      </label>

      <div className="sidebar-nav">
        <button
          type="button"
          className="sidebar-new-session sidebar-leading-control"
          onClick={() => requestNewSession(onRequestNewSession)}
          title="Start a new task — pick a project in the chat box"
        >
          <AppIcon name="plus" size="sm" />
          <span>New task</span>
          <ShortcutKeys className="sidebar-nav-shortcut" compact keys={["mod", "N"]} label="New task" />
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section-head">
          <span className="section-head-label">Projects</span>
          <IconButton label="Add project" title="Open project folder" accent onClick={onAddProject}>
            <AppIcon name="plus" size="sm" />
          </IconButton>
        </div>

        {projects.length === 0 ? (
          <div className="sidebar-empty">
            <p>No projects — use +</p>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="sidebar-empty">
            <p>No matches</p>
          </div>
        ) : (
          <div className="project-tree" role="list">
            {visibleProjects.map((project) => {
              const open = Boolean(q) || expanded[project.id] === true;
              const active = project.id === activeProjectId;
              const projectSessions = (sessionsByProject[project.id] ?? []).filter((session) => {
                if (!showHidden && session.sessionFile && hiddenPaths.has(session.sessionFile)) return false;
                if (!q) return true;
                return session.name.toLowerCase().includes(q) || project.name.toLowerCase().includes(q);
              });
              const sessionGroups = splitSessionList(projectSessions, MAX_VISIBLE_SESSIONS);
              const showOlderSessions = Boolean(q) || expandedOlderProjects[project.id] === true;
              const renderedSessions = showOlderSessions
                ? [...sessionGroups.recent, ...sessionGroups.older]
                : sessionGroups.recent;

              return (
                <div key={project.id} className={`project-node ${active ? "active" : ""}`} role="listitem">
                  <div className="project-node-row">
                    <ContextMenu.Root>
                      <ContextMenu.Trigger asChild>
                        <button
                          type="button"
                          className="project-node-toggle sidebar-leading-control"
                          aria-current={active ? "true" : undefined}
                          aria-expanded={open}
                          aria-label={`Select project ${project.name}`}
                          title={`${project.path}\nClick to set as New task target`}
                          onClick={() => {
                            onSelectProject(project.id);
                            setProjectExpanded(project.id, !open);
                          }}
                        >
                          <span className="project-folder-icon" aria-hidden>
                            <AppIcon name="folder" size="sm" />
                          </span>
                          <span className="project-node-name">{project.name}</span>
                        </button>
                      </ContextMenu.Trigger>
                      <ContextMenu.Portal>
                        <ContextMenu.Content className="session-context-menu" alignOffset={4}>
                          <ContextMenu.Item
                            className="session-context-item"
                            onSelect={() => onSelectProject(project.id)}
                          >
                            Set as active
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="session-context-item"
                            onSelect={() => {
                              onSelectProject(project.id);
                              setProjectExpanded(project.id, true);
                              void startNewSession(project.id);
                            }}
                          >
                            New task here
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="session-context-item"
                            onSelect={() => onRevealInFolder(project.path)}
                          >
                            Reveal in Finder
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="session-context-item"
                            onSelect={() => {
                              void navigator.clipboard?.writeText(project.path);
                            }}
                          >
                            Copy path
                          </ContextMenu.Item>
                          <ContextMenu.Item
                            className="session-context-item danger"
                            onSelect={() => onRemoveProject(project.id)}
                          >
                            Remove from list
                          </ContextMenu.Item>
                        </ContextMenu.Content>
                      </ContextMenu.Portal>
                    </ContextMenu.Root>
                    <IconButton
                      label={`New task in ${project.name}`}
                      title={`New task in ${project.name}`}
                      accent
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectProject(project.id);
                        setProjectExpanded(project.id, true);
                        void startNewSession(project.id);
                      }}
                    >
                      <AppIcon name="plus" size="sm" />
                    </IconButton>
                  </div>

                  {open && (
                    <div className="project-session-list" role="list">
                      {projectSessions.length === 0 ? (
                        <div className="project-session-empty">{q ? "No matching sessions" : "No sessions yet"}</div>
                      ) : (
                        renderedSessions.map((session) => {
                          const isActive = session.sessionId === activeSessionId;
                          const isRenaming = renamingId === session.sessionId;
                          const isHidden = Boolean(session.sessionFile && hiddenPaths.has(session.sessionFile));
                          const live =
                            (session.sessionFile ? liveByFile.get(session.sessionFile) : undefined) ??
                            liveBySessionId.get(session.sessionId);
                          const displayStatus =
                            isActive && activeSessionStatus
                              ? activeSessionStatus
                              : live?.status ?? session.status;
                          const timeLabel = session.updatedAt ? formatRelativeTime(session.updatedAt, nowMs) : "";

                          if (isRenaming) {
                            return (
                              <div
                                key={session.sessionId}
                                className={`session-item nested renaming ${isActive ? "active" : ""}`}
                              >
                                <span
                                  className={`session-dot ${sessionStatusClass(displayStatus)}`}
                                  aria-hidden
                                />
                                <input
                                  ref={renameInputRef}
                                  className="session-rename-input"
                                  aria-label="Rename session"
                                  value={renameValue}
                                  onChange={(event) => setRenameValue(event.target.value)}
                                  onBlur={() => void commitRename(session, project.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void commitRename(session, project.id);
                                    } else if (event.key === "Escape") {
                                      event.preventDefault();
                                      cancelRename();
                                    }
                                  }}
                                />
                              </div>
                            );
                          }

                          return (
                            <ContextMenu.Root key={session.sessionId}>
                              <ContextMenu.Trigger asChild>
                                <div
                                  className={`session-item nested ${isActive ? "active" : ""} ${isHidden ? "is-hidden" : ""}`}
                                  title={session.sessionFile ?? session.name}
                                >
                                  <button
                                    type="button"
                                    className="session-item-main"
                                    onClick={() => {
                                      const path = session.sessionFile;
                                      if (!path) return;
                                      void openWorkspaceSession(path, project.id, session.sessionId);
                                    }}
                                    disabled={!session.sessionFile}
                                  >
                                    <span
                                      className={`session-dot ${sessionStatusClass(displayStatus)}`}
                                      aria-hidden
                                    />
                                    <span className="session-item-text">
                                      <span className="session-title">{session.name}</span>
                                      {timeLabel ? <span className="session-meta">{timeLabel}</span> : null}
                                    </span>
                                  </button>
                                  {session.sessionFile ? (
                                    <button
                                      type="button"
                                      className="session-item-delete"
                                      aria-label={`Delete session ${session.name}`}
                                      title={`Delete ${session.name}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setPendingDelete({ session, projectId: project.id });
                                      }}
                                    >
                                      <AppIcon name="trash" size="xs" />
                                    </button>
                                  ) : null}
                                </div>
                              </ContextMenu.Trigger>
                              <ContextMenu.Portal>
                                <ContextMenu.Content className="session-context-menu" alignOffset={4}>
                                  <ContextMenu.Item
                                    className="session-context-item"
                                    onSelect={() => beginRename(session)}
                                  >
                                    Rename
                                  </ContextMenu.Item>
                                  <ContextMenu.Item
                                    className="session-context-item"
                                    onSelect={() => {
                                      void navigator.clipboard?.writeText(session.sessionId);
                                    }}
                                  >
                                    Copy session ID
                                  </ContextMenu.Item>
                                  {session.sessionFile ? (
                                    <ContextMenu.Item
                                      className="session-context-item"
                                      onSelect={() => onRevealInFolder(session.sessionFile!)}
                                    >
                                      Reveal in Finder
                                    </ContextMenu.Item>
                                  ) : null}
                                  <ContextMenu.Item
                                    className="session-context-item"
                                    onSelect={() => void cloneWorkspaceSession(session, project.id)}
                                  >
                                    Duplicate session
                                  </ContextMenu.Item>
                                  {session.sessionFile ? (
                                    isHidden ? (
                                      <ContextMenu.Item
                                        className="session-context-item"
                                        onSelect={() => unhideSession(session)}
                                      >
                                        Unhide
                                      </ContextMenu.Item>
                                    ) : (
                                      <ContextMenu.Item
                                        className="session-context-item"
                                        onSelect={() => hideSession(session)}
                                      >
                                        Hide from list
                                      </ContextMenu.Item>
                                    )
                                  ) : null}
                                  <ContextMenu.Item
                                    className="session-context-item danger"
                                    onSelect={() => setPendingDelete({ session, projectId: project.id })}
                                  >
                                    Delete…
                                  </ContextMenu.Item>
                                </ContextMenu.Content>
                              </ContextMenu.Portal>
                            </ContextMenu.Root>
                          );
                        })
                      )}
                      {sessionGroups.older.length > 0 && !q ? (
                        <button
                          type="button"
                          className="session-older-toggle"
                          aria-expanded={showOlderSessions}
                          onClick={() => {
                            setExpandedOlderProjects((prev) => ({
                              ...prev,
                              [project.id]: !prev[project.id],
                            }));
                          }}
                        >
                          {showOlderSessions ? "收起较早会话" : `还有 ${sessionGroups.older.length} 个较早会话`}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {hiddenCount > 0 ? (
          <button
            type="button"
            className="sidebar-hidden-toggle"
            onClick={() => setShowHidden((value) => !value)}
          >
            {showHidden ? `Hide ${hiddenCount} hidden` : `Show ${hiddenCount} hidden`}
          </button>
        ) : null}
      </div>

      <div className="sidebar-bottom">
        {updateState && updateLabel(updateState) ? (
          <button
            type="button"
            className={`sidebar-update ${updateState.status}`}
            onClick={onUpdateAction}
            disabled={updateState.status === "downloading" || !onUpdateAction}
            aria-label={updateLabel(updateState)}
            title={updateState.status === "available" ? "Download update" : updateLabel(updateState)}
          >
            <span className="sidebar-update-dot" aria-hidden />
            <span className="sidebar-user-label">{updateLabel(updateState)}</span>
            <AppIcon name={updateState.status === "downloaded" ? "check" : "circleDot"} size="sm" />
          </button>
        ) : null}
        <button type="button" className="sidebar-user" onClick={onOpenSettings} aria-label="Settings">
          <span className="sidebar-user-label">Settings</span>
          <AppIcon name="settings" size="sm" />
        </button>
      </div>

      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="ui-dialog-overlay" />
          <AlertDialog.Content
            className="ui-alert-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              deleteConfirmButtonRef.current?.focus();
            }}
          >
            <AlertDialog.Title className="ui-alert-dialog-title">Delete session?</AlertDialog.Title>
            <AlertDialog.Description className="ui-alert-dialog-desc">
              Permanently delete “{pendingDelete?.session.name ?? "this session"}”. This cannot be undone.
            </AlertDialog.Description>
            <div className="ui-alert-dialog-actions">
              <AlertDialog.Cancel className="ui-alert-dialog-cancel">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                ref={deleteConfirmButtonRef}
                className="ui-alert-dialog-action danger"
                onClick={() => void confirmDelete()}
              >
                Delete
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </aside>
  );
}
