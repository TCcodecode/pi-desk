import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../shared/protocol";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  displayTabTitle,
  modKeyLabel,
  pinShortcutLabel,
  sortTabsPinnedFirst,
  tabShortcutLabel,
  type SessionTab,
} from "./sessionTabs";
import { useAppStore } from "../session/store";
import { useWorkspaceStore } from "./workspaceStore";
import {
  activateTab,
  closeOtherTabs,
  closeTabsToRight,
  closeWorkspaceTab,
  toggleWorkspacePin,
} from "./workspaceActions";
import { AppIcon } from "../ui/icons";
import { ShortcutKeys } from "../app/ShortcutKeys";

export interface SessionTabBarProps {
  hideShortcuts?: boolean;
}

function projectLabel(projectId: string, projects: ProjectSummary[]): string {
  const match = projects.find((item) => item.id === projectId || item.path === projectId);
  if (match?.name?.trim()) return match.name.trim();
  const segment = projectId.replace(/\/+$/, "").split("/").pop();
  return segment?.trim() || projectId;
}

function statusClass(status: SessionTab["status"]): string {
  if (status === "running") return "is-running";
  if (status === "awaiting_approval") return "is-waiting";
  if (status === "completed") return "is-completed";
  if (status === "error") return "is-error";
  return "";
}

export function SessionTabBar({
  hideShortcuts = false,
}: SessionTabBarProps) {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const projects = useAppStore((state) => state.projects ?? []);
  const onActivate = (tabId: string) => void activateTab(tabId);
  const onClose = (tabId: string) => void closeWorkspaceTab(tabId);
  const onCloseOthers = (tabId: string) => void closeOtherTabs(tabId);
  const onCloseToRight = (tabId: string) => void closeTabsToRight(tabId);
  const onTogglePin = (tabId: string) => toggleWorkspacePin(tabId);
  const mod = modKeyLabel();
  const orderedTabs = sortTabsPinnedFirst(tabs);
  const isSingleTab = orderedTabs.length === 1;
  const pinShortcut = pinShortcutLabel(mod);

  // Sliding capsule indicator: one pill that glides between tabs instead of
  // each tab painting its own active background. It is measured from the
  // active tab's box and animated with transform/width.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [slider, setSlider] = useState<{ x: number; width: number } | null>(null);

  const updateSlider = useCallback(() => {
    const scroll = scrollRef.current;
    const activeEl = scroll?.querySelector<HTMLElement>(".session-tab.active");
    if (!scroll || !activeEl) {
      setSlider(null);
      return;
    }
    const scrollRect = scroll.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    setSlider({ x: elRect.left - scrollRect.left, width: elRect.width });
  }, []);

  // Measure before paint so the capsule is in place on the first frame.
  useLayoutEffect(() => {
    updateSlider();
  }, [updateSlider, activeTabId, tabs]);

  // Track layout changes (title width, tab add/close, font load) and scroll.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => updateSlider());
      observer.observe(scroll);
    }
    scroll.addEventListener("scroll", updateSlider, { passive: true });
    return () => {
      observer?.disconnect();
      scroll.removeEventListener("scroll", updateSlider);
    };
  }, [updateSlider]);

  return (
    <div className="session-tab-bar" role="tablist" aria-label="Open sessions">
      <div ref={scrollRef} className={`session-tab-scroll ${isSingleTab ? "is-single" : ""}`}>
        {slider && !isSingleTab ? (
          <div
            className="session-tab-slider"
            style={{ transform: `translateX(${slider.x}px)`, width: slider.width }}
            aria-hidden
          />
        ) : null}
        {orderedTabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          const title = displayTabTitle(tab.title);
          const project = projectLabel(tab.projectId, projects);
          const switchShortcut = tabShortcutLabel(index, mod);
          const status = statusClass(tab.status);
          const pinLabel = tab.pinned ? `Unpin “${title}”` : `Pin “${title}”`;
          const showPinShortcut = isSingleTab && !hideShortcuts;
          const pinControlLabel = showPinShortcut ? `${pinLabel} · Shortcut: ${pinShortcut}` : pinLabel;
          const hasOtherTabs = orderedTabs.length > 1;
          const hasTabsToRight = index < orderedTabs.length - 1;
          const pinControl = (
            <button
              type="button"
              className={`session-tab-pin session-tab-pin-control ${tab.pinned ? "is-pinned" : ""} ${showPinShortcut ? "" : "is-icon-only"}`}
              aria-label={pinControlLabel}
              title={pinControlLabel}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(tab.id);
              }}
            >
              <AppIcon name="pin" size="md" fill={tab.pinned ? "currentColor" : "none"} />
              {showPinShortcut ? (
                <ShortcutKeys
                  className="session-tab-pin-kbd"
                  compact
                  keys={["mod", "P"]}
                  title={`Pin or unpin tab: ${pinShortcut}`}
                />
              ) : null}
            </button>
          );
          return (
            <ContextMenu.Root key={tab.id}>
              <ContextMenu.Trigger asChild>
                <div
                  className={`session-tab session-tab--stacked ${active ? "active" : ""} ${tab.pinned ? "is-pinned" : ""} ${tab.isPreview ? "is-preview" : ""}`}
                  role="tab"
                  aria-selected={active}
                  title={[project, title, switchShortcut ? `Switch: ${switchShortcut}` : null]
                    .concat(isSingleTab ? [`Pin: ${pinShortcut}`] : [])
                    .filter(Boolean)
                    .join(" · ")}
                >
                  {isSingleTab && status ? (
                    <span className={`session-tab-dot ${status}`} aria-hidden />
                  ) : null}
                  {pinControl}
                  <button
                    type="button"
                    className="session-tab-main"
                    onClick={() => onActivate(tab.id)}
                  >
                    {!isSingleTab && status ? (
                      <span className={`session-tab-dot ${status}`} aria-hidden />
                    ) : null}
                    <span className="session-tab-text">
                      <span className="session-tab-project">{project || "Project"}</span>
                      <span className="session-tab-title">{title}</span>
                    </span>
                    {switchShortcut && !hideShortcuts ? (
                      <ShortcutKeys
                        className="session-tab-kbd"
                        compact
                        keys={["mod", String(index + 1)]}
                        label={`Switch tab ${index + 1}`}
                        title={`Switch tab ${switchShortcut}`}
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="session-tab-close"
                    aria-label={`Close ${title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                  >
                    <AppIcon name="x" size="xs" />
                  </button>
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="session-context-menu" alignOffset={4}>
                  <ContextMenu.Item className="session-context-item" onSelect={() => onClose(tab.id)}>
                    Close
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="session-context-item"
                    disabled={!hasOtherTabs}
                    onSelect={() => onCloseOthers?.(tab.id)}
                  >
                    Close other tabs
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="session-context-item"
                    disabled={!hasTabsToRight}
                    onSelect={() => onCloseToRight?.(tab.id)}
                  >
                    Close tabs to the right
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="session-context-separator" />
                  <ContextMenu.Item className="session-context-item" onSelect={() => onTogglePin(tab.id)}>
                    {tab.pinned ? "Unpin tab" : "Pin tab"}
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </div>
  );
}
