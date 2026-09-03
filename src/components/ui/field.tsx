import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[11px] tracking-wide text-subtle uppercase", className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-md bg-inset px-3 text-sm font-light text-fg shadow-[var(--shadow-border)] outline-none focus:shadow-[var(--shadow-border-hover)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-24 w-full rounded-md bg-inset px-3 py-2 text-sm font-light text-fg shadow-[var(--shadow-border)] outline-none focus:shadow-[var(--shadow-border-hover)]",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
