import type { HTMLAttributes } from "react";

export type ShortcutPlatform = "mac" | "windows";

interface ShortcutKeyLabel {
  display: string;
  readable: string;
}

const SHARED_KEY_LABELS: Record<string, ShortcutKeyLabel> = {
  shift: { display: "⇧", readable: "Shift" },
  alt: { display: "Alt", readable: "Alt" },
  escape: { display: "Esc", readable: "Escape" },
  enter: { display: "Enter", readable: "Enter" },
  tab: { display: "Tab", readable: "Tab" },
};

function resolvePlatform(): ShortcutPlatform {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "mac"
    : "windows";
}

function getKeyLabel(key: string, platform: ShortcutPlatform): ShortcutKeyLabel {
  const normalized = key.toLowerCase();
  if (normalized === "mod" || normalized === "ctrl" || normalized === "control") {
    return platform === "mac"
      ? { display: "⌘", readable: "Command" }
      : { display: "Ctrl", readable: "Control" };
  }
  if (normalized === "alt" || normalized === "option") {
    return platform === "mac"
      ? { display: "⌥", readable: "Option" }
      : { display: "Alt", readable: "Alt" };
  }
  if (normalized === "shift") return SHARED_KEY_LABELS.shift;
  if (normalized === "esc" || normalized === "escape") return SHARED_KEY_LABELS.escape;
  if (normalized === "return" || normalized === "enter") return SHARED_KEY_LABELS.enter;
  return { display: key, readable: key.length === 1 ? key.toUpperCase() : key };
}

export interface ShortcutKeysProps extends Omit<HTMLAttributes<HTMLSpanElement>, "aria-label"> {
  keys: readonly string[];
  platform?: ShortcutPlatform;
  label?: string;
  compact?: boolean;
}

export function ShortcutKeys({ keys, platform = resolvePlatform(), label, compact = false, className, ...props }: ShortcutKeysProps) {
  const labels = keys.map((key) => getKeyLabel(key, platform));
  const classes = ["shortcut-keys", compact && "shortcut-keys--compact", className].filter(Boolean).join(" ");
  const ariaLabel = label ? `${label}: ${labels.map((item) => item.readable).join(" ")}` : undefined;
  const shortcut = labels.map((item) => item.display).join(platform === "mac" ? "" : "+");

  return (
    <span {...props} className={classes} role={ariaLabel ? "group" : undefined} aria-label={ariaLabel}>
      <kbd data-shortcut-key={keys.join("+")} aria-hidden="true">{shortcut}</kbd>
    </span>
  );
}
