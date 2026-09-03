import { cn } from "@/lib/utils";

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex rounded-sm bg-inset px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase", className)}>
      {children}
    </span>
  );
}
