import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer, type ComposerProps, type ComposerSubmitPayload } from "../session/Composer";
import { collectFileChanges, Timeline } from "../session/Timeline";
import { ChangeInspector } from "../session/ChangeInspector";
import { ResourceInspector } from "../session/ResourceInspector";
import { SessionSidebar } from "../workspace/SessionSidebar";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";
import { SettingsDialog } from "./SettingsDialog";
import { HelpDialog } from "./HelpDialog";
import { HttpWorkbench } from "../http/HttpWorkbench";
import { PlanInspector } from "../session/PlanInspector";
import { AppIcon } from "../ui/icons";
import { TopBar } from "./TopBar";
import { WelcomeBlock } from "../session/WelcomeBlock";
import { useDragResize } from "../ui/useDragResize";
import { useLocalStorageState } from "../ui/useLocalStorageState";
import { getPiApi } from "./piApi";
import { useAppStore } from "../session/store";
import { prependOlder } from "../session/views";
import type { InspectorTab } from "../session/ResourceInspector";
import type { AgentMode, AgentProfile, AppUpdateState, SessionModeState, SessionStatus } from "../../shared/protocol";
import {
  dedupeTabs,
  loadOpenTabs,
  touchTab,
  upsertTab,
} from "../workspace/sessionTabs";
import {
  alignActiveTabWithSession,
  applyCatalogNames,
  canBePreview,
  syncTabFromSession,
  useWorkspaceStore,
} from "../workspace/workspaceStore";
import {
  activateTab,
  applySnapshot,
  ensureActiveTabRuntime,
  requestNewSession as requestWorkspaceSession,
  startNewSession,
} from "../workspace/workspaceActions";
import { subscribeHostEvents } from "../session/hostEvents";
import { useWorkspaceHotkeys } from "./useWorkspaceHotkeys";

type RightPane = "inspector" | "plan" | "changes";
type EditingInterruptedMessage = { messageId: string; text: string } | null;
const EMPTY_INTERRUPTED_MESSAGE_IDS: readonly string[] = [];

function defaultChangesWidth(): number {
  const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
  return Math.min(1280, Math.max(520, Math.round(viewport * 0.65)));
}

