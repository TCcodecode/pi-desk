import { useEffect, type HTMLAttributes, type ReactNode } from "react";

/**
 * Shared modal dialog chrome: fixed backdrop + centered panel.
 *
 * Replaces the hand-rolled `palette-backdrop` + panel + `stopPropagation`
 * pattern that was duplicated across HelpDialog, SettingsDialog,
 * CommandPalette, TreeDialog, ProjectPickerDialog and TrustDialog.
 *
 * Visual contract is preserved through class tokens: the backdrop keeps the
 * `palette-backdrop` base class (override with `backdropClassName`, e.g.
 * `help-backdrop` / `trust-backdrop`), and `panelClassName` carries the
 * dialog-specific surface class (`settings-dialog`, `tree-dialog`, ...).
 *
 * Behavioural contract:
 * - `role="dialog"` + `aria-label` on the backdrop (matches previous markup).
 * - Clicking the backdrop closes unless `closeOnBackdrop={false}`.
 * - Escape closes via a window keydown listener unless `closeOnEscape={false}`
 *   or no `onClose` is provided (blocking dialogs like TrustDialog).
 * - Content clicks never bubble to the backdrop (stopPropagation).
 */
export interface DialogProps {
  open: boolean;
  /** Accessible name for the dialog (role="dialog" aria-label). */
  label: string;
  /** Close callback for backdrop clicks / Escape. Optional for blocking dialogs. */
  onClose?: () => void;
  /** Extra class(es) for the backdrop element (keeps the palette-backdrop base). */
  backdropClassName?: string;
  /** Class(es) for the panel element. */
  panelClassName?: string;
  /** Clicking the backdrop closes the dialog. Default true. */
  closeOnBackdrop?: boolean;
  /** Escape closes the dialog. Default true. */
  closeOnEscape?: boolean;
  /** Extra props forwarded to the panel element (aria-* etc.). */
  panelProps?: Omit<HTMLAttributes<HTMLDivElement>, "className" | "onClick">;
  children?: ReactNode;
}

export function Dialog({
  open,
  label,
  onClose,
  backdropClassName,
  panelClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  panelProps,
  children,
}: DialogProps) {
  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <div
      className={`palette-backdrop${backdropClassName ? ` ${backdropClassName}` : ""}`}
      role="dialog"
      aria-label={label}
      onClick={closeOnBackdrop && onClose ? onClose : undefined}
    >
      <div
        className={panelClassName}
        onClick={(event) => event.stopPropagation()}
        {...panelProps}
      >
        {children}
      </div>
    </div>
  );
}
