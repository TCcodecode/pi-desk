import { useCallback, useRef, useState } from "react";

/**
 * Clipboard copy with a transient "copied" flag (1.2s reset).
 *
 * Keeps the restricted-environment guard from the original implementations:
 * without `navigator.clipboard.writeText` (non-secure contexts, tests) the
 * copy is a no-op and never claims success.
 */
export function useCopyToClipboard(): { copied: boolean; copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  const copy = useCallback(async (text: string) => {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1200);
      return true;
    } catch {
      // Clipboard can be unavailable in restricted environments; stay quiet.
      return false;
    }
  }, []);

  return { copied, copy };
}
