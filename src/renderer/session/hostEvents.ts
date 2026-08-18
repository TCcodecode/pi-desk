import type { PiApi, PiEvent, SessionStatus } from "../../shared/protocol";
import {
  useWorkspaceStore,
} from "../workspace/workspaceStore";
import { activateTab } from "../workspace/workspaceActions";
import {
  ensureInWorkingSet,
  findRestorableTab,
  loadOpenTabs,
} from "../workspace/sessionTabs";
import { useAppStore } from "./store";

const SESSION_SCOPED_EVENT_TYPES = new Set<PiEvent["type"]>([
  "session_started",
  "session_completed",
  "session_error",
  "user_message_created",
  "assistant_message_started",
  "assistant_message_delta",
  "assistant_message_completed",
  "thinking_started",
  "thinking_delta",
  "thinking_completed",
  "tool_call_started",
  "tool_call_delta",
  "tool_call_completed",
  "file_change_undone",
  "queue_updated",
  "model_changed",
  "thinking_level_changed",
  "mode_changed",
  "plan_artifact_changed",
  "agent_started",
  "turn_started",
  "turn_completed",
  "compaction_started",
  "compaction_completed",
  "auto_retry_started",
  "auto_retry_completed",
  "model_select",
  "session_name_changed",
  "todos_updated",
]);

export function subscribeHostEvents(
  api: PiApi,
  options: {
    promoteTab: (sessionKey?: string) => void;
    patchTabStatus: (sessionKey: string, status: SessionStatus) => void;
  },
): () => void {
  let active = true;
  const unsubscribe = api.onEvent((event) => {
    if (event.type === "live_sessions_changed") {
      useWorkspaceStore.getState().setLiveSessions(event.payload.sessions);
      return;
    }

    const key = event.sessionKey;
    const isSessionScoped = SESSION_SCOPED_EVENT_TYPES.has(event.type);

    if (
      event.type === "user_message_created" ||
      event.type === "agent_started" ||
      event.type === "turn_started"
    ) {
      options.promoteTab(key);
    }

    if (key && isSessionScoped) {
      if (event.type === "agent_started" || event.type === "turn_started") {
        options.patchTabStatus(key, "running");
      } else if (event.type === "turn_completed" || event.type === "session_completed") {
        options.patchTabStatus(key, event.type === "session_completed" ? "completed" : "idle");
      } else if (event.type === "session_error") {
        options.patchTabStatus(key, "error");
      } else if (event.type === "session_name_changed") {
        useWorkspaceStore.getState().patchTabFields(key, {
          ...(event.payload.name ? { title: event.payload.name } : {}),
          ...(event.payload.sessionId ? { sessionId: event.payload.sessionId } : {}),
          ...(event.payload.sessionFile ? { sessionFile: event.payload.sessionFile } : {}),
        });
      }
    }

    useAppStore.getState().applyEvent(event);
  });

  void api.getSnapshot().then(async (snapshot) => {
    if (!active) return;
    useAppStore.getState().applyWorkspaceSnapshot(snapshot);
    const projects = await api.listProjects?.();
    if (projects && active) {
      const activeProjectId = snapshot.activeProjectId ?? projects[0]?.id;
      useAppStore.setState({ projects, activeProjectId });
      const project = projects.find((item) => item.id === activeProjectId);
      if (project && api.listSessions) {
        const list = await api.listSessions(project.path);
        if (!active) return;
        useAppStore.setState({ sessions: list });
        const saved = loadOpenTabs();
        const preferred =
          findRestorableTab(saved.tabs, saved.activeTabId, project.id, project.path) ??
          (list[0]?.sessionFile
            ? {
                id: `file:${list[0].sessionFile}`,
                sessionId: list[0].sessionId,
                sessionFile: list[0].sessionFile,
                projectId: project.id,
                title: list[0].name,
              }
            : undefined);
        if (preferred?.sessionFile) {
          const sessionKey =
            "id" in preferred && preferred.id
              ? preferred.id
              : `file:${preferred.sessionFile}`;
          const next = ensureInWorkingSet(
            saved.tabs.length ? saved.tabs : [],
            {
              id: sessionKey,
              sessionId: preferred.sessionId,
              sessionFile: preferred.sessionFile,
              projectId: project.id,
              title: preferred.title || "Untitled",
              isPreview: false,
            },
            sessionKey,
          );
          if (next.ok) {
            useWorkspaceStore.getState().replaceWorkingSet(next.tabs, next.activeTabId);
            await activateTab(sessionKey);
          }
        }
      }
    }
    if (api.listLiveSessions && active) {
      const live = await api.listLiveSessions();
      if (active) useWorkspaceStore.getState().setLiveSessions(live);
    }
  });

  return () => {
    active = false;
    unsubscribe();
  };
}
