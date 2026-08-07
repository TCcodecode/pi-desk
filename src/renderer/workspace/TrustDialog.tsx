import { AppIcon } from "../ui/icons";
import { Dialog } from "../ui/Dialog";

export function TrustDialog({ open, cwd, hasProjectResources, onResolve }: { open: boolean; cwd: string; hasProjectResources: boolean; onResolve: (trusted: boolean) => void }) {
  return (
    <Dialog
      open={open}
      label="Project trust"
      backdropClassName="trust-backdrop"
      panelClassName="trust-dialog"
      closeOnBackdrop={false}
      closeOnEscape={false}
    >
      <div className="trust-icon" aria-hidden><AppIcon name="shieldAlert" size="lg" /></div>
      <h2 className="trust-title">Trust this project?</h2>
      <p className="trust-copy">
        Pi found project-local resources{hasProjectResources ? " (extensions, skills, or settings)" : ""} in this folder.
        Trusting lets Pi load and run them.
      </p>
      <div className="trust-path">
        <span className="trust-path-icon" aria-hidden><AppIcon name="folder" size="sm" /></span>
        <code>{cwd}</code>
      </div>
      <p className="trust-note">Trust only controls resource loading — it is not a security sandbox.</p>
      <div className="trust-actions">
        <button className="trust-btn primary" onClick={() => onResolve(true)}>Trust project</button>
        <button className="trust-btn" onClick={() => onResolve(false)}>Don&apos;t trust</button>
      </div>
    </Dialog>
  );
}
