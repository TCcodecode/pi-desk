import { AppIcon } from "../ui/icons";
import { ShortcutKeys } from "./ShortcutKeys";
import { SessionTabBar } from "../workspace/SessionTabBar";

/**
 * Main-column top bar: sidebar toggle, session tabs, and the action cluster
 * (return to plan / help / inspector). Extracted from App.tsx.
 */
export function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
  inspectorOpen,
  onToggleInspector,
  onOpenHelp,
  planButton,
  hideShortcuts,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onOpenHelp: () => void;
  /** "Return to plan" button, shown while a plan is active in execute mode. */
  planButton?: { title: string; onOpen: () => void };
  /** Shortcut hints are hidden while the plan pane owns the topbar. */
  hideShortcuts: boolean;
}) {
  return (
    <header className="topbar topbar-with-tabs">
      <button
        type="button"
        className={`topbar-left-panel-toggle ${sidebarCollapsed ? "is-collapsed" : ""}`}
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onToggleSidebar}
      >
        <AppIcon name="panelLeft" size="md" />
      </button>
      <div className="topbar-tabs">
        <SessionTabBar hideShortcuts={hideShortcuts} />
      </div>
      <div className="topbar-side topbar-actions">
        {planButton ? (
          <button
            type="button"
            className="topbar-button plan-return-button"
            aria-label="Open plan"
            title={`Open plan: ${planButton.title}`}
            onClick={planButton.onOpen}
          >
            <AppIcon name="fileText" size="sm" />
            <span>Open plan</span>
          </button>
        ) : null}
        <button
          className="topbar-button shortcut-action-container help-button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={onOpenHelp}
        >
          <AppIcon name="circleHelp" size="md" />
          {!hideShortcuts ? <ShortcutKeys className="topbar-kbd" compact keys={["mod", "?"]} /> : null}
        </button>
        <button
          type="button"
          className={`topbar-button shortcut-action-container ${inspectorOpen ? "active" : ""}`}
          aria-label={inspectorOpen ? "Hide right panel" : "Show right panel"}
          title={inspectorOpen ? "Hide right panel" : "Show right panel"}
          onClick={onToggleInspector}
        >
          <AppIcon name="panelRight" size="md" />
          {!hideShortcuts ? <ShortcutKeys className="topbar-kbd" compact keys={["mod", "B"]} /> : null}
        </button>
      </div>
    </header>
  );
}
