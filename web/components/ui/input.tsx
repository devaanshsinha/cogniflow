import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-11 w-full rounded-xl border border-neutral-200 bg-white/80 px-4 text-sm shadow-sm transition focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-100 dark:focus:border-neutral-500 dark:focus:ring-neutral-700",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
