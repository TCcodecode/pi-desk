import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "../ui/icons";

export interface ComposerMenuOption {
  value: string;
  label: string;
}

export interface ComposerMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
}

interface ComposerMenuProps {
  ariaLabel: string;
  className?: string;
  title?: string;
  value: string;
  valueLabel: string;
  options: ComposerMenuOption[];
  onChange: (value: string) => void;
  actions?: ComposerMenuAction[];
  suffix?: ReactNode;
  leading?: ReactNode;
}

export function ComposerMenu({
  ariaLabel,
  className = "",
  title,
  value,
  valueLabel,
  options,
  onChange,
  actions = [],
  suffix,
  leading,
}: ComposerMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = `composer-menu-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`composer-menu-control ${className}`.trim()} title={title}>
      <button
        type="button"
        className="composer-menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {leading}
        <span className="composer-menu-value">{valueLabel}</span>
        <AppIcon name="chevronRight" size="xs" aria-hidden className="composer-menu-chevron" />
      </button>
      {suffix}
      {open && (
        <div id={menuId} className="composer-menu-popover" role="listbox" aria-label={`${ariaLabel} options`}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="composer-menu-option"
              onClick={() => {
                setOpen(false);
                onChange(option.value);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <AppIcon name="check" size="xs" aria-hidden />}
            </button>
          ))}
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="option"
              aria-selected={false}
              className="composer-menu-option composer-menu-option-action"
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
