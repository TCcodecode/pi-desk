import { AppIcon } from "./icons";
import { useCopyToClipboard } from "./useCopyToClipboard";

/**
 * Compact copy button with icon and "Copied" confirmation state.
 * Replaces the local CopyButton in Timeline.tsx.
 */
export function CopyButton({ text, label, className = "tool-copy" }: { text: string; label: string; className?: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <button type="button" className={className} aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => void copy(text)}>
      <AppIcon name={copied ? "check" : "copy"} size="xs" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
