import { forwardRef, type SelectHTMLAttributes } from "react";
import { cx } from "../cx";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A native select: the default arrow is removed and a chevron hangs on the wrapper.
 * The native popup layer is kept — a custom dropdown in a plugin environment has to
 * handle positioning and focus escape, while the native behaviour is free and correct.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <span className={cx("pui-select-wrap", className)}>
      <select ref={ref} className="pui-select" {...rest}>
        {children}
      </select>
      <svg
        className="pui-select-chevron"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
});
