import type {
  ButtonHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

/**
 * Unified control container for the chatbox (and any in-app control rows).
 *
 * Every select / button / static chip in the composer shares one visual
 * language: 1px border, 8px radius, dark inset background, same hover and
 * focus treatment. Use `as="select"` for a native select wrapped in a label
 * (model, thinking, project), `as="button"` for action
 * buttons (attach and other compact actions), and `as="static"` for read-only chips.
 */
export type ControlBoxVariant = "select" | "button" | "static";

interface ControlBoxBase {
  /** Extra class for the container element. */
  className?: string;
  /** Optional leading icon (e.g. the model dot). */
  icon?: ReactNode;
  /** Accessible name; applied to the interactive element (or the chip). */
  ariaLabel?: string;
  /** Tooltip on the container. */
  title?: string;
  children?: ReactNode;
}

export interface ControlBoxSelectProps extends ControlBoxBase {
  as: "select";
  /** Native select props (value, onChange, …) forwarded to the <select>. */
  selectProps?: Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">;
  children?: ReactNode;
}

export interface ControlBoxButtonProps extends ControlBoxBase {
  as: "button";
  /** Native button props (onClick, …) forwarded to the <button>. */
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;
  children?: ReactNode;
}

export interface ControlBoxStaticProps extends ControlBoxBase {
  as: "static";
  children?: ReactNode;
}

export type ControlBoxProps =
  | ControlBoxSelectProps
  | ControlBoxButtonProps
  | ControlBoxStaticProps;

export function ControlBox(props: ControlBoxProps) {
  const { as, className, icon, ariaLabel, title, children } = props;

  if (as === "select") {
    const { selectProps } = props;
    return (
      <label className={className} title={title}>
        {icon}
        <select aria-label={ariaLabel} {...selectProps}>
          {children}
        </select>
      </label>
    );
  }

  if (as === "button") {
    const { buttonProps } = props;
    return (
      <button type="button" className={className} aria-label={ariaLabel} {...buttonProps}>
        {icon}
        {children}
      </button>
    );
  }

  return (
    <span className={className} aria-label={ariaLabel} title={title}>
      {icon}
      {children}
    </span>
  );
}
