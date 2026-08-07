import { AppIcon } from "../ui/icons";

/**
 * Empty-state hero for the chat column: which action to take next depends on
 * whether a project and/or a session are open. Extracted from App.tsx.
 */
export function WelcomeBlock({
  projectName,
  hasSession,
  onOpenProject,
  onNewTask,
}: {
  projectName?: string;
  hasSession: boolean;
  onOpenProject: () => void;
  onNewTask: () => void;
}) {
  const isEmpty = Boolean(projectName && hasSession);
  return (
    <div className="welcome-block">
      {!isEmpty ? (
        <div className="welcome-orb"><AppIcon name="messageSquare" size="lg" /></div>
      ) : null}
      <h1>
        {!projectName
          ? "Open a project"
          : hasSession
            ? "What are we building?"
            : "No session open"}
      </h1>
      {!isEmpty ? (
        <>
          <p className="welcome-copy">
            {!projectName
              ? "Use + next to Projects, or Open project… in the chat box."
              : "Select a session in the sidebar, or create a new one."}
          </p>
          {!projectName ? (
            <button type="button" className="welcome-primary" onClick={onOpenProject}>
              Open project
            </button>
          ) : (
            <button type="button" className="welcome-primary" onClick={onNewTask}>
              New task
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
