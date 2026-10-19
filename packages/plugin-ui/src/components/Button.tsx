import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "../cx";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the host CTA gradient; secondary = outlined light fill (the toolbar default); ghost = borderless */
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
}

/** A native button; every style consumes host semantic tokens (see the ../tokens.ts contract). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // Outside a plugin container we may sit in a form context, so default to button to avoid accidental submits
      type={type ?? "button"}
      className={cx("pui-btn", `pui-btn-${variant}`, size === "sm" && "pui-btn-sm", className)}
      {...rest}
    />
  );
});
