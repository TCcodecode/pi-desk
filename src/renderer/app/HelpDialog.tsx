import type { RuntimeDiagnostics } from "../../shared/protocol";
import { AppIcon } from "../ui/icons";
import { ShortcutKeys } from "./ShortcutKeys";
import { Dialog } from "../ui/Dialog";

export interface HelpShortcut {
  keys: string[];
  action: string;
}

interface HelpShortcutGroup {
  label: string;
  shortcuts: HelpShortcut[];
}

const SHORTCUT_GROUPS: HelpShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["mod", "K"], action: "Open command palette" },
      { keys: ["mod", "N"], action: "New task" },
      { keys: ["mod", "W"], action: "Close current session tab" },
      { keys: ["mod", "B"], action: "Toggle inspector" },
      { keys: ["mod", "?"], action: "Keyboard shortcuts" },
      { keys: ["mod", "1"], action: "Switch to open session tab 1–9" },
      { keys: ["mod", "G"], action: "Release focus from composer" },
    ],
  },
  {
    label: "Composer",
    shortcuts: [
      { keys: ["/"], action: "Open command suggestions" },
      { keys: ["escape"], action: "Stop agent or close dialogs" },
      { keys: ["enter"], action: "Send message" },
      { keys: ["shift", "enter"], action: "New line in composer" },
    ],
  },
];

export function HelpDialog({ open, onClose, diagnostics }: { open: boolean; onClose: () => void; diagnostics?: RuntimeDiagnostics }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      label="Help and diagnostics"
      backdropClassName="help-backdrop"
      panelClassName="help-dialog"
    >
      <div className="help-header">
          <div>
            <strong>Keyboard shortcuts</strong>
            <p>While this window is focused</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close help">
            <AppIcon name="x" size="sm" />
          </button>
        </div>

        <div className="help-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section className="help-section" key={group.label} aria-labelledby={`help-${group.label.toLowerCase()}`}>
              <div className="help-section-heading">
                <span id={`help-${group.label.toLowerCase()}`}>{group.label}</span>
                <span>Shortcut</span>
              </div>
              <div className="help-list">
                {group.shortcuts.map((shortcut) => (
                  <div className="help-row" key={shortcut.action}>
                    <span className="help-action">{shortcut.action}</span>
                    <ShortcutKeys className="help-keys" keys={shortcut.keys} label={shortcut.action} />
                  </div>
                ))}
              </div>
            </section>
          ))}

          {diagnostics && (
            <section className="help-section help-diagnostics" aria-label="Runtime diagnostics">
              <div className="help-section-heading">
                <span>Runtime</span>
                <span>Status</span>
              </div>
              <div className="diagnostic-row">
                <span>Pi version</span>
                <strong>{diagnostics.piVersion}</strong>
              </div>
              <div className="diagnostic-row">
                <span>Session ID</span>
                <strong>{diagnostics.sdkSessionId ?? "not started"}</strong>
              </div>
              <div className="diagnostic-row">
                <span>Events</span>
                <strong>{diagnostics.sequence}</strong>
              </div>
              {diagnostics.errors.map((error) => (
                <pre key={error}>{error}</pre>
              ))}
            </section>
          )}
        </div>

        <div className="help-footer" aria-label="Tips">
          <div className="help-tip">
            <span className="help-tip-label">Tip</span>
            <p>Type / in the composer · <ShortcutKeys keys={["mod", "K"]} /> all commands</p>
          </div>
          <div className="help-tip">
            <span className="help-tip-label">Tabs</span>
            <p>Up to 9 · <ShortcutKeys keys={["mod", "P"]} /> pin · <ShortcutKeys keys={["mod", "W"]} /> close</p>
          </div>
        </div>
    </Dialog>
  );
}
