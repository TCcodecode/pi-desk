import { useState, type ReactNode } from "react";
import { AppIcon } from "./icons";

/**
 * Collapsible inspector section with chevron + optional count badge.
 * Extracted from ResourceInspector.tsx.
 */
export function CollapsibleSection({ title, count, defaultOpen, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <section className="inspector-section">
      <button className="inspector-section-heading" onClick={() => setOpen((prev) => !prev)}>
        <AppIcon name="chevronRight" size="xs" className={`section-chevron ${open ? "open" : ""}`} />
        <span>{title}</span>
        {count !== undefined && <span className="section-count">{count}</span>}
      </button>
      {open && <div className="inspector-section-body">{children}</div>}
    </section>
  );
}
