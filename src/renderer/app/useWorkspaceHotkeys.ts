import { useEffect } from "react";
import {
  activateTab,
  closeWorkspaceTab,
  toggleWorkspacePin,
} from "../workspace/workspaceActions";
import { sortTabsPinnedFirst } from "../workspace/sessionTabs";
import { useWorkspaceStore } from "../workspace/workspaceStore";

export function useWorkspaceHotkeys(options: {
  onNewSession: () => void;
  onTogglePalette: () => void;
  onToggleInspector: () => void;
  onToggleHelp: () => void;
}): void {
  const { onNewSession, onTogglePalette, onToggleInspector, onToggleHelp } = options;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        event.stopPropagation();
        onNewSession();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onTogglePalette();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        onToggleInspector();
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "?" || event.key === "/")) {
        event.preventDefault();
        onToggleHelp();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.code === "KeyP" || event.key.toLowerCase() === "p")
      ) {
        const id = useWorkspaceStore.getState().activeTabId;
        if (id) {
          event.preventDefault();
          event.stopPropagation();
          toggleWorkspacePin(id);
        }
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "w"
      ) {
        const id = useWorkspaceStore.getState().activeTabId;
        if (id) {
          event.preventDefault();
          event.stopPropagation();
          void closeWorkspaceTab(id);
        }
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const digit = event.key >= "1" && event.key <= "9" ? Number(event.key) : -1;
        if (digit >= 1) {
          const tab = sortTabsPinnedFirst(useWorkspaceStore.getState().tabs)[digit - 1];
          if (tab) {
            event.preventDefault();
            void activateTab(tab.id);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewSession, onTogglePalette, onToggleInspector, onToggleHelp]);
}
