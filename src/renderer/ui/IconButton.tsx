import type { MouseEvent, ReactNode } from "react";

/**
 * Icon-only button with a consistent `sidebar-icon-btn` treatment.
 * Replaces the local IconButton in SessionSidebar.tsx; `className` allows
 * callers to restyle (e.g. `accent` kept via the base class).
 */
export function IconButton({
  label,
  title,
  accent = false,
  className,
  onClick,
  children,
}: {
  label: string;
  title: string;
  accent?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const base = ["sidebar-icon-btn", accent ? "accent" : "", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={base} aria-label={label} title={title} onClick={onClick}>
      {children}
    </button>
  );
}
