import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSummary } from "../../shared/workspace";

export interface ProjectPickerButtonProps {
  project?: ProjectSummary;
  disabled?: boolean;
  compact?: boolean;
  onClick: () => void;
}

export interface ProjectPickerDialogProps {
  projects: ProjectSummary[];
  activeProjectId?: string;
  open: boolean;
  externalPendingProjectId?: string;
  onClose: () => void;
  onSelect: (projectId: string) => Promise<void>;
}

function projectPath(path: string): string {
  const compact = path.replace(/^\/Users\/[^/]+/, "~");
  return compact.length > 52 ? `…${compact.slice(-49)}` : compact;
}

export function ProjectPickerButton({
  project,
  disabled = false,
  compact = false,
  onClick,
}: ProjectPickerButtonProps) {
  return (
    <button
      type="button"
      className={`companion-project-picker-button${compact ? " is-compact" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={project ? `Change project, currently ${project.name}` : "Choose a project"}
      aria-haspopup="dialog"
    >
      <span className="companion-project-picker-copy">
        <span className="companion-project-picker-label">Project</span>
        <strong>{project?.name ?? "Choose a project"}</strong>
      </span>
      <span className="companion-project-picker-chevron" aria-hidden="true">⌄</span>
    </button>
  );
}

export function ProjectPickerDialog({
  projects,
  activeProjectId,
  open,
  externalPendingProjectId,
  onClose,
  onSelect,
}: ProjectPickerDialogProps) {
  const [query, setQuery] = useState("");
  const [pendingProjectId, setPendingProjectId] = useState<string>();
  const [error, setError] = useState<string>();
  const searchRef = useRef<HTMLInputElement>(null);
  const isBusy = Boolean(pendingProjectId || externalPendingProjectId);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(undefined);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, onClose, open]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return projects;
    return projects.filter((project) =>
      `${project.name} ${project.path}`.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [projects, query]);

  if (!open) return null;

  const chooseProject = async (projectId: string) => {
    if (isBusy) return;
    setPendingProjectId(projectId);
    setError(undefined);
    try {
      await onSelect(projectId);
      onClose();
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : String(selectionError));
    } finally {
      setPendingProjectId(undefined);
    }
  };

  return (
    <div
      className="companion-project-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        className="companion-project-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="companion-project-picker-title"
      >
        <div className="companion-project-picker-grabber" aria-hidden="true" />
        <header className="companion-project-picker-header">
          <div>
            <p className="companion-eyebrow">Workspace</p>
            <h2 id="companion-project-picker-title">Choose a project</h2>
          </div>
          <button
            type="button"
            className="companion-icon-button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Close project picker"
          >
            ×
          </button>
        </header>

        <label className="companion-project-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            disabled={isBusy}
          />
        </label>

        {error && <p className="companion-project-picker-error" role="alert">{error}</p>}

        <div className="companion-project-picker-list" role="listbox" aria-label="Projects">
          {filteredProjects.length === 0 && (
            <p className="companion-empty">No projects match “{query}”.</p>
          )}
          {filteredProjects.map((project) => {
            const isActive = project.id === activeProjectId;
            const isPending = project.id === pendingProjectId || project.id === externalPendingProjectId;
            return (
              <button
                key={project.id}
                type="button"
                className={`companion-project-picker-option${isActive ? " is-active" : ""}`}
                role="option"
                aria-selected={isActive}
                onClick={() => void chooseProject(project.id)}
                disabled={isBusy}
              >
                <span className="companion-project-picker-mark" aria-hidden="true">
                  {isPending ? <span className="companion-spinner" /> : isActive ? "✓" : ""}
                </span>
                <span className="companion-project-picker-option-copy">
                  <strong>{project.name}</strong>
                  <span>{projectPath(project.path)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
