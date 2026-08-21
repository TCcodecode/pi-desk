import { useEffect, useState } from "react";
import type { SessionSummary } from "../../shared/protocol";
import type { ProjectSummary } from "../../shared/workspace";

export interface ProjectDirectoryProps {
  projects: ProjectSummary[];
  activeProjectId?: string;
  sessionsByProject: Record<string, SessionSummary[]>;
  loading: boolean;
  error?: string;
  selectingProjectId?: string;
  onRefresh: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenSession: (project: ProjectSummary, session: SessionSummary) => void;
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function ProjectDirectory({
  projects,
  activeProjectId,
  sessionsByProject,
  loading,
  error,
  selectingProjectId,
  onRefresh,
  onSelectProject,
  onOpenSession,
}: ProjectDirectoryProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(activeProjectId ? [activeProjectId] : []),
  );

  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjects((current) => new Set(current).add(activeProjectId));
    }
  }, [activeProjectId]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <div className="companion-project-directory">
      <div className="companion-panel-heading">
        <div>
          <p className="companion-eyebrow">Workspace</p>
          <h1>Projects</h1>
          <p className="companion-project-path">{projects.length} projects · tap a project to switch</p>
        </div>
        <button type="button" className="companion-icon-button" onClick={onRefresh} disabled={loading} aria-label="Refresh projects">
          ↻
        </button>
      </div>

      {error && <p className="companion-project-picker-error" role="alert">{error}</p>}

      <div className="companion-project-tree" role="tree" aria-label="Projects and sessions">
        {projects.map((project) => {
          const sessions = sessionsByProject[project.id] ?? [];
          const isActive = project.id === activeProjectId;
          const isExpanded = expandedProjects.has(project.id);
          const isSelecting = project.id === selectingProjectId;
          return (
            <div key={project.id} className="companion-project-tree-node" role="treeitem" aria-expanded={isExpanded}>
              <div className={`companion-project-tree-row${isActive ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="companion-project-tree-toggle"
                  onClick={() => toggleProject(project.id)}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${project.name}`}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "⌄" : "›"}
                </button>
                <button
                  type="button"
                  className="companion-project-tree-project"
                  onClick={() => onSelectProject(project.id)}
                  disabled={Boolean(selectingProjectId)}
                  aria-current={isActive ? "true" : undefined}
                >
                  <span className="companion-project-tree-icon" aria-hidden="true">□</span>
                  <span className="companion-project-tree-copy">
                    <strong>{project.name}</strong>
                    <span>{project.path}</span>
                  </span>
                  {isSelecting && <span className="companion-spinner companion-project-tree-spinner" aria-label="Switching project" />}
                  {isActive && !isSelecting && <span className="companion-project-tree-active">Active</span>}
                </button>
              </div>

              {isExpanded && (
                <div className="companion-project-tree-sessions" role="group">
                  {loading && sessions.length === 0 && <p className="companion-project-tree-empty">Loading sessions…</p>}
                  {!loading && sessions.map((session) => (
                    <button
                      key={session.sessionId}
                      type="button"
                      className="companion-project-tree-session"
                      onClick={() => onOpenSession(project, session)}
                      disabled={!session.sessionFile}
                    >
                      <span className="companion-project-tree-branch" aria-hidden="true">└</span>
                      <span className="companion-project-tree-session-icon" aria-hidden="true">◷</span>
                      <span className="companion-project-tree-session-copy">
                        <strong>{session.name}</strong>
                        <span>{formatSessionDate(session.updatedAt)}{session.messageCount ? ` · ${session.messageCount} messages` : ""}</span>
                      </span>
                      <span className="companion-project-tree-arrow" aria-hidden="true">›</span>
                    </button>
                  ))}
                  {!loading && sessions.length === 0 && (
                    <p className="companion-project-tree-empty">No sessions in this project yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {projects.length === 0 && <p className="companion-project-tree-empty">No projects are available yet.</p>}
      </div>
    </div>
  );
}