export function App() {
  const state = useAppStore();
  const api = getPiApi();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateState, setUpdateState] = useState<AppUpdateState>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useLocalStorageState("pi.motionEnabled", true, (raw) => raw !== "false");
  const [rightPane, setRightPane] = useState<RightPane>("inspector");
  const [selectedChangePath, setSelectedChangePath] = useState<string | undefined>();
  const [inspectorWidth, setInspectorWidth] = useLocalStorageState("pi.inspectorWidth", 300, (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 300;
  });
  const [planWidth, setPlanWidth] = useLocalStorageState("pi.planWidth", 420, (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 420;
  });
  const [changesWidth, setChangesWidth] = useLocalStorageState("pi.changesWidth", () => defaultChangesWidth(), (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : defaultChangesWidth();
  });
  const [sidebarWidth, setSidebarWidth] = useLocalStorageState("pi.sidebarWidth", 260, Number);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState("pi.sidebarCollapsed", false, (raw) => raw === "true");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("context");
  const [commands, setCommands] = useState<PaletteCommand[]>([]);
  const [branchName, setBranchName] = useState<string | undefined>();
  const [workspaceMode, setWorkspaceMode] = useLocalStorageState<"pi" | "http">("pi.workspaceMode", "pi", (raw) => (raw === "http" ? "http" : "pi"));

  useEffect(() => {
    if (!api?.getUpdateState || !api.onUpdateState) return;
    let active = true;
    const unsubscribe = api.onUpdateState(setUpdateState);
    void api.getUpdateState().then((next) => {
      if (active) setUpdateState(next);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const handleUpdateAction = useCallback(() => {
    if (!api || !updateState) return;
    if (updateState.status === "available") void api.downloadUpdate();
    if (updateState.status === "downloaded") void api.installUpdate();
  }, [api, updateState]);

  useEffect(() => {
    document.documentElement.classList.toggle("motion-disabled", !motionEnabled);
    return () => document.documentElement.classList.remove("motion-disabled");
  }, [motionEnabled]);
  const activeTabId = useWorkspaceStore((item) => item.activeTabId);
  const liveSessions = useWorkspaceStore((item) => item.liveSessions);
  const activeView = useAppStore((item) => (activeTabId ? item.views[activeTabId] : undefined));
  const [editingInterruptedMessage, setEditingInterruptedMessage] = useState<EditingInterruptedMessage>(null);
  const [savingInterruptedMessageEdit, setSavingInterruptedMessageEdit] = useState(false);
  const sessionChanges = useMemo(() => collectFileChanges(state.timeline), [state.timeline]);
  const composerHistory = useMemo(
    () => state.timeline.flatMap((item) => (item.kind === "user" ? [item.content] : [])),
    [state.timeline],
  );
  const timelineWrapRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [scrolledFromBottom, setScrolledFromBottom] = useState(false);
  const requestNewSessionRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    setScrolledFromBottom(false);
    stickToBottomRef.current = true;
  }, [activeTabId]);

  const openChanges = useCallback((path?: string) => {
    const selected = path && sessionChanges.some((change) => change.path === path)
      ? path
      : sessionChanges[0]?.path;
    setSelectedChangePath(selected);
    setRightPane("changes");
    setInspectorOpen(true);
  }, [sessionChanges]);

  const activeConversationId = activeTabId ?? state.session.sessionId;
  const interruptedUserMessageIds = useMemo<readonly string[]>(() => {
    if (state.session.status === "running") return EMPTY_INTERRUPTED_MESSAGE_IDS;
    for (let i = state.timeline.length - 1; i >= 0; i -= 1) {
      const item = state.timeline[i];
      if (item.kind === "user") return [item.id];
    }
    return EMPTY_INTERRUPTED_MESSAGE_IDS;
  }, [state.session.status, state.timeline]);

  useEffect(() => {
    setEditingInterruptedMessage(null);
    setSavingInterruptedMessageEdit(false);
  }, [activeConversationId]);

  const copyInterruptedMessage = useCallback(async (item: { content: string }) => {
    try {
      await navigator.clipboard?.writeText(item.content);
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const editInterruptedMessage = useCallback((item: { id: string; content: string }) => {
    setEditingInterruptedMessage({ messageId: item.id, text: item.content });
  }, []);

  // Stable callbacks: Timeline's memo comparator bails only when these
  // references stay identical. Inline arrows here would re-render the whole
  // timeline on every app-store update (each streaming delta flush).
  const onInterruptedMessageTextChange = useCallback((text: string) => {
    setEditingInterruptedMessage((current) => (current ? { ...current, text } : current));
  }, []);
  const onCancelInterruptedMessageEdit = useCallback(() => {
    setEditingInterruptedMessage(null);
  }, []);

  const formatPromptWithAttachments = useCallback((payload: ComposerSubmitPayload): string => (
    [payload.text.trim(), ...payload.attachments.map((attachment) => `@${attachment.path}`)]
      .filter(Boolean)
      .join("\n")
      .trim()
  ), []);

  const undoChange = useCallback(async (path: string) => {
    if (!api?.undoFileChange) return;
    try {
      const sessionKey = useWorkspaceStore.getState().activeTabId;
      await api.undoFileChange(path, sessionKey ? { sessionKey } : undefined);
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);

  const undoChanges = useCallback(async (paths: string[]) => {
    if (!api?.undoFileChange) return;
    try {
      const sessionKey = useWorkspaceStore.getState().activeTabId;
      const options = sessionKey ? { sessionKey } : undefined;
      for (const path of paths) await api.undoFileChange(path, options);
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);

  const openChangeFile = useCallback(async (path: string) => {
    if (!api?.openFile) return;
    try {
      await api.openFile(path);
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);

  const startDragResize = useDragResize();
  const resizeRightPanel = (event: React.MouseEvent<HTMLDivElement>) => {
    const startWidth = rightPane === "changes" ? changesWidth : rightPane === "plan" ? planWidth : inspectorWidth;
    const minWidth = rightPane === "changes" || rightPane === "plan" ? 360 : 280;
    const occupiedSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth + 5;
    const maxWidth = Math.max(minWidth, Math.min(1280, window.innerWidth - occupiedSidebarWidth - 240));
    startDragResize(event, (dx) => {
      const next = Math.min(maxWidth, Math.max(minWidth, startWidth - dx));
      if (rightPane === "changes") setChangesWidth(next);
      else if (rightPane === "plan") setPlanWidth(next);
      else setInspectorWidth(next);
    });
  };

  useEffect(() => {
    setSelectedChangePath((current) => current && sessionChanges.some((change) => change.path === current)
      ? current
      : sessionChanges[0]?.path);
  }, [sessionChanges]);

  useEffect(() => {
    const workspace = useWorkspaceStore.getState();
    const saved = workspace.tabs.length > 0
      ? { tabs: workspace.tabs, activeTabId: workspace.activeTabId }
      : loadOpenTabs();
    if (saved.tabs.length === 0) return;
    const deduped = dedupeTabs(saved.tabs, saved.activeTabId);
    const nextActiveTabId = deduped.some((tab) => tab.id === saved.activeTabId)
      ? saved.activeTabId
      : deduped[0]?.id;
    workspace.replaceWorkingSet(deduped, nextActiveTabId);
  }, []);

  // If runtime already has a session but tabs are empty (e.g. tests / cold path), seed a tab.
  useEffect(() => {
    const session = state.session;
    if (!session.sessionId || useWorkspaceStore.getState().tabs.length > 0) return;
    const projectId =
      state.projects?.find((item) => item.path === session.cwd || item.id === session.cwd)?.id ??
      state.activeProjectId ??
      session.cwd;
    if (!projectId) return;
    const next = upsertTab([], {
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      projectId,
      title: session.name || "Untitled",
      status: session.status,
      isPreview: canBePreview(session.status),
    });
    useWorkspaceStore.getState().replaceWorkingSet(next.tabs, next.activeTabId);
  }, [state.session.sessionId, state.session.sessionFile, state.session.name, state.session.status, state.session.cwd, state.timeline, state.projects, state.activeProjectId]);

  // Follow the conversation to the bottom while new content streams in,
  // unless the user has scrolled up to read older content. Coalesce to the
  // next animation frame so a burst of deltas triggers one layout pass, not one
  // forced reflow per token.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      const wrap = timelineWrapRef.current;
      if (wrap && stickToBottomRef.current) wrap.scrollTop = wrap.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [state.timeline]);

  const jumpToLatest = useCallback(() => {
    const wrap = timelineWrapRef.current;
    stickToBottomRef.current = true;
    setScrolledFromBottom(false);
    if (wrap) wrap.scrollTo({ top: wrap.scrollHeight, behavior: motionEnabled ? "smooth" : "auto" });
  }, [motionEnabled]);

  const patchTabStatus = useCallback((sessionKey: string, status: SessionStatus) => {
    useWorkspaceStore.getState().patchStatus(sessionKey, status);
  }, []);

  const promoteTab = useCallback((sessionKey?: string) => {
    useWorkspaceStore.getState().promote(sessionKey);
  }, []);

  useEffect(() => {
    if (!api) return;
    return subscribeHostEvents(api, { promoteTab, patchTabStatus });
  }, [api, promoteTab, patchTabStatus]);

  useEffect(() => {
    void api?.getCommands().then((loaded) => {
      if (loaded.length > 0) setCommands(loaded.map((command) => ({ id: command.id, name: command.name, description: command.description, source: command.source })));
    });
  }, [api, state.session.sessionId]);

  useEffect(() => {
    let active = true;
    const cwd = state.session.cwd;
    if (!cwd || !api?.getGitBranch) {
      setBranchName(undefined);
      return;
    }
    void api.getGitBranch(cwd).then((branch) => {
      if (active) setBranchName(branch);
    });
    return () => {
      active = false;
    };
  }, [api, state.session.cwd, state.session.sessionId]);

  useEffect(() => {
    alignActiveTabWithSession(state.session);
  }, [state.session.sessionId, state.session.sessionFile, state.session.name, state.session.status]);

  useEffect(() => {
    applyCatalogNames(state.sessions);
  }, [state.sessions]);

  useWorkspaceHotkeys({
    onNewSession: () => requestNewSessionRef.current(),
    onTogglePalette: () => setPaletteOpen((open) => !open),
    onToggleInspector: () => setInspectorOpen((prev) => !prev),
    onToggleHelp: () => setHelpOpen((prev) => !prev),
  });

  const pushError = (message: string) => {
    useAppStore.getState().applyEvent({
      eventId: `error-${Date.now()}`,
      workspaceId: "local",
      timestamp: new Date().toISOString(),
      sequence: Date.now(),
      type: "session_error",
      payload: { message },
    });
  };

  /** Open folder → add project → start session. Simple. */
  const openProject = async (): Promise<boolean> => {
    try {
      if (api?.addProject) {
        const snapshot = await api.addProject();
        if (!snapshot) return false;
        applySnapshot(snapshot);
        const projects = await api.listProjects();
        const activeProjectId = snapshot.activeProjectId ?? projects[0]?.id;
        useAppStore.setState({
          projects,
          activeProjectId,
        });
        if (activeProjectId) syncTabFromSession(snapshot.session, activeProjectId, snapshot.session.name);
        if (snapshot.lastError) pushError(snapshot.lastError);
        return true;
      }
      const cwd = await api?.chooseWorkspace();
      if (!cwd) return false;
      const sessionKey = `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const snap = await api?.startSession({ cwd, sessionKey });
      applySnapshot(snap);
      if (snap) syncTabFromSession(snap.session, cwd, snap.session.name);
      return true;
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  /** Switch which project is the New-session target — does not load a session. */
  const setActiveProject = async (projectId: string) => {
    try {
      if (api?.setActiveProject) {
        const result = await api.setActiveProject(projectId);
        useAppStore.setState({
          projects: result.projects,
          activeProjectId: result.activeProjectId,
        });
        return;
      }
      // Fallback: local-only highlight if bridge is missing.
      useAppStore.setState({ activeProjectId: projectId });
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
    }
  };

  const ensureSession = async (): Promise<boolean> => {
    const { session, projects, activeProjectId } = useAppStore.getState();
    if (session.sessionId) return true;

    const project = projects?.find((p) => p.id === activeProjectId) ?? projects?.[0];
    const cwd = project?.path ?? session.cwd;
    if (!cwd) {
      return openProject();
    }

    try {
      const sessionKey = useWorkspaceStore.getState().activeTabId
        ?? `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      applySnapshot(await api?.startSession({ cwd, sessionKey }));
      return Boolean(useAppStore.getState().session.sessionId);
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const requestNewSession = () => requestWorkspaceSession(() => { void openProject(); });
  requestNewSessionRef.current = requestNewSession;
  const switchComposerProject = (projectId: string) => startNewSession(projectId);

  const removeProject = async (projectId: string): Promise<void> => {
    if (!api?.removeProject) throw new Error("Remove project is not available");
    try {
      const result = await api.removeProject(projectId);
      useAppStore.setState({
        projects: result.projects,
        activeProjectId: result.activeProjectId,
      });
      // If runtime was disposed, sync empty main state.
      applySnapshot(await api.getSnapshot());
      if (result.activeProjectId && result.activeProjectId !== projectId && api.listSessions) {
        const project = result.projects.find((item) => item.id === result.activeProjectId);
        if (project) {
          const list = await api.listSessions(project.path);
          useAppStore.setState({ sessions: list });
        }
      } else {
        useAppStore.setState({ sessions: [] });
      }
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
    }
  };

  const revealInFolder = (path: string): void => {
    void api?.revealInFolder?.(path);
  };

  const submit = async (payload: ComposerSubmitPayload): Promise<boolean> => {
    if (!api) return false;
    try {
      if (!(await ensureSession())) return false;
      const sessionKey = useWorkspaceStore.getState().activeTabId ? await ensureActiveTabRuntime() : undefined;
      const mode = useAppStore.getState().session.status === "running" ? "followUp" : "prompt";
      const prompt = formatPromptWithAttachments(payload);
      const resolved = await resolveSessionReferences(prompt);
      if (!resolved) return false;
      const opts = sessionKey ? { sessionKey } : undefined;

      const commandMatch = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(resolved.trim());
      const command = commandMatch
        ? commands.find((item) => item.name.replace(/^\//, "") === commandMatch[1])
        : undefined;
      if (command?.source === "builtin") {
        await api.executeCommand(command.name, commandMatch?.[2] ?? "");
        applySnapshot(await api.getSnapshot());
        setEditingInterruptedMessage(null);
        return true;
      }
      if (command?.source && command.source !== "builtin") {
        // AgentSession.prompt executes registered extension commands immediately
        // and expands /skill:<name> and /<template> commands, including while
        // another turn is streaming. They must not be queued.
        promoteTab(sessionKey);
        await api.prompt(resolved, opts);
        setEditingInterruptedMessage(null);
        return true;
      }

      // Promote synchronously, before the host emits user_message_created, so
      // opening another session immediately after Send cannot replace this tab.
      promoteTab(sessionKey);
      if (mode === "followUp") await api.followUp(resolved, opts);
      else await api.prompt(resolved, opts);
      // Sending marks the active tab as recently used (LRU).
      if (sessionKey) {
        const { tabs, replaceWorkingSet, activeTabId: current } = useWorkspaceStore.getState();
        replaceWorkingSet(touchTab(tabs, sessionKey), current);
      }
      setEditingInterruptedMessage(null);
      return true;
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const saveInterruptedMessageEdit = useCallback(async (): Promise<void> => {
    const current = editingInterruptedMessage;
    if (!current || savingInterruptedMessageEdit) return;
    setSavingInterruptedMessageEdit(true);
    try {
      const ok = await submit({ text: current.text, attachments: [] });
      if (!ok) return;
    } finally {
      setSavingInterruptedMessageEdit(false);
    }
  }, [editingInterruptedMessage, savingInterruptedMessageEdit, submit]);

  const editFollowUp = async (index: number, text: string): Promise<boolean> => {
    if (!api?.editFollowUp) return false;
    try {
      if (!(await ensureSession())) return false;
      const sessionKey = useWorkspaceStore.getState().activeTabId ? await ensureActiveTabRuntime() : undefined;
      const resolved = await resolveSessionReferences(text);
      const expectedText = useAppStore.getState().queue.followUp[index];
      await api.editFollowUp(index, resolved, sessionKey ? { sessionKey } : undefined, expectedText);
      return true;
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const sendFollowUpNow = async (index: number): Promise<boolean> => {
    if (!api?.sendFollowUpNow) return false;
    try {
      if (!(await ensureSession())) return false;
      const sessionKey = useWorkspaceStore.getState().activeTabId ? await ensureActiveTabRuntime() : undefined;
      const expectedText = useAppStore.getState().queue.followUp[index];
      await api.sendFollowUpNow(index, sessionKey ? { sessionKey } : undefined, expectedText);
      return true;
    } catch (error) {
      pushError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const resolveSessionReferences = async (text: string): Promise<string> => {
    const marker = /@session:(\S+)/g;
    let result = text;
    const matches = [...text.matchAll(marker)];
    for (const match of matches) {
      const sessionPath = match[1];
      try {
        const { name, context } = await api!.getSessionContext(sessionPath);
        result = result.replace(match[0], `[referenced session: ${name}]\n${context}`);
      } catch {
        pushError(`Failed to load referenced session: ${sessionPath}`);
        result = result.replace(match[0], "");
      }
    }
    return result.trim();
  };

  const composerProjectId =
    state.projects?.find((p) => p.path === state.session.cwd || p.id === state.session.cwd)?.id ??
    state.activeProjectId;

  const modeState = state.session.modeState ?? {
    mode: "execute" as const,
    planProfile: { thinkingLevel: state.session.thinkingLevel },
    executeProfile: { modelKey: state.session.model || undefined, thinkingLevel: state.session.thinkingLevel },
  };
  const activeMode: AgentMode = modeState.mode;
  const planAvailable = activeMode === "plan" || Boolean(modeState.activePlan);
  const planWorkspaceEditable = activeMode === "plan";
  const sidebarCollapsedBeforePlanRef = useRef(sidebarCollapsed);
  const applyModeState = (next: SessionModeState): void => {
    useAppStore.setState((current) => ({
      session: {
        ...current.session,
        modeState: next,
        model: next.mode === "plan"
          ? next.planProfile.modelKey ?? current.session.model
          : next.executeProfile.modelKey ?? current.session.model,
        thinkingLevel: next.mode === "plan" ? next.planProfile.thinkingLevel : next.executeProfile.thinkingLevel,
      },
    }));
  };
  const currentModeState = (): SessionModeState => {
    const session = useAppStore.getState().session;
    return session.modeState ?? {
      mode: "execute",
      planProfile: { thinkingLevel: session.thinkingLevel },
      executeProfile: { modelKey: session.model || undefined, thinkingLevel: session.thinkingLevel },
    };
  };
  const changeAgentMode = (mode: AgentMode): void => {
    if (!api?.setMode) {
      pushError("当前 Pi Desk 进程尚未加载 Plan/Execute 切换接口，请完全重启应用后再试。");
      return;
    }
    const setMode = api.setMode;
    void (async () => {
      const sessionKey = await ensureActiveTabRuntime();
      const next = await setMode(mode, sessionKey ? { sessionKey } : undefined);
      applyModeState(next);
      const snapshot = await api.getSnapshot();
      useAppStore.getState().applyWorkspaceSnapshot(snapshot);
    })().catch((error) => pushError(error instanceof Error ? error.message : String(error)));
  };
  const changeAgentModel = (model: string): void => {
    if (api?.setModeProfile) {
      const setModeProfile = api.setModeProfile;
      void (async () => {
        const sessionKey = await ensureActiveTabRuntime();
        if (!sessionKey) return;
        const nextModeState = currentModeState();
        const mode = nextModeState.mode;
        const profile = mode === "plan" ? nextModeState.planProfile : nextModeState.executeProfile;
        const next = await setModeProfile(mode, { ...profile, modelKey: model }, { sessionKey });
        applyModeState(next);
      })().catch((error) => pushError(error instanceof Error ? error.message : String(error)));
    } else {
      pushError("当前 Pi Desk 进程尚未加载模式配置接口，请完全重启应用后再试。");
    }
  };
  const changeAgentThinking = (thinkingLevel: AgentProfile["thinkingLevel"]): void => {
    if (api?.setModeProfile) {
      const setModeProfile = api.setModeProfile;
      void (async () => {
        const sessionKey = await ensureActiveTabRuntime();
        if (!sessionKey) return;
        const nextModeState = currentModeState();
        const mode = nextModeState.mode;
        const profile = mode === "plan" ? nextModeState.planProfile : nextModeState.executeProfile;
        const next = await setModeProfile(mode, { ...profile, thinkingLevel }, { sessionKey });
        applyModeState(next);
      })().catch((error) => pushError(error instanceof Error ? error.message : String(error)));
    } else {
      pushError("当前 Pi Desk 进程尚未加载模式配置接口，请完全重启应用后再试。");
    }
  };
  const openPlanReview = (): void => {
    setRightPane("plan");
    setInspectorOpen(true);
  };
  useEffect(() => {
    if (activeMode === "plan") {
      sidebarCollapsedBeforePlanRef.current = sidebarCollapsed;
      setSidebarCollapsed(true);
      return;
    }
    setSidebarCollapsed(sidebarCollapsedBeforePlanRef.current);
  }, [activeMode]);
  useEffect(() => {
    if (activeMode === "plan") openPlanReview();
  }, [activeMode, modeState.activePlan?.id, state.session.sessionId]);
  const projectName =
    state.projects?.find((p) => p.id === composerProjectId)?.name ||
    state.session.cwd?.split("/").pop() ||
    state.projects?.find((p) => p.id === state.activeProjectId)?.name;

  const changeWorkspaceMode = (mode: "pi" | "http") => {
    setWorkspaceMode(mode);
  };

  const loadOlderArmedRef = useRef(true);
  const loadOlderForActive = async (): Promise<void> => {
    const key = useWorkspaceStore.getState().activeTabId;
    const view = key ? useAppStore.getState().getView(key) : undefined;
    if (!key || !view?.hasMore || !view.oldestId || view.loadingOlder) return;
    useAppStore.getState().putView({ ...view, loadingOlder: true });
    try {
      const page = await api?.loadOlder?.({
        sessionKey: key,
        beforeId: view.oldestId,
        sessionPath: view.session.sessionFile,
      });
      const latest = useAppStore.getState().getView(key);
      if (!latest || !page) return;
      const hasMore = page.items.length > 0 && page.hasMore;
      useAppStore.getState().putView(prependOlder(latest, page.items, hasMore));
      if (useWorkspaceStore.getState().activeTabId === key) {
        useAppStore.getState().bindForeground(key);
      }
    } catch (error) {
      const latest = useAppStore.getState().getView(key);
      if (latest) useAppStore.getState().putView({ ...latest, loadingOlder: false });
      pushError(error instanceof Error ? error.message : String(error));
    }
  };

  const planConversation = state.timeline.length > 0 ? (
    <Timeline
      items={state.timeline}
      scrollElementRef={timelineWrapRef}
      sessionStatus={state.session.status}
      hasMore={activeView?.hasMore}
      onLoadOlder={() => void loadOlderForActive()}
      onReviewChanges={openChanges}
      reviewOpen={inspectorOpen && rightPane === "changes"}
      selectedReviewPath={selectedChangePath}
      onCloseReview={() => setInspectorOpen(false)}
      onUndoChanges={undoChanges}
      interruptedUserMessageIds={interruptedUserMessageIds}
      onCopyInterruptedMessage={copyInterruptedMessage}
      onEditInterruptedMessage={editInterruptedMessage}
      editingInterruptedMessage={editingInterruptedMessage}
      interruptedEditSaving={savingInterruptedMessageEdit}
      onInterruptedMessageTextChange={onInterruptedMessageTextChange}
      onSaveInterruptedMessageEdit={saveInterruptedMessageEdit}
      onCancelInterruptedMessageEdit={onCancelInterruptedMessageEdit}
    />
  ) : undefined;

  // Shared Composer wiring for both the main layout and the HTTP agent chat.
  const composerProps: ComposerProps = {
    onSubmit: submit,
    history: composerHistory,
    conversationId: activeConversationId,
    onAbort: () => void api?.abort(useWorkspaceStore.getState().activeTabId ? { sessionKey: useWorkspaceStore.getState().activeTabId } : undefined),
    onPickFile: () => api?.chooseFile() ?? Promise.resolve(undefined),
    sessions: state.sessions,
    listProjectFiles: (cwd) => api?.listProjectFiles?.(cwd) ?? Promise.resolve([]),
    isRunning: state.session.status === "running",
    commands,
    queue: state.queue,
    onEditFollowUp: editFollowUp,
    onSendFollowUpNow: sendFollowUpNow,
    models: state.models ?? [],
    model: state.session.model,
    projects: state.projects ?? [],
    projectId: composerProjectId,
    onProjectChange: (projectId) => void switchComposerProject(projectId),
    onOpenProject: () => void openProject(),
    thinkingLevel: state.session.thinkingLevel,
    mode: activeMode,
    onModeChange: changeAgentMode,
    onModelSelect: changeAgentModel,
    onThinkingLevel: changeAgentThinking,
    workspaceName: projectName,
    workspacePath: state.session.cwd || undefined,
    branchName,
  };

  const httpAgentChat = (
    <div className="http-agent-chat-shell">
      <div className="http-agent-timeline">
        {state.timeline.length > 0 ? (
          planConversation
        ) : activeView?.hydrate === "loading" ? (
          <div className="session-loading" role="status">
            <span className="session-loading-dot" aria-hidden />
            Loading session…
          </div>
        ) : activeView?.hydrate === "error" ? (
          <div className="session-loading" role="alert">
            <p>{activeView.errorMessage ?? "Failed to open session"}</p>
            <button type="button" onClick={() => activeTabId && void activateTab(activeTabId)}>Retry</button>
          </div>
        ) : (
          <div className="http-chat-empty"><AppIcon name="messageSquare" size="lg" /><p>Ask the Agent to create, review, or explain a test in this Project.</p></div>
        )}
      </div>
      <Composer {...composerProps} placeholder="Ask the Agent about this HTTP test..." />
    </div>
  );

  if (workspaceMode === "http") {
    return (
      <HttpWorkbench
        projects={state.projects ?? []}
        activeProjectId={state.activeProjectId}
        onSelectProject={async (projectId) => {
          await setActiveProject(projectId);
          await switchComposerProject(projectId);
        }}
        onOpenProject={() => void openProject()}
        onModeChange={changeWorkspaceMode}
        onNewChat={requestNewSession}
        sidebarWidth={sidebarWidth}
        agentChat={httpAgentChat}
      />
    );
  }

  return (
    <main
      className={`app-shell ${inspectorOpen ? "with-inspector" : "chat-only"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${inspectorOpen && rightPane === "changes" ? "changes-open" : ""}`}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--right-panel-width": activeMode === "plan" && rightPane === "plan"
          ? "70vw"
          : `${rightPane === "changes" ? changesWidth : rightPane === "plan" ? planWidth : inspectorWidth}px`,
      } as React.CSSProperties}
    >
      <SessionSidebar
        workspaceMode={workspaceMode}
        onWorkspaceModeChange={changeWorkspaceMode}
        projects={state.projects ?? []}
        activeProjectId={state.activeProjectId}
        sessions={state.sessions}
        activeSessionId={state.session.sessionId}
        activeSessionStatus={state.session.status}
        liveSessions={liveSessions}
        model={state.session.model}
        thinkingLevel={state.session.thinkingLevel}
        onAddProject={() => void openProject()}
        onRequestNewSession={() => void openProject()}
        onSelectProject={(projectId) => void setActiveProject(projectId)}
        onRemoveProject={(projectId) => void removeProject(projectId)}
        onRevealInFolder={revealInFolder}
        loadSessions={async (cwd) => (await api?.listSessions?.(cwd)) ?? []}
        onOpenSettings={() => setSettingsOpen(true)}
        updateState={updateState}
        onUpdateAction={handleUpdateAction}
      />

      <div
        className="panel-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onMouseDown={(event) => {
          const startWidth = sidebarWidth;
          startDragResize(event, (dx) => {
            setSidebarWidth(Math.min(420, Math.max(200, startWidth + dx)));
          });
        }}
      />

      <section className={`main-column ${activeMode === "plan" && rightPane === "plan" ? "plan-focus-main" : ""}`}>
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
          onOpenHelp={() => setHelpOpen(true)}
          planButton={activeMode === "execute" && modeState.activePlan
            ? { title: modeState.activePlan.title, onOpen: openPlanReview }
            : undefined}
          hideShortcuts={activeMode === "plan" && rightPane === "plan"}
        />

        <div className="timeline-stage">
          <div
            ref={timelineWrapRef}
            className={`timeline-wrap ${state.timeline.length === 0 ? "is-empty" : ""}`}
            onScroll={() => {
              const wrap = timelineWrapRef.current;
              if (!wrap) return;
              const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
              stickToBottomRef.current = atBottom;
              setScrolledFromBottom(!atBottom);
              if (wrap.scrollTop >= 80) loadOlderArmedRef.current = true;
              if (wrap.scrollTop < 80 && activeView?.hasMore && loadOlderArmedRef.current) {
                loadOlderArmedRef.current = false;
                void loadOlderForActive();
              }
            }}
          >
            <div className="chat-column">
              {state.timeline.length > 0 ? (
                planConversation
              ) : activeView?.hydrate === "loading" ? (
                <div className="session-loading" role="status">
                  <span className="session-loading-dot" aria-hidden />
                  Loading session…
                </div>
              ) : activeView?.hydrate === "error" ? (
                <div className="session-loading" role="alert">
                  <p>{activeView.errorMessage ?? "Failed to open session"}</p>
                  <button type="button" onClick={() => activeTabId && void activateTab(activeTabId)}>Retry</button>
                </div>
              ) : (
                <WelcomeBlock
                  projectName={projectName}
                  hasSession={Boolean(state.session.sessionId)}
                  onOpenProject={() => void openProject()}
                  onNewTask={requestNewSession}
                />
              )}
            </div>
          </div>
          {scrolledFromBottom && state.timeline.length > 0 && (
            <button
              type="button"
              className="timeline-jump-latest"
              aria-label="Jump to latest"
              title="Jump to the latest messages"
              onClick={jumpToLatest}
            >
              <AppIcon name="chevronDown" size="sm" />
              Latest
              <span className="sr-only">New activity is available below.</span>
            </button>
          )}
        </div>

        <div className="composer-dock">
          <div className="chat-column">
            <Composer {...composerProps} />
          </div>
        </div>
      </section>

      {inspectorOpen && (
        <div
          className="panel-resizer right-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right panel"
          onMouseDown={resizeRightPanel}
        />
      )}

      {inspectorOpen && (
        rightPane === "changes" ? (
          <ChangeInspector
            changes={sessionChanges}
            selectedPath={selectedChangePath}
            onSelect={setSelectedChangePath}
            onOpenFile={(path) => void openChangeFile(path)}
            onUndo={(path) => void undoChange(path)}
            onOpenInspector={() => setRightPane("inspector")}
            onOpenPlan={planAvailable ? openPlanReview : undefined}
            onClose={() => setInspectorOpen(false)}
          />
        ) : rightPane === "plan" ? (
          <PlanInspector
            api={api}
            sessionId={state.session.sessionId}
            sessionKey={useWorkspaceStore.getState().activeTabId}
            activePlan={modeState.activePlan}
            editable={planWorkspaceEditable}
            onOpenInspector={() => setRightPane("inspector")}
            onOpenChanges={() => openChanges()}
            onClose={() => setInspectorOpen(false)}
            onError={pushError}
          />
        ) : (
          <ResourceInspector
            session={state.session}
            resources={state.resources}
            tools={state.tools ?? []}
            lockedToolNames={activeMode === "plan" ? ["bash", "edit", "write"] : undefined}
            onToggleTools={(names) => {
              if (!api) return;
              void (async () => {
                const sessionKey = await ensureActiveTabRuntime();
                await api.setTools(names, sessionKey ? { sessionKey } : undefined);
                const snapshot = await api.getSnapshot();
                useAppStore.getState().applyWorkspaceSnapshot(snapshot);
              })().catch((error) => pushError(error instanceof Error ? error.message : String(error)));
            }}
            onToggleSkills={(patterns) => void api?.setSkills(patterns)}
            onOpenChanges={() => openChanges()}
            onOpenPlan={planAvailable ? openPlanReview : undefined}
            changeCount={sessionChanges.length}
            onClose={() => setInspectorOpen(false)}
            tab={inspectorTab}
            onTabChange={setInspectorTab}
          />
        )
      )}

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        onSelect={async (command) => {
          setPaletteOpen(false);
          if (command.source && command.source !== "builtin") {
            // Extension, skill, and prompt-template commands are executed by
            // AgentSession.prompt (extension dispatch + /skill: /<template>
            // expansion) — executeCommand has no handler for them.
            await submit({ text: command.name, attachments: [] });
            return;
          }
          await api?.executeCommand(command.name);
          // Reload (and other state-mutating commands) change main-process
          // resources (extensions/skills/prompts). Re-pull the snapshot so
          // the inspector reflects them without an app restart.
          const snapshot = await api?.getSnapshot();
          if (snapshot) useAppStore.getState().applyWorkspaceSnapshot(snapshot);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        models={state.models ?? []}
        model={state.session.model}
        thinkingLevel={state.session.thinkingLevel}
        onModelSelect={changeAgentModel}
        onThinkingLevel={changeAgentThinking}
        motionEnabled={motionEnabled}
        onMotionEnabledChange={setMotionEnabled}
        onClose={() => setSettingsOpen(false)}
        listProviders={
          api?.listProviders
            ? async () => {
                const rows = await api.listProviders();
                return Array.isArray(rows) ? rows : [];
              }
            : undefined
        }
        loginWithApiKey={api?.loginWithApiKey ? (id, key) => api.loginWithApiKey(id, key) : undefined}
        logoutProvider={api?.logoutProvider ? (id) => api.logoutProvider(id) : undefined}
        loginWithOAuth={api?.loginWithOAuth ? (id) => api.loginWithOAuth(id) : undefined}
        answerAuthPrompt={api?.answerAuthPrompt ? (promptId, answer) => api.answerAuthPrompt(promptId, answer) : undefined}
        cancelProviderLogin={api?.cancelProviderLogin ? (id) => api.cancelProviderLogin(id) : undefined}
        openExternal={api?.openExternal ? (url) => api.openExternal(url) : undefined}
        onProvidersChanged={async () => {
          const nextModels = (await api?.getModels?.()) ?? [];
          useAppStore.setState({ models: nextModels });
        }}
        getMcpConfig={
          api?.getMcpConfig
            ? async () => {
                const view = await api.getMcpConfig();
                return view ?? { cwd: "", sources: [], servers: [] };
              }
            : undefined
        }
        setMcpServerEnabled={api?.setMcpServerEnabled ? (name, enabled) => api.setMcpServerEnabled(name, enabled) : undefined}
        importCursorMcp={api?.importCursorMcp ? () => api.importCursorMcp() : undefined}
        openMcpConfigFile={api?.openMcpConfigFile ? () => api.openMcpConfigFile() : undefined}
        getCompanionState={api?.getCompanionState ? () => api.getCompanionState() : undefined}
        setCompanionEnabled={api?.setCompanionEnabled ? (enabled) => api.setCompanionEnabled(enabled) : undefined}
        rotateCompanionToken={api?.rotateCompanionToken ? () => api.rotateCompanionToken() : undefined}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} diagnostics={state.diagnostics} />
    </main>
  );
}
