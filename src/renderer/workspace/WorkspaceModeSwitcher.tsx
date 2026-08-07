export type WorkspaceMode = "pi" | "http";

export interface WorkspaceModeSwitcherProps {
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
}

export function WorkspaceModeSwitcher({ mode, onModeChange }: WorkspaceModeSwitcherProps) {
  return (
    <div className="mode-switcher" role="group" aria-label="Workspace mode">
      <button
        type="button"
        aria-pressed={mode === "pi"}
        className={mode === "pi" ? "is-active" : ""}
        onClick={() => onModeChange("pi")}
      >
        Agent
      </button>
      <button
        type="button"
        aria-pressed={mode === "http"}
        className={mode === "http" ? "is-active" : ""}
        onClick={() => onModeChange("http")}
      >
        HTTP Workbench
      </button>
    </div>
  );
}
